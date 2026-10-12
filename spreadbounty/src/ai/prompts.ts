/**
 * The model's two jobs, as browser-safe code shared by the server pipeline and the browser Writer:
 *   readIntent: fill a small form from the sponsor's sentence (rules first; a model only fills gaps)
 *   narrate:    explain facts the code computed; every number is grounding-checked, else the template is used
 * No node: imports and no SDK here (test/boundary.test.ts enforces it). Nothing here touches scoring or payouts.
 */
import { z } from "zod";
import { groundedText } from "./grounding";
import type { LLM } from "./http";

export const PAIRS = ["AUSD/USDC", "MON/USDC"] as const;

export const IntentSchema = z.object({
  pair: z.enum(PAIRS).nullable(),
  bandBps: z.number().nullable(),
  budgetPerDay: z.number().nullable(),
  epochMinutes: z.number().nullable(),
  refPrice: z.number().nullable(),
  summary: z.string(),
});
export type Intent = z.infer<typeof IntentSchema>;

export const INTENT_SYSTEM = `You read a liquidity sponsor's request for a market-making incentive campaign on Kuru (an order book on Monad) and fill in a small form.
pair: "AUSD/USDC" or "MON/USDC" if named, else null.
bandBps: the price band in basis points if stated (1% = 100 bps, 0.15% = 15 bps), else null.
budgetPerDay: USDC per day if stated (convert weekly or monthly to daily), else null.
epochMinutes: payout period in minutes if stated (hourly = 60, daily = 1440), else null.
refPrice: a fixed reference price if stated (e.g. "around 1.0" or "peg"), else null.
summary: one short sentence restating the goal.
Use null for anything not stated. Do not guess.`;

export const BRIEF_SYSTEM = `You write a short brief for a liquidity sponsor about a proposed Spreadbounty campaign on Kuru (Monad's order book).
Use only numbers that appear in the facts JSON, written the same way. Do not compute new numbers.
Cover in under 120 words: what you recommend (band in bps, minimum rest in blocks, budget, epoch length) and why, what recent history shows, and one risk to watch after the first epoch. If pilot is true, say the book had no makers in the window, so this is a pilot.
Plain sentences, no headings, no bullet points.`;

export const REPORT_SYSTEM = `You write the epoch report a liquidity sponsor reads after each Spreadbounty epoch on Kuru (Monad's order book).
Use only numbers that appear in the facts JSON, written the same way. Do not compute or estimate new numbers.
Cover, in under 150 words of plain sentences: what the budget bought (two-sided coverage, depth inside the band, cost per $1k of depth), how concentrated the payouts were, what changed from the previous epoch if one is given, and one suggestion for the next epoch.
Do not repeat the payout root; it is shown separately.`;

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

/** The model fills gaps the rules missed; explicit numbers found by rules win (they are literal reads of the text). */
export const mergeIntent = (fromModel: Intent, rules: Intent): Intent =>
  ({ ...fromModel, ...Object.fromEntries(Object.entries(rules).filter(([k, v]) => v !== null && k !== "summary")) }) as Intent;

const errorText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

export async function readIntent(goal: string, llm: LLM | null) {
  const rules = ruleIntent(goal);
  if (!llm) return { intent: rules, by: "rules" as const, error: null };
  try {
    const fromModel = await llm.json(IntentSchema, INTENT_SYSTEM, goal);
    if (fromModel) return { intent: mergeIntent(fromModel, rules), by: "model" as const, error: null };
    return { intent: rules, by: "rules" as const, error: "The model's reply did not fit the form." };
  } catch (e) {
    return { intent: rules, by: "rules" as const, error: errorText(e) };
  }
}

export const factsPrompt = (facts: unknown, feedback: string | null) => `Facts (JSON):\n${JSON.stringify(facts)}${feedback ? `\n\n${feedback}` : ""}`;

/** Model text if every number in it is in the facts (one retry naming the bad numbers), else the template. */
export async function narrate(llm: LLM | null, system: string, facts: unknown, template: string) {
  let attempts: { ungrounded: string[] }[] = [];
  if (!llm) return { text: template, by: "template" as const, attempts, error: null };
  try {
    const g = await groundedText((fb) => llm.text(system, factsPrompt(facts, fb)), facts);
    attempts = g.attempts;
    if (g.text) return { text: g.text, by: "model" as const, attempts, error: null };
    return { text: template, by: "template" as const, attempts, error: null };
  } catch (e) {
    return { text: template, by: "template" as const, attempts, error: errorText(e) };
  }
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

export interface BriefFacts {
  pair: string;
  budgetPerDayUsdc: number;
  epochMinutes: number;
  recommended: Candidate;
  pilot: boolean;
  history: { makers: number; twoSidedPctWithin15Bps: number };
  lastHours: number;
  budgetPerEpochUsdc: number;
}

export function templateBrief(f: BriefFacts) {
  const r = f.recommended;
  const pay = `${f.budgetPerDayUsdc} USDC per day (${f.budgetPerEpochUsdc} USDC per ${f.epochMinutes}-minute epoch)`;
  if (f.pilot)
    return `Recommend a pilot on ${f.pair}: a ${r.bandBps} bps band, orders must rest ${r.minRestBlocks} blocks, ${pay}. The book had no makers in the last ${f.lastHours} hours, so there is no history to backtest against. Watch how many makers join and how much of the first epoch is two-sided before raising the budget.`;
  return `Recommend a ${r.bandBps} bps band on ${f.pair} with a ${r.minRestBlocks}-block minimum rest and ${pay}. In the last ${f.lastHours} hours ${f.history.makers} makers quoted, and this setting would have kept the book two-sided ${r.twoSidedCoveragePct}% of the time with about ${r.avgDepthUsdc} USDC of depth on the thinner side. The top maker would take ${r.topMakerSharePct}% of rewards; if that stays high after the first epoch, lower the per-maker cap or widen the band to admit more makers.`;
}
