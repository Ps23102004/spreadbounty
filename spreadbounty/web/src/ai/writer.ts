/**
 * The decision model, called from this tab (B2). One route per call, never both:
 *   - a local System One server (Von / Laya speaking POST /v1/systemone) when its URL is set (keys.ts setJudgeUrl):
 *     called straight from the browser with no key, probed first, and asked only the question types it got right
 *   - otherwise this server's POST /api/judge, which forwards to TypeSafe Jev (it rejects browser origins) with the
 *     operator's TYPESAFE_API_KEY or the key set here (x-typesafe-key: forwarded upstream, never stored or logged)
 * A local URL never falls back to the server: whoever set it chose to keep the sponsor's text on this machine.
 * Never throws: null means "no judge", and the Writer behaves exactly as it does without one.
 * client.ts loads this file on demand, so it stays out of the main chunk.
 */
import { judgeRequest, judgeSupport, probeTypes, systemOne, type Judge, type QType } from "../../../src/ai/judge";
import { getJudgeKey, getJudgeUrl } from "./keys";

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

async function viaServer(body: object, signal?: AbortSignal): Promise<Judge | null> {
  const key = getJudgeKey();
  const r = await fetch("/api/judge", { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-typesafe-key": key } : {}) }, body: JSON.stringify(body), signal });
  return r.ok ? (((await r.json()) as { judge?: Judge | null }).judge ?? null) : null;
}

/** The sponsor's sentence: "Which book?" when unsure, and the fixed-copy flags. */
export async function judgeGoal(goal: string, signal?: AbortSignal): Promise<Judge | null> {
  try {
    const url = getJudgeUrl();
    if (!url) return await viaServer({ goal }, signal);
    const { ask, types } = await local(url);
    return types.length ? await judgeRequest(goal, ask, types) : null;
  } catch {
    return null;
  }
}

/** Model-written text against the facts it was written from: which sentences are unsupported. */
export async function judgeText(text: string, facts: object, signal?: AbortSignal): Promise<Judge | null> {
  try {
    const url = getJudgeUrl();
    if (!url) return await viaServer({ text, facts }, signal);
    const { ask, types } = await local(url);
    return types.includes("noul") ? await judgeSupport(text, facts, ask) : null;
  } catch {
    return null;
  }
}
