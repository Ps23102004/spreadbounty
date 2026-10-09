import { ethers } from "ethers";
import { bestOf, type Order } from "./book";

const SCALE = 1_000_000n; // fixed-point for bps maths; all scoring is integer so every machine gets the same root

/**
 * One sample block per window of `every` blocks, picked by the hash of the block that closes the
 * window, so nobody knows which block counts until after it is final. Deterministic given the hashes.
 */
export async function pickSampleBlocks(
  start: number,
  end: number,
  every: number,
  blockHash: (n: number) => Promise<string>,
): Promise<number[]> {
  const out: number[] = [];
  for (let w = start; w + every - 1 <= end; w += every) {
    const closer = w + every - 1;
    const h = BigInt(await blockHash(closer));
    out.push(w + Number(h % BigInt(every)));
  }
  return out;
}

/**
 * Polymarket-style two-sided score for one sample. Each resting order inside the band that has
 * rested >= minRest blocks earns ((band - dist) / band)^2 * size. Per owner,
 * Q = max(min(Qbid, Qask), max(Qbid, Qask) / 3), so one-sided quoting earns a third.
 */
export function scoreSample(
  orders: Order[],
  sampleBlock: number,
  mid: bigint,
  bandBps: number,
  minRest: number,
): Map<string, bigint> {
  const band = BigInt(bandBps) * SCALE;
  const bid = new Map<string, bigint>();
  const ask = new Map<string, bigint>();
  for (const o of orders) {
    if (sampleBlock - o.createdBlock < minRest) continue;
    const diff = o.price > mid ? o.price - mid : mid - o.price;
    const dist = (diff * 10_000n * SCALE) / mid; // bps * SCALE
    if (dist > band) continue;
    const w = ((band - dist) * (band - dist) * o.size) / (band * band);
    const side = o.isBuy ? bid : ask;
    side.set(o.owner, (side.get(o.owner) ?? 0n) + w);
  }
  const out = new Map<string, bigint>();
  for (const owner of new Set([...bid.keys(), ...ask.keys()])) {
    const b = bid.get(owner) ?? 0n;
    const a = ask.get(owner) ?? 0n;
    const lo = b < a ? b : a;
    const hi = b < a ? a : b;
    const q = lo > hi / 3n ? lo : hi / 3n;
    if (q > 0n) out.set(owner, q);
  }
  return out;
}

/** Mid used for a sample: a fixed reference (stable campaign) or the replayed maker-book mid. */
export function sampleMid(orders: Order[], refRaw: bigint | null): bigint | null {
  if (refRaw !== null) return refRaw;
  const { bid, ask } = bestOf(orders);
  return bid !== null && ask !== null ? (bid + ask) / 2n : null;
}

// ---------- 1inch CumulativeMerkleDrop-compatible tree ----------
// leaf = keccak256(abi.encodePacked(account, cumulativeAmount)); parents hash the sorted pair.

export function leafHash(account: string, amount: bigint): string {
  return ethers.utils.solidityKeccak256(["address", "uint256"], [account, amount]);
}

const hashPair = (a: string, b: string) =>
  ethers.utils.keccak256(ethers.utils.concat(BigInt(a) < BigInt(b) ? [a, b] : [b, a]));

export function merkleRoot(entries: [string, bigint][]): string {
  if (!entries.length) return ethers.constants.HashZero;
  let level = entries.map(([acc, amt]) => leafHash(acc, amt)).sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hashPair(level[i]!, level[i + 1]!) : level[i]!);
    level = next;
  }
  return level[0]!;
}

export function merkleProof(entries: [string, bigint][], account: string, amount: bigint): string[] {
  let level = entries.map(([acc, amt]) => leafHash(acc, amt)).sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
  let idx = level.indexOf(leafHash(account, amount));
  if (idx < 0) throw new Error("leaf not in tree");
  const proof: string[] = [];
  while (level.length > 1) {
    const sib = idx ^ 1;
    if (sib < level.length) proof.push(level[sib]!);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hashPair(level[i]!, level[i + 1]!) : level[i]!);
    level = next;
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function verifyProof(proof: string[], root: string, leaf: string): boolean {
  return proof.reduce((h, p) => hashPair(h, p), leaf) === root;
}

/** Score a whole epoch: sum per-sample scores per owner, return entries sorted by address. */
export function scoreEpoch(
  snaps: Map<number, Order[]>,
  refRaw: bigint | null,
  bandBps: number,
  minRest: number,
) {
  const totals = new Map<string, bigint>();
  const samples: { block: number; mid: string | null; scored: number }[] = [];
  for (const [block, orders] of [...snaps.entries()].sort((a, b) => a[0] - b[0])) {
    const mid = sampleMid(orders, refRaw);
    if (mid === null) {
      samples.push({ block, mid: null, scored: 0 });
      continue;
    }
    const s = scoreSample(orders, block, mid, bandBps, minRest);
    for (const [o, q] of s) totals.set(o, (totals.get(o) ?? 0n) + q);
    samples.push({ block, mid: mid.toString(), scored: s.size });
  }
  const entries = [...totals.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { entries, root: merkleRoot(entries), samples };
}
