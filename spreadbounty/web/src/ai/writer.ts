/**
 * The decision model, called from this tab (B2). The Judge choice in the model dialog (keys.ts getJudgeMode) picks
 * one route per call, never two:
 *   - none: no request at all
 *   - local: a System One server (Von / Laya speaking POST /v1/systemone) at the URL set in the dialog, called straight
 *     from the browser with no key, probed first, and asked only the question types it got right
 *   - server: this server's POST /api/judge, which forwards to TypeSafe Jev (it rejects browser origins) with the
 *     operator's TYPESAFE_API_KEY
 *   - key: the same route with the key typed here (x-typesafe-key: forwarded to the fixed upstream, never stored or logged)
 * A choice left unfilled (no URL, no key) means no judge: it never falls back to another route, so a local choice keeps
 * the sponsor's text on this machine and a key choice never quietly spends the operator's key.
 * Never throws: null means "no judge", and the Writer behaves exactly as it does without one.
 * client.ts loads this file on demand, so it stays out of the main chunk.
 */
import { judgeRequest, judgeSupport, probeTypes, systemOne, type Judge, type QType } from "../../../src/ai/judge";
import { getJudgeKey, getJudgeMode, getJudgeUrl } from "./keys";

const LOCAL_TIMEOUT_MS = 20_000; // a local model on a laptop is slower than Jev's ~0.2 s
const probed = new Map<string, QType[]>(); // successful probes only, so a server started later is found on the next call

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
};

async function local(url: string) {
  const ask = systemOne({ url, label: `The System One server at ${hostOf(url)}`, timeoutMs: LOCAL_TIMEOUT_MS });
  let types = probed.get(url);
  if (!types) {
    types = await probeTypes(ask);
    if (types.length) probed.set(url, types);
  }
  return { ask, types };
}

/** The question types a local System One server answered correctly: [] when it is down, blocked (CORS) or wrong. */
export const probeLocal = async (url: string) => (await local(url)).types;

/** Where the Judge choice sends this call: a local URL, this server (with the user's key or ""), or nowhere. */
function route(): { url: string } | { key: string } | null {
  const mode = getJudgeMode(), url = getJudgeUrl(), key = getJudgeKey();
  if (mode === "local") return url ? { url } : null;
  if (mode === "key") return key ? { key } : null;
  return mode === "server" ? { key: "" } : null;
}

async function viaServer(body: object, key: string, signal?: AbortSignal): Promise<Judge | null> {
  const r = await fetch("/api/judge", { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-typesafe-key": key } : {}) }, body: JSON.stringify(body), signal });
  return r.ok ? (((await r.json()) as { judge?: Judge | null }).judge ?? null) : null;
}

/** The sponsor's sentence: "Which book?" when unsure, and the fixed-copy flags. */
export async function judgeGoal(goal: string, signal?: AbortSignal): Promise<Judge | null> {
  try {
    const to = route();
    if (!to) return null;
    if ("key" in to) return await viaServer({ goal }, to.key, signal);
    const { ask, types } = await local(to.url);
    return types.length ? await judgeRequest(goal, ask, types) : null;
  } catch {
    return null;
  }
}

/** Model-written text against the facts it was written from: which sentences are unsupported. */
export async function judgeText(text: string, facts: object, signal?: AbortSignal): Promise<Judge | null> {
  try {
    const to = route();
    if (!to) return null;
    if ("key" in to) return await viaServer({ text, facts }, to.key, signal);
    const { ask, types } = await local(to.url);
    return types.includes("noul") ? await judgeSupport(text, facts, ask) : null;
  } catch {
    return null;
  }
}
