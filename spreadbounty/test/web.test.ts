/**
 * Web helpers that must agree with the production core (alpha lane).
 *   npm run test:web
 */
import assert from "node:assert/strict";
import type { Order } from "../src/core/book";
import { scoreSample } from "../src/core/score";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import type { EpochFile } from "../src/core/epoch";
import type { RawLog } from "../src/core/rpc";
import { quoteWeight } from "../web/src/ui/probe";
import { forge, recompute } from "../web/src/ui/useRecompute";

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

console.log(`${n} tests passed`);
