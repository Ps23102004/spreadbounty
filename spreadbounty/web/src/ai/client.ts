/**
 * The Writer, run in the browser. Same pipeline as the server, with the model calls made from this tab:
 *   1. read the request    readIntent() with the browser's model (rules win on explicit numbers)
 *   2. backtest            POST /api/copilot { goal, intent, brief: "none" }: the server's code, no model, no key
 *   3. write the brief     narrate() over the facts the server returned
 *   4. grounding guard     inside narrate(): src/ai/grounding.ts, the same check the server runs
 * Epoch reports never touch the server's model: the browser downloads the epoch files and runs writeEpochReport.
 * Requests to this app's own origin carry no key header; keys only go to the chosen provider (test/byo.test.ts).
 */
import { BRIEF_SYSTEM, narrate, readIntent, templateBrief, type BriefFacts } from "../../../src/ai/prompts";
import type { LLM } from "../../../src/ai/http";
import { writeEpochReport } from "../../../src/ai/report";
import { api, type DesignResult, type EpochFile, type Report, type Step } from "../api";
import { getKey, loadSettings } from "./keys";
import { buildLLM } from "./providers";

/** Where the words came from, plus any per-step fallback messages ("Anthropic rejected the key (401). Used rules instead."). */
type Where = { where: "browser" | "server"; notes: string[] };
export type WriterDesign = DesignResult & { facts?: BriefFacts; ai: DesignResult["ai"] & Where };
export type WriterReport = Report & { ai: Report["ai"] & Where };
export type StepNote = Step & { note?: string };

/** The Writer picked in the model dialog. `llm` is null for None (rules and templates) and for This server. */
export function currentWriter() {
  const settings = loadSettings();
  return { settings, llm: buildLLM(settings, getKey(settings.provider)) };
}

/** Design page entry point: replaces api.copilot. */
export async function design(goal: string, onStep: (s: StepNote) => void, signal?: AbortSignal): Promise<WriterDesign> {
  const { settings, llm } = currentWriter();
  if (settings.provider === "server") {
    const r = await api.copilot(goal, onStep, signal);
    return { ...r, ai: { ...r.ai, where: "server", notes: [] } };
  }
  return designInBrowser(goal, llm, onStep, signal);
}

/** Overview's epoch report entry point: replaces api.report. */
export async function report(campaignId: string, n: number): Promise<WriterReport> {
  const { settings, llm } = currentWriter();
  if (settings.provider === "server") {
    const r = await api.report(campaignId, n);
    return { ...r, ai: { ...r.ai, where: "server", notes: [] } };
  }
  const [epoch, prev] = await Promise.all([api.epoch(campaignId, n), n > 0 ? api.epoch(campaignId, n - 1).catch(() => null) : null]);
  return reportInBrowser(epoch, prev, llm);
}

export async function reportInBrowser(epoch: EpochFile, prev: EpochFile | null, llm: LLM | null): Promise<WriterReport> {
  const r = await writeEpochReport(epoch, prev, llm);
  return { markdown: r.markdown, root: r.root, ai: { ...r.ai, where: "browser", notes: r.ai.error ? [`${r.ai.error} Used the template instead.`] : [] } };
}

export async function designInBrowser(goal: string, llm: LLM | null, onStep: (s: StepNote) => void, signal?: AbortSignal): Promise<WriterDesign> {
  const who = llm ? `${llm.model} in your browser` : "rules";
  const notes: string[] = [];
  onStep({ step: "intent", status: "running", detail: who });
  const read = await readIntent(goal, llm);
  if (read.error) notes.push(`${read.error} Used rules instead.`);

  const server = await postCopilot({ goal, intent: read.intent, brief: "none" }, signal, (s) => {
    if (s.step === "brief" || (s.step === "intent" && s.status === "running")) return; // this tab owns both model steps
    onStep(s.step === "intent" && notes[0] ? { ...s, note: notes[0] } : s);
  });
  if (!server.facts) throw new Error("This server is too old for in-browser writing (no facts in the copilot reply).");

  onStep({ step: "brief", status: "running", detail: who });
  const b = await narrate(llm, BRIEF_SYSTEM, server.facts, templateBrief(server.facts));
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
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    buf += dec.decode(value, { stream: !done });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === "step") onStep(msg as StepNote);
      else if (msg.type === "result") return msg as WriterDesign;
      else if (msg.type === "error") throw new Error(msg.error);
    }
    if (done) throw new Error("copilot stream ended without a result");
  }
}
