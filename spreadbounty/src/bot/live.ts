/**
 * The maker bot against a real Kuru market. One `tick()`: pull new order-book logs, rebuild the book,
 * ask the strategy what to do, then (live only) send post-only orders and cancels.
 *
 * Safety: paper mode by default (decides and prints, sends nothing). Live needs a throwaway BOT_KEY,
 * `--live --yes`, an implementation that matches the campaign file, and an order size under the notional cap.
 * Every transaction is simulated with eth_call first, so a revert costs nothing. It never deposits on its own.
 */
import { ethers } from "ethers";
import { ERC20_ABI, MARGIN_ABI, ORDERBOOK_ABI } from "../core/abi";
import { bestOf, decodeBookLogs, obIface, replay, type Order } from "../core/book";
import { KURU_MARGIN, NATIVE } from "../core/chain";
import type { Campaign } from "../core/epoch";
import { fetchBookLogs, readMarket } from "../core/fetch";
import type { RawLog } from "../core/rpc";
import { scoreSample } from "../core/score";
import { decide, type Action, type BotParams, type Market, type MyOrder } from "./strategy";

export const isKey = (k?: string) => !!k && /^0x[0-9a-fA-F]{64}$/.test(k.trim());

function revertReason(e: any): string {
  const data = e?.error?.data ?? e?.data;
  if (typeof data === "string" && data.length >= 10) {
    try {
      return obIface.parseError(data).name;
    } catch {}
  }
  return String(e?.reason ?? e?.error?.message ?? e?.message ?? e).slice(0, 160);
}

export interface TickReport {
  block: number;
  centre: number | null;
  othersBid: number | null;
  othersAsk: number | null;
  mine: { id: number; side: "bid" | "ask"; price: number; size: number; restedBlocks: number }[];
  inventory: number;
  actions: string[];
  notes: string[];
  sent: string[];
  /** this bot's share of the score if a sample landed on this block (rested orders only) */
  sharePctNow: number | null;
  estPerEpoch: number | null;
}

export class LiveBot {
  private logs: RawLog[] = [];
  private lastBlock = 0;
  private ob: ethers.Contract;
  private P: bigint;
  private S: bigint;
  readonly me: string;
  market!: Market;
  baseAsset = "";
  quoteAsset = "";
  quoteDecimals = 6;
  baseDecimals = 18;

  constructor(
    private provider: ethers.providers.JsonRpcProvider,
    private c: Campaign,
    private params: BotParams,
    private wallet: ethers.Wallet | null, // null = paper mode with a watch-only address
    watchAddress: string,
    private live: boolean,
    private log: (s: string) => void = console.log,
  ) {
    this.ob = new ethers.Contract(c.market, ORDERBOOK_ABI, provider);
    this.P = BigInt(c.pricePrecision);
    this.S = BigInt(c.sizePrecision);
    this.me = watchAddress.toLowerCase();
  }

  /** Check the market is the one the campaign was built for and load its trading parameters. */
  async init(lookbackBlocks: number) {
    const info = await readMarket(this.provider, this.c.market);
    if (info.implementation.toLowerCase() !== this.c.implementation.toLowerCase())
      throw new Error(`market implementation ${info.implementation} differs from the campaign's ${this.c.implementation}: the event decoder may not match, refusing to quote`);
    const mp = await this.ob.getMarketParams({ from: NATIVE });
    this.baseAsset = mp.baseAsset;
    this.quoteAsset = mp.quoteAsset;
    this.baseDecimals = ethers.BigNumber.from(mp.baseDecimals).toNumber();
    this.quoteDecimals = ethers.BigNumber.from(mp.quoteDecimals).toNumber();
    this.market = { bandBps: this.c.bandBps, minRestBlocks: this.c.minRestBlocks, tick: BigInt(mp.tickSize.toString()), minSize: BigInt(mp.minSize.toString()) };
    const head = await this.provider.getBlockNumber();
    // adopt orders this address already has resting (a restart keeps their rest time)
    this.logs = await fetchBookLogs(this.provider, this.c.market, Math.max(0, head - lookbackBlocks), head);
    this.lastBlock = head;
    return info;
  }

  private state() {
    const { live } = replay(decodeBookLogs(this.logs));
    const all = [...live.values()];
    const mine: MyOrder[] = all.filter((o) => o.owner === this.me).map((o) => ({ id: o.id, isBuy: o.isBuy, price: o.price, size: o.size, createdBlock: o.createdBlock }));
    const others = all.filter((o) => o.owner !== this.me);
    let inventory = 0n;
    for (const l of this.logs) {
      let ev: ethers.utils.LogDescription;
      try {
        ev = obIface.parseLog(l);
      } catch {
        continue;
      }
      if (ev.name !== "Trade" || String(ev.args.makerAddress).toLowerCase() !== this.me) continue;
      const fill = BigInt(ev.args.filledSize.toString());
      inventory += ev.args.isBuy ? -fill : fill; // taker bought = we sold base
    }
    return { all, mine, others, inventory };
  }

  /** Vault (AMM) quotes emit no order logs but still cross post-only orders, so fold them into "others". */
  private async vaultTop() {
    const vp = await this.ob.getVaultParams();
    if (vp[0] === NATIVE || (ethers.BigNumber.from(vp[5]).isZero() && ethers.BigNumber.from(vp[6]).isZero())) return { bid: null, ask: null };
    const toRaw = (x: ethers.BigNumber) => (x.isZero() ? null : (BigInt(x.toString()) * this.P) / 10n ** 18n);
    return { bid: toRaw(vp[1]), ask: toRaw(vp[3]) };
  }

  async tick(): Promise<TickReport> {
    const head = await this.provider.getBlockNumber();
    if (head > this.lastBlock) {
      this.logs.push(...(await fetchBookLogs(this.provider, this.c.market, this.lastBlock + 1, head)));
      this.lastBlock = head;
    }
    const st = this.state();
    const top = bestOf(st.others);
    const vault = await this.vaultTop();
    const maxB = (a: bigint | null, b: bigint | null) => (a === null ? b : b === null ? a : a > b ? a : b);
    const minB = (a: bigint | null, b: bigint | null) => (a === null ? b : b === null ? a : a < b ? a : b);
    const othersBid = maxB(top.bid, vault.bid), othersAsk = minB(top.ask, vault.ask);
    const refRaw = this.c.refPrice === null ? null : BigInt(this.c.refPrice);
    const d = decide({ block: head, refPrice: refRaw, othersBid, othersAsk, mine: st.mine, inventoryRaw: st.inventory, countsFrom: this.c.replayFromBlock }, this.market, this.params);

    const sent: string[] = [];
    if (this.live && this.wallet) for (const a of d.actions) sent.push(await this.execute(a));

    // what this address would earn if a sample landed now (others included, rested orders only)
    const mid = refRaw ?? (() => { const b = bestOf(st.all); return b.bid !== null && b.ask !== null ? (b.bid + b.ask) / 2n : null; })();
    let share: number | null = null;
    if (mid !== null) {
      const s = scoreSample(st.all, head, mid, this.c.bandBps, this.c.minRestBlocks);
      const total = [...s.values()].reduce((x, y) => x + y, 0n);
      share = total === 0n ? 0 : Number(((s.get(this.me) ?? 0n) * 10_000n) / total) / 100;
    }
    const budget = Number(this.c.budgetPerEpoch) / 10 ** this.c.rewardDecimals;
    const hp = (x: bigint | null) => (x === null ? null : Number(x) / Number(this.P));
    return {
      block: head,
      centre: hp(d.centre),
      othersBid: hp(othersBid),
      othersAsk: hp(othersAsk),
      mine: st.mine.map((o) => ({ id: o.id, side: o.isBuy ? "bid" : "ask", price: Number(o.price) / Number(this.P), size: Number(o.size) / Number(this.S), restedBlocks: head - o.createdBlock })),
      inventory: Number(st.inventory) / Number(this.S),
      actions: d.actions.map((a) => this.describe(a)),
      notes: d.notes,
      sent,
      sharePctNow: share,
      estPerEpoch: share === null ? null : (budget * share) / 100,
    };
  }

  describe(a: Action) {
    return a.kind === "cancel" ? `cancel [${a.ids.join(", ")}]` : `${a.isBuy ? "bid" : "ask"} ${Number(a.size) / Number(this.S)} @ ${Number(a.price) / Number(this.P)} (post-only)`;
  }

  private async send(label: string, to: string, data: string, value = ethers.constants.Zero) {
    const w = this.wallet!;
    const req = { from: w.address, to, data, value };
    try {
      await this.provider.call(req); // simulate first: a revert here costs nothing
    } catch (e) {
      return `${label}: skipped, would revert (${revertReason(e)})`;
    }
    const gasLimit = (await this.provider.estimateGas(req)).mul(120).div(100); // Monad bills the declared limit
    const tx = await w.sendTransaction({ to, data, value, gasLimit });
    const r = await tx.wait(1);
    return `${label}: ${r.status === 1 ? "ok" : "REVERTED"} ${tx.hash}`;
  }

  private async execute(a: Action) {
    if (a.kind === "cancel") return this.send(`cancel ${a.ids.length}`, this.c.market, obIface.encodeFunctionData("batchCancelOrders", [a.ids]));
    // margin must hold what the order locks: quote for a bid, base for an ask
    const margin = new ethers.Contract(KURU_MARGIN, MARGIN_ABI, this.provider);
    const token = a.isBuy ? this.quoteAsset : this.baseAsset;
    const have = BigInt((await margin.getBalance(this.me, token)).toString());
    const need = a.isBuy
      ? (a.size * a.price * 10n ** BigInt(this.quoteDecimals)) / (this.S * this.P)
      : (a.size * 10n ** BigInt(this.baseDecimals)) / this.S;
    if (have < need) return `${this.describe(a)}: skipped, margin account holds ${have} < ${need} (run \`bot deposit\`)`;
    return this.send(this.describe(a), this.c.market, obIface.encodeFunctionData(a.isBuy ? "addBuyOrder" : "addSellOrder", [a.price, a.size, true]));
  }

  async cancelAll() {
    const ids = this.state().mine.map((o) => o.id);
    if (!ids.length) return "no resting orders";
    if (!this.live || !this.wallet) return `would cancel [${ids.join(", ")}] (paper mode)`;
    return this.execute({ kind: "cancel", ids });
  }

  async balances() {
    const margin = new ethers.Contract(KURU_MARGIN, MARGIN_ABI, this.provider);
    const sym = async (a: string) => (a === NATIVE ? "MON" : await new ethers.Contract(a, ERC20_ABI, this.provider).symbol());
    const out: Record<string, string> = {};
    for (const [a, dec] of [[this.baseAsset, this.baseDecimals], [this.quoteAsset, this.quoteDecimals]] as const)
      out[`${await sym(a)} in margin`] = ethers.utils.formatUnits(await margin.getBalance(this.me, a), dec);
    out["MON for gas"] = ethers.utils.formatEther(await this.provider.getBalance(this.me));
    return out;
  }

  /** Move funds into (or out of) the Kuru margin account. Explicit command only; the loop never does this. */
  async moveFunds(dir: "deposit" | "withdraw", baseHuman: number, quoteHuman: number) {
    const w = this.wallet!;
    const out: string[] = [];
    const margin = new ethers.Contract(KURU_MARGIN, MARGIN_ABI, this.provider);
    for (const [token, dec, amt] of [[this.baseAsset, this.baseDecimals, baseHuman], [this.quoteAsset, this.quoteDecimals, quoteHuman]] as const) {
      if (!amt) continue;
      const raw = ethers.utils.parseUnits(amt.toFixed(dec), dec);
      if (dir === "withdraw") {
        out.push(await this.send(`withdraw ${amt}`, KURU_MARGIN, margin.interface.encodeFunctionData("withdraw", [raw, token])));
        continue;
      }
      if (token !== NATIVE) {
        const erc = new ethers.Contract(token, ERC20_ABI, this.provider);
        if ((await erc.allowance(w.address, KURU_MARGIN)).lt(raw)) out.push(await this.send(`approve ${amt}`, token, erc.interface.encodeFunctionData("approve", [KURU_MARGIN, raw])));
      }
      out.push(await this.send(`deposit ${amt}`, KURU_MARGIN, margin.interface.encodeFunctionData("deposit", [w.address, token, raw]), token === NATIVE ? raw : ethers.constants.Zero));
    }
    return out;
  }
}

export type { Order };
