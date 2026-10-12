/**
 * One small interface over three AI backends, sized for what small local models can do reliably:
 *   json(): fill a small schema from text    text(): narrate facts in plain language
 *
 *   AI_PROVIDER=claude  Claude via the official Anthropic SDK (claude-opus-5-5 unless CLAUDE_MODEL is set)
 *   AI_PROVIDER=local   any OpenAI-compatible server: Ollama, LM Studio, llama.cpp, vLLM, a DGX Spark box...
 *                       LOCAL_LLM_URL (default http://localhost:11434/v1), LOCAL_LLM_MODEL (e.g. gemma3:4b, qwen2.5:7b, llama3.2:3b)
 *   AI_PROVIDER=off     no model: callers fall back to deterministic parsing and templates
 * Default: claude if ANTHROPIC_API_KEY is set, else local if LOCAL_LLM_MODEL is set, else off.
 *
 * No model output is trusted: JSON is schema-validated (zod), text is grounding-checked by the caller.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { openaiCompatible, type LLM } from "./http";

export { extractJson, type LLM } from "./http";

export function aiConfig() {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  const provider = explicit ?? (process.env.ANTHROPIC_API_KEY ? "claude" : process.env.LOCAL_LLM_MODEL ? "local" : "off");
  return {
    provider: (["claude", "local"].includes(provider) ? provider : "off") as "claude" | "local" | "off",
    claudeModel: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
    localUrl: (process.env.LOCAL_LLM_URL ?? "http://localhost:11434/v1").replace(/\/$/, ""),
    localModel: process.env.LOCAL_LLM_MODEL ?? "gemma3:4b",
    localKey: process.env.LOCAL_LLM_KEY, // most local servers ignore it; LM Studio / vLLM may want one
  };
}

export function getLLM(): LLM | null {
  const c = aiConfig();
  if (c.provider === "claude") return claude(c.claudeModel);
  if (c.provider === "local")
    return openaiCompatible({ baseUrl: c.localUrl, model: c.localModel, key: c.localKey, timeoutMs: Number(process.env.LOCAL_LLM_TIMEOUT_MS ?? 120_000) });
  return null;
}

// ---------------- Claude (official SDK) ----------------
function claude(model: string): LLM {
  const client = new Anthropic();
  return {
    provider: "claude",
    model,
    async json(schema, system, user) {
      const res = await client.beta.messages.parse({
        model,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default", // re-run on Anthropic's recommended model if a safety classifier declines
        output_config: { effort: "low", format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: "user", content: user }],
      });
      if (res.stop_reason === "refusal") return null;
      return (res.parsed_output as z.infer<typeof schema> | null) ?? null;
    },
    async text(system, user, maxTokens = 2000) {
      const res = await client.beta.messages.create({
        model,
        max_tokens: maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system,
        messages: [{ role: "user", content: user }],
      });
      if (res.stop_reason === "refusal") return null;
      return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim() || null;
    },
  };
}
