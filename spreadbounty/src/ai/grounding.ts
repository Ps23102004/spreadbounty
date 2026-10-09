/**
 * Grounding guard: every number a model writes must exist in the facts it was given.
 * Small local models invent figures; this catches it deterministically and lets the caller
 * retry once with the offending numbers named, then fall back to a template.
 */

/** Every finite number reachable in a JSON value (numbers and numeric strings). */
export function factNumbers(facts: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) out.push(Number(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts);
  return out;
}

const NUM = /(?<![\w.])(-?\$?\d[\d,]*(?:\.\d+)?)(\s?[kKmM](?![a-zA-Z]))?(?![\w])/g;

/** Unit phrases that contain a number but state no fact: "cost per $1k of depth". */
const UNIT_PHRASES = /\bper\s+(?:\$|usdc\s*)?(?:1k|1,000|1000|one thousand)\b/gi;

/** Numbers as written in prose: "1,234.5", "$10", "98%", "5.1k". Hex, addresses, code spans and unit phrases are skipped. */
export function textNumbers(text: string): { raw: string; value: number; decimals: number }[] {
  const cleaned = text.replace(/0x[0-9a-fA-F]+/g, " ").replace(/`[^`]*`/g, " ").replace(UNIT_PHRASES, " per unit ");
  const out: { raw: string; value: number; decimals: number }[] = [];
  for (const m of cleaned.matchAll(NUM)) {
    const digits = m[1]!.replace(/[$,]/g, "");
    let value = Number(digits);
    if (!Number.isFinite(value)) continue;
    const suffix = m[2]?.trim().toLowerCase();
    if (suffix === "k") value *= 1e3;
    if (suffix === "m") value *= 1e6;
    const decimals = digits.includes(".") ? digits.split(".")[1]!.length : 0;
    out.push({ raw: m[0].trim(), value, decimals: suffix ? Math.max(0, decimals) - (suffix === "k" ? 3 : 6) : decimals });
  }
  return out;
}

export function checkGrounding(text: string, facts: unknown, extraAllowed: number[] = []) {
  const allowed = [...factNumbers(facts), ...extraAllowed];
  const ungrounded: string[] = [];
  for (const n of textNumbers(text)) {
    if (Number.isInteger(n.value) && Math.abs(n.value) <= 10) continue; // list numbering, "two makers", "1 epoch"
    const tol = 0.5 * 10 ** -n.decimals; // what rounding to the shown precision allows
    const ok = allowed.some((f) => Math.abs(n.value - f) <= tol + 1e-9 || (f !== 0 && Math.abs(n.value - f) / Math.abs(f) <= 0.005));
    if (!ok) ungrounded.push(n.raw);
  }
  return { ok: ungrounded.length === 0, ungrounded: [...new Set(ungrounded)] };
}

/** Ask for text, check it, retry once naming the bad numbers, else return null so the caller uses a template. */
export async function groundedText(
  generate: (feedback: string | null) => Promise<string | null>,
  facts: unknown,
  extraAllowed: number[] = [],
) {
  let feedback: string | null = null;
  const attempts: { ungrounded: string[] }[] = [];
  for (let i = 0; i < 2; i++) {
    const text = await generate(feedback);
    if (!text) return { text: null, attempts };
    const g = checkGrounding(text, facts, extraAllowed);
    attempts.push({ ungrounded: g.ungrounded });
    if (g.ok) return { text, attempts };
    feedback = `These numbers are not in the facts and must not appear: ${g.ungrounded.join(", ")}. Rewrite using only numbers from the facts.`;
  }
  return { text: null, attempts };
}
