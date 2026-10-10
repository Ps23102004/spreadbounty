/**
 * Maker bot tests, offline. Strategy rules as unit tests; then backtests on the demo dataset scored by the real
 * epoch builder.   npm run test:bot   (needs npm run demo:gen)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Campaign } from "../src/core/epoch";
import { demoSource } from "../src/data/source";
import { compareStrategies, marketFrom, simulateBot, strategies } from "../src/bot/sim";
import { decide, DEFAULT_PARAMS, type BotParams, type Market } from "../src/bot/strategy";
import { LiveBot } from "../src/bot/live";
import { provider } from "../src/core/fetch";
import { startFakeChain } from "./fake-chain";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok  ${m}`); };

// AUSD-like market: price precision 1e7, tick 100 (0.00001 -> 0.1 bps), size precision 1e6
const P = 10_000_000n, S = 1_000_000n;
const m: Market = { bandBps: 15, minRestBlocks: 20, tick: 100n, minSize: 10n * S };
const p: BotParams = { ...DEFAULT_PARAMS, sizeRaw: 1000n * S, maxInventoryRaw: 5000n * S };
const ref = P; // 1.0
const base = { block: 1000, refPrice: ref, othersBid: 9_998_000n, othersAsk: 10_002_000n, mine: [], inventoryRaw: 0n };

// ---------- strategy ----------
{
  const d = decide(base, m, p);
  const places = d.actions.filter((a) => a.kind === "place");
  assert.equal(places.length, 2);
  const bid = places.find((a) => a.kind === "place" && a.isBuy)!, ask = places.find((a) => a.kind === "place" && !a.isBuy)!;
  // 0.35 * 15 bps = 5.25 bps -> 0.999475 / 1.000525, rounded away from the centre to the 0.00001 tick
  assert.equal(bid.kind === "place" && bid.price, 9_994_700n);
  assert.equal(ask.kind === "place" && ask.price, 10_005_300n);
  ok("fresh book: one bid and one ask, 35% of the band from the reference, tick-aligned away from the centre");
}
{
  const mine = [{ id: 1, isBuy: true, price: 9_994_700n, size: 1000n * S, createdBlock: 900 }, { id: 2, isBuy: false, price: 10_005_300n, size: 1000n * S, createdBlock: 900 }];
  assert.deepEqual(decide({ ...base, mine }, m, p).actions, []);
  // a little off target but inside the hysteresis: still left alone (a requote would forfeit 20 blocks of rest)
  const near = [{ ...mine[0]!, price: 9_996_000n }, mine[1]!];
  assert.deepEqual(decide({ ...base, mine: near }, m, p).actions, []);
  ok("good resting orders are left alone, even slightly off target: no churn");
}
{
  const mine = [
    { id: 1, isBuy: true, price: 9_986_000n, size: 1000n * S, createdBlock: 900 }, // 14 bps: past 85% of the band
    { id: 2, isBuy: false, price: 10_005_300n, size: 1000n * S, createdBlock: 800 },
    { id: 3, isBuy: false, price: 10_005_300n, size: 1000n * S, createdBlock: 900 }, // duplicate ask
  ];
  const d = decide({ ...base, mine }, m, p);
  assert.deepEqual(d.actions[0], { kind: "cancel", ids: [1, 2] });
  assert.equal(d.actions.filter((a) => a.kind === "place").length, 1);
  assert.ok(d.notes.some((x) => x.includes("band edge")));
  ok("an order drifting to the band edge is requoted; duplicate orders on a side are cancelled");
}
{
  const d = decide({ ...base, othersBid: 9_960_000n, othersAsk: 9_964_000n, mine: [{ id: 7, isBuy: true, price: 9_994_700n, size: 1000n * S, createdBlock: 1 }] }, m, p);
  assert.deepEqual(d.actions, [{ kind: "cancel", ids: [7] }]);
  assert.ok(d.notes[0]!.includes("peg guard"));
  ok("peg guard: the book trades 38 bps off the reference -> every quote pulled");
}
{
  const d = decide({ ...base, inventoryRaw: 6000n * S }, m, p);
  const places = d.actions.filter((a) => a.kind === "place");
  assert.equal(places.length, 1);
  assert.equal(places[0]!.kind === "place" && places[0]!.isBuy, false);
  ok("inventory limit: long past the cap -> no bid, ask only");
}
{
  const d = decide({ ...base, othersAsk: 9_994_000n }, m, p); // someone asks below our target bid
  const bid = d.actions.find((a) => a.kind === "place" && a.isBuy);
  assert.equal(bid?.kind === "place" && bid.price, 9_993_900n);
  ok("post-only: the bid never crosses the resting ask (one tick under it)");
}
{
  const mine = [{ id: 1, isBuy: true, price: 9_994_700n, size: 1000n * S, createdBlock: 500 }, { id: 2, isBuy: false, price: 10_005_300n, size: 1000n * S, createdBlock: 500 }];
  const d = decide({ ...base, mine, countsFrom: 600 }, m, p);
  assert.deepEqual(d.actions[0], { kind: "cancel", ids: [1, 2] });
  assert.ok(d.notes.every((x) => x.includes("before the campaign")));
  ok("orders placed before the campaign started are replaced (they would never score)");
}

// ---------- backtests on the demo dataset, scored by buildEpoch ----------
process.chdir(new URL("..", import.meta.url).pathname);
const src = demoSource();
const ausd = JSON.parse(readFileSync("out/demo/campaign-ausd-usdc-demo.json", "utf8")) as Campaign;
const rs = await compareStrategies(src, ausd, 2, 2000, 20000);
const [bot, naive, lazy] = rs;
assert.ok(bot!.payout > naive!.payout && naive!.payout > lazy!.payout, rs.map((r) => `${r.strategy}: ${r.payout}`).join(" | "));
assert.ok(bot!.txs < naive!.txs / 10);
assert.equal(bot!.restingTwoSidedPct, 100);
assert.ok(bot!.withBot.avgTwoSidedDepthQuote > bot!.withoutBot.avgTwoSidedDepthQuote);
const again = await compareStrategies(src, ausd, 2, 2000, 20000);
assert.deepEqual(again.map((r) => r.payout), rs.map((r) => r.payout));
ok(`AUSD epoch 2: bot ${bot!.payout} > naive ${naive!.payout} (${naive!.txs} txs) > lazy ${lazy!.payout} USDC; deterministic`);

// a moving market with no fixed reference: MON/USDC, centre = the rest of the book's mid
const monInfo = await src.market("MON/USDC");
const mon: Campaign = {
  ...ausd, id: "mon-usdc-test", market: monInfo.market, pair: "MON/USDC", pricePrecision: monInfo.pricePrecision, sizePrecision: monInfo.sizePrecision,
  refPrice: null, bandBps: 25, replayFromBlock: 111_955_000,
};
const monS = BigInt(mon.sizePrecision);
const [mbot] = strategies(mon, 20_000n * monS, 60_000n * monS);
const r = await simulateBot({ campaign: mon, epoch: 1, logs: await src.logs(mon.market, mon.replayFromBlock, 111_978_999), blockHash: src.blockHash, market: marketFrom(mon, monInfo), params: mbot!.params, strategy: mbot!.name });
assert.ok(r.payout > 0);
assert.ok(r.places > 2, "the bot must follow a moving mid");
assert.ok(Math.abs(r.inventory) <= 80_000, `inventory ${r.inventory} beyond limit + one order`);
ok(`MON/USDC epoch 1 (moving mid): ${r.places} quotes, ${r.fills} fills, inventory ${r.inventory} MON, payout ${r.payout} USDC (${r.sharePct.toFixed(1)}%)`);

// ---------- the live runner, paper mode, against a fake RPC serving the same demo chain ----------
const fake = await startFakeChain({ startBlock: 111_980_000, step: 7 });
try {
  const rpc = provider(fake.url);
  const fresh = new LiveBot(rpc, ausd, { ...p }, null, "0x000000000000000000000000000000000000b0b0", false, () => {});
  await fresh.init(3000);
  const t = await fresh.tick();
  assert.equal(t.centre, 1);
  assert.equal(t.mine.length, 0);
  assert.deepEqual(t.actions, ["bid 1000 @ 0.99947 (post-only)", "ask 1000 @ 1.00053 (post-only)"]);
  assert.deepEqual(t.sent, []);
  assert.equal(t.sharePctNow, 0);

  // watching an existing demo maker: its resting orders are adopted, its live score share is estimated
  const a1 = "0xde000000000000000000000000000000000000a1";
  const watcher = new LiveBot(rpc, ausd, { ...p }, null, a1, false, () => {});
  await watcher.init(3000);
  const w = await watcher.tick();
  assert.ok(w.mine.length >= 1, "a1's resting orders should be found in the lookback window");
  assert.ok(w.sharePctNow !== null && w.sharePctNow > 0);
  const w2 = await watcher.tick();
  assert.ok(w2.block > w.block);
  ok(`live runner (paper) on a fake RPC: plans 2 post-only quotes from scratch; adopts maker A1's ${w.mine.length} orders, share now ${w.sharePctNow}%`);
} finally {
  fake.close();
}

console.log(`\n${n} tests passed`);
