/**
 * Web helpers that must agree with the production core (alpha lane).
 *   npm run test:web
 */
import assert from "node:assert/strict";
import type { Order } from "../src/core/book";
import { scoreSample } from "../src/core/score";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import type { RawLog } from "../src/core/rpc";
import { quoteWeight } from "../web/src/ui/probe";
import { buildEpoch, type EpochFile } from "../src/core/epoch";
import { forge, recompute, termsDiff } from "../web/src/ui/useRecompute";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok  ${m}`); };

// ---------- A2: the quote probe asks scoreSample, so its weight is the scorer's weight ----------
{
  const P = 10_000_000n; // AUSD/USDC price precision: 1.0000 = 10,000,000
  const mid = P;
  const band = 15;
  const tick = 100n; // 0.1 bps
  const SIZE = 10n ** 12n;
  // 20 cases from -20 bps to +20 bps, plus exactly at both band edges
  const offsets = [-200, -151, -150, -149, -120, -90, -60, -30, -10, -1, 0, 1, 10, 30, 60, 90, 120, 149, 150, 151, 200].map(BigInt);
  for (const k of offsets) {
    const price = mid + k * tick;
    const w = quoteWeight(price, mid, band);
    // one-order book straight through the scorer
    const one: Order = { id: 1, owner: "x", price, size: SIZE, isBuy: price < mid, createdBlock: 0 };
    const direct = Number(scoreSample([one], 1, mid, band, 0).get("x") ?? 0n) / Number(SIZE);
    assert.equal(w.oneSided, direct, `one-sided weight at ${k} ticks`);
    // and the published formula ((band - dist) / band)^2, 0 at or past the edge
    const dist = Math.abs(Number(k * tick)) / Number(mid) * 1e4;
    const expect = dist >= band ? 0 : ((band - dist) / band) ** 2;
    assert.ok(Math.abs(w.twoSided - expect) < 1e-9, `two-sided weight at ${dist} bps: ${w.twoSided} vs ${expect}`);
    assert.ok(Math.abs(w.oneSided * 3 - w.twoSided) < 1e-9, "one side earns a third");
  }
  assert.equal(quoteWeight(mid + 150n * tick, mid, band).twoSided, 0, "exactly at the band edge: weight 0");
  assert.equal(quoteWeight(mid - 150n * tick, mid, band).twoSided, 0, "exactly at the lower band edge: weight 0");
  assert.equal(quoteWeight(mid, mid, band).twoSided, 1, "at the reference: the top score");
  ok(`quote probe: ${offsets.length} prices match scoreSample on a one-order book; 0 at both band edges, 1 at the reference, one side = a third`);
}

// ---------- A3: Start and Verify share one recompute; it passes the real demo epochs and catches the forge ----------
{
  const dir = "out/demo/ausd-usdc-demo";
  const files = [0, 1, 2].map((k) => JSON.parse(readFileSync(`${dir}/epoch-${k}.json`, "utf8")) as EpochFile);
  const logs = JSON.parse(readFileSync(`${dir}/epoch-2.logs.json`, "utf8")) as RawLog[];
  const hash = async (b: number) => ethers.utils.id(`spreadbounty-demo-block-${b}`); // the formula the browser uses in demo mode
  const seen: number[] = [];
  const good = await recompute(files, logs, hash, false, (c) => { seen.push(c.epoch); });
  assert.equal(good.ok, true, `honest epochs verify: ${good.diffs.join(", ")}`);
  assert.equal(good.recomputed, files[2]!.root);
  assert.deepEqual(seen, [0, 1, 2], "every epoch reported in order, so the tape prints real progress");
  assert.ok(good.checks.every((c) => c.ok) && good.forgedWho === null);

  const bad = await recompute(files, logs, hash, true);
  assert.equal(bad.ok, false, "a forged payout list fails");
  assert.ok(bad.diffs.includes("cumulative") && bad.diffs.includes("root"), `fields that differ: ${bad.diffs.join(", ")}`);
  const f = forge(files[2]!);
  assert.equal(bad.committed, f.file.root, "the forged file carries its own well-formed root");
  assert.notEqual(f.file.root, files[2]!.root);
  assert.equal(bad.recomputed, files[2]!.root, "recomputing from logs gets the honest root back");
  assert.equal(bad.forgedWho, f.who);
  assert.equal(files.length, 3, "inputs untouched by the forge");
  assert.equal(files[2]!.root, JSON.parse(readFileSync(`${dir}/epoch-2.json`, "utf8")).root);

  const upTo1 = await recompute(files.slice(0, 2), logs.filter((l) => l.blockNumber <= files[1]!.toBlock), hash, false);
  assert.equal(upTo1.ok, true, "a shorter chain (up to epoch 1) verifies too");
  ok(`recompute (shared by Start and Verify): demo epochs 0-2 verify (root ${good.recomputed.slice(0, 10)}…); forged epoch 2 fails on cumulative and root`);
}

// ---------- judge finding: files must carry the published terms and honest per-epoch payouts ----------
{
  const dir = "out/demo/ausd-usdc-demo";
  const files = [0, 1, 2].map((k) => JSON.parse(readFileSync(`${dir}/epoch-${k}.json`, "utf8")) as EpochFile);
  const logs = JSON.parse(readFileSync(`${dir}/epoch-2.logs.json`, "utf8")) as RawLog[];
  const hash = async (b: number) => ethers.utils.id(`spreadbounty-demo-block-${b}`);
  const published = { ...files[2]!.campaign, rationale: "x", epochs: 3 }; // what /api/campaigns lists: the campaign plus extras
  assert.deepEqual(termsDiff(files[2]!.campaign, published), [], "extras the file does not carry are not differences");
  const good = await recompute(files, logs, hash, false, undefined, published);
  assert.equal(good.ok, true, `honest files carry the published terms: ${good.diffs.join(", ")}`);

  // 1. a payout list that does not add up, with the real cumulative and root untouched
  const raised = files.map((f) => ({ ...f }));
  raised[2] = { ...raised[2]!, amounts: raised[2]!.amounts.map((a, i) => (i === 0 ? { ...a, amount: (BigInt(a.amount) + 5_000_000n).toString() } : a)) };
  const r1 = await recompute(raised, logs, hash, false, undefined, published);
  assert.equal(r1.ok, false, "a tampered amounts list must not verify");
  assert.ok(r1.diffs.includes("amounts"), `fields that differ: ${r1.diffs.join(", ")}`);
  assert.equal(r1.epoch, 2, "the outcome names the epoch that failed");
  assert.equal(r1.committed, r1.recomputed, "roots are equal when only the payout list changed, so the tape must not say the roots differ");

  // 2. campaign terms rewritten inside every epoch file, rebuilt with the production builder so each file is self-consistent
  const rich = { ...files[0]!.campaign, budgetPerEpoch: (BigInt(files[0]!.campaign.budgetPerEpoch) * 2n).toString(), bandBps: 40 };
  const rebuilt: EpochFile[] = [];
  for (let k = 0; k < 3; k++) rebuilt.push(await buildEpoch(rich, k, logs, hash, rebuilt[k - 1] ?? null));
  assert.equal((await recompute(rebuilt, logs, hash, false)).ok, true, "without the published terms a self-consistent rewrite verifies (this is why the terms are compared)");
  const r2 = await recompute(rebuilt, logs, hash, false, undefined, published);
  assert.equal(r2.ok, false, "a rewritten budget and band must not verify against the published campaign");
  assert.ok(r2.diffs.includes("campaign.budgetPerEpoch") && r2.diffs.includes("campaign.bandBps"), `fields that differ: ${r2.diffs.join(", ")}`);
  assert.equal(r2.epoch, 0, "the first epoch whose terms differ stops the run, and the roots shown are that epoch's");

  // 3. a rule dropped from the files (the rebuilt files score without it): a missing field is a difference, not a match
  const lacking = { ...files[0]!.campaign } as Record<string, unknown>;
  delete lacking.minRestBlocks;
  const dropped: EpochFile[] = [];
  for (let k = 0; k < 3; k++) dropped.push(await buildEpoch(lacking as unknown as EpochFile["campaign"], k, logs, hash, dropped[k - 1] ?? null));
  const r3 = await recompute(dropped, logs, hash, false, undefined, published);
  assert.equal(r3.ok, false, "files that omit a campaign rule must not verify against the published campaign");
  assert.ok(r3.diffs.includes("campaign.minRestBlocks"), `fields that differ: ${r3.diffs.join(", ")}`);
}
ok("recompute: a tampered payout list and rewritten campaign terms both fail; honest files with the published terms pass");


// ---------- A5: the session store asks GET /api/me only when this browser may hold a session ----------
{
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k) };
  const calls: string[] = [];
  let reply: { status: number; body: unknown } = { status: 401, body: { error: "Not signed in." } };
  (globalThis as any).fetch = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  };
  const s = await import("../web/src/ui/session");
  let now = s.getSession();
  assert.equal(now.checked, false);

  await s.refreshSession();
  assert.equal(calls.length, 0, "a visitor who never signed in here makes no request, so no 401 reaches the console");
  assert.equal(s.getSession().checked, true);
  assert.equal(s.getSession().address, null);

  s.setHint(Date.now() + 60_000);
  await s.refreshSession();
  assert.deepEqual(calls, ["/api/me"], "a live hint asks the server");
  assert.equal(s.getSession().address, null, "401 means signed out");
  assert.equal(mem.size, 0, "a 401 clears the hint, so the next load stays quiet");

  s.setHint(Date.now() + 60_000);
  reply = { status: 200, body: { address: null } };
  await s.refreshSession();
  assert.equal(s.getSession().address, null, "200 with address null means signed out");
  assert.equal(mem.size, 0);

  s.setHint(Date.now() + 60_000);
  const roles = { sponsorOf: ["x"], makerIn: [] };
  reply = { status: 200, body: { address: "0xAbC0000000000000000000000000000000000001", roles } };
  await s.refreshSession();
  now = s.getSession();
  assert.equal(now.address, "0xAbC0000000000000000000000000000000000001");
  assert.deepEqual(now.roles, roles);
  assert.equal(mem.size, 1, "a live session keeps its hint");

  s.setHint(Date.now() - 1);
  calls.length = 0;
  await s.refreshSession();
  assert.equal(calls.length, 0, "an expired hint is the same as none");
  assert.equal(s.getSession().address, null);
  assert.ok(![...mem.values()].some((v) => /0x|sess|sig/i.test(v)), "the browser keeps a timestamp, never a token or address");
  ok("session: no /api/me call without a live hint; 401 and {address:null} both mean signed out and clear the hint; storage holds only a timestamp");
}


// ---------- B3: the sampling strip redoes the draw from the epoch file, and a moved sample fails ----------
{
  const { explainSample } = await import("../web/src/ui/sampling");
  const { pickSampleBlocks } = await import("../src/core/score");
  let n = 0;
  for (const k of [0, 1, 2]) {
    const f = JSON.parse(readFileSync(`out/demo/ausd-usdc-demo/epoch-${k}.json`, "utf8")) as EpochFile;
    const every = f.campaign.sampleEvery;
    const core = await pickSampleBlocks(f.fromBlock, f.toBlock, every, async (b) => ethers.utils.id(`spreadbounty-demo-block-${b}`));
    assert.deepEqual(f.samples.map((s) => s.block), core, "the epoch file holds the scorer's sample blocks");
    for (const s of f.samples) {
      const e = explainSample(s, every);
      assert.ok(e.agrees && e.start + e.offset === s.block && e.offset >= 0 && e.offset < every, `sample ${s.block}`);
      n++;
    }
    const moved = { ...f.samples[0]!, block: f.samples[0]!.block + 1 };
    assert.equal(explainSample(moved, every).agrees, false, "a sample block moved by one fails the rule");
  }
  ok(`sampling strip: ${n} demo samples redo as window start + hash mod sampleEvery, matching pickSampleBlocks; a moved sample fails`);
}

console.log(`${n} tests passed`);
