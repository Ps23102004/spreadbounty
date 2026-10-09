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

export interface LLM {
  provider: "claude" | "local";
  model: string;
  json<T extends z.ZodType>(schema: T, system: string, user: string): Promise<z.infer<T> | null>;
  text(system: string, user: string, maxTokens?: number): Promise<string | null>;
}

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
  if (c.provider === "local") return local(c.localUrl, c.localModel, c.localKey);
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

// ---------------- Local (OpenAI-compatible HTTP) ----------------
/** Pull the first balanced JSON object out of a reply (small models wrap JSON in prose or code fences). */
export function extractJson(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : s;
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(body.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function local(baseUrl: string, model: string, key?: string): LLM {
  const call = async (body: Record<string, unknown>) => {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, temperature: 0, stream: false, ...body }),
      signal: AbortSignal.timeout(Number(process.env.LOCAL_LLM_TIMEOUT_MS ?? 120_000)),
    });
    if (!r.ok) throw Object.assign(new Error(`local LLM ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: r.status });
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? "";
  };
  return {
    provider: "local",
    model,
    async json(schema, system, user) {
      const jsonSchema = z.toJSONSchema(schema);
      const messages = [
        { role: "system", content: `${system}\nReply with one JSON object only, matching this JSON Schema:\n${JSON.stringify(jsonSchema)}` },
        { role: "user", content: user },
      ];
      // Strongest constraint the server supports first: JSON-schema grammar, then JSON mode, then plain text.
      const formats = [{ type: "json_schema", json_schema: { name: "result", schema: jsonSchema, strict: true } }, { type: "json_object" }, null];
      for (const fmt of formats) {
        let out: string;
        try {
          out = await call({ messages, max_tokens: 800, ...(fmt ? { response_format: fmt } : {}) });
        } catch (e: any) {
          if (e?.status === 400 || e?.status === 422) continue; // server doesn't support this response_format
          throw e;
        }
        const parsed = schema.safeParse(extractJson(out));
        if (parsed.success) return parsed.data;
      }
      return null;
    },
    async text(system, user, maxTokens = 900) {
      const out = await call({ messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens });
      return out.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || null; // strip reasoning traces some local models emit
    },
  };
}
