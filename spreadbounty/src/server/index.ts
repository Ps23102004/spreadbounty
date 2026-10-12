/**
 * Spreadbounty API + web app server (node:http, no framework).
 *
 *   npm run serve            http://localhost:8787   (DATA_SOURCE=demo by default; DATA_SOURCE=live for mainnet)
 *
 * Edge controls (headers, rate limits, body limits, schemas, sanitised errors) live in ./security.ts.
 * `createApp()` builds the server without listening, so tests can boot it on an ephemeral port.
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { decodeBookLogs, replay } from "../core/book";
import type { RawLog } from "../core/rpc";
import { BLOCK_SECONDS, DEFAULT_RPC } from "../core/chain";
import { epochMetrics, type Campaign, type EpochFile } from "../core/epoch";
import { leafHash, merkleProof, verifyProof } from "../core/score";
import { aiConfig, getLLM, type LLM } from "../ai/llm";
import { designCampaign, IntentSchema, PAIRS } from "../ai/pipeline";
import { writeEpochReport } from "../ai/report";
import { judgeRequest, judgeSupport, JudgeError, systemOne, TYPESAFE_URL } from "../ai/judge"; // B2 (gamma2)
import { getSource, recentHistory, type DataSource } from "../data/source";
import { compareStrategies } from "../bot/sim";
import { ethers } from "ethers";
import { createAuth, type Auth } from "./auth";
import {
  Address, assertSameOrigin, BlockhashQuery, BookQuery, BotSimQuery, clientIp, firstIssue, HttpError, internalError, isHttps, MarketQuery,
  NonceQuery, PublishIn, query, RateLimiter, rateRule, readJsonBody, serverConfig, setSecurityHeaders, VerifyIn, type ServerConfig,
} from "./security";

const WEB = join(import.meta.dirname, "../../web/dist");
const ID = /^[a-z0-9-]{1,80}$/;
const BOOK_TTL_MS = 15_000;
/** Expensive work allowed to run at once, server-wide (rate limits are per IP; these bound the total). */
const CONCURRENCY = { copilot: 2, model: 2 } as const;
const PER_SPONSOR_PER_DAY = 3;
const PUBLIC_DEMO_MAX_CAMPAIGNS = 50;
const PUBLISHES_PER_IP_PER_DAY = 5; // sign-in is free, so the per-address cap alone does not stop one person with many wallets
const HOUR_BLOCKS = Math.round(3600 / BLOCK_SECONDS);

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
};
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8"));
const campaignPath = (src: DataSource, id: string) => `${src.dir}/campaign-${id}.json`;
const epochPath = (src: DataSource, id: string, n: number) => `${src.dir}/${id}/epoch-${n}.json`;
const parse = <T extends z.ZodType>(schema: T, input: unknown, withPath = false): z.infer<T> => {
  const r = schema.safeParse(input);
  if (!r.success) throw new HttpError(400, firstIssue(r.error, withPath));
  return r.data;
};

/** Enough shape that list and book code cannot crash on a file someone dropped into the directory by hand. */
const StoredCampaign = z.looseObject({ id: z.string(), market: z.string(), pair: z.string(), replayFromBlock: z.number() });

function listCampaigns(src: DataSource) {
  if (!existsSync(src.dir)) return [];
  return readdirSync(src.dir)
    .filter((f) => /^campaign-.+\.json$/.test(f))
    .flatMap((f) => {
      try {
        const c = StoredCampaign.safeParse(readJson(join(src.dir, f)));
        // the file name is the id: a file cannot claim another campaign's id
        return c.success && ID.test(c.data.id) && f === `campaign-${c.data.id}.json` ? [c.data as unknown as Campaign & { rationale?: string }] : [];
      } catch {
        return [];
      }
    })
    .map((c) => ({ ...c, epochs: listEpochs(src, c.id).length }))
    .sort((a, b) => b.replayFromBlock - a.replayFromBlock);
}
function listEpochs(src: DataSource, id: string) {
  const dir = `${src.dir}/${id}`;
  if (!ID.test(id) || !existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => f.match(/^epoch-(\d+)\.json$/)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Every address that placed an order during the epoch, paid or not (shows who quoted but did not qualify). */
function makersSeen(src: DataSource, id: string, n: number, e: EpochFile) {
  const bundle = epochPath(src, id, n).replace(".json", ".logs.json");
  if (!existsSync(bundle)) return [];
  const counts = new Map<string, number>();
  for (const ev of decodeBookLogs(readJson<RawLog[]>(bundle).filter((l) => l.blockNumber >= e.fromBlock && l.blockNumber <= e.toBlock)))
    if (ev.kind === "create") counts.set(ev.order.owner, (counts.get(ev.order.owner) ?? 0) + 1);
  return [...counts.entries()].map(([owner, orders]) => ({ owner, orders })).sort((a, b) => b.orders - a.orders);
}

/** Resting maker orders aggregated by price level: what the order book looks like now (from logs alone). */
async function bookSnapshot(src: DataSource, pair: string, hours: number) {
  const m = await src.market(pair);
  // a campaign with closed epochs outranks a freshly published one, so a new publish cannot redraw the public book
  const camps = listCampaigns(src).filter((c) => c.market.toLowerCase() === m.market.toLowerCase());
  const camp = camps.find((c) => c.epochs > 0) ?? camps[0];
  const h = await recentHistory(src, m.market, hours);
  const { live } = replay(decodeBookLogs(h.logs));
  const P = Number(m.pricePrecision), S = Number(m.sizePrecision);
  const levels = new Map<string, { price: number; size: number; isBuy: boolean; makers: Set<string> }>();
  for (const o of live.values()) {
    const k = `${o.isBuy}:${o.price}`;
    const l = levels.get(k) ?? { price: Number(o.price) / P, size: 0, isBuy: o.isBuy, makers: new Set<string>() };
    l.size += Number(o.size) / S;
    l.makers.add(o.owner);
    levels.set(k, l);
  }
  const all = [...levels.values()].map((l) => ({ price: l.price, size: Math.round(l.size * 100) / 100, isBuy: l.isBuy, makers: l.makers.size }));
  return {
    pair: m.pair,
    head: h.to,
    windowHours: hours,
    refPrice: camp?.refPrice ? Number(camp.refPrice) / P : null,
    bandBps: camp?.bandBps ?? null,
    bids: all.filter((l) => l.isBuy).sort((a, b) => b.price - a.price),
    asks: all.filter((l) => !l.isBuy).sort((a, b) => a.price - b.price),
  };
}

/** Backtest the maker bot vs two naive strategies on one closed epoch (cached: it replays the whole epoch 3 times). */
const simCache = new Map<string, unknown>();
async function botSim(src: DataSource, id: string, n: number, size: number) {
  const key = `${src.dir}:${id}:${n}:${size}`;
  if (simCache.has(key)) return simCache.get(key);
  const c = readJson<Campaign>(campaignPath(src, id));
  const baseline = existsSync(epochPath(src, id, n)) ? readJson<EpochFile>(epochPath(src, id, n)) : undefined;
  const rs = await compareStrategies(src, c, n, size, size * 10, baseline);
  const out = {
    epoch: n,
    sizePerSide: size,
    base: c.pair.split("/")[0],
    quote: c.pair.split("/")[1],
    budget: rs[0]!.withBot.budgetRewardTokens,
    results: rs.map((r) => ({
      strategy: r.strategy, payout: r.payout, sharePct: r.sharePct, txs: r.txs, places: r.places, cancels: r.cancels, fills: r.fills,
      inventory: r.inventory, restingTwoSidedPct: r.restingTwoSidedPct,
      depthWith: r.withBot.avgTwoSidedDepthQuote, depthWithout: r.withoutBot.avgTwoSidedDepthQuote,
      coverageWith: r.withBot.twoSidedCoveragePct, coverageWithout: r.withoutBot.twoSidedCoveragePct,
    })),
  };
  if (simCache.size >= 50) simCache.clear();
  simCache.set(key, out);
  return out;
}

/**
 * Roles come from public files, never from a user table: a sponsor is the `sponsor` of a campaign file, a maker
 * appears in an epoch's payouts, and everyone is a verifier. ponytail: reads every epoch file per call; index by
 * address if a deploy ever holds thousands of epochs.
 */
function rolesFor(src: DataSource, addr: string) {
  const camps = listCampaigns(src);
  const sponsorOf = camps.filter((c) => typeof c.sponsor === "string" && c.sponsor.toLowerCase() === addr).map((c) => c.id);
  const makerIn = camps.flatMap((c) => {
    const epochs: number[] = [];
    let cumulative = "0";
    for (const n of listEpochs(src, c.id)) {
      try {
        const e = readJson<EpochFile>(epochPath(src, c.id, n));
        if (e.amounts.some((a) => a.account.toLowerCase() === addr)) epochs.push(n);
        cumulative = e.cumulative.find((a) => a.account.toLowerCase() === addr)?.amount ?? cumulative;
      } catch { /* an unreadable epoch file grants nothing */ }
    }
    return epochs.length ? [{ campaign: c.id, epochs, cumulative }] : [];
  });
  return { sponsorOf, makerIn };
}

/** What route handlers share. */
interface Ctx {
  src: DataSource;
  cfg: ServerConfig;
  auth: Auth;
  limiter: RateLimiter;
  now: () => number;
  log: (m: string) => void;
  /** The server-side model, or null when it is off (always off on PUBLIC_DEMO unless SERVER_AI=on). */
  llm: () => LLM | null;
  running: Record<keyof typeof CONCURRENCY, number>;
}

/** Run `fn` in one of the `kind` slots, or answer 429 when they are all taken. */
async function exclusive<T>(ctx: Ctx, kind: keyof typeof CONCURRENCY, fn: () => Promise<T>): Promise<T> {
  if (ctx.running[kind] >= CONCURRENCY[kind]) throw new HttpError(429, "The server is busy with this kind of request. Try again in a few seconds.", { "Retry-After": "5" });
  ctx.running[kind]++;
  try {
    return await fn();
  } finally {
    ctx.running[kind]--;
  }
}

// ---------------- AI routes (gamma's A6 extension points) ----------------
/** POST /api/copilot body. A6 adds `intent?` (IntentSchema) and `brief?: "server" | "none"` here. Unknown keys are stripped. */
// A6 (gamma): optional browser-read intent and brief mode for BYO-model runs; strict zod so nothing else gets through.
export const CopilotIn = z.object({ goal: z.string().min(3).max(1000), intent: IntentSchema.optional(), brief: z.enum(["server", "none"]).optional() });

/** POST /api/copilot: streams one JSON object per line (steps, then the result). At most 2 run at once, server-wide. */
async function copilot(req: IncomingMessage, res: ServerResponse, ctx: Ctx) {
  const parsed = CopilotIn.safeParse(await readJsonBody(req));
  if (!parsed.success) return send(res, 400, { error: "Describe the goal in a sentence (3 to 1000 characters)." });
  await exclusive(ctx, "copilot", async () => {
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    const line = (o: unknown) => res.write(JSON.stringify(o) + "\n");
    try {
      const { goal, intent, brief } = parsed.data; // A6 (gamma): optional browser-read intent and brief mode
      const r = await designCampaign(goal, ctx.src, ctx.llm(), (s) => line({ type: "step", ...s }), { intent, brief });
      line({ type: "result", ...r });
    } catch (e) {
      line({ type: "error", ...internalError(e, ctx.log) });
    }
    res.end();
  });
}

/** POST /api/campaigns/:id/epochs/:n/report. A6 reads `?narrate=none` from `url` here and returns `{ facts, template, root }`. */
async function epochReport(_url: URL, ctx: Ctx, id: string, n: number, e: EpochFile) {
  const prevPath = epochPath(ctx.src, id, n - 1);
  const prev = n > 0 && existsSync(prevPath) ? readJson<EpochFile>(prevPath) : null;
  return writeEpochReport(e, prev, ctx.llm());
}

// ---- B2 (gamma2): POST /api/judge, the decision model. Begin marked edit. ----
/** Either the sponsor's sentence, or model-written text plus the facts it was written from. Strict: no URL, no model, no questions. */
export const JudgeIn = z.union([
  z.strictObject({ goal: z.string().min(3).max(1000) }),
  z.strictObject({ text: z.string().min(1).max(4000), facts: z.record(z.string(), z.unknown()) }),
]);
const TYPESAFE_KEY = /^[\x21-\x7e]{8,256}$/; // one printable token; anything else is ignored, never echoed

/**
 * Jev rejects browser origins, so this route calls it for the browser. One fixed upstream (TYPESAFE_URL); the server
 * builds every question (src/ai/judge.ts). The key is the caller's `x-typesafe-key` header, else TYPESAFE_API_KEY; it
 * goes only into the upstream Authorization header and is never logged, stored or echoed. No key, an upstream error or
 * a timeout answers `{ judge: null }` with a readable note, and the page behaves exactly as without a judge.
 */
async function judgeRoute(req: IncomingMessage, env: NodeJS.ProcessEnv, ctx: Ctx) {
  const body = parse(JudgeIn, await readJsonBody(req));
  const header = req.headers["x-typesafe-key"];
  const key = (typeof header === "string" && TYPESAFE_KEY.test(header) ? header : "") || env.TYPESAFE_API_KEY || "";
  if (!key) return { judge: null, note: "No decision model on this server (TYPESAFE_API_KEY is not set)." };
  const ask = systemOne({ url: TYPESAFE_URL, key, label: "TypeSafe", timeoutMs: 8_000 });
  try {
    return { judge: await exclusive(ctx, "model", () => ("goal" in body ? judgeRequest(body.goal, ask) : judgeSupport(body.text, body.facts, ask))) };
  } catch (e) {
    if (e instanceof JudgeError) return { judge: null, note: e.message };
    throw e; // HttpError (busy) or a bug: the generic handler answers without detail
  }
}
// ---- End B2 marked edit. ----

// ---------------- campaigns ----------------
/** POST /api/campaigns: signed-in sponsors only; the stored `sponsor` is always the session address. */
async function publish(req: IncomingMessage, ctx: Ctx) {
  const addr = ctx.auth.session(req);
  if (!addr) throw new HttpError(401, "Sign in with your wallet to publish a campaign.");
  const body = parse(PublishIn, await readJsonBody(req), true);
  const c = { ...body.campaign, sponsor: ethers.utils.getAddress(addr) };
  // the campaign must describe the real book for its pair, or Overview and Verify would label the wrong market
  const m = await ctx.src.market(c.pair);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!same(c.market, m.market) || !same(c.implementation, m.implementation) || c.pricePrecision !== m.pricePrecision || c.sizePrecision !== m.sizePrecision)
    throw new HttpError(400, `campaign: market details do not match the ${c.pair} book.`);
  // starts within the last hour (the sponsor took a while to click Publish) and at most 7 days ahead
  const head = await ctx.src.head();
  if (c.replayFromBlock < head - HOUR_BLOCKS || c.replayFromBlock > head + 168 * HOUR_BLOCKS)
    throw new HttpError(400, "campaign.replayFromBlock: must be between an hour ago and 7 days from now, in blocks.");
  const all = listCampaigns(ctx.src);
  const dayAgo = ctx.now() - 86_400_000;
  const todays = all.filter((x) => typeof x.sponsor === "string" && x.sponsor.toLowerCase() === addr && statSync(campaignPath(ctx.src, x.id)).mtimeMs > dayAgo);
  if (todays.length >= PER_SPONSOR_PER_DAY) throw new HttpError(429, `At most ${PER_SPONSOR_PER_DAY} campaigns per sponsor per day.`, { "Retry-After": "3600" });
  if (ctx.cfg.publicDemo && all.length >= PUBLIC_DEMO_MAX_CAMPAIGNS) throw new HttpError(429, `This demo server holds ${PUBLIC_DEMO_MAX_CAMPAIGNS} campaigns already.`, { "Retry-After": "86400" });
  ctx.limiter.take(`publish:${clientIp(req, ctx.cfg)}`, PUBLISHES_PER_IP_PER_DAY, 86_400_000); // counts valid publishes only
  mkdirSync(ctx.src.dir, { recursive: true });
  try {
    writeFileSync(campaignPath(ctx.src, c.id), JSON.stringify({ ...c, rationale: body.rationale }, null, 2), { flag: "wx" }); // wx: never overwrite
  } catch (e) {
    if ((e as { code?: string }).code === "EEXIST") throw new HttpError(409, "A campaign with this id is already published.");
    throw e;
  }
  return { id: c.id, path: `campaign-${c.id}.json` }; // public file name only, never a server path
}

async function campaigns(req: IncomingMessage, res: ServerResponse, url: URL, parts: string[], ctx: Ctx) {
  const { src } = ctx;
  if (parts.length === 2 && req.method === "GET") return send(res, 200, listCampaigns(src));
  if (parts.length === 2 && req.method === "POST") return send(res, 201, await publish(req, ctx));
  const isReport = parts[5] === "report" && parts.length === 6;
  if (isReport ? req.method !== "POST" : req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed." });
  const id = parts[2];
  if (!id || !ID.test(id) || !existsSync(campaignPath(src, id))) return send(res, 404, { error: "No such campaign." });
  if (parts.length === 3) return send(res, 200, readJson(campaignPath(src, id)));
  if (parts[3] === "epochs" && parts.length === 4) {
    return send(res, 200, listEpochs(src, id).map((n) => {
      const e = readJson<EpochFile>(epochPath(src, id, n));
      return { n, fromBlock: e.fromBlock, toBlock: e.toBlock, root: e.root, metrics: epochMetrics(e), makersSeen: makersSeen(src, id, n, e), samples: e.samples.map((s) => ({ block: s.block, bidDepth: s.bidDepth, askDepth: s.askDepth, scored: s.scored })) };
    }));
  }
  if (parts[3] === "drop" && parts.length === 4) {
    const f = `${src.dir}/${id}/drop.json`;
    return existsSync(f) ? send(res, 200, readJson(f)) : send(res, 404, { error: "No claim contract deployed for this campaign." });
  }
  if (parts[3] === "bot-sim" && parts.length === 4) {
    const q = BotSimQuery.safeParse(query(url));
    if (!q.success) return send(res, 400, { error: "Pick a closed epoch and a size per side from 1 to 10,000,000." });
    if (!existsSync(epochPath(src, id, q.data.epoch))) return send(res, 400, { error: "Pick a closed epoch." });
    return send(res, 200, await exclusive(ctx, "model", () => botSim(src, id, q.data.epoch, q.data.size)));
  }
  const n = Number(parts[4]);
  if (parts[3] === "epochs" && /^\d{1,7}$/.test(parts[4] ?? "") && existsSync(epochPath(src, id, n))) {
    const e = readJson<EpochFile>(epochPath(src, id, n));
    if (parts.length === 5) return send(res, 200, e);
    if (parts[5] === "logs" && parts.length === 6) {
      const bundle = epochPath(src, id, n).replace(".json", ".logs.json");
      if (!existsSync(bundle)) return send(res, 404, { error: "No log bundle; verify against the RPC instead." });
      res.writeHead(200, { "content-type": "application/json" });
      return pipeline(createReadStream(bundle), res, () => {}); // pipeline closes the file if the client goes away
    }
    if (parts[5] === "claim" && parts.length === 7) {
      const acct = parse(Address, parts[6]).toLowerCase();
      const entries = e.cumulative.map((c) => [c.account, BigInt(c.amount)] as [string, bigint]);
      const entry = entries.find(([a]) => a === acct);
      if (!entry) return send(res, 404, { error: "This address has nothing to claim in this epoch." });
      const proof = merkleProof(entries, entry[0], entry[1]);
      return send(res, 200, { account: entry[0], cumulativeAmount: entry[1].toString(), root: e.root, proof, verifies: verifyProof(proof, e.root, leafHash(entry[0], entry[1])) });
    }
    if (isReport) return send(res, 200, await exclusive(ctx, "model", () => epochReport(url, ctx, id, n, e)));
  }
  return send(res, 404, { error: "Not found." });
}

// ---------------- the app ----------------
export interface AppOptions {
  src?: DataSource;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  log?: (m: string) => void;
}

export function createApp(opts: AppOptions = {}) {
  const env = opts.env ?? process.env;
  const cfg = serverConfig(env);
  const now = opts.now ?? Date.now;
  const log = opts.log ?? console.error;
  const ctx: Ctx = {
    src: opts.src ?? getSource(),
    cfg,
    auth: createAuth(env.SESSION_SECRET, now, log),
    limiter: new RateLimiter(now),
    now,
    log,
    llm: () => (cfg.serverAiOff ? null : getLLM()),
    running: { copilot: 0, model: 0 },
  };
  const { src, auth, limiter } = ctx;

  // /api/book replays up to 3 h of logs (hundreds of RPC calls live): one shared fetch per pair and window every 15 s
  const bookCache = new Map<string, { at: number; value: Promise<unknown> }>();
  const cachedBook = (pair: string, hours: number) => {
    const key = `${pair}:${hours}`;
    const hit = bookCache.get(key);
    if (hit && now() - hit.at < BOOK_TTL_MS) return hit.value;
    const value = bookSnapshot(src, pair, hours);
    value.catch(() => bookCache.delete(key));
    bookCache.set(key, { at: now(), value });
    return value;
  };

  async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
    const p = "/" + parts.join("/"); // one spelling per route, so "/x/" or "//x" cannot reach a handler through a cheaper rate bucket
    const method = req.method ?? "GET";
    const rule = rateRule(method, p);
    limiter.take(`${rule.group}:${clientIp(req, cfg)}`, rule.max);
    if (method !== "GET" && method !== "HEAD") assertSameOrigin(req);

    if (p === "/api/config" && method === "GET") {
      const ai = aiConfig();
      const provider = cfg.serverAiOff ? "off" : ai.provider;
      return send(res, 200, {
        dataSource: src.kind,
        synthetic: src.kind === "demo",
        rpcUrl: src.kind === "live" ? env.RPC_URL ?? DEFAULT_RPC : null,
        ai: { provider, model: provider === "claude" ? ai.claudeModel : provider === "local" ? ai.localModel : null, endpoint: provider === "local" ? ai.localUrl : null },
        pairs: PAIRS,
      });
    }
    if (p === "/api/ai/health" && method === "GET") {
      // one tiny round trip so a sponsor can see whether their local model (Ollama, LM Studio, llama.cpp...) answers
      const llm = ctx.llm();
      if (!llm) return send(res, 200, { ok: false, provider: "off", reason: "No model configured: rules and templates are used." });
      const t0 = Date.now();
      try {
        const out = await llm.text("Reply with the single word: ready", "Are you there?", 20);
        return send(res, 200, { ok: !!out, provider: llm.provider, model: llm.model, latencyMs: Date.now() - t0, reply: (out ?? "").slice(0, 60) });
      } catch (e) {
        const { id } = internalError(e, ctx.log);
        return send(res, 200, { ok: false, provider: llm.provider, model: llm.model, latencyMs: Date.now() - t0, reason: `The model did not answer (server log ref ${id}).` });
      }
    }
    if (p === "/api/market" && method === "GET") return send(res, 200, await src.market(parse(MarketQuery, query(url)).pair));
    if (p === "/api/book" && method === "GET") {
      const q = parse(BookQuery, query(url));
      return send(res, 200, await cachedBook(q.pair, q.hours));
    }
    if (p === "/api/blockhash" && method === "GET") {
      // demo only: in live mode the browser asks the RPC itself so verification doesn't trust this server
      if (src.kind !== "demo") return send(res, 400, { error: "live mode: fetch block hashes from the RPC directly" });
      const ns = parse(BlockhashQuery, query(url)).n.split(",").map(Number).filter((x) => Number.isSafeInteger(x) && x > 0).slice(0, 2000);
      return send(res, 200, Object.fromEntries(await Promise.all(ns.map(async (n) => [n, await src.blockHash(n)]))));
    }
    if (p === "/api/copilot" && method === "POST") return copilot(req, res, ctx);
    if (p === "/api/judge" && method === "POST") return send(res, 200, await judgeRoute(req, env, ctx)); // B2 (gamma2)

    // ---- sign-in (A5): reading, verifying and claim lookups never need it; only publishing does ----
    if (p === "/api/auth/nonce" && method === "GET") {
      const { address } = parse(NonceQuery, query(url));
      const host = String(req.headers.host ?? "");
      if (!/^[a-z0-9.-]{1,253}(:\d{1,5})?$/i.test(host) || !cfg.allowedHosts.includes(host.replace(/:\d+$/, "").toLowerCase()))
        throw new HttpError(400, "This server does not accept sign-ins for that host name.");
      return send(res, 200, auth.challenge(address, host, `${isHttps(req, cfg) ? "https" : "http"}://${host}`));
    }
    if (p === "/api/auth/verify" && method === "POST") {
      const { nonce, signature } = parse(VerifyIn, await readJsonBody(req));
      const address = auth.verify(nonce, signature);
      return send(res, 200, { address }, { "Set-Cookie": auth.cookie(address, isHttps(req, cfg)) });
    }
    if (p === "/api/auth/logout" && method === "POST") return send(res, 200, { ok: true }, { "Set-Cookie": auth.clearCookie(isHttps(req, cfg)) });
    if (p === "/api/me" && method === "GET") {
      const addr = auth.session(req);
      if (!addr) return send(res, 401, { error: "Not signed in." });
      return send(res, 200, { address: ethers.utils.getAddress(addr), roles: rolesFor(src, addr) });
    }

    if (parts[1] === "campaigns") return campaigns(req, res, url, parts, ctx);
    return send(res, 404, { error: "Not found." });
  }

  const server = createServer(async (req, res) => {
    try {
      setSecurityHeaders(req, res, cfg);
      const url = new URL(req.url ?? "/", "http://localhost"); // inside the try: a malformed request target is a 400, not a crash
      if (url.pathname.startsWith("/api/")) await api(req, res, url);
      else staticFile(res, url.pathname);
    } catch (e) {
      if (res.headersSent) return void res.end();
      if (e instanceof HttpError) return send(res, e.status, { error: e.message }, e.headers);
      if ((e as { code?: string }).code === "ERR_INVALID_URL") return send(res, 400, { error: "Bad request." });
      send(res, 500, internalError(e, ctx.log));
    }
  });
  server.requestTimeout = 30_000; // whole request (headers + body) must arrive within 30 s; streamed responses are unaffected
  server.headersTimeout = 20_000;
  const sweeper = setInterval(() => (limiter.sweep(), auth.sweep()), 60_000);
  sweeper.unref();
  server.on("close", () => clearInterval(sweeper));
  return server;
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png" };

function staticFile(res: ServerResponse, pathname: string) {
  let file = join(WEB, normalize(pathname));
  if (!file.startsWith(WEB + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB, "index.html");
  if (!existsSync(file)) {
    res.writeHead(503, { "content-type": "text/plain" });
    return res.end("Web app not built. Run `npm run build:web`, or use `npm run dev` for the dev server.");
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  pipeline(createReadStream(file), res, () => {});
}

const isMain = () => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

// `npm run serve` / `tsx src/server/index.ts`; importing this module (tests) starts nothing and reads no .env
if (isMain()) {
  (await import("dotenv")).config();
  const PORT = Number(process.env.PORT ?? 8787);
  const cfg = serverConfig(process.env);
  createApp().listen(PORT, () => {
    const ai = aiConfig();
    const provider = cfg.serverAiOff ? "off" : ai.provider;
    console.log(`Spreadbounty on http://localhost:${PORT}  |  data: ${process.env.DATA_SOURCE === "live" ? "live" : "demo (synthetic)"}  |  ai: ${provider}${provider === "local" ? ` ${ai.localModel} @ ${ai.localUrl}` : provider === "claude" ? ` ${ai.claudeModel}` : ""}${cfg.publicDemo ? "  |  PUBLIC_DEMO" : ""}`);
  });
}
