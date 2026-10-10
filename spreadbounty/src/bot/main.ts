/**
 * Spreadbounty maker bot.
 *
 *   npm run bot -- sim  <campaign.json> [--epoch n] [--size 2000]          backtest 3 strategies, scored by the real epoch builder
 *   npm run bot -- plan <campaign.json> [--size 2000]                      one read-only tick on mainnet: book, my orders, what it would do
 *   npm run bot -- run  <campaign.json> --size 50 [--live --yes]           loop; paper mode unless --live --yes
 *   npm run bot -- cancel-all <campaign.json> --yes
 *   npm run bot -- deposit|withdraw <campaign.json> --base 50 --quote 50 --yes
 *
 * Live trading needs BOT_KEY (a THROWAWAY wallet holding only what you are willing to lose) in .env.
 * Options: --max-inv <base> (default 10x size), --offset <0..1> (fraction of the band, default 0.35),
 *          --every-ms <ms> (default 2000), BOT_MAX_ORDER_QUOTE (default 100) caps size x price per order.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import type { Campaign, EpochFile } from "../core/epoch";
import { provider } from "../core/fetch";
import { getSource } from "../data/source";
import { isKey, LiveBot } from "./live";
import { compareStrategies } from "./sim";
import { DEFAULT_PARAMS, type BotParams } from "./strategy";

const [cmd, file, ...args] = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const has = (n: string) => args.includes(n);
const num = (n: string, d: number) => { const v = flag(n); if (v === undefined) return d; const x = Number(v); if (!Number.isFinite(x) || x < 0) throw new Error(`${n} must be a non-negative number`); return x; };

function usage(): never {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 14).join("\n"));
  process.exit(cmd ? 1 : 0);
}

async function main() {
  if (!cmd || !file) usage();
  const c = JSON.parse(readFileSync(file, "utf8")) as Campaign;
  const size = num("--size", 2000);
  const maxInv = num("--max-inv", size * 10);

  if (cmd === "sim") {
    const src = getSource();
    const epoch = num("--epoch", 0);
    const baselinePath = `${src.dir}/${c.id}/epoch-${epoch}.json`;
    let baseline: EpochFile | undefined;
    try { baseline = JSON.parse(readFileSync(baselinePath, "utf8")); } catch {}
    console.error(`backtesting ${c.pair} epoch ${epoch} on ${src.kind}${src.kind === "demo" ? " (synthetic)" : ""} data, ${size} per side...`);
    const rs = await compareStrategies(src, c, epoch, size, maxInv, baseline);
    const quote = c.pair.split("/")[1];
    console.log(`\n${"strategy".padEnd(40)} ${"payout".padStart(10)} ${"share".padStart(7)} ${"txs".padStart(5)} ${"fills".padStart(5)} ${"2-sided".padStart(8)}`);
    for (const r of rs) console.log(`${r.strategy.padEnd(40)} ${r.payout.toFixed(2).padStart(10)} ${(r.sharePct.toFixed(1) + "%").padStart(7)} ${String(r.txs).padStart(5)} ${String(r.fills).padStart(5)} ${(r.restingTwoSidedPct.toFixed(0) + "%").padStart(8)}`);
    const b = rs[0]!;
    console.log(`\npayout in ${quote} for one epoch (budget ${b.withBot.budgetRewardTokens}). With our bot the book's two-sided depth goes from ${b.withoutBot.avgTwoSidedDepthQuote.toFixed(0)} to ${b.withBot.avgTwoSidedDepthQuote.toFixed(0)} ${quote}.`);
    console.log("Fills use a simple model (takers who hit a worse price would have hit us); gas is not included.");
    return;
  }

  // ---------- chain commands ----------
  const live = has("--live") && has("--yes");
  const needsKey = live || ["cancel-all", "deposit", "withdraw"].includes(cmd);
  const key = process.env.BOT_KEY?.trim();
  if (needsKey && !isKey(key)) throw new Error("BOT_KEY in .env is missing or not a 0x-prefixed 32-byte key. Use a fresh throwaway wallet, never one with real savings.");
  const p = provider();
  const wallet = isKey(key) ? new ethers.Wallet(key!, p) : null;
  const watch = wallet?.address ?? flag("--address") ?? ethers.constants.AddressZero;
  const params: BotParams = { ...DEFAULT_PARAMS, offsetFrac: num("--offset", DEFAULT_PARAMS.offsetFrac), sizeRaw: BigInt(Math.round(size * Number(c.sizePrecision))), maxInventoryRaw: BigInt(Math.round(maxInv * Number(c.sizePrecision))) };
  const go = (cmd === "run" && live) || (["cancel-all", "deposit", "withdraw"].includes(cmd) && has("--yes"));
  const bot = new LiveBot(p, c, params, wallet, watch, go);
  const info = await bot.init(num("--lookback", 3000));
  console.error(`${info.pair} ${c.market} | campaign ${c.id}: band ${c.bandBps} bps, rest ${c.minRestBlocks} blocks | bot ${watch}${go ? "" : " (paper: nothing is sent)"}`);

  const cap = Number(process.env.BOT_MAX_ORDER_QUOTE ?? 100);
  const px = c.refPrice ? Number(c.refPrice) / Number(c.pricePrecision) : info.bestBid ?? info.bestAsk ?? 0;
  if (go && cmd === "run" && size * px > cap) throw new Error(`order size ${size} x ~${px} = ${(size * px).toFixed(2)} exceeds BOT_MAX_ORDER_QUOTE=${cap}; lower --size or raise the cap deliberately`);

  if (cmd === "cancel-all") return console.log(await bot.cancelAll());
  if (cmd === "deposit" || cmd === "withdraw") {
    if (!has("--yes")) return console.log(`would ${cmd} base ${num("--base", 0)} and quote ${num("--quote", 0)}; add --yes to send`);
    for (const line of await bot.moveFunds(cmd, num("--base", 0), num("--quote", 0))) console.log(line);
    return console.log(await bot.balances());
  }
  if (wallet) console.log(await bot.balances());

  const print = (r: Awaited<ReturnType<LiveBot["tick"]>>) => {
    const mine = r.mine.map((o) => `${o.side} ${o.size}@${o.price} (${o.restedBlocks}b)`).join(", ") || "none";
    console.log(`#${r.block} centre ${r.centre ?? "?"} | others ${r.othersBid ?? "-"} / ${r.othersAsk ?? "-"} | mine: ${mine} | inv ${r.inventory} | share now ${r.sharePctNow === null ? "?" : r.sharePctNow + "%"} (~${r.estPerEpoch?.toFixed(2) ?? "?"}/epoch)`);
    for (const n of r.notes) console.log(`   note: ${n}`);
    for (const a of r.actions) console.log(`   ${go ? "do" : "would"}: ${a}`);
    for (const s of r.sent) console.log(`   sent: ${s}`);
  };
  if (cmd === "plan") return print(await bot.tick());
  if (cmd !== "run") usage();

  let stop = false, errors = 0;
  const shutdown = async () => {
    if (stop) process.exit(1);
    stop = true;
    console.log("\nstopping: cancelling resting orders...");
    console.log(await bot.cancelAll().catch((e) => `cancel failed: ${e.message}; run \`bot cancel-all\``));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const every = num("--every-ms", 2000);
  while (!stop) {
    try {
      print(await bot.tick());
      errors = 0;
    } catch (e: any) {
      console.error(`tick failed: ${e?.message ?? e}`);
      if (++errors >= 5) { console.error("5 failures in a row"); await shutdown(); }
    }
    await new Promise((r) => setTimeout(r, every));
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exitCode = 1;
});
