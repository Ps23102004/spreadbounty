/**
 * Campaign design pipeline. Code does the work (read market, rebuild history, backtest a grid,
 * pick by a fixed rule); the model only (1) reads the sponsor's sentence into a small JSON object
 * and (2) narrates the result. Both model steps have deterministic fallbacks, so this runs the same
 * on Claude, a 4B local model, or no model at all.
 */
import { historyStats, simulateCampaign } from "../core/analytics";
import { BLOCK_SECONDS, CHAIN_ID, USDC } from "../core/chain";
import type { Campaign } from "../core/epoch";
import { recentHistory, type DataSource } from "../data/source";
import type { LLM } from "./http";
import { BRIEF_SYSTEM, narrate, readIntent, templateBrief, type Candidate, type Intent } from "./prompts";

export { IntentSchema, PAIRS, ruleIntent, templateBrief, type Candidate, type Intent } from "./prompts";
const STABLE = new Set(["AUSD/USDC"]);
const HISTORY_HOURS = 3;

/** `note` carries a per-step fallback message ("Anthropic rejected the key (401). Used rules instead."). */
export type Step = { step: string; status: "running" | "done"; detail?: string; note?: string };

/**
 * `intent`: a reading already made elsewhere (the browser's own model), used as given; the server model is not asked.
 * `brief: "none"`: skip the model brief (the caller narrates the returned `facts` itself); the template is returned.
 */
export interface DesignOpts { intent?: Intent; brief?: "server" | "none" }

export async function designCampaign(goal: string, src: DataSource, llm: LLM | null, onStep: (s: Step) => void = () => {}, opts: DesignOpts = {}) {
  // 1. read the request
  onStep({ step: "intent", status: "running", detail: opts.intent ? "read in your browser" : llm ? `${llm.provider}:${llm.model}` : "rules" });
  let intentBy: "model" | "rules" | "client" = "client";
  let intent: Intent;
  if (opts.intent) intent = opts.intent;
  else {
    const read = await readIntent(goal, llm);
    ({ intent } = read);
    intentBy = read.by;
    if (read.error) onStep({ step: "intent", status: "running", detail: "rules", note: `${read.error} Used rules instead.` });
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
  const { text: brief, by: briefBy, attempts, error } = await narrate(opts.brief === "none" ? null : llm, BRIEF_SYSTEM, facts, templateBrief(facts));
  onStep({ step: "brief", status: "done", detail: briefBy === "model" ? "written by model, every number checked" : attempts.length ? "model numbers failed the check: used template" : "template", ...(error ? { note: `${error} Used the template instead.` } : {}) });

  return {
    intent, intentBy, market, history: stats, candidates, recommended: pick, pilot, campaign, brief, facts,
    ai: { provider: llm?.provider ?? "off", model: llm?.model ?? null, intentBy, briefBy, groundingAttempts: attempts },
    dataSource: src.kind,
  };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
