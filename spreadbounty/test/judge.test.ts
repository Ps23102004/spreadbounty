/**
 * B2 decision-model tests. A mock System One server (node:http, the request shape from docs.typesafe.ai/api) plays
 * TypeSafe Jev and a local Von/Laya server; the real app server runs POST /api/judge and /api/copilot; the browser
 * Writer (web/src/ai) runs in Node with fetch routed to both. No network, no real key.
 *   npm run test:judge
 * Live mode, once, against the real Jev with TYPESAFE_API_KEY (prints accuracy and latency; never prints the key):
 *   JUDGE_LIVE=1 npx tsx test/judge.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import {
  FLAG_COPY, judgeRequest, judgeSupport, JudgeError, probeTypes, readRequest, REQUEST_QUESTIONS, splitSentences, supportQuestions, systemOne, TYPESAFE_URL,
  type Answers,
} from "../src/ai/judge";
import { templateBrief } from "../src/ai/prompts";
import { reportFacts, templateReport } from "../src/ai/report";
import { demoSource } from "../src/data/source";
import { createApp } from "../src/server/index";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok  ${m}`); };
const fixture = JSON.parse(readFileSync(new URL("./fixtures/sponsor-requests.json", import.meta.url), "utf8")) as { requests: { request: string; pair: string; flags: string[] }[] };

if (process.env.JUDGE_LIVE === "1") await live();
else await offline();

async function offline() {
  // ---------- a mock System One server ----------
  type Seen = { url: string; headers: IncomingMessage["headers"]; body: any };
  const upstream: Seen[] = [];
  const mode = { status: 200, lowPair: false, delayMs: 0, requireKey: "" };
  const has = (s: string, re: RegExp) => re.test(s.toLowerCase());
  function answer(id: string, q: any, state: any, url: URL) {
    const req = String(state?.request ?? "");
    if (url.searchParams.get("wrong")) return q.type === "choice" ? { type: "choice", choice: Object.keys(q.criteria)[0], confidence: 0.9, probabilities: {} } : { type: "noul", noul: 0.9 };
    if (q.type === "choice") {
      const choice = has(req, /mon/) ? "MON/USDC" : has(req, /ausd/) ? "AUSD/USDC" : "none";
      return { type: "choice", choice, confidence: mode.lowPair ? 0.55 : 0.95, probabilities: { [choice]: mode.lowPair ? 0.6 : 0.97 } };
    }
    const yes: Record<string, RegExp> = {
      wants_volume: /volume|per trade|fills/, names_makers: /wintermute|top \d|only .*makers/, price_promise: /peg defended|never let|stop .* falling|at exactly/,
      one_sided: /only bids|only asks|bids only/, names_mon: /mon\/usdc/, names_ausd: /ausd\/usdc/,
    };
    if (id.startsWith("supported_")) return { type: "noul", noul: /wintermute/i.test(q.instructions.sentence) ? 0.05 : 0.95 };
    return { type: "noul", noul: yes[id]?.test(req.toLowerCase()) ? 0.92 : 0.04 };
  }
  /** The documented request contract; anything else is a 422, as the real API answers. */
  const validRequest = (b: any) =>
    b && typeof b.model === "string" && b.state !== undefined && b.questions && typeof b.questions === "object" &&
    Object.values(b.questions).every((q: any) =>
      q.instructions !== undefined &&
      (q.type === "noul" ? q.criteria === undefined || (typeof q.criteria.true === "string" && typeof q.criteria.false === "string")
      : q.type === "choice" && q.criteria && Object.values(q.criteria).every((c) => c === null || typeof c === "string")));
  const mock = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const url = new URL(req.url ?? "/", "http://mock");
      const body = raw ? JSON.parse(raw) : null;
      upstream.push({ url: url.href, headers: req.headers, body });
      const reply = (status: number, o: unknown) => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(o)); };
      if (mode.delayMs) await new Promise((r) => setTimeout(r, mode.delayMs));
      if (req.method !== "POST" || url.pathname !== "/v1/systemone") return reply(404, { error: "not found" });
      if (mode.requireKey && req.headers.authorization !== `Bearer ${mode.requireKey}`) return reply(401, { error: "unauthorized" });
      if (mode.status !== 200) return reply(mode.status, { error: "nope" });
      if (!validRequest(body)) return reply(422, { error: "invalid request" });
      const only = url.searchParams.get("only"); // a partial local server: answers one question type, leaves the rest out
      const answers = Object.fromEntries(Object.entries(body.questions).filter(([, q]: any) => !only || q.type === only).map(([id, q]) => [id, answer(id, q, body.state, url)]));
      reply(200, { model: url.searchParams.has("only") || url.searchParams.has("wrong") ? "laya-local" : "jev-mock-1", answers, usage: { input_tokens: 10, output_tokens: 1 } });
    });
  });
  await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
  const MOCK = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1/systemone`;

  // ---------- pure mapping: thresholds and the fixed copy ----------
  {
    const noul = (x: number) => ({ type: "noul" as const, noul: x });
    const choice = (c: string, conf: number) => ({ type: "choice" as const, choice: c, confidence: conf, probabilities: { [c]: conf } });
    const all: Answers = { pair: choice("MON/USDC", 0.95), wants_volume: noul(0.6), names_makers: noul(0.9), price_promise: noul(0.99), one_sided: noul(0.7) };
    assert.deepEqual(readRequest(all), {
      flags: [
        { code: "wants_volume", text: "This campaign pays for resting depth inside a band, not volume." },
        { code: "names_makers", text: "Campaigns are open to every maker." },
        { code: "price_promise", text: "Depth rewards don't defend a peg." },
        { code: "one_sided", text: "One-sided quoting earns a third of the score." },
      ],
    });
    assert.deepEqual(readRequest({ ...all, wants_volume: noul(0.59), names_makers: noul(0), price_promise: noul(0.1), one_sided: noul(0.2) }), { flags: [] });
    const ask = { needsPair: { ask: "Which book?", options: ["AUSD/USDC", "MON/USDC"] }, flags: [] };
    assert.deepEqual(readRequest({ pair: choice("MON/USDC", 0.69) }), ask);
    assert.deepEqual(readRequest({ pair: choice("none", 0.99) }), ask);
    assert.deepEqual(readRequest({ pair: choice("AUSD/USDC", 0.7) }), { flags: [] });
    assert.deepEqual(splitSentences("Coverage was 93.9% at 15 bps. Depth: 1,418 USDC! Why? Fine"), ["Coverage was 93.9% at 15 bps.", "Depth: 1,418 USDC!", "Why?", "Fine"]);
    assert.deepEqual(Object.keys(supportQuestions(["a.", "b."])), ["supported_0", "supported_1"]);
    ok("mapping: flags at p >= 0.6 with the exact copy; pair under 0.7 confidence or 'none' -> needsPair 'Which book?'; sentences split, decimals intact");
  }

  // ---------- the client: request shape, key header, failures ----------
  {
    const KEY = "ts-test-key-client-0001";
    upstream.length = 0;
    const ask = systemOne({ url: MOCK, key: KEY, label: "TypeSafe" });
    const j = await judgeRequest("Reward the top 5 makers by fills on MON/USDC", ask);
    assert.deepEqual(j.flags.map((f) => f.code), ["wants_volume", "names_makers"]);
    assert.equal(j.by, "jev-mock-1");
    const sent = upstream[0]!;
    assert.equal(sent.headers.authorization, `Bearer ${KEY}`);
    assert.equal(sent.body.model, "jev-latest");
    assert.deepEqual(sent.body.state, { request: "Reward the top 5 makers by fills on MON/USDC" });
    assert.deepEqual(Object.keys(sent.body.questions), Object.keys(REQUEST_QUESTIONS));
    mode.status = 401;
    await assert.rejects(judgeRequest("x y z", ask), (e: Error) => e instanceof JudgeError && e.message === "TypeSafe rejected the key (401)." && !e.message.includes(KEY));
    mode.status = 529;
    await assert.rejects(judgeRequest("x y z", ask), /TypeSafe is busy \(529\)/);
    mode.status = 200;
    mode.delayMs = 400;
    await assert.rejects(judgeRequest("x y z", systemOne({ url: MOCK, key: KEY, label: "TypeSafe", timeoutMs: 100 })), /did not answer within 0 s|did not answer within/);
    mode.delayMs = 0;
    await assert.rejects(judgeRequest("x y z", systemOne({ url: "http://127.0.0.1:9/v1/systemone" })), /could not be reached/);
    // a server that leaves a question out (or answers it with the wrong type) is not trusted with the rest
    await assert.rejects(judgeRequest("MON", systemOne({ url: `${MOCK}?only=choice` })), /left a question unanswered/);
    ok("client: POST {model: jev-latest, state, questions} with Bearer key; 401/529/timeout/unreachable/missing answers -> JudgeError without the key");
  }

  // ---------- the server route: one fixed upstream, key never logged or echoed ----------
  const ENV_KEY = "ts-test-key-operator-0002", HEADER_KEY = "ts-test-key-sponsor-0003";
  const env: Record<string, string> = { SESSION_SECRET: "judge-test-secret-0123456789abcdefghij", SERVER_AI: "off", TYPESAFE_API_KEY: ENV_KEY };
  const serverLog: string[] = [];
  let clock = Date.now(); // each own-origin request starts a fresh rate-limit window (the 10/min model bucket is not under test here)
  const app = createApp({ src: demoSource(), env, now: () => (clock += 61_000), log: (m) => serverLog.push(m) });
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  const APP = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  const fetched: { url: string; headers: Record<string, string> }[] = [];
  const responses: string[] = [];
  // every request in this process: own-origin paths go to the app, the fixed TypeSafe URL goes to the mock
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    fetched.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()) });
    const to = url.startsWith("/") ? APP + url : url === TYPESAFE_URL ? MOCK : url;
    if (url.startsWith("http://localhost:11434/")) return localModel(init);
    const r = await realFetch(to, init);
    if (url.startsWith("/api/judge")) responses.push(await r.clone().text());
    return r;
  }) as typeof fetch;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    realFetch(`${APP}/api/judge`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then(async (r) => {
      const text = await r.text();
      responses.push(text);
      return { status: r.status, body: JSON.parse(text) };
    });
  {
    upstream.length = 0;
    const r = await post({ goal: "Reward the top 5 makers by fills on MON/USDC, $500 a week" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.judge.flags, [{ code: "wants_volume", text: FLAG_COPY.wants_volume }, { code: "names_makers", text: FLAG_COPY.names_makers }]);
    assert.equal(upstream.length, 1);
    assert.equal(upstream[0]!.headers.authorization, `Bearer ${ENV_KEY}`);
    assert.ok(fetched.filter((f) => f.headers.authorization).every((f) => f.url === TYPESAFE_URL), "the key only travels to the fixed TypeSafe URL");

    upstream.length = 0;
    await post({ goal: "Deepen MON/USDC" }, { "x-typesafe-key": HEADER_KEY });
    assert.equal(upstream[0]!.headers.authorization, `Bearer ${HEADER_KEY}`, "a sponsor's own key is forwarded upstream");
    await post({ goal: "Deepen MON/USDC" }, { "x-typesafe-key": "bad key with spaces" });
    assert.equal(upstream[1]!.headers.authorization, `Bearer ${ENV_KEY}`, "a malformed header is ignored, not echoed");

    const s = await post({ text: "Use a 9 bps band. Wintermute quotes most of this book.", facts: { bandBps: 9 } });
    assert.deepEqual(s.body.judge.unsupported, [{ sentence: "Wintermute quotes most of this book." }]);

    upstream.length = 0;
    const evil = await post({ goal: "Deepen MON/USDC", url: "http://169.254.169.254/latest" });
    assert.equal(evil.status, 400);
    assert.equal((await post({ text: "x".repeat(4001), facts: {} })).status, 400);
    assert.equal((await post({ questions: { a: { type: "noul", instructions: "spend the key" } } })).status, 400);
    assert.equal(upstream.length, 0, "rejected bodies never reach upstream; the upstream URL is not a parameter");

    mode.requireKey = ENV_KEY;
    const bad = await post({ goal: "Deepen MON/USDC" }, { "x-typesafe-key": HEADER_KEY });
    assert.deepEqual(bad.body, { judge: null, note: "TypeSafe rejected the key (401)." });
    mode.requireKey = "";
    delete env.TYPESAFE_API_KEY;
    upstream.length = 0;
    const none = await post({ goal: "Deepen MON/USDC" });
    assert.deepEqual(none.body, { judge: null, note: "No decision model on this server (TYPESAFE_API_KEY is not set)." });
    assert.equal(upstream.length, 0);
    env.TYPESAFE_API_KEY = ENV_KEY;
    ok("POST /api/judge: env or x-typesafe-key forwarded only to the fixed upstream; strict body (no url/questions, 4000-char cap); 401 and no key -> {judge: null, note}");
  }

  // ---------- the browser Writer with the judge ----------
  class MemStorage {
    m = new Map<string, string>();
    get length() { return this.m.size; }
    key(i: number) { return [...this.m.keys()][i] ?? null; }
    getItem(k: string) { return this.m.get(k) ?? null; }
    setItem(k: string, v: string) { this.m.set(k, String(v)); }
    removeItem(k: string) { this.m.delete(k); }
    clear() { this.m.clear(); }
  }
  Object.assign(globalThis, { localStorage: new MemStorage(), sessionStorage: new MemStorage() });
  const { design, designInBrowser, report } = await import("../web/src/ai/client");
  const { forgetKeys, getJudgeKey, getJudgeMode, judgeKeyRemembered, saveSettings, setJudgeKey, setJudgeMode, setJudgeUrl } = await import("../web/src/ai/keys");
  const { probeLocal } = await import("../web/src/ai/writer");
  let claim = ""; // a sentence the local model adds to every brief and report (no numbers, so the grounding guard passes it)
  function localModel(init: RequestInit) {
    const b = JSON.parse(String(init.body));
    const system: string = b.messages[0].content, user: string = b.messages[1].content;
    const f = JSON.parse(user.slice(user.indexOf("{"), user.lastIndexOf("}") + 1) || "{}");
    const content = system.includes("fill in a small form") ? "{}" // intent: nothing usable, rules are used
      : f.recommended ? `Use a ${f.recommended["band bps"]} bps band.${claim}` : `Coverage was ${f["this epoch"]["two sided coverage %"]}%.${claim}`;
    if (b.response_format?.type === "json_schema") return Promise.resolve(new Response("{}", { status: 400 }));
    return Promise.resolve(Response.json({ model: b.model, choices: [{ message: { content } }] }));
  }
  const use = (provider: "none" | "local") => saveSettings({ provider, model: provider === "local" ? "gemma4:e4b-it-qat" : "", baseUrl: provider === "local" ? "http://localhost:11434/v1" : "", remember: false });
  const GOAL = "Reward the top 5 makers by fills on MON/USDC, $500 a week";
  const json = (x: unknown) => JSON.stringify(x);

  {
    // no key: no judge, and exactly the pre-B2 result
    use("none");
    delete env.TYPESAFE_API_KEY;
    const plain = await design(GOAL, () => {});
    assert.ok(!("judge" in plain));
    assert.deepEqual(plain, await designInBrowser(GOAL, null, () => {}));
    const rep = await report("ausd-usdc-demo", 2);
    assert.ok(!("judge" in rep));
    env.TYPESAFE_API_KEY = ENV_KEY;

    // with the judge: flags, and the campaign byte-identical
    upstream.length = 0;
    const judged = await design(GOAL, () => {});
    assert.equal(json(judged.campaign), json(plain.campaign), "the judge cannot change the campaign");
    assert.equal(json(judged.candidates), json(plain.candidates));
    assert.equal(json(judged.recommended), json(plain.recommended));
    assert.equal(judged.brief, plain.brief);
    assert.deepEqual(judged.judge, { flags: [{ code: "wants_volume", text: FLAG_COPY.wants_volume }, { code: "names_makers", text: FLAG_COPY.names_makers }], by: "jev-mock-1" });
    assert.equal(upstream.length, 1, "template brief: only the request is judged, the code-written text is not re-checked");
    ok("Writer: no key -> no `judge` key and the same result as before B2; with Jev -> flags, campaign/candidates/brief byte-identical");
  }
  {
    use("none");
    const vague = await design("Make our book deeper, $100 a day", () => {});
    assert.deepEqual(vague.judge?.needsPair, { ask: "Which book?", options: ["AUSD/USDC", "MON/USDC"] });
    assert.equal(vague.campaign.pair, "AUSD/USDC", "the campaign keeps the rules' default; the UI asks instead of trusting it");
    mode.lowPair = true;
    const unsure = await design("Deepen MON a bit", () => {});
    mode.lowPair = false;
    assert.deepEqual(unsure.judge?.needsPair, { ask: "Which book?", options: ["AUSD/USDC", "MON/USDC"] });
    const sure = await design("Deepen MON/USDC, $50 a day", () => {});
    assert.equal(sure.judge?.needsPair, undefined);
    ok("pair: 'none' or confidence under 0.7 -> needsPair {ask: 'Which book?'}; a confident read asks nothing");
  }
  {
    use("local");
    claim = "";
    const honest = await design(GOAL, () => {});
    assert.equal(honest.ai.briefBy, "model");
    assert.deepEqual(honest.judge?.unsupported, []);
    claim = " Wintermute quotes most of this book.";
    const steps: string[] = [];
    const lied = await design(GOAL, (s) => steps.push(s.step));
    assert.equal(lied.ai.briefBy, "template");
    assert.equal(lied.brief, templateBrief(lied.facts!));
    assert.deepEqual(lied.judge?.unsupported, [{ sentence: "Wintermute quotes most of this book." }]);
    assert.equal(lied.ai.notes.at(-1), "The decision model could not match a sentence to the facts. Used the template instead.");
    assert.equal(json(lied.campaign), json(honest.campaign));
    const rep = await report("ausd-usdc-demo", 2);
    const e2 = JSON.parse(readFileSync("out/demo/ausd-usdc-demo/epoch-2.json", "utf8")), e1 = JSON.parse(readFileSync("out/demo/ausd-usdc-demo/epoch-1.json", "utf8"));
    assert.equal(rep.ai.writtenBy, "template");
    assert.equal(rep.markdown, templateReport(reportFacts(e2, e1)));
    assert.deepEqual(rep.judge, { flags: [], unsupported: [{ sentence: "Wintermute quotes most of this book." }], by: "jev-mock-1" });
    claim = "";
    ok("support: a model sentence the facts don't back (numbers all grounded) switches brief and report to the template and names the sentence");
  }
  {
    // the dialog's Judge choice decides the route; a stored key travels only when "your TypeSafe key" is chosen
    use("none");
    assert.equal(getJudgeMode(), "server", "default: this server's judge, as before the dialog had a Judge section");
    setJudgeKey(HEADER_KEY, false);
    fetched.length = 0;
    upstream.length = 0;
    await design(GOAL, () => {});
    const viaOperator = fetched.filter((f) => f.url === "/api/judge");
    assert.equal(viaOperator.length, 1);
    assert.ok(!("x-typesafe-key" in viaOperator[0]!.headers), "Jev on this server: the browser's key is not sent");
    assert.equal(upstream[0]!.headers.authorization, `Bearer ${ENV_KEY}`);
    setJudgeMode("none");
    fetched.length = 0;
    upstream.length = 0;
    const none = await design(GOAL, () => {});
    assert.ok(!("judge" in none));
    assert.ok(!fetched.some((f) => f.url === "/api/judge" || f.url.includes("systemone")), "None: no judge request at all");
    assert.equal(upstream.length, 0);
    setJudgeMode("key");
    setJudgeKey("", false);
    fetched.length = 0;
    await design(GOAL, () => {});
    assert.ok(!fetched.some((f) => f.url === "/api/judge"), "key chosen but empty: no judge, and the operator's key is not used instead");
    setJudgeKey(HEADER_KEY, true);
    assert.ok(judgeKeyRemembered() && globalThis.localStorage.getItem("sb-judge-key") === HEADER_KEY, "Remember keeps it in localStorage");
    setJudgeKey(HEADER_KEY, false);
    assert.ok(!judgeKeyRemembered() && globalThis.localStorage.getItem("sb-judge-key") === null && getJudgeKey() === HEADER_KEY, "without Remember: sessionStorage only");
    ok("judge choice: default Jev on this server sends no browser key; None sends nothing; an empty key choice sends nothing; Remember -> localStorage");
  }
  {
    // the TypeSafe key typed in the browser goes to this server only as x-typesafe-key, and comes back nowhere
    use("none");
    setJudgeMode("key");
    setJudgeKey(HEADER_KEY, false);
    fetched.length = 0;
    upstream.length = 0;
    await design(GOAL, () => {});
    const own = fetched.filter((f) => f.url === "/api/judge");
    assert.equal(own.length, 1);
    assert.equal(own[0]!.headers["x-typesafe-key"], HEADER_KEY);
    for (const f of fetched.filter((f) => JSON.stringify(f).includes(HEADER_KEY)))
      assert.ok((f.url === "/api/judge" && f.headers["x-typesafe-key"] === HEADER_KEY) || (f.url === TYPESAFE_URL && f.headers.authorization === `Bearer ${HEADER_KEY}`), `key sent to ${f.url}`);
    assert.equal(upstream[0]!.headers.authorization, `Bearer ${HEADER_KEY}`);
    setJudgeKey(HEADER_KEY, true);
    forgetKeys();
    assert.equal(globalThis.sessionStorage.getItem("sb-judge-key"), null);
    assert.equal(globalThis.localStorage.getItem("sb-judge-key"), null);
    for (const k of [ENV_KEY, HEADER_KEY]) {
      assert.ok(!serverLog.some((l) => l.includes(k)), "key in a server log line");
      assert.ok(!responses.some((r) => r.includes(k)), "key in an /api/judge response");
    }
    ok("keys: the browser's TypeSafe key rides only on its own /api/judge call; neither key appears in any server log or /api/judge response");
  }
  {
    // a local System One server, browser-direct with no key; never falls back to this server
    use("none");
    setJudgeMode("local");
    setJudgeUrl(MOCK);
    fetched.length = 0;
    const r = await design(GOAL, () => {});
    assert.deepEqual(r.judge?.flags.map((f) => f.code), ["wants_volume", "names_makers"]);
    assert.ok(!fetched.some((f) => f.url === "/api/judge"), "local URL set: this server's judge is not called");
    assert.ok(fetched.filter((f) => f.url.startsWith(MOCK)).every((f) => !f.headers.authorization), "no key to the local server");
    assert.deepEqual(await probeLocal(MOCK), ["choice", "noul"]);
    // a server that answers only Choice: only the pair is asked, nothing else is claimed
    const partial = `${MOCK}?only=choice`;
    assert.deepEqual(await probeLocal(partial), ["choice"]);
    setJudgeUrl(partial);
    fetched.length = 0;
    const p = await design("Make our book deeper, $100 a day", () => {});
    assert.deepEqual(p.judge, { flags: [], needsPair: { ask: "Which book?", options: ["AUSD/USDC", "MON/USDC"] }, by: "laya-local" });
    const asked = fetched.filter((f) => f.url === partial).length;
    assert.equal(asked, 1, "the request only (the probe was cached)");
    // a server that always picks the first option and always says yes, and one that is not running
    assert.deepEqual(await probeLocal(`${MOCK}?wrong=1`), []);
    setJudgeUrl("http://127.0.0.1:9/v1/systemone");
    fetched.length = 0;
    const dead = await design(GOAL, () => {});
    assert.ok(!("judge" in dead));
    assert.ok(!fetched.some((f) => f.url === "/api/judge"));
    setJudgeUrl("");
    fetched.length = 0;
    assert.ok(!("judge" in (await design(GOAL, () => {}))) && !fetched.some((f) => f.url === "/api/judge"), "local chosen but no URL: no judge, no server fallback");
    setJudgeMode("server");
    ok("local System One: browser-direct, no key, no server fallback; probe claims only the types answered right (choice+noul, choice only, none)");
  }
  globalThis.fetch = realFetch;
  app.close();
  mock.close();
  assert.equal(fixture.requests.length, 12);
  console.log(`\n${n} judge tests passed`);
}

// ---------------- live: the 12-request fixture against the real Jev, once ----------------
async function live() {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("JUDGE_LIVE=1 needs TYPESAFE_API_KEY in the environment.");
  const ask = systemOne({ url: TYPESAFE_URL, key, label: "TypeSafe", timeoutMs: 20_000 });
  const codes = Object.keys(FLAG_COPY);
  let right = 0, total = 0, exact = 0, model = "";
  const ms: number[] = [];
  const rows: string[] = [];
  for (const r of fixture.requests) {
    const t0 = performance.now();
    const raw = await ask({ request: r.request }, REQUEST_QUESTIONS);
    ms.push(performance.now() - t0);
    model = raw.model;
    const j = readRequest(raw.answers);
    const pairOk = r.pair === "ask" ? !!j.needsPair : !j.needsPair && (raw.answers.pair as { choice: string }).choice === r.pair;
    const flagOk = codes.map((c) => j.flags.some((f) => f.code === c) === r.flags.includes(c));
    right += Number(pairOk) + flagOk.filter(Boolean).length;
    total += 1 + codes.length;
    if (pairOk && flagOk.every(Boolean)) exact++;
    const p = (c: string) => (raw.answers[c] as { noul: number }).noul.toFixed(2);
    const pa = raw.answers.pair as { choice: string; confidence: number };
    rows.push(`| ${r.request} | ${pa.choice} @ ${pa.confidence} | ${codes.map(p).join(" / ")} | ${r.pair}; ${r.flags.join(", ") || "none"} | ${pairOk && flagOk.every(Boolean) ? "yes" : "no"} |`);
  }
  ms.sort((a, b) => a - b);
  console.log(`model ${model}; ${right}/${total} judgments right; ${exact}/12 requests fully right; latency per request: median ${Math.round(ms[6]!)} ms, max ${Math.round(ms[11]!)} ms`);
  console.log(`| request | pair (choice @ confidence) | ${codes.join(" / ")} | expected | all right |\n|---|---|---|---|---|\n${rows.join("\n")}`);

  // the per-sentence check on code-written templates (every number from the facts) and on invented claims
  const { designCampaign } = await import("../src/ai/pipeline");
  const d = await designCampaign(fixture.requests[0]!.request, demoSource(), null);
  const e2 = JSON.parse(readFileSync("out/demo/ausd-usdc-demo/epoch-2.json", "utf8")), e1 = JSON.parse(readFileSync("out/demo/ausd-usdc-demo/epoch-1.json", "utf8"));
  const invented = ["Wintermute quotes most of this book today.", "Coverage doubled compared with last month.", "This band will attract at least ten new makers within a day.", "Makers left because the maker fee went up last week."];
  for (const [name, facts, template] of [["brief", d.facts, templateBrief(d.facts)], ["report", reportFacts(e2, e1), templateReport(reportFacts(e2, e1))]] as const) {
    const t0 = performance.now();
    const j = await judgeSupport(`${template} ${invented.join(" ")}`, facts, ask);
    const flagged = new Set(j.unsupported!.map((u) => u.sentence));
    const tpl = splitSentences(template);
    console.log(`${name}: ${Math.round(performance.now() - t0)} ms for ${tpl.length + invented.length} sentences; invented flagged ${invented.filter((s) => flagged.has(s)).length}/${invented.length}; template sentences flagged ${tpl.filter((s) => flagged.has(s)).length}/${tpl.length}${tpl.filter((s) => flagged.has(s)).map((s) => `\n  flagged template sentence: ${s}`).join("")}`);
  }
  // probe the live API as if it were a local server: what it answers correctly
  console.log(`probeTypes against Jev: ${JSON.stringify(await probeTypes(ask))}`);
}
