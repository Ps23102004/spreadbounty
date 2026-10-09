/**
 * Offline checks (no RPC): ABIs match @kuru-labs/kuru-sdk, replay/scoring/merkle behave on synthetic logs.
 *   npm run selftest
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { ERC20_ABI, MARGIN_ABI, ORDERBOOK_ABI, ROUTER_ABI } from "../src/abi";
import { decodeBookLogs, obIface, replay } from "../src/book";
import { leafHash, merkleProof, merkleRoot, pickSampleBlocks, scoreEpoch, scoreSample, verifyProof } from "../src/score";
import type { RawLog } from "../src/rpc";

const require = createRequire(import.meta.url);
let checks = 0;
const ok = (name: string) => { checks++; console.log(`  ok  ${name}`); };

// ---------- 1. ABI fragments match the SDK's JSON ABIs ----------
function sdkAbi(file: string) {
  const j = require(`@kuru-labs/kuru-sdk/abi/${file}`);
  return new ethers.utils.Interface(Array.isArray(j) ? j : j.abi);
}
for (const [mine, file] of [[ORDERBOOK_ABI, "OrderBook.json"], [ROUTER_ABI, "Router.json"], [MARGIN_ABI, "MarginAccount.json"]] as const) {
  const sdk = sdkAbi(file);
  const ours = new ethers.utils.Interface(mine as readonly string[] as string[]);
  for (const f of Object.values(ours.functions)) assert.equal(sdk.getSighash(f.name), ours.getSighash(f), `${file} ${f.format()}`);
  for (const e of Object.values(ours.events)) assert.equal(sdk.getEventTopic(e.name), ours.getEventTopic(e), `${file} ${e.format()}`);
  for (const e of Object.values(ours.errors)) assert.equal(sdk.getSighash(e.name), ours.getSighash(e), `${file} ${e.format()}`);
  // output arity for the views we decode
  for (const f of Object.values(ours.functions).filter((f) => f.constant)) {
    assert.equal(sdk.getFunction(f.name).outputs!.length, f.outputs!.length, `${file} ${f.name} outputs`);
  }
  ok(`${file}: ${Object.keys(ours.functions).length} functions, ${Object.keys(ours.events).length} events, ${Object.keys(ours.errors).length} errors match SDK`);
}
new ethers.utils.Interface(ERC20_ABI);

// ---------- 2. Replay on synthetic logs ----------
const MKT = "0x8cF49e35D73B19433FF4d4421637AABB680dc9Cc";
const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const T = "0x00000000000000000000000000000000000000cc";
let logIndex = 0;
function log(block: number, name: string, args: unknown[]): RawLog {
  const { data, topics } = obIface.encodeEventLog(obIface.getEvent(name), args);
  return { address: MKT, data, topics, blockNumber: block, logIndex: logIndex++, transactionHash: ethers.utils.id(`${block}-${logIndex}`), blockHash: "0x", transactionIndex: 0, removed: false } as RawLog;
}
// prices in pricePrecision 1e4 (1.0000 = 10000), sizes in sizePrecision 1e2
const logs: RawLog[] = [
  log(100, "OrderCreated", [1, A, 1000, 9995, true]), // A bid 10 @ 0.9995 (5 bps)
  log(100, "OrderCreated", [2, A, 1000, 10005, false]), // A ask 10 @ 1.0005
  log(101, "OrderCreated", [3, B, 2000, 9990, true]), // B bid 20 @ 0.9990 (10 bps), one-sided
  log(102, "OrderCreated", [4, B, 500, 9900, true]), // B bid outside a 15 bps band
  log(150, "Trade", [2, A, true, ethers.utils.parseUnits("1.0005", 18), 400, T, T, 600]), // A ask filled 6, 4 left
  log(160, "OrdersCanceled", [[4], B]),
  log(170, "FlipOrderCreated", [9, 10, B, 300, 10010, 9990, false]), // B flip ask 3 @ 1.0010
  log(180, "FlipOrderUpdated", [9, 0]), // flip order fully filled -> removed
];
const events = decodeBookLogs(logs);
assert.equal(events.length, logs.length);
const { live, snaps } = replay(events, [120, 155, 175, 200]);
assert.deepEqual([...live.keys()].sort(), [1, 2, 3]);
assert.equal(live.get(2)!.size, 400n);
assert.equal(snaps.get(120)!.length, 4); // before trade/cancel
assert.equal(snaps.get(155)!.find((o) => o.id === 2)!.size, 400n);
assert.equal(snaps.get(175)!.some((o) => o.id === 9), true);
assert.equal(snaps.get(200)!.some((o) => o.id === 9 || o.id === 4), false);
ok("replay: create / trade resize / cancel / flip create+update, snapshots at block boundaries");

// orders created before the window: trades and cancels on unknown ids are ignored
const partial = replay(decodeBookLogs([log(300, "Trade", [77, A, true, 1n, 0, T, T, 5]), log(301, "OrdersCanceled", [[78], A])]));
assert.equal(partial.live.size, 0);
ok("replay: events on pre-window orders ignored");

// ---------- 3. Scoring ----------
const mid = 10000n;
const s = scoreSample(snaps.get(155)!, 155, mid, 15, 20);
// A two-sided: bid 1000 @5bps -> (10/15)^2*1000 = 444; ask 400 @5bps -> 177; Q = max(min, max/3) = 177
assert.equal(s.get(A.toLowerCase()), 177n);
// B one-sided bid 2000 @10bps -> (5/15)^2*2000 = 222 -> Q = 222/3 = 74 ; order 4 is outside band
assert.equal(s.get(B.toLowerCase()), 74n);
ok("score: two-sided beats one-sided, out-of-band ignored, integer maths");
const young = scoreSample(snaps.get(120)!, 120, mid, 15, 20);
assert.equal(young.get(B.toLowerCase()), undefined); // B's orders rested 19-20 blocks: id3 created 101 -> 19 < 20
ok("score: min-rest enforced");

// ---------- 4. Merkle: 1inch CumulativeMerkleDrop format ----------
const leafManual = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256"], [A, 177n]));
assert.equal(leafHash(A, 177n), leafManual);
const entries: [string, bigint][] = [[A.toLowerCase(), 177n], [B.toLowerCase(), 74n], [T, 5n]];
const root = merkleRoot(entries);
assert.equal(root, merkleRoot([...entries].reverse()));
for (const [acc, amt] of entries) assert.ok(verifyProof(merkleProof(entries, acc, amt), root, leafHash(acc, amt)));
assert.ok(!verifyProof(merkleProof(entries, A.toLowerCase(), 177n), root, leafHash(A, 178n)));
ok("merkle: leaf = keccak(encodePacked(account, amount)), sorted pairs, order-independent root, proofs verify");

// ---------- 5. Sampling + epoch determinism ----------
const fakeHash = async (n: number) => ethers.utils.id(`block-${n}`);
const picks = await pickSampleBlocks(100, 299, 50, fakeHash);
assert.equal(picks.length, 4);
picks.forEach((b, i) => assert.ok(b >= 100 + i * 50 && b < 150 + i * 50));
assert.deepEqual(picks, await pickSampleBlocks(100, 299, 50, fakeHash));
const e1 = scoreEpoch(replay(decodeBookLogs(logs), picks).snaps, mid, 15, 20);
const e2 = scoreEpoch(replay(decodeBookLogs([...logs]), [...picks].reverse()).snaps, mid, 15, 20);
assert.equal(e1.root, e2.root);
assert.ok(e1.entries.length > 0);
ok(`epoch: one sample per window, same logs -> same root (${e1.root.slice(0, 18)}...)`);

console.log(`\n${checks} checks passed`);
