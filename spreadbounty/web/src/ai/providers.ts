/**
 * The Writer slot's providers. Cloud providers have fixed endpoints, so a key can only go to the provider it was
 * typed for; only Local takes a user-set base URL. Model ids are typed or listed from the provider; the only default
 * is claude-opus-5-5 for Anthropic. The adapters (and zod) load on first use, so this file stays out of the
 * main chunk's weight.
 */
import type { HttpLLM } from "../../../src/ai/http";
import { getJudgeMode, type JudgeMode, type ModelSettings, type ProviderId } from "./keys";

interface Provider { label: string; short: string; baseUrl: string; needsKey: boolean; defaultModel: string }
export const PROVIDERS: Record<ProviderId, Provider> = {
  none: { label: "None: rules and templates", short: "none", baseUrl: "", needsKey: false, defaultModel: "" },
  server: { label: "This server", short: "this server", baseUrl: "", needsKey: false, defaultModel: "" },
  anthropic: { label: "Anthropic", short: "Claude", baseUrl: "https://api.anthropic.com", needsKey: true, defaultModel: "claude-opus-5-5" },
  openai: { label: "OpenAI", short: "OpenAI", baseUrl: "https://api.openai.com/v1", needsKey: true, defaultModel: "" },
  gemini: { label: "Google Gemini", short: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true, defaultModel: "" },
  openrouter: { label: "OpenRouter", short: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true, defaultModel: "" },
  local: { label: "Local", short: "local", baseUrl: "http://localhost:11434/v1", needsKey: false, defaultModel: "" },
};
export const LOCAL_PRESETS = [
  { name: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { name: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  { name: "llama.cpp", baseUrl: "http://localhost:8080/v1" },
  { name: "vLLM", baseUrl: "http://localhost:8000/v1" },
];

/** Where this Writer's requests, and its key, go. */
export function endpoint(s: ModelSettings) {
  return s.provider === "local" ? (s.baseUrl.trim() || PROVIDERS.local.baseUrl).replace(/\/$/, "") : PROVIDERS[s.provider].baseUrl;
}
export function endpointHost(s: ModelSettings) {
  try {
    return new URL(endpoint(s)).host;
  } catch {
    return "";
  }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A browser-side model, or null when the Writer is None, This server, or not filled in yet. */
export async function buildLLM(s: ModelSettings, key: string, fetchImpl?: Fetch, needModel = true): Promise<HttpLLM | null> {
  const p = PROVIDERS[s.provider];
  if (!p.baseUrl || (needModel && !s.model.trim()) || (p.needsKey && !key)) return null;
  const { anthropicMessages, openaiCompatible } = await import("../../../src/ai/http");
  if (s.provider === "anthropic") return anthropicMessages({ key, model: s.model.trim(), fetchImpl });
  const label = s.provider === "local" ? `The model server at ${endpointHost(s)}` : p.label;
  return openaiCompatible({ baseUrl: endpoint(s), model: s.model.trim(), key: key || undefined, provider: s.provider, label, fetchImpl, timeoutMs: s.provider === "local" ? 120_000 : 60_000 });
}

/** One tiny real call: latency and the model id the provider echoed back. */
export async function testConnection(s: ModelSettings, key: string, fetchImpl?: Fetch) {
  const llm = await buildLLM(s, key, fetchImpl);
  if (!llm) return { ok: false as const, message: PROVIDERS[s.provider].needsKey && !key ? "Add a key first." : "Add a model id first." };
  const t0 = performance.now();
  try {
    const r = await llm.ping();
    return { ok: true as const, latencyMs: Math.round(performance.now() - t0), model: r.model, reply: r.reply };
  } catch (e) {
    return { ok: false as const, message: String((e as Error)?.message ?? e) };
  }
}

export async function listModels(s: ModelSettings, key: string, fetchImpl?: Fetch) {
  const llm = await buildLLM(s, key, fetchImpl, false);
  if (!llm) throw new Error("Add a key first.");
  return llm.models();
}

export const JUDGE_LABELS: Record<JudgeMode, string> = {
  none: "None",
  server: "Jev on this server",
  key: "Jev with your TypeSafe key",
  local: "Local System One server (Von, Laya)",
};
const JUDGE_SHORT: Record<JudgeMode, string> = { none: "none", server: "Jev (this server)", key: "Jev (your key)", local: "System One (browser)" };

/**
 * "Writer: none", "Writer: gemma4 (browser)", "Writer: Claude (browser)", plus " · Judge: Jev (this server)" for the
 * chosen judge (B-1 and A-5 lines). The header chip passes `judge: null` and stays short.
 */
export function writerLabel(s: ModelSettings, serverModel: string | null = null, judge: JudgeMode | null = getJudgeMode()) {
  const j = judge && judge !== "none" ? ` · Judge: ${JUDGE_SHORT[judge]}` : "";
  if (s.provider === "none") return `Writer: none${j}`;
  if (s.provider === "server") return `Writer: ${serverModel ?? "this server"} (server)${j}`;
  const m = s.model.trim();
  const name = s.provider === "anthropic" ? "Claude" : m ? m.split("/").pop()!.split(":")[0]! : PROVIDERS[s.provider].short;
  return `Writer: ${name} (browser)${j}`;
}
