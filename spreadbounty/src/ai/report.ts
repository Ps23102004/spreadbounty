/**
 * Epoch Report: a plain-language return-on-spend note for the sponsor after each epoch.
 * All numbers are computed by epochMetrics() from the verified epoch file; the model only explains them.
 */
import Anthropic from "@anthropic-ai/sdk";
import { epochMetrics, type EpochFile } from "../core/epoch";

const MODEL = "claude-opus-5-5";

const SYSTEM = `You write the epoch report a liquidity sponsor reads after each Spreadbounty epoch on Kuru (Monad).
Use only the numbers in the JSON you are given; never compute, round into new figures, or estimate anything that is not there. If a comparison needs a number that is missing, say it is not available.
Write for a growth or treasury lead, not a trader: what the budget bought (two-sided coverage, depth inside the band, cost per $1k of depth), how concentrated the rewards were, what changed from the previous epoch when one is given, and one concrete suggestion for the next epoch's parameters with the reason.
Close with the payout root and a line saying anyone can recompute it from public Kuru logs with \`sb verify\`. Keep it under 200 words, in markdown.`;

export async function writeEpochReport(epoch: EpochFile, prev: EpochFile | null = null) {
  const facts = {
    campaign: { id: epoch.campaign.id, pair: epoch.campaign.pair, bandBps: epoch.campaign.bandBps, minRestBlocks: epoch.campaign.minRestBlocks, refPrice: epoch.campaign.refPrice },
    thisEpoch: epochMetrics(epoch),
    previousEpoch: prev ? epochMetrics(prev) : null,
    payouts: epoch.amounts.map((a) => ({ maker: a.account, usdc: Number(a.amount) / 10 ** epoch.campaign.rewardDecimals })),
  };
  const client = new Anthropic();
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: SYSTEM,
    messages: [{ role: "user", content: `Epoch facts (JSON):\n${JSON.stringify(facts, null, 2)}` }],
  });
  if (res.stop_reason === "refusal") throw new Error(`model declined: ${res.stop_details?.category ?? "unknown"}`);
  return { markdown: res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"), facts };
}
