/**
 * Edge controls for the public server (plans/SECURITY-PLAN.md section 2): response headers and CSP,
 * per-IP rate limits, JSON body limits, input schemas and sanitised errors. Stdlib + zod only.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { z } from "zod";
import { CHAIN_ID, USDC } from "../core/chain";
import { PAIRS } from "../ai/pipeline";

/** An error whose message is safe to show the client. Anything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public headers: Record<string, string> = {}) {
    super(message);
  }
}

export interface ServerConfig {
  publicDemo: boolean; // PUBLIC_DEMO=1: the deploy judges click; tighter caps, server AI off by default
  serverAiOff: boolean; // SERVER_AI=off, or PUBLIC_DEMO=1 without SERVER_AI=on
  proxyHops: number; // TRUST_PROXY=N: N proxies in front append to X-Forwarded-For (0 = use the socket address)
  allowedHosts: string[]; // ALLOWED_HOSTS: host names a sign-in message may name as its domain
  csp: string;
}

export function serverConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const publicDemo = env.PUBLIC_DEMO === "1";
  return {
    publicDemo,
    serverAiOff: env.SERVER_AI === "off" || (publicDemo && env.SERVER_AI !== "on"),
    proxyHops: Math.max(0, Math.min(5, Number.parseInt(env.TRUST_PROXY ?? "0", 10) || 0)),
    allowedHosts: (env.ALLOWED_HOSTS ?? "localhost,127.0.0.1").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
    csp: contentSecurityPolicy(env.RPC_URL, env.CSP_CONNECT_EXTRA),
  };
}

// ---------------- headers ----------------
/** Model providers the browser calls directly with the user's own key (A6), plus local model servers. */
const MODEL_HOSTS = ["https://api.anthropic.com", "https://api.openai.com", "https://generativelanguage.googleapis.com", "https://openrouter.ai", "http://localhost:*", "http://127.0.0.1:*"];
const MONAD_RPCS = ["https://rpc.monad.xyz", "https://testnet-rpc.monad.xyz"];
const SOURCE = /^(https?|wss?):\/\/[a-zA-Z0-9.*-]+(:(\d{1,5}|\*))?$/; // one CSP host-source, nothing that could end the directive

export function contentSecurityPolicy(rpcUrl?: string, extra?: string) {
  let rpcOrigin: string[] = [];
  try {
    if (rpcUrl) rpcOrigin = [new URL(rpcUrl).origin];
  } catch { /* a bad RPC_URL fails elsewhere; never in the header */ }
  const extras = (extra ?? "").split(/[\s,]+/).filter((s) => SOURCE.test(s));
  const connect = [...new Set(["'self'", ...MONAD_RPCS, ...rpcOrigin, ...MODEL_HOSTS, ...extras])].filter((s) => s === "'self'" || SOURCE.test(s));
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function isHttps(req: IncomingMessage, cfg: ServerConfig) {
  if ((req.socket as TLSSocket).encrypted) return true;
  const xfp = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]!.trim().toLowerCase();
  return cfg.proxyHops > 0 && xfp === "https";
}

export function setSecurityHeaders(req: IncomingMessage, res: ServerResponse, cfg: ServerConfig) {
  res.setHeader("Content-Security-Policy", cfg.csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY"); // frame-ancestors for browsers that predate CSP2
  if (isHttps(req, cfg)) res.setHeader("Strict-Transport-Security", "max-age=31536000");
}

// ---------------- who is asking ----------------
/** The socket address, or with TRUST_PROXY=N the address the outermost trusted proxy saw (the Nth entry from the right). */
export function clientIp(req: IncomingMessage, cfg: ServerConfig) {
  if (cfg.proxyHops > 0) {
    const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const ip = hops[hops.length - cfg.proxyHops];
    if (ip) return ip.slice(0, 64);
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** State-changing requests must come from this origin (or from a non-browser client that sends no Origin). */
export function assertSameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch { /* "null" and junk are foreign */ }
  if (!host || host !== req.headers.host) throw new HttpError(403, "Cross-origin requests are not allowed.");
}

// ---------------- rate limits (SECURITY-PLAN 2.2) ----------------
/** Fixed one-minute windows in a Map, swept every minute. ponytail: per-process memory; a shared store if the app ever runs on more than one instance. */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private now: () => number = Date.now) {}
  /** Count one request; throws a 429 with Retry-After once `max` is exceeded within `windowMs`. */
  take(key: string, max: number, windowMs = 60_000) {
    const t = this.now();
    let h = this.hits.get(key);
    if (!h || h.reset <= t) this.hits.set(key, (h = { n: 0, reset: t + windowMs }));
    if (++h.n > max) throw new HttpError(429, "Too many requests. Try again shortly.", { "Retry-After": String(Math.max(1, Math.ceil((h.reset - t) / 1000))) });
  }
  sweep() {
    const t = this.now();
    for (const [k, h] of this.hits) if (h.reset <= t) this.hits.delete(k);
  }
}

/** Which bucket a request counts against. Gamma's POST /api/judge (B2) is already in the "model" group. */
export function rateRule(method: string, path: string): { group: string; max: number } {
  if (path === "/api/copilot") return { group: "copilot", max: 6 };
  if (path === "/api/auth/nonce" || path === "/api/auth/verify") return { group: "auth", max: 10 };
  if (path === "/api/ai/health" || path === "/api/judge" || /^\/api\/campaigns\/[^/]+\/bot-sim$/.test(path) || (method === "POST" && /\/report$/.test(path)))
    return { group: "model", max: 10 };
  return { group: "api", max: 120 };
}

// ---------------- bodies ----------------
export const BODY_LIMIT = 16 * 1024;

/** JSON bodies only (415), at most 16 KB (413), well-formed (400). */
export function readJsonBody(req: IncomingMessage, limit = BODY_LIMIT): Promise<unknown> {
  const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") return Promise.reject(new HttpError(415, "Send JSON (content-type: application/json)."));
  const tooBig = () => new HttpError(413, "Request body too large (16 KB max).", { Connection: "close" });
  if (Number(req.headers["content-length"] ?? 0) > limit) return Promise.reject(tooBig());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (c: Buffer) => {
      size += c.length;
      if (size <= limit) return void chunks.push(c);
      req.off("data", onData); // stop buffering; the 413 goes out with Connection: close
      req.pause();
      reject(tooBig());
    };
    req.on("data", onData);
    req.on("error", reject);
    req.on("end", () => {
      if (size > limit) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, "Body must be valid JSON."));
      }
    });
  });
}

// ---------------- errors ----------------
/** Log the real error server-side under a short id; the client gets the id and nothing else. Never logs bodies. */
export function internalError(e: unknown, log: (msg: string) => void = console.error) {
  const id = randomBytes(4).toString("hex");
  log(`[error ${id}] ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  return { error: "Internal error", id };
}

// ---------------- input schemas (SECURITY-PLAN 2.3) ----------------
export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x address.");
const pairOf = z.enum(PAIRS, { error: "Unknown market." });

export const MarketQuery = z.object({ pair: pairOf.default("AUSD/USDC") });
export const BookQuery = z.object({
  pair: pairOf.default("AUSD/USDC"),
  hours: z.coerce.number({ error: "hours must be between 0.1 and 3." }).min(0.1, "hours must be between 0.1 and 3.").max(3, "hours must be between 0.1 and 3.").default(1)
    .transform((h) => Math.round(h * 10) / 10), // bounded cache keys
});
export const BotSimQuery = z.object({
  epoch: z.coerce.number().int().min(0).max(1_000_000),
  size: z.coerce.number().min(1).max(10_000_000).default(2000),
});
export const BlockhashQuery = z.object({ n: z.string().max(40_000).default("") });
export const NonceQuery = z.object({ address: Address });
export const VerifyIn = z.strictObject({
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  signature: z.string().regex(/^0x([0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/),
});

/** First query value per key, so `?pair=a&pair=b` cannot smuggle an array past a schema. */
export const query = (url: URL) => Object.fromEntries(url.searchParams.entries());

/** A base-units integer string in [min, max]. One check, so BigInt never sees a string the pattern rejected (zod runs every refine). */
const digits = (max: bigint, min = 0n) =>
  z.string().refine((s) => /^\d{1,40}$/.test(s) && BigInt(s) >= min && BigInt(s) <= max, `Must be a whole number from ${min} to ${max}, as a string.`);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const slug = (pair: string) => pair.replace("/", "-").toLowerCase();

/**
 * What a sponsor may publish. Unknown keys (including `shadow`, which only the CLI sets) are rejected, and
 * `sponsor` is ignored: the route overwrites it with the signed-in address. Market fields are checked against
 * the chain by the route, because a campaign that names the wrong book could otherwise relabel itself.
 */
export const CampaignIn = z.strictObject({
  id: z.string().regex(/^(ausd-usdc|mon-usdc)-\d{1,20}$/, "Campaign id must be <pair>-<digits>, e.g. ausd-usdc-123."),
  chainId: z.literal(CHAIN_ID),
  market: Address,
  pair: pairOf,
  implementation: Address,
  pricePrecision: digits(10n ** 30n, 1n),
  sizePrecision: digits(10n ** 30n, 1n),
  refPrice: digits(10n ** 40n).nullable(),
  bandBps: int(1, 500),
  minRestBlocks: int(1, 10_000),
  sampleEvery: int(50, 10_000),
  replayFromBlock: int(0, 1e12),
  epochBlocks: int(600, 288_000),
  budgetPerEpoch: digits(10n ** 12n),
  rewardToken: Address.refine((a) => a.toLowerCase() === USDC.toLowerCase(), "Rewards are paid in USDC."),
  rewardDecimals: z.literal(6),
  sponsor: Address.optional(),
}).refine((c) => c.id.startsWith(`${slug(c.pair)}-`), { message: "Campaign id must start with its pair.", path: ["id"] });

export const PublishIn = z.strictObject({ campaign: CampaignIn, rationale: z.string().max(4000).optional() });

/** One readable line from a zod failure (optionally with the field path), never the raw input. */
export const firstIssue = (e: z.ZodError, withPath = true) => {
  const i = e.issues[0];
  return i ? `${withPath && i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}` : "Invalid input.";
};
