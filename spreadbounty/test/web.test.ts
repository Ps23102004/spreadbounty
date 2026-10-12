/**
 * Web helpers that must agree with the production core (alpha lane).
 *   npm run test:web
 */
import assert from "node:assert/strict";
import type { Order } from "../src/core/book";
import { scoreSample } from "../src/core/score";
import { quoteWeight } from "../web/src/ui/probe";

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

console.log(`${n} tests passed`);
