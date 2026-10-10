import type { Campaign, EpochFile } from "../../src/core/epoch";
import type { RawLog } from "../../src/core/rpc";

export type { Campaign, EpochFile, RawLog };

export interface Config {
  dataSource: "demo" | "live";
  synthetic: boolean;
  rpcUrl: string | null;
  ai: { provider: "claude" | "local" | "off"; model: string | null; endpoint: string | null };
  pairs: string[];
}
export interface Metrics {
  pair: string; epoch: number; blocks: string; samples: number; samplesWithPrice: number;
  twoSidedCoveragePct: number; avgTwoSidedDepthQuote: number; makersPaid: number;
  paidRewardTokens: number; budgetRewardTokens: number; costPer1kDepthQuote: number | null;
  topMakerSharePct: number; bandBps: number; root: string;
}
export interface EpochSummary {
  n: number; fromBlock: number; toBlock: number; root: string; metrics: Metrics;
  makersSeen: { owner: string; orders: number }[];
  samples: { block: number; bidDepth: string; askDepth: string; scored: number }[];
}
export type CampaignRow = Campaign & { rationale?: string; epochs: number };
export interface Level { price: number; size: number; isBuy: boolean; makers: number }
export interface Book { pair: string; head: number; windowHours: number; refPrice: number | null; bandBps: number | null; bids: Level[]; asks: Level[] }
export interface Candidate {
  bandBps: number; minRestBlocks: number; twoSidedCoveragePct: number; avgDepthUsdc: number;
  costPerDayPer1kDepth: number | null; makers: number; topMakerSharePct: number;
}
export interface AiMeta { provider: string; model: string | null; groundingAttempts: { ungrounded: string[] }[] }
export interface DesignResult {
  intent: { pair: string | null; bandBps: number | null; budgetPerDay: number | null; epochMinutes: number | null; refPrice: number | null; summary: string };
  intentBy: "model" | "rules";
  candidates: Candidate[]; recommended: Candidate; pilot: boolean; campaign: Campaign; brief: string;
  ai: AiMeta & { intentBy: "model" | "rules"; briefBy: "model" | "template" };
  history: { makers: number; medianSpreadBps: number | null };
  dataSource: "demo" | "live";
}
export type Step = { step: string; status: "running" | "done"; detail?: string };
export interface Report { markdown: string; root: string; ai: AiMeta & { writtenBy: "model" | "template" } }
export interface Claim { account: string; cumulativeAmount: string; root: string; proof: string[]; verifies: boolean }
export interface BotSim {
  epoch: number; sizePerSide: number; base: string; quote: string; budget: number;
  results: { strategy: string; payout: number; sharePct: number; txs: number; places: number; cancels: number; fills: number; inventory: number; restingTwoSidedPct: number; depthWith: number; depthWithout: number; coverageWith: number; coverageWithout: number }[];
}
export interface Health { ok: boolean; provider: string; model?: string; latencyMs?: number; reply?: string; reason?: string }

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `${r.status} ${r.statusText}`);
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  config: () => j<Config>("/api/config"),
  health: () => j<Health>("/api/ai/health"),
  book: (pair: string, hours = 1) => j<Book>(`/api/book?pair=${encodeURIComponent(pair)}&hours=${hours}`),
  campaigns: () => j<CampaignRow[]>("/api/campaigns"),
  epochs: (id: string) => j<EpochSummary[]>(`/api/campaigns/${id}/epochs`),
  epoch: (id: string, n: number) => j<EpochFile>(`/api/campaigns/${id}/epochs/${n}`),
  logs: (id: string, n: number) => j<RawLog[]>(`/api/campaigns/${id}/epochs/${n}/logs`),
  claim: (id: string, n: number, account: string) => j<Claim>(`/api/campaigns/${id}/epochs/${n}/claim/${account}`),
  report: (id: string, n: number) => j<Report>(`/api/campaigns/${id}/epochs/${n}/report`, { method: "POST" }),
  botSim: (id: string, n: number, size: number) => j<BotSim>(`/api/campaigns/${id}/bot-sim?epoch=${n}&size=${size}`),
  publish: (campaign: Campaign, rationale: string) => j<{ id: string; path: string }>("/api/campaigns", post({ campaign, rationale })),

  /** The copilot streams one JSON object per line: steps as they happen, then the result. */
  async copilot(goal: string, onStep: (s: Step) => void, signal?: AbortSignal): Promise<DesignResult> {
    const r = await fetch("/api/copilot", { ...post({ goal }), signal });
    if (!r.ok || !r.body) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `copilot failed (${r.status})`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.type === "step") onStep(msg as Step);
        else if (msg.type === "result") return msg as DesignResult;
        else if (msg.type === "error") throw new Error(msg.error);
      }
    }
    throw new Error("copilot stream ended without a result");
  },
};

// ---------- formatting ----------
export const fmt = {
  n: (x: number, d = 0) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
  usd: (x: number, d = 2) => `${x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`,
  pct: (x: number, d = 1) => `${Number.isInteger(x) ? x : x.toFixed(d)}%`,
  short: (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`,
  compact: (x: number) => (Math.abs(x) >= 1000 ? `${(x / 1000).toFixed(x >= 10000 ? 0 : 1)}k` : x.toFixed(0)),
};

/** Stable display names for makers: the demo uses 0xde…a1 style placeholder addresses. */
export const makerName = (a: string) => {
  const tail = a.slice(-2).toUpperCase();
  return /^0xde0{30,}/i.test(a) ? `Maker ${tail}` : fmt.short(a);
};
