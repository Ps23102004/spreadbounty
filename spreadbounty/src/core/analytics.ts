/**
 * Deterministic market analytics used by the Campaign Copilot's tools and by dashboards.
 * The model never computes these numbers; it only reads them.
 */
import { BOOK_TOPICS, bestOf, decodeBookLogs, replay, type Order } from "./book";
import type { RawLog } from "./rpc";
import { scoreSample } from "./score";

const BANDS = [5, 15, 50] as const;

function bookLogs(logs: RawLog[], market: string) {
  const topics = new Set(BOOK_TOPICS);
  return logs.filter((l) => l.address.toLowerCase() === market.toLowerCase() && topics.has(l.topics[0]!));
}

function strideBlocks(from: number, to: number, every: number) {
  const out: number[] = [];
  for (let b = from + every - 1; b <= to; b += every) out.push(b);
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

function sideDepth(orders: Order[], mid: bigint, bandBps: number) {
  let bid = 0n, ask = 0n;
  for (const o of orders) {
    const diff = o.price > mid ? o.price - mid : mid - o.price;
    if (diff * 10_000n > BigInt(bandBps) * mid) continue;
    if (o.isBuy) bid += o.size;
    else ask += o.size;
  }
  return { bid, ask };
}

/**
 * What the maker book looked like over a window, from logs alone. Orders created before `fromBlock`
 * are invisible, so the first 25% of the window is treated as warm-up and not measured.
 */
export function historyStats(
  logs: RawLog[],
  market: string,
  fromBlock: number,
  toBlock: number,
  every: number,
  pricePrecision: bigint,
  sizePrecision: bigint,
  refPrice: bigint | null = null,
) {
  const warm = fromBlock + Math.floor((toBlock - fromBlock) / 4);
  const blocks = strideBlocks(fromBlock, toBlock, every).filter((b) => b >= warm);
  const { snaps } = replay(decodeBookLogs(bookLogs(logs, market)), blocks);
  const P = Number(pricePrecision), S = Number(sizePrecision);
  const spreads: number[] = [];
  const cover: Record<string, number> = {}, depth: Record<string, number[]> = {};
  for (const b of BANDS) { cover[b] = 0; depth[b] = []; }
  const makers = new Set<string>();
  const ownerDepth = new Map<string, number>();
  let priced = 0;
  for (const block of blocks) {
    const orders = snaps.get(block) ?? [];
    orders.forEach((o) => makers.add(o.owner));
    const { bid, ask } = bestOf(orders);
    if (bid !== null && ask !== null) spreads.push((Number(ask - bid) / Number((ask + bid) / 2n)) * 1e4);
    const mid = refPrice ?? (bid !== null && ask !== null ? (bid + ask) / 2n : null);
    if (mid === null) continue;
    priced++;
    for (const bd of BANDS) {
      const d = sideDepth(orders, mid, bd);
      if (d.bid > 0n && d.ask > 0n) cover[bd]!++;
      depth[bd]!.push((Math.min(Number(d.bid), Number(d.ask)) / S) * (Number(mid) / P));
    }
    for (const o of orders) ownerDepth.set(o.owner, (ownerDepth.get(o.owner) ?? 0) + (Number(o.size) / S) * (Number(o.price) / P));
  }
  const totalDepth = [...ownerDepth.values()].reduce((a, b) => a + b, 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    fromBlock,
    toBlock,
    measuredFromBlock: warm,
    samples: blocks.length,
    samplesWithPrice: priced,
    makers: makers.size,
    medianSpreadBps: median(spreads),
    coverageByBand: Object.fromEntries(BANDS.map((b) => [String(b), priced ? (100 * cover[b]!) / priced : 0])),
    avgTwoSidedDepthQuoteByBand: Object.fromEntries(BANDS.map((b) => [String(b), avg(depth[b]!)])),
    topMakerDepthSharePct: totalDepth ? (100 * Math.max(...ownerDepth.values())) / totalDepth : 0,
    caveat: "Only orders created inside the window are visible; Kuru's AMM vault is excluded (it emits no order logs).",
  };
}

/**
 * Replay a candidate campaign over past blocks: who would have earned what, and what the sponsor's
 * budget would have bought. Assumes makers behave as they did historically (no incentive response),
 * so it is a floor on depth, not a forecast.
 */
export function simulateCampaign(
  logs: RawLog[],
  market: string,
  p: { fromBlock: number; toBlock: number; bandBps: number; minRestBlocks: number; sampleEvery: number; refPrice: bigint | null; budgetPerDay: number; blockSeconds: number },
  pricePrecision: bigint,
  sizePrecision: bigint,
) {
  const blocks = strideBlocks(p.fromBlock, p.toBlock, p.sampleEvery);
  const { snaps } = replay(decodeBookLogs(bookLogs(logs, market)), blocks);
  const P = Number(pricePrecision), S = Number(sizePrecision);
  const totals = new Map<string, bigint>();
  const depths: number[] = [];
  let covered = 0, priced = 0;
  for (const block of blocks) {
    const orders = snaps.get(block) ?? [];
    let mid = p.refPrice;
    if (mid === null) {
      const { bid, ask } = bestOf(orders);
      mid = bid !== null && ask !== null ? (bid + ask) / 2n : null;
    }
    if (mid === null) continue;
    priced++;
    for (const [o, q] of scoreSample(orders, block, mid, p.bandBps, p.minRestBlocks)) totals.set(o, (totals.get(o) ?? 0n) + q);
    const rested = orders.filter((o) => block - o.createdBlock >= p.minRestBlocks);
    const d = sideDepth(rested, mid, p.bandBps);
    if (d.bid > 0n && d.ask > 0n) covered++;
    depths.push((Math.min(Number(d.bid), Number(d.ask)) / S) * (Number(mid) / P));
  }
  const total = [...totals.values()].reduce((a, b) => a + b, 0n);
  const makers = [...totals.entries()]
    .map(([account, q]) => {
      const sharePct = total ? (Number((q * 1_000_000n) / total) / 1_000_000) * 100 : 0;
      return { account, sharePct, rewardPerDay: (sharePct / 100) * p.budgetPerDay };
    })
    .sort((a, b) => b.sharePct - a.sharePct);
  const avgDepth = depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
  const hours = ((p.toBlock - p.fromBlock + 1) * p.blockSeconds) / 3600;
  return {
    windowHours: hours,
    samples: blocks.length,
    samplesWithPrice: priced,
    twoSidedCoveragePct: priced ? (100 * covered) / priced : 0,
    avgQualifyingTwoSidedDepthQuote: avgDepth,
    costPerDayPer1kDepth: avgDepth > 0 ? (p.budgetPerDay / avgDepth) * 1000 : null,
    makers: makers.slice(0, 10),
    makerCount: makers.length,
    caveat: "Historical makers only; real campaigns attract new makers, so depth here is a floor and cost per $1k a ceiling.",
  };
}
