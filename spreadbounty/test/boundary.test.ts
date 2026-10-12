// A0 guardrails: payout code never imports the AI layer; no secrets or raw HTML reach the browser bundle.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
let failures = 0, checks = 0;
function ok(name: string, cond: boolean, detail = "") {
  checks++;
  console.log(`  ${cond ? "ok " : "FAIL"} ${name}${cond || !detail ? "" : `: ${detail}`}`);
  if (!cond) failures++;
}
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx|js|mjs|cjs|css|html)$/.test(f)) out.push(p);
  }
  return out;
}
const importsOf = (file: string) => [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

// 1. src/core, src/drop, src/bot never import src/ai or web/
{
  const bad: string[] = [];
  for (const d of ["src/core", "src/drop", "src/bot"]) for (const f of walk(join(root, d)))
    for (const i of importsOf(f)) if (/(^|\/)(ai)(\/|$)/.test(i) || /(^|\/)web(\/|$)/.test(i)) bad.push(`${f.replace(root + "/", "")} -> ${i}`);
  ok("payout code (core/drop/bot) never imports the AI layer or web/", bad.length === 0, bad.join("; "));
}
// 2. no dangerouslySetInnerHTML in the web app
{
  const bad = walk(join(root, "web/src")).filter((f) => readFileSync(f, "utf8").includes("dangerouslySetInnerHTML"));
  ok("web/src has no dangerouslySetInnerHTML", bad.length === 0, bad.join(", "));
}
// 3. browser-side AI modules stay browser-safe (once they exist)
{
  const bad: string[] = [];
  for (const f of ["src/ai/prompts.ts", "src/ai/http.ts"].map((p) => join(root, p)).filter(existsSync))
    for (const i of importsOf(f)) if (i.startsWith("node:") || i === "@anthropic-ai/sdk") bad.push(`${f.replace(root + "/", "")} -> ${i}`);
  ok("src/ai/prompts.ts and src/ai/http.ts import no node: modules or the Anthropic SDK", bad.length === 0, bad.join("; "));
}
// 4. the API client never touches the key store
{
  const api = join(root, "web/src/api.ts");
  ok("web/src/api.ts does not import web/src/ai/keys", !existsSync(api) || !importsOf(api).some((i) => /ai\/keys/.test(i)));
}
// 5. the built bundle carries no secrets (only when a build exists)
{
  const dist = join(root, "web/dist");
  if (existsSync(dist)) {
    // Env-var NAMES may appear in help text; VALUES must not. Match name=value assignments and known key prefixes.
    const patterns: [string, RegExp][] = [
      ["env assignment with a value", /\b(ANTHROPIC_API_KEY|TYPESAFE_API_KEY|SESSION_SECRET|BOT_KEY|SPONSOR_KEY|CLAIM_KEY|MAKER_KEY|TAKER_KEY)\s*[=:]\s*["']?(0x[0-9a-fA-F]{64}|sk-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{32,})/],
      ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/], ["OpenAI key", /\bsk-[A-Za-z0-9]{32,}/], ["Google key", /\bAIza[0-9A-Za-z_-]{30,}/],
    ];
    // A real key has high entropy; library constants (zero hash, max uint, padded selectors) do not.
    const looksLikeKey = (h: string) => { const body = h.slice(2).toLowerCase(); return !/^0+$|^f+$|0{24,}/.test(body) && new Set(body).size >= 10; };
    const hits: string[] = [];
    for (const f of walk(dist)) {
      const s = readFileSync(f, "utf8");
      for (const [name, re] of patterns) if (re.test(s)) hits.push(`${f.replace(root + "/", "")}: ${name}`);
      for (const h of s.match(/\b0x[0-9a-fA-F]{64}\b/g) ?? []) if (looksLikeKey(h)) hits.push(`${f.replace(root + "/", "")}: raw private key ${h.slice(0, 10)}…`);
    }
    ok("web/dist contains no secret values or key prefixes", hits.length === 0, hits.join("; "));
  } else ok("web/dist absent (secret scan skipped; run build:web first for the full check)", true);
}
console.log(`\n${checks - failures}/${checks} boundary checks passed`);
if (failures) process.exit(1);
