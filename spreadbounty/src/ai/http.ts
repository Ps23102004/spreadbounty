/**
 * Model adapters over plain fetch, safe to run in the browser (no SDK, no node: imports, no process.env).
 * The server's AI_PROVIDER=local path and the browser's "bring your own model" Writer share this code.
 *   openaiCompatible   OpenAI, Gemini's OpenAI-compatible endpoint, OpenRouter, Ollama, LM Studio, llama.cpp, vLLM
 *   anthropicMessages  the Anthropic Messages API, called straight from the browser with the user's key
 * Errors are thrown as ModelError with a sentence a sponsor can read ("Anthropic rejected the key (401).").
 * The key only ever goes into a header of a request to the adapter's own base URL.
 */
import { z } from "zod";

export interface LLM {
  provider: string;
  model: string;
  json<T extends z.ZodType>(schema: T, system: string, user: string): Promise<z.infer<T> | null>;
  text(system: string, user: string, maxTokens?: number): Promise<string | null>;
}
/** An adapter that can also prove it is reachable: one tiny call, and the model id the provider echoed back. */
export interface HttpLLM extends LLM {
  ping(): Promise<{ model: string; reply: string }>;
  models(): Promise<string[]>;
}
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class ModelError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

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

const jsonSchemaOf = (schema: z.ZodType) => {
  const { $schema: _, ...s } = z.toJSONSchema(schema) as Record<string, unknown>;
  return s;
};
const withSchema = (system: string, schema: object) => `${system}\nReply with one JSON object only, matching this JSON Schema:\n${JSON.stringify(schema)}`;

/** One HTTP call with readable failures: unreachable (CORS, nothing listening, CSP), timeout, 401/403, 429, 404, other. */
async function call(f: Fetch, label: string, url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const host = new URL(url).host;
  let r: Response;
  try {
    r = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new ModelError(`${label} did not answer within ${Math.round(timeoutMs / 1000)} s.`);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
    throw new ModelError(
      local
        ? `Your browser could not reach ${host}. Is the model server running? If it is Ollama, start it with OLLAMA_ORIGINS=${origin ?? "<this site's origin>"} so it accepts calls from this page.`
        : `Your browser could not reach ${host}: the call was blocked (CORS or this site's content policy) or the network is down.`,
    );
  }
  if (r.ok) return r.json();
  const body = (await r.text().catch(() => "")).slice(0, 300);
  const msg =
    r.status === 401 || r.status === 403 ? `${label} rejected the key (${r.status}).`
    : r.status === 429 ? `${label} is rate-limiting this key (429). Wait a minute and try again.`
    : r.status === 404 ? `${label} has no model or endpoint by that name (404). Check the model id.`
    : `${label} answered ${r.status}: ${body.replace(/\s+/g, " ").slice(0, 160)}`;
  throw new ModelError(msg, r.status);
}

const defaultFetch: Fetch = (url, init) => globalThis.fetch(url, init); // resolved per call: never a detached window.fetch

export function openaiCompatible(o: { baseUrl: string; model: string; key?: string; provider?: string; label?: string; timeoutMs?: number; fetchImpl?: Fetch }): HttpLLM {
  const base = o.baseUrl.replace(/\/$/, "");
  const f = o.fetchImpl ?? defaultFetch;
  const label = o.label ?? new URL(base).host;
  const timeoutMs = o.timeoutMs ?? 120_000;
  const headers: Record<string, string> = { "content-type": "application/json", ...(o.key ? { authorization: `Bearer ${o.key}` } : {}) };
  const chat = async (body: Record<string, unknown>): Promise<{ content: string; model: string }> => {
    const send = (b: Record<string, unknown>) => call(f, label, `${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(b) }, timeoutMs);
    const full = { model: o.model, temperature: 0, stream: false, ...body };
    let j: any;
    try {
      j = await send(full);
    } catch (e: any) {
      // reasoning models (OpenAI o-series, GPT-5 class) reject temperature and max_tokens; they want max_completion_tokens
      if (e?.status !== 400 || !/max_tokens|max_completion_tokens|temperature/i.test(e.message)) throw e;
      const { temperature: _, max_tokens, ...rest } = full as Record<string, unknown>;
      // ponytail: 4x headroom because reasoning tokens count against the cap; expose a setting if replies come back empty
      j = await send({ ...rest, max_completion_tokens: Number(max_tokens ?? 800) * 4 });
    }
    const choice = j?.choices?.[0];
    const content: string = choice?.message?.content ?? "";
    // a reply cut off by the token cap ends mid-sentence: keep the complete sentences
    const cut = choice?.finish_reason === "length" ? content.slice(0, content.lastIndexOf(".") + 1) : content;
    return { content: cut, model: String(j?.model ?? o.model) };
  };
  return {
    provider: o.provider ?? "local",
    model: o.model,
    async json(schema, system, user) {
      const jsonSchema = jsonSchemaOf(schema);
      const messages = [{ role: "system", content: withSchema(system, jsonSchema) }, { role: "user", content: user }];
      // Strongest constraint the server supports first: JSON-schema grammar, then JSON mode, then plain text.
      const formats = [{ type: "json_schema", json_schema: { name: "result", schema: jsonSchema, strict: true } }, { type: "json_object" }, null];
      for (const fmt of formats) {
        let out: string;
        try {
          out = (await chat({ messages, max_tokens: 800, ...(fmt ? { response_format: fmt } : {}) })).content;
        } catch (e: any) {
          if (e?.status === 400 || e?.status === 422) continue; // server doesn't support this response_format
          throw e;
        }
        const parsed = schema.safeParse(extractJson(out));
        if (parsed.success) return parsed.data;
      }
      return null;
    },
    async text(system, user, maxTokens = 2000) { // thinking models spend part of the cap on reasoning
      const { content } = await chat({ messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens });
      return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || null; // strip reasoning traces some local models emit
    },
    async ping() {
      const r = await chat({ messages: [{ role: "system", content: "Reply with the single word: ready" }, { role: "user", content: "Are you there?" }], max_tokens: 20 });
      return { model: r.model, reply: r.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim().slice(0, 60) };
    },
    async models() {
      const j = await call(f, label, `${base}/models`, { method: "GET", headers: o.key ? { authorization: `Bearer ${o.key}` } : {} }, 20_000);
      return ((j?.data ?? []) as { id?: string }[]).map((m) => String(m.id ?? "")).filter(Boolean).sort();
    },
  };
}

export const ANTHROPIC_URL = "https://api.anthropic.com";
export const ANTHROPIC_HEADERS = { "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } as const;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Anthropic Messages API from the browser. First try: low effort, structured output for JSON, and the server-side
 * refusal fallback; if the chosen model rejects any of those (400), the same request is sent plain. JSON replies go
 * through the same extractJson and zod path as local models, so nothing unvalidated reaches the pipeline.
 */
export function anthropicMessages(o: { key: string; model: string; timeoutMs?: number; fetchImpl?: Fetch }): HttpLLM {
  const f = o.fetchImpl ?? defaultFetch;
  const timeoutMs = o.timeoutMs ?? 120_000;
  const headers = { "content-type": "application/json", "x-api-key": o.key, ...ANTHROPIC_HEADERS };
  const create = async (body: Record<string, unknown>, format?: object): Promise<{ text: string | null; model: string }> => {
    const send = (b: Record<string, unknown>, extra: Record<string, string>) =>
      call(f, "Anthropic", `${ANTHROPIC_URL}/v1/messages`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify({ model: o.model, ...b }) }, timeoutMs);
    let res: any;
    try {
      res = await send({ ...body, output_config: { effort: "low", ...(format ? { format: { type: "json_schema", schema: format } } : {}) }, fallbacks: "default" }, { "anthropic-beta": FALLBACK_BETA });
    } catch (e: any) {
      if (e?.status !== 400) throw e;
      res = await send(body, {}); // older models: no effort, structured output or fallbacks
    }
    const model = String(res?.model ?? o.model);
    if (res?.stop_reason === "refusal") return { text: null, model };
    const text = ((res?.content ?? []) as { type: string; text?: string }[]).flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("\n").trim();
    return { text: text || null, model };
  };
  return {
    provider: "anthropic",
    model: o.model,
    async json(schema, system, user) {
      const s = jsonSchemaOf(schema);
      const { text } = await create({ max_tokens: 4000, system: withSchema(system, s), messages: [{ role: "user", content: user }] }, s);
      const parsed = schema.safeParse(text === null ? null : extractJson(text));
      return parsed.success ? parsed.data : null;
    },
    async text(system, user, maxTokens = 2000) {
      return (await create({ max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] })).text;
    },
    async ping() {
      const r = await create({ max_tokens: 64, system: "Reply with the single word: ready", messages: [{ role: "user", content: "Are you there?" }] });
      return { model: r.model, reply: (r.text ?? "").slice(0, 60) };
    },
    async models() {
      const j = await call(f, "Anthropic", `${ANTHROPIC_URL}/v1/models?limit=100`, { method: "GET", headers: { "x-api-key": o.key, ...ANTHROPIC_HEADERS } }, 20_000);
      return ((j?.data ?? []) as { id?: string }[]).map((m) => String(m.id ?? "")).filter(Boolean);
    },
  };
}
