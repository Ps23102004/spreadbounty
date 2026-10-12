/**
 * Offline tests for the deterministic core (no RPC, no API key).
 *   npm test
 */
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { obIface } from "../src/core/book";
import { buildEpoch, epochMetrics, verifyEpoch, type Campaign } from "../src/core/epoch";
import { historyStats, simulateCampaign } from "../src/core/analytics";
import { leafHash, merkleProof, verifyProof } from "../src/core/score";
import type { RawLog } from "../src/core/rpc";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok  ${m}`); };

const MKT = "0x8cF49e35D73B19433FF4d4421637AABB680dc9Cc";
const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const T = "0x00000000000000000000000000000000000000cc";
let li = 0;
const log = (block: number, name: string, args: unknown[], address = MKT): RawLog => {
  const { data, topics } = obIface.encodeEventLog(obIface.getEvent(name), args);
  return { address, data, topics, blockNumber: block, logIndex: li++, transactionHash: ethers.utils.id(`tx-${li}`), blockHash: "0x", transactionIndex: 0, removed: false } as RawLog;
};
const hash = async (b: number) => ethers.utils.id(`blockhash-${b}`);

// AUSD/USDC-like: price precision 1e7 (1.0 = 10_000_000), size precision 1e6
const campaign: Campaign = {
  id: "test-ausd", chainId: 143, market: MKT, pair: "AUSD/USDC", implementation: "0x5e3446c600524Be453bbCEFD46a9E4C9bE8899a0",
  pricePrecision: "10000000", sizePrecision: "1000000", refPrice: "10000000",
  bandBps: 15, minRestBlocks: 20, sampleEvery: 100, replayFromBlock: 1000, epochBlocks: 1000,
  budgetPerEpoch: "100000000", rewardToken: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", rewardDecimals: 6, sponsor: T,
};

const logs: RawLog[] = [
  log(990, "OrderCreated", [1, B, 50_000_000, 9_995_000, true]), // before campaign start: never counts
  log(1001, "OrderCreated", [2, A, 10_000_000, 9_995_000, true]), // A bid 10 @ 0.9995
  log(1001, "OrderCreated", [3, A, 10_000_000, 10_005_000, false]), // A ask 10 @ 1.0005
  log(1200, "OrderCreated", [4, B, 20_000_000, 9_990_000, true]), // B bid only, 10 bps
  log(1500, "Trade", [3, A, true, ethers.utils.parseUnits("1.0005", 18), 4_000_000, T, T, 6_000_000]),
  log(1700, "OrdersCanceled", [[4], B]),
  log(1800, "OrderCreated", [5, B, 5_000_000, 10_010_000, false], "0x0000000000000000000000000000000000000001"), // other market
  log(2100, "OrderCreated", [6, B, 30_000_000, 10_001_000, false]), // epoch 1: B ask
];

// ---------- epoch 0 ----------
const e0 = await buildEpoch(campaign, 0, logs, hash, null);
assert.equal(e0.fromBlock, 1000);
assert.equal(e0.toBlock, 1999);
assert.equal(e0.samples.length, 10);
assert.equal(e0.logCount, 5); // 990 and other-market logs excluded, 2100 is after epoch 0
assert.ok(e0.amounts.length >= 1);
const paid0 = e0.amounts.reduce((s, a) => s + BigInt(a.amount), 0n);
assert.ok(paid0 <= BigInt(campaign.budgetPerEpoch));
assert.ok(!e0.scores.some((s) => s.account === B.toLowerCase()) || BigInt(e0.scores.find((s) => s.account === B.toLowerCase())!.score) < BigInt(e0.scores.find((s) => s.account === A.toLowerCase())!.score));
ok(`epoch 0: ${e0.samples.length} samples, ${e0.logCount} campaign logs, paid ${paid0} <= budget, two-sided A outscores one-sided B`);

for (const s of e0.samples) {
  assert.ok(s.block >= 1000 + Math.floor((s.block - 1000) / 100) * 100);
  assert.equal(s.closer, 1000 + Math.floor((s.block - 1000) / 100) * 100 + 99);
}
ok("sample records: each sample sits in its window and names the closing block whose hash picked it");

// ---------- verify: same inputs pass, any tamper fails ----------
const v = await verifyEpoch(e0, [...logs].reverse().sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex), hash, null);
assert.ok(v.ok, v.diffs.join("\n"));
ok("verify: recomputed from logs, every committed field matches");

const tampered = JSON.parse(JSON.stringify(e0));
tampered.cumulative[0].amount = (BigInt(tampered.cumulative[0].amount) + 1n).toString();
assert.ok(!(await verifyEpoch(tampered, logs, hash, null)).ok);
const dropped = logs.filter((l) => l.blockNumber !== 1500); // hide the trade
assert.ok(!(await verifyEpoch(e0, dropped, hash, null)).ok);
const otherHashes = async (b: number) => ethers.utils.id(`other-${b}`);
assert.ok(!(await verifyEpoch(e0, logs, otherHashes, null)).ok);
ok("verify: edited payout, withheld log, or different block hashes are all detected");

// ---------- epoch 1 chains cumulatively ----------
const e1 = await buildEpoch(campaign, 1, logs, hash, e0);
assert.equal(e1.prevRoot, e0.root);
for (const c0 of e0.cumulative) {
  const c1 = e1.cumulative.find((c) => c.account === c0.account)!;
  assert.ok(BigInt(c1.amount) >= BigInt(c0.amount));
}
await assert.rejects(buildEpoch(campaign, 2, logs, hash, e0)); // must chain from epoch 1
const entries = e1.cumulative.map((c) => [c.account, BigInt(c.amount)] as [string, bigint]);
for (const [acc, amt] of entries) assert.ok(verifyProof(merkleProof(entries, acc, amt), e1.root, leafHash(acc, amt)));
ok("epoch 1: cumulative amounts never decrease, chain enforced, every claim proof verifies");

// ---------- every committed field is checked, not only the Merkle inputs (judge finding) ----------
{
  const bump = (xs: { account: string; amount: string }[]) => xs.map((x, i) => (i === 0 ? { ...x, amount: (BigInt(x.amount) + 5_000_000n).toString() } : x));
  assert.ok((await verifyEpoch(e1, logs, hash, e0)).ok, "the honest chained epoch still verifies");
  const amountsOnly = await verifyEpoch({ ...e0, amounts: bump(e0.amounts) }, logs, hash, null);
  assert.ok(!amountsOnly.ok && amountsOnly.diffs.some((d) => d.startsWith("amounts")), "a raised per-epoch payout, with the real cumulative and root, is caught");
  assert.ok(!(await verifyEpoch({ ...e0, toBlock: e0.toBlock + 1 }, logs, hash, null)).ok, "a different block range is caught");
  assert.ok(!(await verifyEpoch({ ...e1, prevRoot: null }, logs, hash, e0)).ok, "a wrong prevRoot is caught");
}
ok("verify: a tampered per-epoch amounts list, block range or prevRoot is detected");

const m = epochMetrics(e0);
assert.equal(m.samples, 10);
assert.ok(m.twoSidedCoveragePct > 0 && m.twoSidedCoveragePct <= 100);
assert.ok(m.makersPaid >= 1);
ok(`metrics: coverage ${m.twoSidedCoveragePct.toFixed(0)}%, avg two-sided depth ${m.avgTwoSidedDepthQuote.toFixed(2)} USDC, cost/$1k ${m.costPer1kDepthQuote?.toFixed(2)}`);

// ---------- analytics for the copilot ----------
const hs = historyStats(logs, MKT, 1000, 2999, 100, 10_000_000n, 1_000_000n);
assert.ok(hs.makers >= 1 && hs.samples > 0);
ok(`historyStats: ${hs.samples} snapshots, ${hs.makers} makers, two-sided@15bps ${hs.coverageByBand["15"]?.toFixed(0)}%`);
const sim = simulateCampaign(logs, MKT, { fromBlock: 1000, toBlock: 2999, bandBps: 15, minRestBlocks: 20, sampleEvery: 100, refPrice: 10_000_000n, budgetPerDay: 50, blockSeconds: 0.3 }, 10_000_000n, 1_000_000n);
assert.ok(sim.makers.length >= 1);
assert.ok(Math.abs(sim.makers.reduce((s, x) => s + x.sharePct, 0) - 100) < 0.01); // shares floored at 1e-6
ok(`simulateCampaign: ${sim.makers.length} makers would earn; top share ${sim.makers[0]!.sharePct.toFixed(0)}%`);

console.log(`\n${n} tests passed`);
