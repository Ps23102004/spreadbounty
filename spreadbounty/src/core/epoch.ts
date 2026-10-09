/**
 * Epoch files: the public, recomputable record of one campaign epoch.
 *
 * Rules (fixed per campaign, published before it starts):
 *  - Only orders created at or after `campaign.replayFromBlock` count, so anyone can rebuild the book
 *    from that block's logs alone (no archive state needed).
 *  - One sample block per `sampleEvery` window, chosen by the hash of the block that closes the window.
 *  - Score per sample = Polymarket-style two-sided score (src/core/score.ts), summed over the epoch.
 *  - Payout = floor(budget * score / totalScore); dust stays with the sponsor.
 *  - Leaves are cumulative (1inch CumulativeMerkleDrop), so each epoch's root supersedes the last.
 * No AI and no server judgement anywhere in this file: same logs + same block hashes => same root.
 */
import { ethers } from "ethers";
import { BOOK_TOPICS, bestOf, decodeBookLogs, replay, type Order } from "./book";
import type { RawLog } from "./rpc";
import { merkleRoot, pickSampleBlocks, scoreSample } from "./score";

export interface Campaign {
  id: string;
  chainId: number;
  market: string;
  pair: string; // display only, e.g. "AUSD/USDC"
  implementation: string; // OrderBook implementation the decoder was checked against
  pricePrecision: string;
  sizePrecision: string;
  refPrice: string | null; // raw price units; null = replayed maker-book mid
  bandBps: number;
  minRestBlocks: number;
  sampleEvery: number;
  replayFromBlock: number; // campaign start: only orders created from here count
  epochBlocks: number;
  budgetPerEpoch: string; // reward token base units
  rewardToken: string;
  rewardDecimals: number;
  sponsor: string;
}

export interface SampleRecord {
  block: number;
  closer: number;
  closerHash: string;
  mid: string | null;
  bookHash: string;
  bidDepth: string; // in-band, rested, base size units (sizePrecision), all qualifying makers
  askDepth: string;
  scored: number;
}

export interface EpochFile {
  version: 1;
  campaign: Campaign;
  epoch: number;
  fromBlock: number;
  toBlock: number;
  logCount: number;
  logsDigest: string;
  samples: SampleRecord[];
  scores: { account: string; score: string }[];
  amounts: { account: string; amount: string }[];
  cumulative: { account: string; amount: string }[];
  prevRoot: string | null;
  root: string;
}

export const epochRange = (c: Campaign, epoch: number) => {
  const fromBlock = c.replayFromBlock + epoch * c.epochBlocks;
  return { fromBlock, toBlock: fromBlock + c.epochBlocks - 1 };
};

/** Canonical digest of the log set the epoch was computed from. */
export function logsDigest(logs: RawLog[]): string {
  const leaves = logs.map((l) =>
    ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256", "bytes32", "address", "bytes32[]", "bytes"],
        [l.blockNumber, l.logIndex, l.transactionHash, l.address, l.topics, l.data],
      ),
    ),
  );
  return ethers.utils.keccak256(ethers.utils.concat([ethers.constants.HashZero, ...leaves]));
}

export function bookHash(orders: Order[]): string {
  const sorted = [...orders].sort((a, b) => a.id - b.id);
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["tuple(uint40 id,address owner,uint256 price,uint256 size,bool isBuy,uint256 created)[]"],
      [sorted.map((o) => ({ id: o.id, owner: o.owner, price: o.price, size: o.size, isBuy: o.isBuy, created: o.createdBlock }))],
    ),
  );
}

/** Book logs that belong to this campaign: right market, inside [replayFromBlock, toBlock]. */
export function campaignLogs(c: Campaign, logs: RawLog[], toBlock: number) {
  const topics = new Set(BOOK_TOPICS);
  return logs.filter(
    (l) =>
      l.address.toLowerCase() === c.market.toLowerCase() &&
      topics.has(l.topics[0]!) &&
      l.blockNumber >= c.replayFromBlock &&
      l.blockNumber <= toBlock,
  );
}

function inBandDepth(orders: Order[], block: number, mid: bigint, c: Campaign) {
  let bid = 0n, ask = 0n;
  const band = BigInt(c.bandBps);
  for (const o of orders) {
    if (block - o.createdBlock < c.minRestBlocks) continue;
    const diff = o.price > mid ? o.price - mid : mid - o.price;
    if (diff * 10_000n > band * mid) continue;
    if (o.isBuy) bid += o.size;
    else ask += o.size;
  }
  return { bid, ask };
}

export async function buildEpoch(
  c: Campaign,
  epoch: number,
  allLogs: RawLog[],
  blockHash: (n: number) => Promise<string>,
  prev: EpochFile | null,
): Promise<EpochFile> {
  const { fromBlock, toBlock } = epochRange(c, epoch);
  if (prev && (prev.epoch !== epoch - 1 || prev.campaign.id !== c.id)) throw new Error("prev epoch does not chain");
  const logs = campaignLogs(c, allLogs, toBlock);
  const samples = await pickSampleBlocks(fromBlock, toBlock, c.sampleEvery, blockHash);
  const { snaps } = replay(decodeBookLogs(logs), samples);
  const refRaw = c.refPrice === null ? null : BigInt(c.refPrice);

  const totals = new Map<string, bigint>();
  const records: SampleRecord[] = [];
  for (const block of samples) {
    const orders = snaps.get(block) ?? [];
    let mid: bigint | null = refRaw;
    if (mid === null) {
      const { bid, ask } = bestOf(orders);
      mid = bid !== null && ask !== null ? (bid + ask) / 2n : null;
    }
    const closer = block - ((block - fromBlock) % c.sampleEvery) + c.sampleEvery - 1;
    const rec: SampleRecord = { block, closer, closerHash: await blockHash(closer), mid: mid?.toString() ?? null, bookHash: bookHash(orders), bidDepth: "0", askDepth: "0", scored: 0 };
    if (mid !== null) {
      const s = scoreSample(orders, block, mid, c.bandBps, c.minRestBlocks);
      for (const [o, q] of s) totals.set(o, (totals.get(o) ?? 0n) + q);
      const d = inBandDepth(orders, block, mid, c);
      rec.bidDepth = d.bid.toString();
      rec.askDepth = d.ask.toString();
      rec.scored = s.size;
    }
    records.push(rec);
  }

  const scores = [...totals.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const total = scores.reduce((s, [, q]) => s + q, 0n);
  const budget = BigInt(c.budgetPerEpoch);
  const amounts = scores.map(([a, q]) => [a, total === 0n ? 0n : (budget * q) / total] as [string, bigint]).filter(([, x]) => x > 0n);

  const cum = new Map<string, bigint>((prev?.cumulative ?? []).map((e) => [e.account, BigInt(e.amount)]));
  for (const [a, x] of amounts) cum.set(a, (cum.get(a) ?? 0n) + x);
  const cumulative = [...cum.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  return {
    version: 1,
    campaign: c,
    epoch,
    fromBlock,
    toBlock,
    logCount: logs.length,
    logsDigest: logsDigest(logs),
    samples: records,
    scores: scores.map(([account, q]) => ({ account, score: q.toString() })),
    amounts: amounts.map(([account, x]) => ({ account, amount: x.toString() })),
    cumulative: cumulative.map(([account, x]) => ({ account, amount: x.toString() })),
    prevRoot: prev?.root ?? null,
    root: merkleRoot(cumulative),
  };
}

/** Recompute an epoch from logs and compare every committed field. Empty diff list = verified. */
export async function verifyEpoch(
  file: EpochFile,
  allLogs: RawLog[],
  blockHash: (n: number) => Promise<string>,
  prev: EpochFile | null,
): Promise<{ ok: boolean; diffs: string[]; recomputed: EpochFile }> {
  const re = await buildEpoch(file.campaign, file.epoch, allLogs, blockHash, prev);
  const diffs: string[] = [];
  const cmp = (k: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${k}: committed ${JSON.stringify(a).slice(0, 120)} != recomputed ${JSON.stringify(b).slice(0, 120)}`);
  };
  cmp("logsDigest", file.logsDigest, re.logsDigest);
  cmp("logCount", file.logCount, re.logCount);
  cmp("samples", file.samples, re.samples);
  cmp("scores", file.scores, re.scores);
  cmp("cumulative", file.cumulative, re.cumulative);
  cmp("root", file.root, re.root);
  return { ok: diffs.length === 0, diffs, recomputed: re };
}

/** Plain numbers for dashboards and the AI report (computed here, never by the model). */
export function epochMetrics(f: EpochFile) {
  const S = Number(f.campaign.sizePrecision);
  const P = Number(f.campaign.pricePrecision);
  const valid = f.samples.filter((s) => s.mid !== null);
  const twoSided = valid.filter((s) => s.bidDepth !== "0" && s.askDepth !== "0");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const depthQuote = valid.map((s) => (Math.min(Number(s.bidDepth), Number(s.askDepth)) / S) * (Number(s.mid) / P));
  const paid = f.amounts.reduce((s, a) => s + BigInt(a.amount), 0n);
  const paidHuman = Number(paid) / 10 ** f.campaign.rewardDecimals;
  const avgDepth = avg(depthQuote);
  const topShare = f.amounts.length ? Number(f.amounts.map((a) => BigInt(a.amount)).reduce((m, x) => (x > m ? x : m), 0n)) / Number(paid || 1n) : 0;
  return {
    pair: f.campaign.pair,
    epoch: f.epoch,
    blocks: `${f.fromBlock}-${f.toBlock}`,
    samples: f.samples.length,
    samplesWithPrice: valid.length,
    twoSidedCoveragePct: valid.length ? (100 * twoSided.length) / valid.length : 0,
    avgTwoSidedDepthQuote: avgDepth, // min(bid, ask) in-band depth, in quote units
    makersPaid: f.amounts.length,
    paidRewardTokens: paidHuman,
    budgetRewardTokens: Number(f.campaign.budgetPerEpoch) / 10 ** f.campaign.rewardDecimals,
    costPer1kDepthQuote: avgDepth > 0 ? (paidHuman / avgDepth) * 1000 : null,
    topMakerSharePct: 100 * topShare,
    bandBps: f.campaign.bandBps,
    root: f.root,
  };
}
