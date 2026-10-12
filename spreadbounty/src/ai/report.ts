/**
 * Epoch Report: a plain-language return-on-spend note for the sponsor after each epoch.
 * Numbers come from epochMetrics() on the verified epoch file; the model only explains them,
 * every number it writes is grounding-checked, and a template is used if it fails twice or no model is set.
 * Shadow campaigns (`shadow: true` on the campaign file) paid nobody: the facts say so, the template says
 * "would have", and the grounding guard rejects model text that says a maker was paid or took anything.
 */
import { epochMetrics, type EpochFile } from "../core/epoch";
import type { LLM } from "./http";
import { narrate, REPORT_SYSTEM } from "./prompts";

const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
/** The epoch file's campaign normally lacks the flag (it sits on the campaign file), so callers pass it. */
const shadowOf = (epoch: EpochFile) => (epoch.campaign as { shadow?: boolean }).shadow === true;

export function reportFacts(epoch: EpochFile, prev: EpochFile | null, shadow = shadowOf(epoch)) {
  const m = (f: EpochFile) => {
    const x = epochMetrics(f);
    return {
      epoch: x.epoch,
      twoSidedCoveragePct: r2(x.twoSidedCoveragePct),
      avgTwoSidedDepthUsdc: Math.round(x.avgTwoSidedDepthQuote),
      makersRewarded: x.makersPaid,
      rewardsUsdc: r2(x.paidRewardTokens),
      budgetUsdc: r2(x.budgetRewardTokens),
      costPer1kDepthUsdc: r2(x.costPer1kDepthQuote),
      topMakerSharePct: r2(x.topMakerSharePct),
    };
  };
  return {
    pair: epoch.campaign.pair,
    shadow,
    bandBps: epoch.campaign.bandBps,
    minRestBlocks: epoch.campaign.minRestBlocks,
    thisEpoch: m(epoch),
    previousEpoch: prev ? m(prev) : null,
    rewards: epoch.amounts.map((a) => ({ maker: a.account, usdc: r2(Number(a.amount) / 10 ** epoch.campaign.rewardDecimals) })),
  };
}

export function templateReport(f: ReturnType<typeof reportFacts>) {
  const t = f.thisEpoch, p = f.previousEpoch;
  const n = t.makersRewarded;
  const shared = `${f.shadow ? "would have " : ""}${n === 1 ? "received" : "shared"}`;
  const took = f.shadow ? "would have taken" : "took";
  const change = p
    ? ` Compared with epoch ${p.epoch}, coverage went from ${p.twoSidedCoveragePct}% to ${t.twoSidedCoveragePct}% and depth from ${p.avgTwoSidedDepthUsdc} to ${t.avgTwoSidedDepthUsdc} USDC.`
    : "";
  const tip = t.topMakerSharePct !== null && t.topMakerSharePct > 50 ? `One maker ${took} over half the rewards; consider a per-maker cap next epoch.` : t.twoSidedCoveragePct !== null && t.twoSidedCoveragePct < 90 ? "Coverage was under 90%; a slightly wider band or a higher budget would help." : "Coverage and spread were healthy; keep the parameters and watch whether new makers join.";
  return `${f.shadow ? "Shadow campaign: nobody was paid. " : ""}Epoch ${t.epoch} on ${f.pair}: the book was two-sided within ${f.bandBps} bps for ${t.twoSidedCoveragePct}% of samples, with ${t.avgTwoSidedDepthUsdc} USDC of depth on the thinner side on average. ${n} maker${n === 1 ? "" : "s"} ${shared} ${t.rewardsUsdc} of the ${t.budgetUsdc} USDC budget, which works out to ${t.costPer1kDepthUsdc} USDC per $1k of depth; the largest maker ${took} ${t.topMakerSharePct}%.${change} ${tip}`;
}

/** Browser-safe: the browser runs this with its own model on epoch files it downloaded (same facts, same guard). */
export async function writeEpochReport(epoch: EpochFile, prev: EpochFile | null, llm: LLM | null, shadow = shadowOf(epoch)) {
  const facts = reportFacts(epoch, prev, shadow);
  const r = await narrate(llm, REPORT_SYSTEM, facts, templateReport(facts));
  return { markdown: r.text, facts, root: epoch.root, ai: { provider: llm?.provider ?? "off", model: llm?.model ?? null, writtenBy: r.by, groundingAttempts: r.attempts, error: r.error } };
}
