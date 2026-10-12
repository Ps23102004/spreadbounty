/**
 * Bring-your-own-model tests: the browser Writer (web/src/ai) run in Node with a spy in place of fetch.
 * The spy plays every party: this app's server (the real designCampaign behind /api/copilot, epoch files),
 * Anthropic, OpenAI and a local Ollama. No network, no real keys.
 *   Run by test/ai.test.ts (npm run test:ai), or alone: npm run --silent demo:gen && npx tsx test/byo.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkGrounding } from "../src/ai/grounding";
import { designCampaign, IntentSchema } from "../src/ai/pipeline";
import { demoSource } from "../src/data/source";

// ---------- the browser globals the Writer uses ----------
class MemStorage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const local = new MemStorage(), session = new MemStorage();
Object.assign(globalThis, { localStorage: local, sessionStorage: session });

const { design, report } = await import("../web/src/ai/client");
const { forgetKeys, getKey, saveSettings, setKey } = await import("../web/src/ai/keys");
const { testConnection, writerLabel } = await import("../web/src/ai/providers");

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok  ${m}`); };

// ---------- one spy for every request the browser makes ----------
type Seen = { url: string; headers: Record<string, string>; body: any };
let seen: Seen[] = [];
let providerStatus = 200; // what Anthropic / OpenAI / Ollama answer
let liar = false; // the model invents numbers in every draft
const src = demoSource();
const epochFile = (k: number) => JSON.parse(readFileSync(`out/demo/ausd-usdc-demo/epoch-${k}.json`, "utf8"));
const factsIn = (user: string) => JSON.parse(user.slice(user.indexOf("{"), user.lastIndexOf("}") + 1));
function modelReply(system: string, user: string) {
  if (system.includes("fill in a small form")) return 'Sure! ```json\n{"pair":"MON/USDC","bandBps":null,"budgetPerDay":null,"epochMinutes":60,"refPrice":null,"summary":"Deepen MON"}\n```';
  if (system.includes("single word")) return "ready";
  if (liar) return "Coverage would be 97.5% with 12,345 USDC of depth.";
  const f = factsIn(user);
  return f.recommended ? `Use a ${f.recommended.bandBps} bps band; history shows ${f.recommended.twoSidedCoveragePct}% two-sided coverage.` : `Coverage was ${f.thisEpoch.twoSidedCoveragePct}% with ${f.thisEpoch.avgTwoSidedDepthUsdc} USDC of depth.`;
}
globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
  const url = String(input);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  seen.push({ url, headers, body });
  // this app's server
  if (url === "/api/copilot") {
    const lines: string[] = [];
    const intent = body.intent === undefined ? undefined : IntentSchema.parse(body.intent); // as the server validates it
    const r = await designCampaign(body.goal, src, null, (s) => lines.push(JSON.stringify({ type: "step", ...s })), { intent, brief: body.brief });
    lines.push(JSON.stringify({ type: "result", ...r }));
    return new Response(lines.join("\n") + "\n");
  }
  const ep = url.match(/^\/api\/campaigns\/ausd-usdc-demo\/epochs\/(\d+)$/);
  if (ep) return Response.json(epochFile(Number(ep[1])));
  // model providers
  const provider = ["https://api.anthropic.com/", "https://api.openai.com/", "http://localhost:11434/"].find((p) => url.startsWith(p));
  if (!provider) throw new TypeError("Failed to fetch"); // what a browser reports for CORS blocks and dead hosts
  if (providerStatus !== 200) return new Response('{"error":{"message":"nope"}}', { status: providerStatus });
  if (provider.includes("anthropic")) {
    const text = modelReply(body.system, body.messages[0].content);
    return Response.json({ id: "msg_1", model: body.model, stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text }] });
  }
  if (url.endsWith("/models")) return Response.json({ data: [{ id: "gemma4:e4b-it-qat" }] });
  if (body.response_format?.type === "json_schema") return new Response("{}", { status: 400 }); // a weak local server
  return Response.json({ model: body.model, choices: [{ message: { content: modelReply(body.messages[0].content, body.messages[1].content) } }] });
}) as typeof fetch;

const failure = (t: Awaited<ReturnType<typeof testConnection>>) => (t.ok ? "" : t.message);
const GOAL = "Deepen the MON book, about $700 a week";
const ownOrigin = (u: string) => new URL(u, "http://this-app.test").origin === "http://this-app.test";
/** Every request carrying the key went to `origin`; nothing to this app's origin carried a key or an auth header. */
function assertKeyOnlyTo(key: string, origin: string) {
  assert.ok(seen.some((r) => ownOrigin(r.url)), "talked to this app's server");
  assert.ok(seen.some((r) => r.url.startsWith(origin)), `talked to ${origin}`);
  for (const r of seen) {
    const carries = Object.values(r.headers).some((v) => v.includes(key)) || JSON.stringify(r.body ?? "").includes(key) || r.url.includes(key);
    if (carries) assert.equal(new URL(r.url, "http://this-app.test").origin, origin, `key sent to ${r.url}`);
    if (ownOrigin(r.url)) assert.ok(!("authorization" in r.headers) && !("x-api-key" in r.headers), `auth header on own-origin ${r.url}`);
  }
}
const use = (provider: "none" | "anthropic" | "openai" | "local", model: string, key = "", remember = false) => {
  saveSettings({ provider, model, baseUrl: provider === "local" ? "http://localhost:11434/v1" : "", remember });
  if (key) setKey(provider, key, remember);
  seen = [];
};

// ---------- None: the browser path with rules and templates matches the server's rules-only run ----------
{
  use("none", "");
  const steps: string[] = [];
  const r = await design(GOAL, (s) => steps.push(`${s.step}:${s.status}`));
  const server = await designCampaign(GOAL, src, null);
  assert.deepEqual(r.campaign, server.campaign);
  assert.deepEqual(r.candidates, server.candidates);
  assert.equal(r.brief, server.brief);
  assert.equal(r.ai.where, "browser");
  assert.ok(seen.every((r) => ownOrigin(r.url)), "None never calls a provider");
  assert.deepEqual(steps, ["intent:running", "intent:done", "market:running", "market:done", "history:running", "history:done", "backtest:running", "backtest:done", "brief:running", "brief:done"]);
  ok("None: browser pipeline gives the same campaign, candidates and template brief as the server's rules-only run");
}

// ---------- Anthropic: key only to api.anthropic.com, with the three browser headers ----------
{
  const KEY = "test-key-anthropic-0001";
  use("anthropic", "claude-opus-5-5", KEY);
  const r = await design(GOAL, () => {});
  const rep = await report("ausd-usdc-demo", 2);
  assertKeyOnlyTo(KEY, "https://api.anthropic.com");
  const calls = seen.filter((s) => s.url === "https://api.anthropic.com/v1/messages");
  assert.ok(calls.length >= 3); // intent, brief, report
  for (const c of calls) {
    assert.equal(c.headers["x-api-key"], KEY);
    assert.equal(c.headers["anthropic-version"], "2023-06-01");
    assert.equal(c.headers["anthropic-dangerous-direct-browser-access"], "true");
  }
  assert.equal(r.ai.intentBy, "model");
  assert.equal(r.intent.pair, "MON/USDC");
  assert.equal(r.intent.budgetPerDay, 100); // "$700 a week" read by rules wins over the model's null
  assert.equal(r.ai.briefBy, "model");
  assert.ok(checkGrounding(r.brief, r.facts).ok);
  assert.equal(rep.ai.writtenBy, "model");
  assert.equal(rep.ai.where, "browser");
  assert.ok(!seen.some((s) => s.url.includes("/report")), "report never asks the server's model");
  ok("Anthropic: key only on requests to api.anthropic.com (x-api-key, anthropic-version, direct-browser-access); own-origin calls carry no key");
}

// ---------- OpenAI: Bearer key only to api.openai.com ----------
{
  const KEY = "test-key-openai-0002";
  use("openai", "gpt-test", KEY);
  const r = await design(GOAL, () => {});
  await report("ausd-usdc-demo", 2);
  assertKeyOnlyTo(KEY, "https://api.openai.com");
  for (const c of seen.filter((s) => s.url.startsWith("https://api.openai.com"))) assert.equal(c.headers.authorization, `Bearer ${KEY}`);
  assert.ok(!seen.some((s) => JSON.stringify(s).includes("test-key-anthropic-0001")), "the Anthropic key never travels with OpenAI selected");
  assert.equal(r.ai.briefBy, "model");
  ok("OpenAI-compatible: Bearer key only on requests to api.openai.com; the other provider's key is never sent");
}

// ---------- Local (Ollama): no key, no auth header ----------
{
  use("local", "gemma4:e4b-it-qat");
  const steps: { step: string; detail?: string }[] = [];
  const r = await design(GOAL, (s) => steps.push(s));
  assert.ok(seen.some((s) => s.url === "http://localhost:11434/v1/chat/completions"));
  assert.ok(seen.every((s) => !("authorization" in s.headers) && !("x-api-key" in s.headers)));
  assert.equal(steps[0]!.detail, "gemma4:e4b-it-qat in your browser"); // the tape's first line names the browser model
  assert.equal(r.ai.model, "gemma4:e4b-it-qat");
  const t = await testConnection({ provider: "local", model: "gemma4:e4b-it-qat", baseUrl: "http://localhost:11434/v1", remember: false }, "");
  assert.ok(t.ok && t.model === "gemma4:e4b-it-qat" && t.latencyMs >= 0);
  ok("Local: requests go to localhost:11434 with no key header; first step names the browser model; Test reports the echoed model id");
}

// ---------- the browser brief rejects invented numbers and falls back to the template ----------
{
  use("local", "gemma4:e4b-it-qat");
  liar = true;
  const r = await design("AUSD/USDC, 15 bps, $50/day", () => {});
  liar = false;
  const server = await designCampaign("AUSD/USDC, 15 bps, $50/day", src, null);
  assert.equal(r.ai.briefBy, "template");
  assert.equal(r.ai.groundingAttempts.length, 2);
  assert.deepEqual(r.ai.groundingAttempts[0]!.ungrounded, ["97.5", "12,345"]);
  assert.equal(r.brief, server.brief);
  assert.ok(!r.brief.includes("97.5"));
  ok("browser brief: invented numbers fail the same grounding guard twice, the template is shown");
}

// ---------- readable failures, per step ----------
{
  use("anthropic", "claude-opus-5-5", "test-key-anthropic-0001");
  providerStatus = 401;
  const steps: { step: string; note?: string }[] = [];
  const r = await design(GOAL, (s) => steps.push(s));
  assert.equal(r.ai.intentBy, "rules");
  assert.equal(r.ai.briefBy, "template");
  assert.deepEqual(r.ai.notes, ["Anthropic rejected the key (401). Used rules instead.", "Anthropic rejected the key (401). Used the template instead."]);
  assert.ok(steps.some((s) => s.step === "intent" && s.note === "Anthropic rejected the key (401). Used rules instead."));
  assert.equal(r.recommended.bandBps, (await designCampaign(GOAL, src, null)).recommended.bandBps);
  const rep = await report("ausd-usdc-demo", 2);
  assert.equal(rep.ai.writtenBy, "template");
  assert.match(rep.ai.notes[0]!, /rejected the key/);
  providerStatus = 429;
  assert.match(failure(await testConnection({ provider: "anthropic", model: "claude-opus-5-5", baseUrl: "", remember: false }, "k")), /rate-limiting this key \(429\)/);
  providerStatus = 200;
  const dead = await testConnection({ provider: "local", model: "m", baseUrl: "http://localhost:1234/v1", remember: false }, "");
  assert.match(failure(dead), /could not reach localhost:1234.*OLLAMA_ORIGINS/);
  ok("failures read plainly and fall back per step: 401 -> rules + template, 429 named, unreachable local server explains OLLAMA_ORIGINS");
}

// ---------- key storage ----------
{
  forgetKeys();
  const values = (s: MemStorage) => [...s.m.values()];
  setKey("anthropic", "test-key-store-0003", false);
  assert.ok(values(session).includes("test-key-store-0003"));
  assert.ok(!values(local).some((v) => v.includes("test-key-store-0003")), "not in localStorage without Remember");
  saveSettings({ provider: "anthropic", model: "claude-opus-5-5", baseUrl: "", remember: true });
  assert.ok(values(local).includes("test-key-store-0003"), "Remember copies it to localStorage");
  saveSettings({ provider: "anthropic", model: "claude-opus-5-5", baseUrl: "", remember: false });
  assert.ok(!values(local).includes("test-key-store-0003"), "unticking Remember removes it");
  setKey("anthropic", "test-key-store-0003", true);
  forgetKeys();
  assert.ok(![...values(local), ...values(session)].some((v) => v.includes("test-key-store-0003")) && getKey("anthropic") === "");
  assert.equal(writerLabel({ provider: "local", model: "gemma4:e4b-it-qat", baseUrl: "", remember: false }), "Writer: gemma4 (browser)");
  assert.equal(writerLabel({ provider: "anthropic", model: "claude-opus-5-5", baseUrl: "", remember: false }), "Writer: Claude (browser)");
  ok("keys: sessionStorage by default, localStorage only with Remember, Forget clears both stores");
}

console.log(`\n${n} BYO-model tests passed`);
