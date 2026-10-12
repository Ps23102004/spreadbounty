/**
 * Bring-your-own-model tests: the browser Writer (web/src/ai) run in Node with a spy in place of fetch.
 * The spy plays every party: this app's server (the real designCampaign behind /api/copilot, epoch files),
 * Anthropic, OpenAI and a local Ollama. No network, no real keys.
 *   Run by test/ai.test.ts (npm run test:ai), or alone: npm run --silent demo:gen && npx tsx test/byo.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { checkGrounding, paymentClaims } from "../src/ai/grounding";
import { designCampaign, IntentSchema } from "../src/ai/pipeline";
import { writeEpochReport } from "../src/ai/report";
import { demoSource } from "../src/data/source";

// The model dialog is rendered to markup below: Node needs its CSS import to be a no-op and a global React
// (the root tsconfig compiles JSX to React.createElement).
register("data:text/javascript,export async function load(u,c,n){return u.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:n(u,c)}");
Object.assign(globalThis, { React });

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
const { forgetKeys, getKey, saveSettings, setJudgeKey, setJudgeMode, setKey } = await import("../web/src/ai/keys");
const { testConnection, writerLabel } = await import("../web/src/ai/providers");

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok  ${m}`); };
const DIALOG = "../web/src/ui/ModelDialog.tsx"; // a variable, so the root tsc (no JSX setting) does not compile the .tsx

// ---------- one spy for every request the browser makes ----------
type Seen = { url: string; headers: Record<string, string>; body: any };
let seen: Seen[] = [];
let providerStatus = 200; // what Anthropic / OpenAI / Ollama answer
let liar = false; // the model invents numbers in every draft
let echo = ""; // a sentence the model adds to every brief (e.g. one repeating the sponsor's own number)
let shadowCampaign = false; // what /api/campaigns says about ausd-usdc-demo
const src = demoSource();
const epochFile = (k: number) => JSON.parse(readFileSync(`out/demo/ausd-usdc-demo/epoch-${k}.json`, "utf8"));
const factsIn = (user: string) => JSON.parse(user.slice(user.indexOf("{"), user.lastIndexOf("}") + 1));
function modelReply(system: string, user: string) {
  if (system.includes("fill in a small form")) return 'Sure! ```json\n{"pair":"MON/USDC","bandBps":null,"budgetPerDay":null,"epochMinutes":60,"refPrice":null,"summary":"Deepen MON"}\n```';
  if (system.includes("single word")) return "ready";
  if (liar) return "Coverage would be 97.5% with 12,345 USDC of depth.";
  const f = factsIn(user), t = f["this epoch"];
  return f.recommended ? `Use a ${f.recommended["band bps"]} bps band; history shows ${f.recommended["two sided coverage %"]}% two-sided coverage.${echo}` : `Coverage was ${t["two sided coverage %"]}% with ${t["average two sided depth USDC"]} USDC of depth.`;
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
  if (url === "/api/campaigns") return Response.json([{ id: "ausd-usdc-demo", shadow: shadowCampaign }]);
  const ep = url.match(/^\/api\/campaigns\/ausd-usdc-demo\/epochs\/(\d+)$/);
  if (ep) return Response.json(epochFile(Number(ep[1])));
  if (url === "/api/campaigns/ausd-usdc-demo/epochs/2/report") return Response.json(await writeEpochReport(epochFile(2), epochFile(1), null)); // a server that passes no shadow flag
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
/** What the Design tape prints after "request read by": the last running detail of the intent step (Design.tsx stepLine). */
const tapeReader = (steps: { step: string; status?: string; detail?: string }[]) => steps.filter((s) => s.step === "intent" && s.status === "running").at(-1)?.detail;
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
  const steps: { step: string; status?: string; detail?: string }[] = [];
  const r = await design(GOAL, (s) => steps.push(s));
  assert.ok(seen.some((s) => s.url === "http://localhost:11434/v1/chat/completions"));
  assert.ok(seen.every((s) => !("authorization" in s.headers) && !("x-api-key" in s.headers)));
  assert.equal(steps[0]!.detail, "asking gemma4:e4b-it-qat in your browser"); // the spinner says who is being asked
  assert.equal(tapeReader(steps), "gemma4:e4b-it-qat in your browser"); // the tape's first line names the model that read it
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

// ---------- the browser brief may repeat the sponsor's own numbers, and only those ----------
{
  use("local", "gemma4:e4b-it-qat");
  echo = " Keep it within 0.25% as you asked.";
  const own = await design("Deepen MON/USDC within 0.25%, about $700 a week", () => {});
  assert.equal(own.ai.briefBy, "model");
  assert.match(own.brief, /0\.25% as you asked/);
  echo = " Keep it within 0.65% as you asked.";
  const invented = await design("Deepen MON/USDC within 0.25%, about $700 a week", () => {});
  assert.equal(invented.ai.briefBy, "template");
  assert.deepEqual(invented.ai.groundingAttempts[0]!.ungrounded, ["0.65"]);
  echo = "";
  ok("browser brief: the sponsor's 0.25% passes; a 0.65% that is in neither the facts nor the request still fails");
}

// ---------- shadow campaigns: the browser report never says anyone was paid ----------
{
  shadowCampaign = true;
  use("none", "");
  const r = await report("ausd-usdc-demo", 2);
  assert.equal(r.facts!.shadow, true);
  assert.match(r.markdown, /^Shadow campaign: nobody was paid\./);
  assert.deepEqual(paymentClaims(r.markdown), []);
  use("anthropic", "claude-opus-5-5", "test-key-anthropic-0001");
  const m = await report("ausd-usdc-demo", 2);
  assert.equal(m.ai.writtenBy, "model");
  const sent = seen.find((s) => s.url === "https://api.anthropic.com/v1/messages")!;
  assert.equal(factsIn(sent.body.messages[0].content).shadow, true, "the model is told nobody was paid");
  saveSettings({ provider: "server", model: "", baseUrl: "", remember: false });
  const srv = await report("ausd-usdc-demo", 2);
  assert.match(srv.markdown, /^Shadow campaign: nobody was paid\./);
  assert.equal(srv.ai.writtenBy, "template");
  assert.match(srv.ai.notes.at(-1)!, /as if makers were paid/);
  shadowCampaign = false;
  use("none", "");
  assert.ok(!(await report("ausd-usdc-demo", 2)).markdown.startsWith("Shadow"));
  ok("shadow report: the campaign row's flag reaches the template and the model's facts; a server without the flag is overridden");
}

// ---------- the model dialog: Judge section and what each choice sends where ----------
{
  const { ModelDialog } = await import(DIALOG);
  const render = () => renderToStaticMarkup(React.createElement(ModelDialog, { open: false, onClose: () => {}, serverAi: null }));
  forgetKeys();
  use("local", "gemma4:e4b-it-qat");
  const local = render();
  assert.match(local, /Model calls go from this browser to localhost:11434\. This server still gets your sentence and the form read from it, to run the backtest\./);
  assert.ok(!local.includes("This server never sees them"), "the old line said the server sees nothing");

  setJudgeMode("server");
  assert.match(render(), /<legend class="label">Judge<\/legend>.*checked=""\/><span>Jev on this server<\/span>/);
  assert.match(render(), /asks TypeSafe Jev with the operator&#x27;s key/);
  setJudgeMode("key");
  setJudgeKey("ts-test-key-render-0009", false);
  const key = render();
  assert.match(key, /<label class="label" for="([^"]+)-jkey">TypeSafe key<\/label><div class="md-inline"><input id="\1-jkey" type="password" autoComplete="off"/);
  assert.match(key, /passes through this server for each request, to api\.typesafe\.ai only\. It is never stored or logged\. The key is forgotten when this tab closes\./);
  assert.match(key, /Remember on this device/);
  setJudgeMode("local");
  const loc = render();
  assert.match(loc, /<span class="label">System One URL<\/span><input type="url"[^>]*value="http:\/\/localhost:8770\/v1\/systemone"/);
  assert.match(loc, /go from this browser to localhost:8770, with no key\. This server&#x27;s judge is not asked\./);
  setJudgeMode("none");
  assert.match(render(), /No judge: nothing is flagged/);
  setJudgeMode("server");
  forgetKeys();
  ok("model dialog: Judge section (None / Jev on this server / your TypeSafe key / local System One) with labelled inputs; local Writer copy says the sentence still reaches this server");
}

// ---------- readable failures, per step ----------
{
  use("anthropic", "claude-opus-5-5", "test-key-anthropic-0001");
  providerStatus = 401;
  const steps: { step: string; status?: string; detail?: string; note?: string }[] = [];
  const r = await design(GOAL, (s) => steps.push(s));
  assert.equal(r.ai.intentBy, "rules");
  assert.equal(tapeReader(steps), "rules", "a rejected key: the tape says the rules read the request");
  assert.ok(!steps.some((s) => s.step === "intent" && s.detail === "claude-opus-5-5 in your browser"), "never 'read by claude-opus-5-5'");
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
  ok("failures read plainly and fall back per step: 401 -> rules + template (tape: read by rules), 429 named, unreachable local server explains OLLAMA_ORIGINS");
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
  assert.equal(writerLabel({ provider: "local", model: "gemma4:e4b-it-qat", baseUrl: "", remember: false }, null, null), "Writer: gemma4 (browser)");
  assert.equal(writerLabel({ provider: "anthropic", model: "claude-opus-5-5", baseUrl: "", remember: false }, null, null), "Writer: Claude (browser)");
  assert.equal(writerLabel({ provider: "none", model: "", baseUrl: "", remember: false }), "Writer: none · Judge: Jev (this server)"); // default judge, shown on Design B-1
  assert.equal(writerLabel({ provider: "none", model: "", baseUrl: "", remember: false }, null, "none"), "Writer: none");
  ok("keys: sessionStorage by default, localStorage only with Remember, Forget clears both stores");
}

console.log(`\n${n} BYO-model tests passed`);
