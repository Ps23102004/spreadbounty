/**
 * Campaign Copilot: turns a sponsor's goal ("$50/day to keep AUSD/USDC two-sided within 15 bps")
 * into exact campaign parameters, backtested on real Kuru history by our deterministic scorer.
 *
 * The model only chooses parameters and explains them. Every number comes from a tool, and the
 * payout itself is computed later by src/core/epoch.ts from public logs, never by the model.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { historyStats, simulateCampaign } from "../core/analytics";
import { BLOCK_SECONDS, CHAIN_ID, USDC } from "../core/chain";
import type { Campaign } from "../core/epoch";
import { fetchBookLogs, provider, readMarket, resolveMarket } from "../core/fetch";
import type { RawLog } from "../core/rpc";

const MODEL = "claude-opus-5-5";
const MAX_HOURS = 3; // public RPC caps getLogs at 100 blocks; 3 h is ~360 calls

const SYSTEM = `You design Spreadbounty campaigns on Kuru, the on-chain order book on Monad.
A campaign pays an open crowd of market makers, from a sponsor's budget, for keeping one book two-sided and deep inside a price band. Payouts are computed later by deterministic code from public logs and are recomputable by anyone; you never decide who gets paid.

Your job: turn the sponsor's goal into campaign parameters they can trust.
- Look at the market (market_info) and how its maker book behaved recently (history_stats) before proposing anything.
- Backtest at least two candidate parameter sets with simulate_campaign and compare them on two-sided coverage, depth bought, cost per $1k of depth, and how concentrated the rewards are.
- Then call save_campaign once with the set you recommend.
- Every number you state must come from a tool result. If a tool cannot answer something, say so rather than estimating.
- Be direct about limits: the backtest only sees makers who were already there, so depth is a floor; a band narrower than ~3 ticks is unfair to makers; an empty book has no history, so recommend a pilot epoch and say what to watch.
Finish with a short brief for the sponsor: recommended parameters, what the backtest shows, the main risk, and what to check after the first epoch.`;

type Ctx = { logs: Map<string, { logs: RawLog[]; from: number; to: number }>; saved: string | null };

export async function runCopilot(intent: string, opts: { outDir?: string; sponsor?: string } = {}) {
  const p = provider();
  const ctx: Ctx = { logs: new Map(), saved: null };
  const history = async (market: string, hours: number) => {
    const key = `${market}:${hours}`;
    if (!ctx.logs.has(key)) {
      const head = await p.getBlockNumber();
      const from = head - Math.round((hours * 3600) / BLOCK_SECONDS);
      ctx.logs.set(key, { logs: await fetchBookLogs(p, market, from, head), from, to: head });
    }
    return ctx.logs.get(key)!;
  };

  const marketInfo = betaZodTool({
    name: "market_info",
    description: "Live Kuru market facts: pair, tick size in bps, minimum order, fees, best bid/ask and spread, whether Kuru's AMM vault is quoting, current block.",
    inputSchema: z.object({ market: z.string().describe('"AUSD/USDC", "MON/USDC", or a market address') }),
    run: async ({ market }) => JSON.stringify(await readMarket(p, market)),
  });

  const historyTool = betaZodTool({
    name: "history_stats",
    description: "How the maker book behaved over the last N hours, rebuilt from order logs: makers seen, median spread, % of time two-sided within 5/15/50 bps, average two-sided depth (quote units), top maker's share of depth.",
    inputSchema: z.object({
      market: z.string(),
      hours: z.number().min(0.25).max(MAX_HOURS),
      refPrice: z.number().positive().nullable().describe("fixed reference price (e.g. 1.0 for a stablecoin pair) or null to use the book mid"),
    }),
    run: async ({ market, hours, refPrice }) => {
      const m = await readMarket(p, market);
      const h = await history(m.market, hours);
      const P = BigInt(m.pricePrecision), S = BigInt(m.sizePrecision);
      const ref = refPrice === null ? null : BigInt(Math.round(refPrice * Number(P)));
      return JSON.stringify({ pair: m.pair, logs: h.logs.length, ...historyStats(h.logs, m.market, h.from, h.to, 200, P, S, ref) });
    },
  });

  const simulate = betaZodTool({
    name: "simulate_campaign",
    description: "Backtest candidate campaign parameters on the last N hours with the exact production scorer: two-sided coverage, average qualifying depth, cost per day per $1k of depth, and per-maker reward split.",
    inputSchema: z.object({
      market: z.string(),
      hours: z.number().min(0.25).max(MAX_HOURS),
      bandBps: z.number().int().min(1).max(500),
      minRestBlocks: z.number().int().min(10).max(2000),
      sampleEvery: z.number().int().min(50).max(2000),
      refPrice: z.number().positive().nullable(),
      budgetPerDay: z.number().positive(),
    }),
    run: async (a) => {
      const m = await readMarket(p, a.market);
      const h = await history(m.market, a.hours);
      const P = BigInt(m.pricePrecision), S = BigInt(m.sizePrecision);
      return JSON.stringify({
        pair: m.pair,
        params: a,
        ...simulateCampaign(h.logs, m.market, { fromBlock: h.from, toBlock: h.to, bandBps: a.bandBps, minRestBlocks: a.minRestBlocks, sampleEvery: a.sampleEvery, refPrice: a.refPrice === null ? null : BigInt(Math.round(a.refPrice * Number(P))), budgetPerDay: a.budgetPerDay, blockSeconds: BLOCK_SECONDS }, P, S),
      });
    },
  });

  const save = betaZodTool({
    name: "save_campaign",
    description: "Write the recommended campaign to a JSON file the sponsor can publish. Call once, after simulating. The campaign starts startDelayMinutes after the current block so makers can see it first.",
    inputSchema: z.object({
      market: z.string(),
      bandBps: z.number().int().min(1).max(500),
      minRestBlocks: z.number().int().min(10).max(2000),
      sampleEvery: z.number().int().min(50).max(2000),
      refPrice: z.number().positive().nullable(),
      budgetPerDay: z.number().positive().describe("USDC per day"),
      epochMinutes: z.number().int().min(30).max(1440),
      startDelayMinutes: z.number().min(1).max(1440),
      rationale: z.string(),
    }),
    run: async (a) => {
      const m = await readMarket(p, a.market);
      if (a.bandBps < 3 * (m.tickBpsAtMid ?? 0)) return `Rejected: band ${a.bandBps} bps is under 3 ticks (${(3 * (m.tickBpsAtMid ?? 0)).toFixed(2)} bps). Widen it.`;
      const epochBlocks = Math.round((a.epochMinutes * 60) / BLOCK_SECONDS);
      const c: Campaign = {
        id: `${m.pair.replace("/", "-").toLowerCase()}-${m.head}`,
        chainId: CHAIN_ID,
        market: m.market,
        pair: m.pair,
        implementation: m.implementation,
        pricePrecision: m.pricePrecision,
        sizePrecision: m.sizePrecision,
        refPrice: a.refPrice === null ? null : String(Math.round(a.refPrice * Number(m.pricePrecision))),
        bandBps: a.bandBps,
        minRestBlocks: a.minRestBlocks,
        sampleEvery: a.sampleEvery,
        replayFromBlock: m.head + Math.round((a.startDelayMinutes * 60) / BLOCK_SECONDS),
        epochBlocks,
        budgetPerEpoch: String(Math.floor(a.budgetPerDay * (a.epochMinutes / 1440) * 1e6)),
        rewardToken: USDC,
        rewardDecimals: 6,
        sponsor: opts.sponsor ?? "0x0000000000000000000000000000000000000000",
      };
      const dir = opts.outDir ?? "out";
      mkdirSync(dir, { recursive: true });
      const path = `${dir}/campaign-${c.id}.json`;
      writeFileSync(path, JSON.stringify({ ...c, rationale: a.rationale }, null, 2));
      ctx.saved = path;
      return `Saved ${path}: starts at block ${c.replayFromBlock}, ${epochBlocks} blocks per epoch, ${Number(c.budgetPerEpoch) / 1e6} USDC per epoch.`;
    },
  });

  const client = new Anthropic();
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // re-run on Anthropic's recommended model if a safety classifier declines
    output_config: { effort: "high" },
    system: SYSTEM,
    tools: [marketInfo, historyTool, simulate, save],
    messages: [{ role: "user", content: intent }],
    max_iterations: 12,
  });

  for await (const message of runner) {
    for (const block of message.content) {
      if (block.type === "tool_use") console.error(`  · ${block.name}(${JSON.stringify(block.input).slice(0, 140)})`);
    }
  }
  const final = await runner.done();
  if (final.stop_reason === "refusal") throw new Error(`model declined: ${final.stop_details?.category ?? "unknown"}`);
  const text = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  return { brief: text, campaignFile: ctx.saved, stopReason: final.stop_reason };
}

export { resolveMarket };
