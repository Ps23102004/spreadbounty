/**
 * AI harness tests, no API key needed: a mock OpenAI-compatible server plays a weak local model
 * (Gemma / MiniCPM / Qwen / Llama-class behaviour: no JSON-schema mode, JSON wrapped in prose,
 * invented numbers) and the pipeline must still produce correct, grounded output.
 *   npm run test:ai   (needs demo data: npm run demo:gen)
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { checkGrounding, paymentClaims, textNumbers } from "../src/ai/grounding";
import { anthropicMessages, openaiCompatible } from "../src/ai/http";
import { extractJson } from "../src/ai/llm";
import { designCampaign, IntentSchema, ruleIntent } from "../src/ai/pipeline";
import { factsPrompt, INTENT_SYSTEM, requestNumbers } from "../src/ai/prompts";
import { reportFacts, templateReport, writeEpochReport } from "../src/ai/report";
import { demoSource } from "../src/data/source";
import { readFileSync } from "node:fs";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok  ${m}`); };

// ---------- grounding ----------
const facts = { coverage: 93.9, depth: 1418, cost: 70.52, budget: 100, band: 25, nested: [{ share: "42.8" }] };
assert.ok(checkGrounding("Coverage 93.9%, about 1,418 USDC deep, $70.52 per $1k, 25 bps, top maker 42.8%.", facts).ok);
assert.ok(checkGrounding("Coverage was 94% with 1.4k USDC of depth.", facts).ok); // rounding to shown precision is fine
const bad = checkGrounding("Coverage was 97.5% and 3,200 USDC deep.", facts);
assert.deepEqual(bad.ungrounded, ["97.5", "3,200"]);
assert.ok(checkGrounding("Pay 2 makers over 3 epochs from 0xdeadbeef1234 at block `111990000`.", facts).ok); // small counts, hex, code spans ignored
assert.deepEqual(textNumbers("5.1k and $2,500.25").map((x) => x.value), [5100, 2500.25]);
// "per $1k" is a unit, not a claim; it must pass even when no fact is anywhere near 1000 (regression)
assert.ok(checkGrounding("That is 1.14 USDC per $1k of depth, or 2.5 per 1,000.", { cost: 1.14, other: 2.5 }).ok);
assert.deepEqual(checkGrounding("About $1k of extra depth.", { cost: 1.14 }).ungrounded, ["$1k"]); // a bare $1k is still a claim
ok("grounding: accepts fact numbers and honest rounding, flags invented ones, ignores counts/hex/code/unit phrases");

// ---------- field names copied into prose (judge finding: "achieved 100 twoSidedCoveragePct" got the green badge) ----------
{
  const f = { twoSidedCoveragePct: 100, bandBps: 25 };
  const leak = checkGrounding("The book achieved 100 twoSidedCoveragePct at 25 bps.", f);
  assert.equal(leak.ok, false);
  assert.deepEqual(leak.ungrounded, []); // every number is right: only the identifier fails it
  assert.deepEqual(leak.words, ["twoSidedCoveragePct"]);
  assert.deepEqual(checkGrounding("Coverage hit 100twoSidedCoveragePct.", f).words, ["twoSidedCoveragePct"]); // glued to a number
  assert.deepEqual(checkGrounding("Coverage was 100%; see avgDepthQuote.", f).words, ["avgDepthQuote"]); // camelCase that is no fact key
  assert.ok(checkGrounding("Coverage was 100% within 25 bps, even on iOS and macOS.", f).ok);
  ok("grounding: rejects camelCase field names (fact keys or identifier-shaped tokens), allows plain prose");
}

// ---------- the sponsor's own numbers are not invented; numbers from nowhere still are ----------
{
  const goal = "Deepen MON/USDC within 0.25%, about $700 a week";
  const allowed = requestNumbers(goal, ruleIntent(goal));
  const f = { bandBps: 25, budgetPerDayUsdc: 100 };
  assert.deepEqual(checkGrounding("Keep MON/USDC within 0.25% as you asked, with a 25 bps band.", f).ungrounded, ["0.25"]); // the old false positive
  assert.ok(checkGrounding("Keep MON/USDC within 0.25% as you asked, with a 25 bps band and $700 a week.", f, allowed).ok);
  assert.deepEqual(checkGrounding("Keep MON/USDC within 0.4%, with a 25 bps band.", f, allowed).ungrounded, ["0.4"]);
  assert.deepEqual(checkGrounding("Expect 97.5% coverage.", f, allowed).ungrounded, ["97.5"]);
  ok("grounding: numbers in the sponsor's sentence or the parsed form pass; numbers in neither are still rejected");
}

// ---------- shadow campaigns: nobody was paid ----------
{
  const sf = { shadow: true, rewardsUsdc: 10 };
  assert.deepEqual(checkGrounding("1 maker was paid 10 USDC and took the whole budget.", sf).words, ["paid", "took"]);
  assert.ok(checkGrounding("Nobody was paid. 1 maker would have taken 10 USDC; makers would have shared it.", sf).ok);
  assert.ok(checkGrounding("1 maker took 10 USDC.", { ...sf, shadow: false }).ok); // a real campaign may say it
  const s2 = JSON.parse(readFileSync("data/shadow/mon-usdc-shadow-112650356/epoch-2.json", "utf8"));
  const s1 = JSON.parse(readFileSync("data/shadow/mon-usdc-shadow-112650356/epoch-1.json", "utf8"));
  const shadow = templateReport(reportFacts(s2, s1, true));
  assert.match(shadow, /^Shadow campaign: nobody was paid\. /);
  assert.match(shadow, / 1 maker would have received [\d.]+ of the [\d.]+ USDC budget/);
  assert.match(shadow, /the largest maker would have taken 100%/);
  assert.deepEqual(paymentClaims(shadow), []);
  assert.ok(!/\bmakers shared\b|\btook\b/.test(shadow));
  const real = templateReport(reportFacts(s2, s1, false));
  assert.match(real, / 1 maker received [\d.]+ of the/); // singular: never "1 makers shared"
  assert.ok(!real.includes("1 makers"));
  assert.equal(reportFacts(s2, s1).shadow, false, "the epoch file alone does not carry the flag; callers pass it");
  ok("report template: shadow says 'nobody was paid' and 'would have received/taken'; one maker reads '1 maker'");
}

// ---------- the facts a model sees use plain words, not field names ----------
{
  const prompt = factsPrompt({ thisEpoch: { twoSidedCoveragePct: 93.9, costPer1kDepthUsdc: 1.14 }, history: { twoSidedPctWithin15Bps: 80 } }, null);
  assert.equal(prompt, 'Facts (JSON):\n{"this epoch":{"two sided coverage %":93.9,"cost per 1k depth USDC":1.14},"history":{"two sided % within 15 bps":80}}');
  ok("factsPrompt: keys become plain words (two sided coverage %, cost per 1k depth USDC)");
}

// ---------- JSON extraction from chatty small-model replies ----------
assert.deepEqual(extractJson('Sure! Here it is:\n```json\n{"a": 1, "b": "x}"}\n```\nHope that helps'), { a: 1, b: "x}" });
assert.deepEqual(extractJson('The answer is {"pair": null, "n": {"k": 2}} done'), { pair: null, n: { k: 2 } });
assert.equal(extractJson("no json here"), null);
ok("extractJson: code fences, prose around JSON, braces inside strings");

// ---------- rules intent ----------
assert.equal(ruleIntent("Deepen MON/USDC, about $700 a week").budgetPerDay, 100);
assert.equal(ruleIntent("ausd within 0.2%").bandBps, 20);
assert.equal(ruleIntent("AUSD/USDC 15 bps hourly").epochMinutes, 60);
assert.equal(ruleIntent("Deepen the MON book").budgetPerDay, null);
assert.equal(ruleIntent("Deepen the MON book").summary, "Deepen the MON book. Budget: 50/day (default, not in your sentence).");
assert.ok(!ruleIntent("Deepen MON/USDC, about $700 a week").summary.includes("default"));
ok("ruleIntent: weekly/monthly budgets, % and bps bands, hourly epochs; a missing budget is called a default in the summary");
{
  const details: string[] = [];
  await designCampaign("Deepen the MON book", demoSource(), null, (s) => s.step === "intent" && s.status === "done" && details.push(s.detail!));
  assert.equal(JSON.parse(details[0]!).budgetDefault, true);
  await designCampaign("Deepen the MON book, $50/day", demoSource(), null, (s) => s.step === "intent" && s.status === "done" && details.push(s.detail!));
  assert.equal(JSON.parse(details[1]!).budgetDefault, undefined);
  ok("pipeline: the intent step marks a default budget (budgetDefault) so the tape need not present 50/day as read");
}

// ---------- (a) an intent read elsewhere (the browser) drives the same backtest as the rules-only path ----------
{
  const s0 = demoSource();
  for (const g of ["Agora wants AUSD/USDC tight around 1.0, $50/day, hourly epochs", "Deepen MON/USDC within 0.25%, about $700 a week", "Keep AUSD two-sided within 10 bps, $30 a day"]) {
    const injected = await designCampaign(g, s0, null, undefined, { intent: ruleIntent(g), brief: "none" });
    const rules = await designCampaign(g, s0, null);
    assert.deepEqual(injected.campaign, rules.campaign);
    assert.deepEqual(injected.candidates, rules.candidates);
    assert.equal(injected.ai.intentBy, "client");
    assert.deepEqual(injected.facts, rules.facts);
  }
  ok("designCampaign with an injected intent and brief none = rules-only campaign, candidates and facts (3 examples)");
}

// ---------- (c) anthropicMessages: browser headers, plain retry for older models, canned replies parsed ----------
{
  const sent: { headers: Record<string, string>; body: any }[] = [];
  const replies = [
    new Response('{"type":"error","error":{"type":"invalid_request_error","message":"effort not supported"}}', { status: 400 }),
    Response.json({ model: "claude-x", stop_reason: "end_turn", content: [{ type: "text", text: 'Here you go: {"pair":"AUSD/USDC","bandBps":15,"budgetPerDay":null,"epochMinutes":null,"refPrice":1,"summary":"tight AUSD"}' }] }),
    Response.json({ model: "claude-x", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "ready" }] }),
    Response.json({ model: "claude-x", stop_reason: "refusal", content: [] }),
  ];
  const fake = async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    sent.push({ headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(String(init.body)) });
    return replies.shift()!;
  };
  const a = anthropicMessages({ key: "test-key-0004", model: "claude-opus-5-5", fetchImpl: fake });
  assert.deepEqual(await a.json(IntentSchema, INTENT_SYSTEM, "AUSD 15 bps"), { pair: "AUSD/USDC", bandBps: 15, budgetPerDay: null, epochMinutes: null, refPrice: 1, summary: "tight AUSD" });
  for (const h of sent.map((x) => x.headers)) {
    assert.equal(h["x-api-key"], "test-key-0004");
    assert.equal(h["anthropic-version"], "2023-06-01");
    assert.equal(h["anthropic-dangerous-direct-browser-access"], "true");
  }
  assert.equal(sent[0]!.body.output_config.effort, "low");
  assert.equal(sent[0]!.body.output_config.format.type, "json_schema");
  assert.equal(sent[1]!.body.output_config, undefined); // after a 400: the same request, plain
  assert.equal(await a.text("s", "u"), "ready");
  assert.equal(await a.text("s", "u"), null); // refusal -> null -> caller uses rules / template
  ok("anthropicMessages: x-api-key + anthropic-version + direct-browser-access on every call; 400 -> plain retry; JSON parsed; refusal -> null");
}

// ---------- mock weak local model ----------
type Mode = "good" | "liar" | "fixes-on-retry" | "echo-request" | "leak" | "paid";
let mode: Mode = "fixes-on-retry";
let calls: { body: any }[] = [];
const factsSeen: any[] = [];
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  calls.push({ body });
  const reply = (content: string) => res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  if (body.response_format?.type === "json_schema") { res.statusCode = 400; return res.end('{"error":"response_format json_schema not supported"}'); }
  const sys: string = body.messages[0].content;
  if (sys.includes("fill in a small form")) return reply('Okay! ```json\n{"pair":"AUSD/USDC","bandBps":15,"budgetPerDay":null,"epochMinutes":60,"refPrice":1,"summary":"Keep AUSD tight"}\n```');
  const user: string = body.messages[1].content;
  const retry = user.includes("must not appear");
  if (mode === "liar" || (mode === "fixes-on-retry" && !retry)) return reply("<think>hmm</think>Coverage would be 97.5% with 12,345 USDC of depth.");
  // a grounded answer: quote numbers straight from the facts
  const f = JSON.parse(user.slice(user.indexOf("{"), user.lastIndexOf("}") + 1));
  factsSeen.push(f);
  const rec = f.recommended ?? f["this epoch"];
  if (mode === "echo-request") return reply(`Keep the book within 0.25% as you asked: a ${rec["band bps"]} bps band.`);
  if (mode === "leak") return reply(`The book achieved ${rec["two sided coverage %"]} twoSidedCoveragePct.`);
  if (mode === "paid") return reply(`${rec["makers rewarded"]} maker was paid ${rec["rewards USDC"]} USDC.`);
  return reply(f.recommended ? `Use a ${rec["band bps"]} bps band; history shows ${rec["two sided coverage %"]}% two-sided coverage.` : `Coverage was ${rec["two sided coverage %"]}% with ${rec["average two sided depth USDC"]} USDC of depth.`);
});
await new Promise<void>((r) => server.listen(0, r));
process.env.AI_PROVIDER = "local";
process.env.LOCAL_LLM_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
process.env.LOCAL_LLM_MODEL = "gemma3:4b";
const { getLLM } = await import("../src/ai/llm");
const llm = getLLM()!;
const src = demoSource();

const r1 = await designCampaign("Agora wants AUSD/USDC tight around 1.0, $50/day", src, llm);
assert.equal(r1.ai.intentBy, "model");
assert.equal(r1.intent.budgetPerDay, 50); // the literal "$50/day" read by rules beats the model's null
assert.ok(calls.some((c) => c.body.response_format?.type === "json_object")); // fell back from json_schema to json_object
assert.equal(r1.ai.briefBy, "model");
assert.equal(r1.ai.groundingAttempts.length, 2);
assert.deepEqual(r1.ai.groundingAttempts[0]!.ungrounded, ["97.5", "12,345"]);
assert.ok(!r1.brief.includes("<think>"));
ok("local model: json_schema rejected -> json_object, fenced JSON parsed, invented numbers caught, retry accepted");

mode = "liar";
const r2 = await designCampaign("AUSD/USDC, 15 bps, $50/day", src, llm);
assert.equal(r2.ai.briefBy, "template");
assert.ok(!r2.brief.includes("97.5"));
ok("local model that keeps inventing numbers -> template brief, nothing invented reaches the sponsor");

const e2 = JSON.parse(readFileSync("out/demo/ausd-usdc-demo/epoch-2.json", "utf8"));
const e1 = JSON.parse(readFileSync("out/demo/ausd-usdc-demo/epoch-1.json", "utf8"));
mode = "good";
const rep = await writeEpochReport(e2, e1, llm);
assert.equal(rep.ai.writtenBy, "model");
assert.ok(checkGrounding(rep.markdown, rep.facts).ok);
const keysOf = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
assert.ok(keysOf(factsSeen.at(-1)).every((k) => !/[a-z][A-Z]/.test(k)), "the model saw no camelCase field names");
ok("report: grounded model text accepted; the facts it saw had plain-word keys");

mode = "leak";
const leaked = await writeEpochReport(e2, e1, llm);
assert.equal(leaked.ai.writtenBy, "template");
assert.equal(leaked.ai.groundingAttempts.length, 2);
assert.ok(leaked.ai.groundingAttempts[0]!.ungrounded.includes("twoSidedCoveragePct"));
assert.ok(calls.at(-1)!.body.messages[1].content.includes("Do not write twoSidedCoveragePct"), "the retry names the field");
ok("report: a model that copies a field name into prose fails twice -> template, no green badge");

{
  const s2 = JSON.parse(readFileSync("data/shadow/mon-usdc-shadow-112650356/epoch-2.json", "utf8"));
  const s1 = JSON.parse(readFileSync("data/shadow/mon-usdc-shadow-112650356/epoch-1.json", "utf8"));
  mode = "paid";
  assert.equal((await writeEpochReport(s2, s1, llm, false)).ai.writtenBy, "model"); // "was paid" is true of a real campaign
  const sh = await writeEpochReport(s2, s1, llm, true);
  assert.equal(sh.ai.writtenBy, "template");
  assert.deepEqual(sh.ai.groundingAttempts.map((a) => a.ungrounded), [["paid"], ["paid"]]);
  assert.equal(factsSeen.at(-1).shadow, true, "the model is told it is a shadow campaign");
  assert.match(sh.markdown, /^Shadow campaign: nobody was paid\./);
  mode = "good";
  ok("shadow report: model text saying a maker was paid is rejected -> 'nobody was paid' template");
}

{
  mode = "echo-request";
  const echo = await designCampaign("Deepen MON/USDC within 0.25%, about $700 a week", src, llm);
  assert.equal(echo.ai.briefBy, "model");
  assert.match(echo.brief, /within 0\.25% as you asked/);
  mode = "good";
  ok("pipeline brief: repeating the sponsor's own 0.25% passes the grounding guard");
}

{
  // (b) the shared adapter on its own: schema-valid JSON out of a prose-wrapped reply, after json_schema is refused
  const o = openaiCompatible({ baseUrl: process.env.LOCAL_LLM_URL!, model: "gemma3:4b" });
  const intent = await o.json(IntentSchema, INTENT_SYSTEM, "Keep AUSD tight");
  assert.ok(IntentSchema.safeParse(intent).success);
  assert.equal(intent!.bandBps, 15);
  ok("openaiCompatible: schema-valid JSON from a prose-wrapped reply (json_schema refused -> json_object)");
}

server.close();
process.env.LOCAL_LLM_URL = "http://127.0.0.1:9/v1"; // nothing listening
const { getLLM: getLLM2 } = await import("../src/ai/llm");
const down = getLLM2()!;
const r3 = await designCampaign("AUSD/USDC, 15 bps, $50/day", src, down);
assert.equal(r3.ai.intentBy, "rules");
assert.equal(r3.ai.briefBy, "template");
assert.equal(r3.recommended.bandBps, 15);
ok("model server down -> rules + template, same recommendation");

console.log(`\n${n} tests passed`);

await import("./byo.test"); // bring-your-own-model suite (browser Writer), kept in test:ai so test:all runs it
