/**
 * The decision model (B2): typed, calibrated judgments from a System One API, TypeSafe's Jev
 * (`POST https://api.typesafe.ai/v1/systemone`) or a local server that speaks the same request (Von / Laya).
 *   judgeRequest  reads the sponsor's sentence: which book (Choice), and four Nouls that become fixed-copy flags
 *   judgeSupport  one Noul per sentence of a model-written brief or report: is it supported by the facts JSON?
 * It never touches a number. Its only outputs are a "Which book?" prompt, flags with fixed copy, and a list of
 * unsupported sentences (the caller then shows the template). Nothing in src/core, src/drop or src/bot imports it.
 * Browser-safe: no node: imports, no process.env. Callers treat any thrown JudgeError as "no judge" (null).
 * Request and answer shapes follow https://docs.typesafe.ai/api (checked against the live API on Oct 11).
 */
import { z } from "zod";

/** The only upstream the server ever calls. A constant: no request field or header can change it. */
export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export const JUDGE_MODEL = "jev-latest";
/** Tunable thresholds, measured on test/fixtures/sponsor-requests.json (docs/JUDGE.md). */
export const FLAG_AT = 0.6; // a Noul at or above this raises its flag
export const PAIR_MIN = 0.7; // a pair Choice below this confidence (or "none") asks "Which book?"
export const SUPPORT_MIN = 0.5; // a sentence below this is unsupported
export const MAX_SENTENCES = 20; // briefs are under 120 words, reports under 150

export type QType = "choice" | "noul";
type Noul = { type: "noul"; instructions: unknown; criteria?: { true: string; false: string } };
type Choice = { type: "choice"; instructions: unknown; criteria: Record<string, string | null> }; // null: an option needing no description
export type Questions = Record<string, Noul | Choice>;

const Answer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number().min(0).max(1), probabilities: z.record(z.string(), z.number()) }),
]);
export type Answer = z.infer<typeof Answer>;
export type Answers = Record<string, Answer>;
const Reply = z.object({ model: z.string().max(100).optional(), answers: z.record(z.string(), z.unknown()) });

export interface Flag { code: string; text: string }
export interface Judge {
  needsPair?: { ask: string; options: string[] };
  flags: Flag[];
  unsupported?: { sentence: string }[];
  /** The model id the System One server echoed ("jev-1.13.0"). */
  by?: string;
}

/** A failure a sponsor can read. Never carries the key or the request body. */
export class JudgeError extends Error {}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Ask = (state: unknown, questions: Questions) => Promise<{ model: string; answers: Answers }>;

/** One System One call. Answers that are missing, malformed or of the wrong type are dropped, never guessed. */
export function systemOne(o: { url: string; key?: string; label?: string; model?: string; timeoutMs?: number; fetchImpl?: Fetch }): Ask {
  const label = o.label ?? "The System One server";
  const timeoutMs = o.timeoutMs ?? 8_000;
  return async (state, questions) => {
    const f = o.fetchImpl ?? ((u: string, i: RequestInit) => globalThis.fetch(u, i)); // resolved per call
    let r: Response;
    try {
      r = await f(o.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(o.key ? { authorization: `Bearer ${o.key}` } : {}) },
        body: JSON.stringify({ model: o.model ?? JUDGE_MODEL, state, questions }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      throw new JudgeError(name === "TimeoutError" || name === "AbortError" ? `${label} did not answer within ${Math.round(timeoutMs / 1000)} s.` : `${label} could not be reached.`);
    }
    if (!r.ok) {
      throw new JudgeError(
        r.status === 401 || r.status === 403 ? `${label} rejected the key (${r.status}).`
        : r.status === 429 || r.status === 529 ? `${label} is busy (${r.status}). Try again in a minute.`
        : `${label} answered ${r.status}.`,
      );
    }
    const reply = Reply.safeParse(await r.json().catch(() => null));
    if (!reply.success) throw new JudgeError(`${label} sent a reply that is not a System One answer.`);
    const answers: Answers = {};
    for (const [id, raw] of Object.entries(reply.data.answers)) {
      const a = Answer.safeParse(raw);
      if (a.success && questions[id]?.type === a.data.type) answers[id] = a.data;
    }
    return { model: reply.data.model ?? o.model ?? JUDGE_MODEL, answers };
  };
}

// ---------------- the sponsor's sentence ----------------
/** Fixed copy, from plans/FEATURE-PLAN.md B2. The UI shows these strings, never model text. */
export const FLAG_COPY = {
  wants_volume: "This campaign pays for resting depth inside a band, not volume.",
  names_makers: "Campaigns are open to every maker.",
  price_promise: "Depth rewards don't defend a peg.",
  one_sided: "One-sided quoting earns a third of the score.",
} as const;
export const PAIR_OPTIONS = ["AUSD/USDC", "MON/USDC"] as const;

export const REQUEST_QUESTIONS: Questions = {
  pair: {
    type: "choice",
    instructions: "Which Kuru order book does the sponsor's `request` want to fund?",
    criteria: {
      "AUSD/USDC": "The AUSD/USDC book: AUSD, Agora's dollar stablecoin, against USDC",
      "MON/USDC": "The MON/USDC book: MON, Monad's native token, against USDC",
      none: "The request names or implies neither of these books, or a different one",
    },
  },
  wants_volume: {
    type: "noul",
    instructions: "Does `request` ask to reward trading volume, trades, fills or turnover?",
    criteria: {
      true: "It wants to pay for volume, trades, fills, turnover or taker activity",
      false: "It only asks for depth, liquidity, tight spreads or quotes resting on the book, even if it mentions that traders benefit",
    },
  },
  names_makers: {
    type: "noul",
    instructions: "Does `request` ask to pay only particular makers, or to exclude particular makers?",
    criteria: {
      true: "It names firms or wallets to pay or to exclude, or limits rewards to a chosen group such as the top few makers",
      false: "Any maker who quotes could earn",
    },
  },
  price_promise: {
    type: "noul",
    instructions: "Does `request` ask the campaign to keep the price itself at a level, defend a peg, or stop the price from falling or rising?",
    criteria: {
      true: "It expects the price to be held, defended or guaranteed, for example 'never let it trade below $2' or 'protect the peg'",
      false: "It only says where quotes should sit, for example 'quotes near 0.999' or 'a band around the reference'; giving a reference price or peg for the band is not asking for the price to be held",
    },
  },
  one_sided: {
    type: "noul",
    instructions: "Does `request` ask for quotes on only one side of the book?",
    criteria: { true: "It wants only bids (buy orders) or only asks (sell orders)", false: "It wants both sides, or does not say" },
  },
};

const only = (qs: Questions, types: QType[]) => Object.fromEntries(Object.entries(qs).filter(([, q]) => types.includes(q.type))) as Questions;

/** Answers to the sponsor-sentence questions, as the UI needs them. Pure: thresholds live here. */
export function readRequest(answers: Answers): Judge {
  const out: Judge = { flags: [] };
  const pair = answers.pair;
  if (pair?.type === "choice" && (pair.choice === "none" || pair.confidence < PAIR_MIN)) out.needsPair = { ask: "Which book?", options: [...PAIR_OPTIONS] };
  for (const [code, text] of Object.entries(FLAG_COPY)) {
    const a = answers[code];
    if (a?.type === "noul" && a.noul >= FLAG_AT) out.flags.push({ code, text });
  }
  return out;
}

/** One request, every question in parallel. `types`: what the server answers (a local server may answer fewer). */
export async function judgeRequest(goal: string, ask: Ask, types: QType[] = ["choice", "noul"]): Promise<Judge> {
  const qs = only(REQUEST_QUESTIONS, types);
  const { model, answers } = await ask({ request: goal }, qs);
  if (Object.keys(qs).some((id) => !answers[id])) throw new JudgeError("The System One server left a question unanswered.");
  return { ...readRequest(answers), by: model };
}

// ---------------- model-written text against its facts ----------------
/** Sentence boundaries: ., ! or ? followed by space. Decimals ("93.9%") have no space, so they stay whole. */
export const splitSentences = (text: string) => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

export function supportQuestions(sentences: string[]): Questions {
  return Object.fromEntries(
    sentences.map((sentence, i) => [
      `supported_${i}`,
      {
        type: "noul",
        instructions: { sentence, question: "Is everything `sentence` claims supported by the `facts` JSON in the state?" },
        criteria: {
          true: "Every number, name, comparison and outcome in it appears in `facts` or follows directly from them; a recommendation or a risk to watch that rests only on `facts` counts as supported",
          false: "It states a number, name, cause, comparison, history or outcome that `facts` does not contain or that contradicts them",
        },
      },
    ]),
  );
}

/** Sentences the decision model could not match to the facts (empty: all supported). Fails closed past MAX_SENTENCES. */
export async function judgeSupport(text: string, facts: unknown, ask: Ask): Promise<Judge> {
  const sentences = splitSentences(text);
  const checked = sentences.slice(0, MAX_SENTENCES);
  const qs = supportQuestions(checked);
  const { model, answers } = await ask({ facts }, qs);
  if (Object.keys(qs).some((id) => !answers[id])) throw new JudgeError("The System One server left a sentence unchecked.");
  const unsupported = checked.filter((_, i) => (answers[`supported_${i}`] as { noul: number }).noul < SUPPORT_MIN);
  return { flags: [], unsupported: [...unsupported, ...sentences.slice(MAX_SENTENCES)].map((sentence) => ({ sentence })), by: model };
}

// ---------------- what a local server actually answers ----------------
/**
 * One call with known answers: a Choice whose right option is not the first, and two Nouls with opposite
 * answers, so a server that always says "yes" or always picks the first option is not counted. Returns the
 * question types answered correctly; [] when the server is down, blocked (CORS) or wrong.
 */
export async function probeTypes(ask: Ask): Promise<QType[]> {
  try {
    const { answers: a } = await ask({ request: "Fund two-sided quotes on the MON/USDC book." }, {
      book: { type: "choice", instructions: "Which book does `request` name?", criteria: { "AUSD/USDC": null, "MON/USDC": null, none: "No book is named" } },
      names_mon: { type: "noul", instructions: "Does `request` name the MON/USDC book?" },
      names_ausd: { type: "noul", instructions: "Does `request` name the AUSD/USDC book?" },
    });
    const types: QType[] = [];
    if (a.book?.type === "choice" && a.book.choice === "MON/USDC") types.push("choice");
    if (a.names_mon?.type === "noul" && a.names_ausd?.type === "noul" && a.names_mon.noul > 0.5 && a.names_ausd.noul < 0.5) types.push("noul");
    return types;
  } catch {
    return [];
  }
}
