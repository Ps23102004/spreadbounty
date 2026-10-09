/**
 * Deterministic SYNTHETIC dataset so the app runs without Monad RPC. Every address here is an obvious
 * 0xDe… placeholder and the UI labels this data "Demo data (synthetic)". Market parameters
 * (precision, tick, min size, fees, vault, implementation) are the real values read from mainnet on
 * 2026-10-09; the orders and trades are simulated. Epoch files are built with the production core.
 *
 *   npm run demo:gen
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ethers } from "ethers";
import { obIface } from "../core/book";
import { KURU_OB_IMPL, MARKETS, USDC } from "../core/chain";
import { buildEpoch, epochMetrics, type Campaign, type EpochFile } from "../core/epoch";
import type { RawLog } from "../core/rpc";
import { DEMO_DIR, demoBlockHash, type MarketInfo } from "../data/source";

// mulberry32: tiny seeded PRNG so every run produces identical data
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEAD = 111_990_000;
const EPOCH = 12_000; // 1 hour at ~0.3 s blocks
const demoAddr = (tag: string) => ethers.utils.getAddress("0xde" + tag.padStart(38, "0"));

interface Live { id: number; owner: string; price: bigint; size: bigint; isBuy: boolean }

class Book {
  logs: RawLog[] = [];
  live = new Map<number, Live>();
  nextId = 1;
  idx = new Map<number, number>();
  constructor(public market: string, public P: bigint) {}
  private emit(block: number, name: string, args: unknown[]) {
    const { data, topics } = obIface.encodeEventLog(obIface.getEvent(name), args);
    const li = this.idx.get(block) ?? 0;
    this.idx.set(block, li + 1);
    this.logs.push({ address: this.market, data, topics, blockNumber: block, logIndex: li, transactionHash: ethers.utils.id(`demo-tx-${this.market}-${block}-${li}`), blockHash: demoBlockHash(block), transactionIndex: 0, removed: false } as RawLog);
  }
  place(block: number, owner: string, price: bigint, size: bigint, isBuy: boolean) {
    const id = this.nextId++;
    this.live.set(id, { id, owner, price, size, isBuy });
    this.emit(block, "OrderCreated", [id, owner, size, price, isBuy]);
    return id;
  }
  cancel(block: number, owner: string, ids: number[]) {
    const mine = ids.filter((id) => this.live.get(id)?.owner === owner);
    if (!mine.length) return;
    mine.forEach((id) => this.live.delete(id));
    this.emit(block, "OrdersCanceled", [mine, owner]);
  }
  /** Taker hits the best opposite order; returns false if that side is empty. */
  take(block: number, taker: string, takerBuys: boolean, size: bigint) {
    const side = [...this.live.values()].filter((o) => o.isBuy !== takerBuys);
    if (!side.length) return false;
    const best = side.reduce((b, o) => (takerBuys ? (o.price < b.price ? o : b) : o.price > b.price ? o : b));
    const fill = size < best.size ? size : best.size;
    best.size -= fill;
    if (best.size === 0n) this.live.delete(best.id);
    const px1e18 = (best.price * 10n ** 18n) / this.P;
    this.emit(block, "Trade", [best.id, best.owner, takerBuys, px1e18, best.size, taker, taker, fill]);
    return true;
  }
  top() {
    const bids = [...this.live.values()].filter((o) => o.isBuy).map((o) => o.price);
    const asks = [...this.live.values()].filter((o) => !o.isBuy).map((o) => o.price);
    return { bid: bids.length ? bids.reduce((a, b) => (a > b ? a : b)) : null, ask: asks.length ? asks.reduce((a, b) => (a < b ? a : b)) : null };
  }
}

interface MakerSpec { owner: string; join: number; halfBps: number; size: number; every: number; sides: "both" | "bid"; flicker?: boolean }

function runMakers(book: Book, specs: MakerSpec[], from: number, to: number, mid: (b: number) => number, P: number, S: number, tick: number, r: () => number, tradeEvery: number, tradeMax: number) {
  const orders = new Map<string, number[]>();
  const nextQuote = new Map<string, number>(specs.map((s) => [s.owner, s.join]));
  let nextTrade = from + Math.floor(r() * tradeEvery);
  const takers = [demoAddr("7a"), demoAddr("7b"), demoAddr("7c")];
  for (let b = from; b <= to; b++) {
    for (const s of specs) {
      if (b < s.join || b !== nextQuote.get(s.owner)) continue;
      const had = orders.get(s.owner) ?? [];
      book.cancel(b, s.owner, had);
      if (s.flicker && had.length) {
        // flicker maker: pulls after 3-6 blocks, then waits; it never rests long enough to score
        orders.set(s.owner, []);
        nextQuote.set(s.owner, b + Math.round(s.every * (0.75 + 0.5 * r())));
        continue;
      }
      const m = mid(b) * P;
      const off = (m * s.halfBps) / 1e4;
      const bid = BigInt(Math.floor((m - off) / tick) * tick);
      const ask = BigInt(Math.ceil((m + off) / tick) * tick);
      const size = BigInt(Math.round(s.size * (0.85 + 0.3 * r()) * S));
      const ids = [book.place(b, s.owner, bid, size, true)];
      if (s.sides === "both") ids.push(book.place(b, s.owner, ask, size, false));
      orders.set(s.owner, ids);
      nextQuote.set(s.owner, s.flicker ? b + 3 + Math.floor(r() * 4) : b + Math.round(s.every * (0.75 + 0.5 * r())));
    }
    if (b === nextTrade) {
      book.take(b, takers[Math.floor(r() * takers.length)]!, r() < 0.5, BigInt(Math.round((0.05 + 0.95 * r()) * tradeMax * S)));
      nextTrade = b + Math.max(20, Math.round(tradeEvery * (0.4 + 1.2 * r())));
    }
  }
  return orders;
}

async function main() {
  mkdirSync(DEMO_DIR, { recursive: true });
  const r = rng(20261009);

  // ---------- AUSD/USDC: empty until the campaign starts, then makers arrive ----------
  const ausd = MARKETS["AUSD/USDC"].toLowerCase();
  const start = HEAD - 3 * EPOCH - 4_000; // 3 closed epochs + one in progress
  const ausdBook = new Book(ausd, 10_000_000n);
  runMakers(
    ausdBook,
    [
      { owner: demoAddr("a1"), join: start + 60, halfBps: 3, size: 2000, every: 1500, sides: "both" },
      { owner: demoAddr("b2"), join: start + 5_200, halfBps: 9, size: 6000, every: 4000, sides: "both" },
      { owner: demoAddr("c3"), join: start + 14_000, halfBps: 4, size: 1500, every: 2500, sides: "bid" },
      { owner: demoAddr("d4"), join: start + 26_000, halfBps: 2, size: 900, every: 900, sides: "both" },
      { owner: demoAddr("e5"), join: start + 9_000, halfBps: 1, size: 20000, every: 600, sides: "both", flicker: true },
    ],
    start,
    HEAD,
    () => 1,
    1e7,
    1e6,
    100,
    r,
    350,
    600,
  );
  const ausdTop = ausdBook.top();

  // ---------- MON/USDC: busy book with three professional makers, mid on a random walk ----------
  const mon = MARKETS["MON/USDC"].toLowerCase();
  const monBook = new Book(mon, 100_000_000n);
  const monFrom = HEAD - 36_000;
  const walk: number[] = [];
  let px = 0.0246;
  for (let i = 0; i <= 36_000 / 100 + 1; i++) {
    walk.push(px);
    px *= 1 + (r() - 0.5) * 0.004;
  }
  const monMid = (b: number) => walk[Math.floor((b - monFrom) / 100)]!;
  runMakers(
    monBook,
    [
      { owner: demoAddr("f1"), join: monFrom + 5, halfBps: 5, size: 20000, every: 100, sides: "both" },
      { owner: demoAddr("f2"), join: monFrom + 40, halfBps: 12, size: 50000, every: 300, sides: "both" },
      { owner: demoAddr("f3"), join: monFrom + 90, halfBps: 30, size: 100000, every: 1200, sides: "both" },
    ],
    monFrom,
    HEAD,
    monMid,
    1e8,
    1e10,
    100,
    r,
    150,
    4000,
  );
  const monTop = monBook.top();

  const info = (market: string, pair: string, P: number, S: number, minSize: number, vault: string, top: { bid: bigint | null; ask: bigint | null }): MarketInfo => {
    const bid = top.bid === null ? null : Number(top.bid) / P;
    const ask = top.ask === null ? null : Number(top.ask) / P;
    const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
    return {
      market: ethers.utils.getAddress(market), pair, verifiedKuruMarket: true, implementation: KURU_OB_IMPL,
      pricePrecision: String(P), sizePrecision: String(S), tickSize: 100, tickBpsAtMid: mid ? (100 / P / mid) * 1e4 : null,
      minSize, feesBps: { maker: 0, taker: 0 }, bestBid: bid, bestAsk: ask, spreadBps: bid && ask ? ((ask - bid) / ((ask + bid) / 2)) * 1e4 : null,
      vault: { address: vault, quoting: false }, head: HEAD,
    };
  };
  const chain = {
    synthetic: true,
    note: "Demo data (synthetic). Market parameters are real (read from Monad mainnet 2026-10-09); orders, trades and addresses are simulated.",
    head: HEAD,
    markets: {
      "AUSD/USDC": info(ausd, "AUSD/USDC", 1e7, 1e6, 10, "0xb4549195f26c90865e1aeDC7EB1f5F322a31E2f7", ausdTop),
      "MON/USDC": info(mon, "MON/USDC", 1e8, 1e10, 200, "0x838c2d3fD4DB5eB2F185cbE7697fbaAce52b34d7", monTop),
    },
    logs: { [ausd]: ausdBook.logs, [mon]: monBook.logs },
  };
  writeFileSync(`${DEMO_DIR}/chain.json`, JSON.stringify(chain));

  // ---------- the demo campaign and its three closed epochs, built by the production core ----------
  const campaign: Campaign = {
    id: "ausd-usdc-demo", chainId: 143, market: ethers.utils.getAddress(ausd), pair: "AUSD/USDC", implementation: KURU_OB_IMPL,
    pricePrecision: "10000000", sizePrecision: "1000000", refPrice: "10000000",
    bandBps: 15, minRestBlocks: 20, sampleEvery: 200, replayFromBlock: start, epochBlocks: EPOCH,
    budgetPerEpoch: "10000000", rewardToken: USDC, rewardDecimals: 6, sponsor: demoAddr("5150"),
  };
  writeFileSync(`${DEMO_DIR}/campaign-${campaign.id}.json`, JSON.stringify({ ...campaign, rationale: "Demo campaign: keep AUSD/USDC two-sided within 15 bps of 1.0000 for 10 USDC per hourly epoch." }, null, 2));
  mkdirSync(`${DEMO_DIR}/${campaign.id}`, { recursive: true });
  let prev: EpochFile | null = null;
  for (let n = 0; n < 3; n++) {
    const to = start + (n + 1) * EPOCH - 1;
    const logs = ausdBook.logs.filter((l) => l.blockNumber <= to);
    const e: EpochFile = await buildEpoch(campaign, n, logs, async (b) => demoBlockHash(b), prev);
    writeFileSync(`${DEMO_DIR}/${campaign.id}/epoch-${n}.json`, JSON.stringify(e, null, 2));
    writeFileSync(`${DEMO_DIR}/${campaign.id}/epoch-${n}.logs.json`, JSON.stringify(logs.filter((l) => l.blockNumber >= start)));
    const m = epochMetrics(e);
    console.log(`epoch ${n}: coverage ${m.twoSidedCoveragePct.toFixed(0)}%, depth ${m.avgTwoSidedDepthQuote.toFixed(0)} USDC, makers paid ${m.makersPaid}, root ${e.root.slice(0, 10)}…`);
    prev = e;
  }
  console.log(`demo: ${ausdBook.logs.length} AUSD/USDC logs, ${monBook.logs.length} MON/USDC logs -> ${DEMO_DIR}/`);
}

main();
