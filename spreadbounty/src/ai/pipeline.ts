/**
 * Campaign design pipeline. Code does the work (read market, rebuild history, backtest a grid,
 * pick by a fixed rule); the model only (1) reads the sponsor's sentence into a small JSON object
 * and (2) narrates the result. Both model steps have deterministic fallbacks, so this runs the same
 * on Claude, a 4B local model, or no model at all.
 */
import { z } from "zod";
import { historyStats, simulateCampaign } from "../core/analytics";
import { BLOCK_SECONDS, CHAIN_ID, USDC } from "../core/chain";
import type { Campaign } from "../core/epoch";
import { recentHistory, type DataSource } from "../data/source";
import { groundedText } from "./grounding";
import type { LLM } from "./llm";

export const PAIRS = ["AUSD/USDC", "MON/USDC"] as const;
const STABLE = new Set(["AUSD/USDC"]);
const HISTORY_HOURS = 3;

export const IntentSchema = z.object({
  pair: z.enum(PAIRS).nullable(),
  bandBps: z.number().nullable(),
  budgetPerDay: z.number().nullable(),
  epochMinutes: z.number().nullable(),
  refPrice: z.number().nullable(),
  summary: z.string(),
});
export type Intent = z.infer<typeof IntentSchema>;

const INTENT_SYSTEM = `You read a liquidity sponsor's request for a market-making incentive campaign on Kuru (an order book on Monad) and fill in a small form.
pair: "AUSD/USDC" or "MON/USDC" if named, else null.
bandBps: the price band in basis points if stated (1% = 100 bps, 0.15% = 15 bps), else null.
budgetPerDay: USDC per day if stated (convert weekly or monthly to daily), else null.
epochMinutes: payout period in minutes if stated (hourly = 60, daily = 1440), else null.
refPrice: a fixed reference price if stated (e.g. "around 1.0" or "peg"), else null.
summary: one short sentence restating the goal.
Use null for anything not stated. Do not guess.`;

/** Rules-based reading for when no model is configured or the model returns nothing usable. */
export function ruleIntent(goal: string): Intent {
  const g = goal.toLowerCase();
  const pair = g.includes("mon/usdc") || /\bmon\b/.test(g) ? "MON/USDC" : g.includes("ausd") ? "AUSD/USDC" : null;
  const bps = g.match(/(\d+(?:\.\d+)?)\s*(?:bps|bp|basis)/);
  const pct = g.match(/(\d+(?:\.\d+)?)\s*%/);
  const usd = g.match(/\$\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:usdc|usd|dollars)/);
  const amount = usd ? Number((usd[1] ?? usd[2])!.replace(/,/g, "")) : null;
  const per = /(?:per|a|each|every|\/)\s*week|weekly/.test(g) ? 7 : /(?:per|a|each|every|\/)\s*month|monthly/.test(g) ? 30 : 1;
  const epoch = /hourly|per hour|every hour/.test(g) ? 60 : /daily epoch|per day epoch|daily payout/.test(g) ? 1440 : null;
  const ref = g.match(/(?:peg|reference|around|of)\s*\$?(\d\.\d+)/);
  return {
    pair,
    bandBps: bps ? Number(bps[1]) : pct ? Number(pct[1]) * 100 : null,
    budgetPerDay: amount === null ? null : amount / per,
    epochMinutes: epoch,
    refPrice: ref ? Number(ref[1]) : null,
    summary: goal.trim().slice(0, 200),
  };
}

export interface Candidate {
  bandBps: number;
  minRestBlocks: number;
  twoSidedCoveragePct: number;
  avgDepthUsdc: number;
  costPerDayPer1kDepth: number | null;
  makers: number;
  topMakerSharePct: number;
}

export type Step = { step: string; status: "running" | "done"; detail?: string };

export async function designCampaign(goal: string, src: DataSource, llm: LLM | null, onStep: (s: Step) => void = () => {}) {
  // 1. read the request
  onStep({ step: "intent", status: "running", detail: llm ? `${llm.provider}:${llm.model}` : "rules" });
  let intentBy: "model" | "rules" = "rules";
  let intent = ruleIntent(goal);
  if (llm) {
    try {
      const fromModel = await llm.json(IntentSchema, INTENT_SYSTEM, goal);
      if (fromModel) {
        // model fills gaps the rules missed; explicit numbers found by rules win (they are literal reads of the text)
        intent = { ...fromModel, ...Object.fromEntries(Object.entries(intent).filter(([k, v]) => v !== null && k !== "summary")) } as Intent;
        intentBy = "model";
      }
    } catch (e: any) {
      onStep({ step: "intent", status: "running", detail: `model unavailable (${String(e?.message ?? e).slice(0, 80)}), using rules` });
    }
  }
  const pair = intent.pair ?? "AUSD/USDC";
  const budgetPerDay = intent.budgetPerDay && intent.budgetPerDay > 0 ? round(intent.budgetPerDay, 2) : 50;
  const epochMinutes = Math.min(1440, Math.max(30, Math.round(intent.epochMinutes ?? 60)));
  const refPrice = intent.refPrice ?? (STABLE.has(pair) ? 1.0 : null);
  onStep({ step: "intent", status: "done", detail: JSON.stringify({ pair, bandBps: intent.bandBps, budgetPerDay, epochMinutes, refPrice }) });

  // 2. the market and its recent history
  onStep({ step: "market", status: "running" });
  const market = await src.market(pair);
  const P = BigInt(market.pricePrecision), S = BigInt(market.sizePrecision);
  const refRaw = refPrice === null ? null : BigInt(Math.round(refPrice * Number(P)));
  onStep({ step: "market", status: "done", detail: `${market.pair}: tick ${market.tickBpsAtMid?.toFixed(2) ?? "?"} bps, spread ${market.spreadBps?.toFixed(1) ?? "no book"} bps` });

  onStep({ step: "history", status: "running", detail: `last ${HISTORY_HOURS} h of order logs` });
  const h = await recentHistory(src, market.market, HISTORY_HOURS);
  const stats = historyStats(h.logs, market.market, h.from, h.to, 200, P, S, refRaw);
  onStep({ step: "history", status: "done", detail: `${h.logs.length} logs, ${stats.makers} makers, two-sided within 15 bps ${stats.coverageByBand["15"]!.toFixed(0)}% of the time` });

  // 3. backtest a grid around the request
  onStep({ step: "backtest", status: "running" });
  const minBand = Math.max(1, Math.ceil(3 * (market.tickBpsAtMid ?? 0.1)));
  const base = Math.max(minBand, Math.round(intent.bandBps ?? (STABLE.has(pair) ? 15 : 25)));
  const bands = [...new Set([Math.max(minBand, Math.round(base * 0.6)), base, Math.round(base * 1.6)])].sort((a, b) => a - b);
  const candidates: Candidate[] = [];
  for (const bandBps of bands)
    for (const minRestBlocks of [20, 60]) {
      const sim = simulateCampaign(h.logs, market.market, { fromBlock: h.from, toBlock: h.to, bandBps, minRestBlocks, sampleEvery: 200, refPrice: refRaw, budgetPerDay, blockSeconds: BLOCK_SECONDS }, P, S);
      candidates.push({
        bandBps, minRestBlocks,
        twoSidedCoveragePct: round(sim.twoSidedCoveragePct, 1),
        avgDepthUsdc: round(sim.avgQualifyingTwoSidedDepthQuote, 0),
        costPerDayPer1kDepth: sim.costPerDayPer1kDepth === null ? null : round(sim.costPerDayPer1kDepth, 2),
        makers: sim.makerCount,
        topMakerSharePct: round(sim.makers[0]?.sharePct ?? 0, 1),
      });
    }
  // fixed rule: tight depth is the product, so among settings within 5 points of the best coverage take the
  // requested band if one was given, else the tightest band; ties go to the lower cost per $1k of depth
  const best = Math.max(...candidates.map((c) => c.twoSidedCoveragePct));
  const eligible = candidates.filter((c) => c.twoSidedCoveragePct >= best - 5);
  const byCost = (a: Candidate, b: Candidate) => (a.costPerDayPer1kDepth ?? Infinity) - (b.costPerDayPer1kDepth ?? Infinity);
  const requested = intent.bandBps !== null ? eligible.filter((c) => c.bandBps === base).sort(byCost) : [];
  const ranked = requested.length ? requested : [...eligible].sort((a, b) => a.bandBps - b.bandBps || byCost(a, b));
  const pilot = candidates.every((c) => c.makers === 0);
  const pick = pilot ? candidates.find((c) => c.bandBps === base && c.minRestBlocks === 20)! : ranked[0]!;
  onStep({ step: "backtest", status: "done", detail: `${candidates.length} candidates; ${pilot ? "no makers in history: pilot epoch" : `best covers ${pick.twoSidedCoveragePct}% at ${pick.bandBps} bps`}` });

  // 4. the campaign itself (published only when the sponsor clicks Publish)
  const head = await src.head();
  const campaign: Campaign = {
    id: `${pair.replace("/", "-").toLowerCase()}-${head}`,
    chainId: CHAIN_ID,
    market: market.market,
    pair: market.pair,
    implementation: market.implementation,
    pricePrecision: market.pricePrecision,
    sizePrecision: market.sizePrecision,
    refPrice: refRaw === null ? null : refRaw.toString(),
    bandBps: pick.bandBps,
    minRestBlocks: pick.minRestBlocks,
    sampleEvery: 200,
    replayFromBlock: head + 300, // ~90 s so makers see the campaign before it starts
    epochBlocks: Math.round((epochMinutes * 60) / BLOCK_SECONDS),
    budgetPerEpoch: String(Math.floor(budgetPerDay * (epochMinutes / 1440) * 100) * 10_000), // whole cents
    rewardToken: USDC,
    rewardDecimals: 6,
    sponsor: "0x0000000000000000000000000000000000000000",
  };

  // 5. the brief: model narrates, grounding guard checks every number, template if it fails
  const facts = {
    request: intent.summary,
    pair: market.pair,
    budgetPerDayUsdc: budgetPerDay,
    epochMinutes,
    referencePrice: refPrice,
    market: { tickBps: round(market.tickBpsAtMid ?? 0, 2), spreadBps: market.spreadBps === null ? null : round(market.spreadBps, 1), minOrder: market.minSize, makerFeeBps: market.feesBps.maker },
    lastHours: HISTORY_HOURS,
    history: { makers: stats.makers, medianSpreadBps: stats.medianSpreadBps === null ? null : round(stats.medianSpreadBps, 1), twoSidedPctWithin15Bps: round(stats.coverageByBand["15"]!, 1), avgDepthUsdcWithin15Bps: round(stats.avgTwoSidedDepthQuoteByBand["15"]!, 0) },
    candidates,
    recommended: pick,
    pilot,
    budgetPerEpochUsdc: round(Number(campaign.budgetPerEpoch) / 1e6, 2),
  };
  onStep({ step: "brief", status: "running" });
  let briefBy: "model" | "template" = "template";
  let brief = templateBrief(facts);
  let attempts: { ungrounded: string[] }[] = [];
  if (llm) {
    try {
      const g = await groundedText(
        (feedback) => llm.text(BRIEF_SYSTEM, `Facts (JSON):\n${JSON.stringify(facts)}${feedback ? `\n\n${feedback}` : ""}`),
        facts,
      );
      attempts = g.attempts;
      if (g.text) {
        brief = g.text;
        briefBy = "model";
      }
    } catch {
      /* keep template */
    }
  }
  onStep({ step: "brief", status: "done", detail: briefBy === "model" ? "written by model, every number checked" : attempts.length ? "model numbers failed the check: used template" : "template" });

  return {
    intent, intentBy, market, history: stats, candidates, recommended: pick, pilot, campaign, brief,
    ai: { provider: llm?.provider ?? "off", model: llm?.model ?? null, intentBy, briefBy, groundingAttempts: attempts },
    dataSource: src.kind,
  };
}

const BRIEF_SYSTEM = `You write a short brief for a liquidity sponsor about a proposed Spreadbounty campaign on Kuru (Monad's order book).
Use only numbers that appear in the facts JSON, written the same way. Do not compute new numbers.
Cover in under 120 words: what you recommend (band in bps, minimum rest in blocks, budget, epoch length) and why, what recent history shows, and one risk to watch after the first epoch. If pilot is true, say the book had no makers in the window, so this is a pilot.
Plain sentences, no headings, no bullet points.`;

export function templateBrief(f: { pair: string; budgetPerDayUsdc: number; epochMinutes: number; recommended: Candidate; pilot: boolean; history: { makers: number; twoSidedPctWithin15Bps: number }; lastHours: number; budgetPerEpochUsdc: number }) {
  const r = f.recommended;
  const pay = `${f.budgetPerDayUsdc} USDC per day (${f.budgetPerEpochUsdc} USDC per ${f.epochMinutes}-minute epoch)`;
  if (f.pilot)
    return `Recommend a pilot on ${f.pair}: a ${r.bandBps} bps band, orders must rest ${r.minRestBlocks} blocks, ${pay}. The book had no makers in the last ${f.lastHours} hours, so there is no history to backtest against. Watch how many makers join and how much of the first epoch is two-sided before raising the budget.`;
  return `Recommend a ${r.bandBps} bps band on ${f.pair} with a ${r.minRestBlocks}-block minimum rest and ${pay}. In the last ${f.lastHours} hours ${f.history.makers} makers quoted, and this setting would have kept the book two-sided ${r.twoSidedCoveragePct}% of the time with about ${r.avgDepthUsdc} USDC of depth on the thinner side. The top maker would take ${r.topMakerSharePct}% of rewards; if that stays high after the first epoch, lower the per-maker cap or widen the band to admit more makers.`;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
