/**
 * Backtest a maker strategy against recorded order-book history, then score the result with the production
 * scorer (buildEpoch). The bot's orders are written into the log stream as real OrderCreated / OrdersCanceled /
 * Trade logs, so what it "earns" here is exactly what the epoch builder would pay.
 *
 * Fill model (simple and on the pessimistic side for the maker): when a recorded taker trade hit a resting order
 * at a price worse for the taker than our quote on that side, the taker is assumed to have hit us first. Our fill
 * does not remove the recorded trade from the other maker, so the book is slightly over-filled, not under.
 * Actions take effect one block after the decision (one transaction's latency).
 */
import { ethers } from "ethers";
import { BOOK_TOPICS, bestOf, decodeBookLogs, obIface, replay, type Order } from "../core/book";
import { buildEpoch, epochMetrics, epochRange, type Campaign, type EpochFile } from "../core/epoch";
import type { RawLog } from "../core/rpc";
import { decide, type BotParams, type Market, type MyOrder } from "./strategy";

export const SIM_BOT = "0xb07b07b07b07b07b07b07b07b07b07b07b07b07b".toLowerCase();

export interface SimResult {
  strategy: string;
  params: BotParams;
  epoch: number;
  payout: number; // reward tokens
  sharePct: number;
  places: number;
  cancels: number;
  txs: number; // place and cancel transactions the bot would send
  fills: number;
  inventory: number; // base, human units, net from fills
  restingTwoSidedPct: number; // share of sample blocks where the bot had a scoring bid AND ask
  withBot: ReturnType<typeof epochMetrics>;
  withoutBot: ReturnType<typeof epochMetrics>;
}

export async function simulateBot(opts: {
  campaign: Campaign;
  epoch: number;
  logs: RawLog[]; // book logs from replayFromBlock through the epoch's last block
  blockHash: (n: number) => Promise<string>;
  market: Market;
  params: BotParams;
  strategy: string;
  everyBlocks?: number; // decision cadence (~2 s at 0.3 s blocks)
  baseline?: EpochFile; // the committed epoch, to skip recomputing "without bot"
}): Promise<SimResult> {
  const { campaign: c, epoch, market: m, params } = opts;
  const every = opts.everyBlocks ?? 7;
  const { fromBlock, toBlock } = epochRange(c, epoch);
  const start = Math.max(c.replayFromBlock, fromBlock - 2 * c.minRestBlocks); // warm up so the first samples can count
  const sorted = [...opts.logs].filter((l) => l.blockNumber <= toBlock).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

  // others' book, advanced block by block
  const byBlock = new Map<number, RawLog[]>();
  for (const l of sorted) (byBlock.get(l.blockNumber) ?? byBlock.set(l.blockNumber, []).get(l.blockNumber)!).push(l);
  const others = new Map<number, Order>();
  const applyOthers = (logs: RawLog[]) => {
    for (const e of decodeBookLogs(logs)) {
      if (e.kind === "create") others.set(e.order.id, { ...e.order });
      else if (e.kind === "cancel") e.ids.forEach((id) => others.delete(id));
      else {
        const o = others.get(e.id);
        if (!o) continue;
        if (e.size === 0n) others.delete(e.id);
        else o.size = e.size;
      }
    }
  };
  // fast-forward to the bot's start
  for (const l of sorted) if (l.blockNumber < start) applyOthers([l]);

  const botLogs: RawLog[] = [];
  const market = sorted[0]?.address ?? c.market;
  let li = 0;
  const emit = (block: number, name: string, args: unknown[]) => {
    const { data, topics } = obIface.encodeEventLog(obIface.getEvent(name), args);
    botLogs.push({ address: market, data, topics, blockNumber: block, logIndex: 100_000 + li++, transactionHash: ethers.utils.id(`sim-${block}-${li}`), blockHash: ethers.constants.HashZero, transactionIndex: 0, removed: false } as RawLog);
  };

  const mine = new Map<number, MyOrder>();
  let nextId = 900_000_000;
  let inventory = 0n, places = 0, cancels = 0, txs = 0, fills = 0;
  const P = BigInt(c.pricePrecision);
  const refRaw = c.refPrice === null ? null : BigInt(c.refPrice);
  let pending: ReturnType<typeof decide>["actions"] = [];

  for (let b = start; b <= toBlock; b++) {
    // 1. last tick's transactions land in this block
    for (const a of pending) {
      txs++;
      if (a.kind === "cancel") {
        const ids = a.ids.filter((id) => mine.has(id));
        if (!ids.length) continue;
        ids.forEach((id) => mine.delete(id));
        cancels += ids.length;
        emit(b, "OrdersCanceled", [ids, SIM_BOT]);
      } else {
        const id = nextId++;
        mine.set(id, { id, isBuy: a.isBuy, price: a.price, size: a.size, createdBlock: b });
        places++;
        emit(b, "OrderCreated", [id, SIM_BOT, a.size, a.price, a.isBuy]);
      }
    }
    pending = [];

    // 2. recorded activity in this block; takers who hit a worse price than ours hit us first
    const blockLogs = byBlock.get(b) ?? [];
    for (const l of blockLogs) {
      if (l.topics[0] === BOOK_TOPICS[2]) {
        const t = obIface.parseLog(l).args;
        const takerBuys: boolean = t.isBuy;
        const hit = others.get(Number(t.orderId));
        const ours = [...mine.values()].filter((o) => o.isBuy !== takerBuys).sort((x, y) => (takerBuys ? Number(x.price - y.price) : Number(y.price - x.price)))[0];
        if (hit && ours && (takerBuys ? ours.price < hit.price : ours.price > hit.price)) {
          const want = BigInt(t.filledSize.toString());
          const fill = want < ours.size ? want : ours.size;
          ours.size -= fill;
          inventory += takerBuys ? -fill : fill;
          fills++;
          const px1e18 = (ours.price * 10n ** 18n) / P;
          emit(b, "Trade", [ours.id, SIM_BOT, takerBuys, px1e18, ours.size, ethers.constants.AddressZero, ethers.constants.AddressZero, fill]);
          if (ours.size === 0n) mine.delete(ours.id);
        }
      }
    }
    applyOthers(blockLogs);

    // 3. decide every `every` blocks
    if ((b - start) % every === 0) {
      const { bid, ask } = bestOf([...others.values()]);
      pending = decide({ block: b, refPrice: refRaw, othersBid: bid, othersAsk: ask, mine: [...mine.values()], inventoryRaw: inventory, countsFrom: c.replayFromBlock }, m, params).actions;
    }
  }

  // score with the production epoch builder, with and without the bot
  const all = [...sorted, ...botLogs].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  const withBot = await buildEpoch(c, epoch, all, opts.blockHash, null);
  const withoutBot = opts.baseline ?? (await buildEpoch(c, epoch, sorted, opts.blockHash, null));
  const dec = 10 ** c.rewardDecimals;
  const amt = withBot.amounts.find((a) => a.account === SIM_BOT);
  const paid = withBot.amounts.reduce((s, a) => s + Number(a.amount), 0);

  // how often the bot itself was two-sided and scoring at a sample block (rested, in band)
  const { snaps } = replay(decodeBookLogs(botLogs), withBot.samples.map((s) => s.block));
  const band = BigInt(c.bandBps);
  let twoSided = 0;
  for (const s of withBot.samples) {
    if (s.mid === null) continue;
    const mid = BigInt(s.mid);
    const ok = (isBuy: boolean) => (snaps.get(s.block) ?? []).some((o) => o.isBuy === isBuy && s.block - o.createdBlock >= c.minRestBlocks && (o.price > mid ? o.price - mid : mid - o.price) * 10_000n <= band * mid);
    if (ok(true) && ok(false)) twoSided++;
  }

  return {
    strategy: opts.strategy,
    params,
    epoch,
    payout: amt ? Number(amt.amount) / dec : 0,
    sharePct: amt && paid ? (100 * Number(amt.amount)) / paid : 0,
    places, cancels, txs, fills,
    inventory: Number(inventory) / Number(c.sizePrecision),
    restingTwoSidedPct: withBot.samples.length ? (100 * twoSided) / withBot.samples.length : 0,
    withBot: epochMetrics(withBot),
    withoutBot: epochMetrics(withoutBot),
  };
}

/** The comparison every maker asks for: our bot vs a naive requoter vs a lazy wide quote, same size, same history. */
export function strategies(c: Campaign, sizeRaw: bigint, maxInventoryRaw: bigint): { name: string; params: BotParams }[] {
  const base = { sizeRaw, maxInventoryRaw, maxDistFrac: 0.85, hysteresisFrac: 0.4, maxAgeBlocks: 0, pegGuardBps: 30, offsetFrac: 0.35 };
  return [
    { name: "Spreadbounty bot (requote on drift)", params: base },
    { name: `Naive: requote every ${2 * c.minRestBlocks} blocks`, params: { ...base, maxAgeBlocks: 2 * c.minRestBlocks } },
    { name: "Lazy: quote at the band edge", params: { ...base, offsetFrac: 0.9, maxDistFrac: 1, hysteresisFrac: 1 } },
  ];
}

/** Trading parameters from a readMarket()-shaped record (tick in raw price units, minSize in base units). */
export const marketFrom = (c: Campaign, info: { tickSize: number; minSize: number }): Market => ({
  bandBps: c.bandBps,
  minRestBlocks: c.minRestBlocks,
  tick: BigInt(info.tickSize),
  minSize: BigInt(Math.round(info.minSize * Number(c.sizePrecision))),
});

/** Run all three strategies on one epoch of a campaign; what `bot sim` and the web page show. */
export async function compareStrategies(
  src: { market(m: string): Promise<{ tickSize: number; minSize: number }>; logs(market: string, from: number, to: number): Promise<RawLog[]>; blockHash(n: number): Promise<string> },
  c: Campaign,
  epoch: number,
  sizeHuman: number,
  maxInventoryHuman: number,
  baseline?: EpochFile,
) {
  const info = await src.market(c.market);
  const { toBlock } = epochRange(c, epoch);
  const logs = await src.logs(c.market, c.replayFromBlock, toBlock);
  const S = Number(c.sizePrecision);
  const out: SimResult[] = [];
  for (const s of strategies(c, BigInt(Math.round(sizeHuman * S)), BigInt(Math.round(maxInventoryHuman * S))))
    out.push(await simulateBot({ campaign: c, epoch, logs, blockHash: (n) => src.blockHash(n), market: marketFrom(c, info), params: s.params, strategy: s.name, baseline }));
  return out;
}
