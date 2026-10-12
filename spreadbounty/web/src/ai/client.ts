/**
 * The Writer, run in the browser. Same pipeline as the server, with the model calls made from this tab:
 *   1. read the request    readIntent() with the browser's model (rules win on explicit numbers)
 *   2. backtest            POST /api/copilot { goal, intent, brief: "none" }: the server's code, no model, no key
 *   3. write the brief     narrate() over the facts the server returned
 *   4. grounding guard     inside narrate(): src/ai/grounding.ts, the same check the server runs
 * Epoch reports never touch the server's model: the browser downloads the epoch files and runs writeEpochReport.
 * The decision model (B2, ./writer.ts) runs beside both: it reads the sponsor's sentence in parallel with the pipeline,
 * and checks every sentence a model wrote against its facts. It adds `judge` and can swap model text for the template;
 * it never changes the campaign, the candidates or any number (test/judge.test.ts).
 * Requests to this app's own origin carry no key header; keys only go to the chosen provider (test/byo.test.ts).
 * Import it statically: the model code (adapters, prompts, zod) is loaded on first use, outside the main chunk.
 */
import type { LLM } from "../../../src/ai/http";
import type { Judge } from "../../../src/ai/judge";
import type { BriefFacts } from "../../../src/ai/prompts";
import type { reportFacts } from "../../../src/ai/report";
import { api, type DesignResult, type EpochFile, type Report, type Step } from "../api";
import { getKey, loadSettings } from "./keys";
import { buildLLM } from "./providers";

/** Where the words came from, plus any per-step fallback messages ("Anthropic rejected the key (401). Used rules instead."). */
type Where = { where: "browser" | "server"; notes: string[] };
/** `judge` is absent when no decision model answered: the result is then exactly what it was before B2. */
export type WriterDesign = DesignResult & { facts?: BriefFacts; ai: DesignResult["ai"] & Where; judge?: Judge };
export type WriterReport = Report & { facts?: ReturnType<typeof reportFacts>; ai: Report["ai"] & Where; judge?: Judge };
export type { Judge };
export type StepNote = Step & { note?: string };

/** The Writer picked in the model dialog. `llm` is null for None (rules and templates) and for This server. */
export async function currentWriter() {
  const settings = loadSettings();
  return { settings, llm: await buildLLM(settings, getKey(settings.provider)) };
}

/** Design page entry point: replaces api.copilot. */
export async function design(goal: string, onStep: (s: StepNote) => void, signal?: AbortSignal): Promise<WriterDesign> {
  const { settings, llm } = await currentWriter();
  const asked = judge().then((w) => w.judgeGoal(goal, signal)).catch(() => null); // in parallel with the whole pipeline
  let r: WriterDesign;
  if (settings.provider === "server") {
    const s = await api.copilot(goal, onStep, signal);
    r = { ...s, ai: { ...s.ai, where: "server", notes: [] } };
  } else r = await designInBrowser(goal, llm, onStep, signal);
  const facts = r.facts;
  const check = r.ai.briefBy === "model" && facts ? await checkText(r.brief, facts, signal) : null;
  if (check?.unsupported?.length && facts) {
    const { templateBrief } = await import("../../../src/ai/prompts");
    r = { ...r, brief: templateBrief(facts), ai: { ...r.ai, briefBy: "template", notes: [...r.ai.notes, UNSUPPORTED] } };
  }
  return withJudge(r, await asked, check);
}

/** A shadow campaign (`shadow: true` on its campaign row) paid nobody; the epoch files themselves don't say so. */
const isShadow = (campaignId: string) =>
  api.campaigns().then((cs) => (cs.find((c) => c.id === campaignId) as { shadow?: boolean } | undefined)?.shadow === true);

/** Overview's epoch report entry point: replaces api.report. */
export async function report(campaignId: string, n: number): Promise<WriterReport> {
  const [{ settings, llm }, shadow] = await Promise.all([currentWriter(), isShadow(campaignId)]);
  let r: WriterReport;
  if (settings.provider === "server") {
    const s = await api.report(campaignId, n);
    r = { ...s, ai: { ...s.ai, where: "server", notes: [] } };
    if (shadow && r.facts && !r.facts.shadow) {
      // a server that does not pass the shadow flag writes "paid": replace its words with the shadow template
      const { templateReport } = await import("../../../src/ai/report");
      const facts = { ...r.facts, shadow: true };
      r = { ...r, facts, markdown: templateReport(facts), ai: { ...r.ai, writtenBy: "template", notes: [...r.ai.notes, "This server wrote the report as if makers were paid. Used the shadow template instead."] } };
    }
  } else {
    const [epoch, prev] = await Promise.all([api.epoch(campaignId, n), n > 0 ? api.epoch(campaignId, n - 1).catch(() => null) : null]);
    r = await reportInBrowser(epoch, prev, llm, shadow);
  }
  const facts = r.facts;
  const check = r.ai.writtenBy === "model" && facts ? await checkText(r.markdown, facts) : null;
  if (check?.unsupported?.length && facts) {
    const { templateReport } = await import("../../../src/ai/report");
    r = { ...r, markdown: templateReport(facts), ai: { ...r.ai, writtenBy: "template", notes: [...r.ai.notes, UNSUPPORTED] } };
  }
  return withJudge(r, null, check);
}

// ---------------- the decision model (B2) ----------------
const judge = () => import("./writer");
const UNSUPPORTED = "The decision model could not match a sentence to the facts. Used the template instead.";
const checkText = (text: string, facts: object, signal?: AbortSignal) => judge().then((w) => w.judgeText(text, facts, signal)).catch(() => null);

/** Adds `judge` only when a decision model answered; otherwise the result is returned untouched. */
function withJudge<T extends object>(r: T, asked: Judge | null, check: Judge | null): T & { judge?: Judge } {
  if (!asked && !check) return r;
  return { ...r, judge: { flags: asked?.flags ?? [], ...(asked?.needsPair ? { needsPair: asked.needsPair } : {}), ...(check ? { unsupported: check.unsupported ?? [] } : {}), by: asked?.by ?? check?.by } };
}

export async function reportInBrowser(epoch: EpochFile, prev: EpochFile | null, llm: LLM | null, shadow = false): Promise<WriterReport> {
  const { writeEpochReport } = await import("../../../src/ai/report");
  const r = await writeEpochReport(epoch, prev, llm, shadow);
  return { markdown: r.markdown, root: r.root, facts: r.facts, ai: { ...r.ai, where: "browser", notes: r.ai.error ? [`${r.ai.error} Used the template instead.`] : [] } };
}

export async function designInBrowser(goal: string, llm: LLM | null, onStep: (s: StepNote) => void, signal?: AbortSignal): Promise<WriterDesign> {
  const { BRIEF_SYSTEM, narrate, readIntent, requestNumbers, templateBrief } = await import("../../../src/ai/prompts");
  const who = llm ? `${llm.model} in your browser` : "rules";
  const notes: string[] = [];
  onStep({ step: "intent", status: "running", detail: llm ? `asking ${who}` : who });
  const read = await readIntent(goal, llm);
  if (read.error) notes.push(`${read.error} Used rules instead.`);
  // the tape's "request read by" line takes the last running detail: name who actually read it (rules after a 401)
  if (llm) onStep({ step: "intent", status: "running", detail: read.by === "model" ? who : "rules" });

  const server = await postCopilot({ goal, intent: read.intent, brief: "none" }, signal, (s) => {
    if (s.step === "brief" || (s.step === "intent" && s.status === "running")) return; // this tab owns both model steps
    onStep(s.step === "intent" && notes[0] ? { ...s, note: notes[0] } : s);
  });
  if (!server.facts) throw new Error("This server is too old for in-browser writing (no facts in the copilot reply).");

  onStep({ step: "brief", status: "running", detail: llm ? `asking ${who}` : who });
  const b = await narrate(llm, BRIEF_SYSTEM, server.facts, templateBrief(server.facts), requestNumbers(goal, read.intent));
  if (b.error) notes.push(`${b.error} Used the template instead.`);
  onStep({
    step: "brief", status: "done",
    detail: b.by === "model" ? `written by ${who}, every number checked` : b.attempts.length ? "model numbers failed the check: used template" : "template",
    ...(b.error ? { note: notes[notes.length - 1] } : {}),
  });
  return {
    ...server, intent: read.intent, intentBy: read.by, brief: b.text,
    ai: { provider: llm?.provider ?? "off", model: llm?.model ?? null, intentBy: read.by, briefBy: b.by, groundingAttempts: b.attempts, where: "browser", notes },
  };
}

/** POST to this app's own origin: JSON body, content-type only. It never sees a key. */
async function postCopilot(body: object, signal: AbortSignal | undefined, onStep: (s: StepNote) => void): Promise<WriterDesign> {
  const r = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `copilot failed (${r.status})`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", result: WriterDesign | null = null;
  for (;;) {
    const { done, value } = await reader.read(); // read to the end so the request completes cleanly
    buf += dec.decode(value, { stream: !done });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === "step") onStep(msg as StepNote);
      else if (msg.type === "result") result = msg as WriterDesign;
      else if (msg.type === "error") throw new Error(msg.error);
    }
    if (done) {
      if (result) return result;
      throw new Error("copilot stream ended without a result");
    }
  }
}
