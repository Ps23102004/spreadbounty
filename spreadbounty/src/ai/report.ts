/**
 * Epoch Report: a plain-language return-on-spend note for the sponsor after each epoch.
 * Numbers come from epochMetrics() on the verified epoch file; the model only explains them,
 * every number it writes is grounding-checked, and a template is used if it fails twice or no model is set.
 */
import { epochMetrics, type EpochFile } from "../core/epoch";
import { groundedText } from "./grounding";
import type { LLM } from "./llm";

const SYSTEM = `You write the epoch report a liquidity sponsor reads after each Spreadbounty epoch on Kuru (Monad's order book).
Use only numbers that appear in the facts JSON, written the same way. Do not compute or estimate new numbers.
Cover, in under 150 words of plain sentences: what the budget bought (two-sided coverage, depth inside the band, cost per $1k of depth), how concentrated the payouts were, what changed from the previous epoch if one is given, and one suggestion for the next epoch.
Do not repeat the payout root; it is shown separately.`;

const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);

export function reportFacts(epoch: EpochFile, prev: EpochFile | null) {
  const m = (f: EpochFile) => {
    const x = epochMetrics(f);
    return {
      epoch: x.epoch,
      twoSidedCoveragePct: r2(x.twoSidedCoveragePct),
      avgTwoSidedDepthUsdc: Math.round(x.avgTwoSidedDepthQuote),
      makersPaid: x.makersPaid,
      paidUsdc: r2(x.paidRewardTokens),
      budgetUsdc: r2(x.budgetRewardTokens),
      costPer1kDepthUsdc: r2(x.costPer1kDepthQuote),
      topMakerSharePct: r2(x.topMakerSharePct),
    };
  };
  return {
    pair: epoch.campaign.pair,
    bandBps: epoch.campaign.bandBps,
    minRestBlocks: epoch.campaign.minRestBlocks,
    thisEpoch: m(epoch),
    previousEpoch: prev ? m(prev) : null,
    payouts: epoch.amounts.map((a) => ({ maker: a.account, usdc: r2(Number(a.amount) / 10 ** epoch.campaign.rewardDecimals) })),
  };
}

export function templateReport(f: ReturnType<typeof reportFacts>) {
  const t = f.thisEpoch, p = f.previousEpoch;
  const change = p
    ? ` Compared with epoch ${p.epoch}, coverage went from ${p.twoSidedCoveragePct}% to ${t.twoSidedCoveragePct}% and depth from ${p.avgTwoSidedDepthUsdc} to ${t.avgTwoSidedDepthUsdc} USDC.`
    : "";
  const tip = t.topMakerSharePct !== null && t.topMakerSharePct > 50 ? "One maker took over half the rewards; consider a per-maker cap next epoch." : t.twoSidedCoveragePct !== null && t.twoSidedCoveragePct < 90 ? "Coverage was under 90%; a slightly wider band or a higher budget would help." : "Coverage and spread were healthy; keep the parameters and watch whether new makers join.";
  return `Epoch ${t.epoch} on ${f.pair}: the book was two-sided within ${f.bandBps} bps for ${t.twoSidedCoveragePct}% of samples, with ${t.avgTwoSidedDepthUsdc} USDC of depth on the thinner side on average. ${t.makersPaid} makers shared ${t.paidUsdc} of the ${t.budgetUsdc} USDC budget, which works out to ${t.costPer1kDepthUsdc} USDC per $1k of depth; the largest maker took ${t.topMakerSharePct}%.${change} ${tip}`;
}

export async function writeEpochReport(epoch: EpochFile, prev: EpochFile | null, llm: LLM | null) {
  const facts = reportFacts(epoch, prev);
  let writtenBy: "model" | "template" = "template";
  let text = templateReport(facts);
  let attempts: { ungrounded: string[] }[] = [];
  if (llm) {
    try {
      const g = await groundedText((fb) => llm.text(SYSTEM, `Facts (JSON):\n${JSON.stringify(facts)}${fb ? `\n\n${fb}` : ""}`), facts);
      attempts = g.attempts;
      if (g.text) {
        text = g.text;
        writtenBy = "model";
      }
    } catch {
      /* keep template */
    }
  }
  return { markdown: text, facts, root: epoch.root, ai: { provider: llm?.provider ?? "off", model: llm?.model ?? null, writtenBy, groundingAttempts: attempts } };
}
