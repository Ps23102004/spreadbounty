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
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { decodeBookLogs, replay } from "../core/book";
import type { RawLog } from "../core/rpc";
import { DEFAULT_RPC } from "../core/chain";
import { epochMetrics, type Campaign, type EpochFile } from "../core/epoch";
import { leafHash, merkleProof, verifyProof } from "../core/score";
import { aiConfig, getLLM, type LLM } from "../ai/llm";
import { designCampaign, PAIRS } from "../ai/pipeline";
import { writeEpochReport } from "../ai/report";
import { getSource, recentHistory, type DataSource } from "../data/source";
import { compareStrategies } from "../bot/sim";
import {
  Address, assertSameOrigin, BlockhashQuery, BookQuery, BotSimQuery, clientIp, firstIssue, HttpError, internalError, MarketQuery,
  PublishIn, query, RateLimiter, rateRule, readJsonBody, serverConfig, setSecurityHeaders, type ServerConfig,
} from "./security";

const WEB = join(import.meta.dirname, "../../web/dist");
const ID = /^[a-z0-9-]{1,80}$/;
const BOOK_TTL_MS = 15_000;
const COPILOT_CONCURRENCY = 2;

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
        return c.success ? [c.data as unknown as Campaign & { rationale?: string }] : [];
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
  const camp = listCampaigns(src).find((c) => c.market.toLowerCase() === m.market.toLowerCase());
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

/** What route handlers share. */
interface Ctx {
  src: DataSource;
  cfg: ServerConfig;
  log: (m: string) => void;
  /** The server-side model, or null when it is off (always off on PUBLIC_DEMO unless SERVER_AI=on). */
  llm: () => LLM | null;
  copilotRunning: { n: number };
}

// ---------------- AI routes (gamma's A6 extension points) ----------------
/** POST /api/copilot body. A6 adds `intent?` (IntentSchema) and `brief?: "server" | "none"` here. Unknown keys are stripped. */
export const CopilotIn = z.object({ goal: z.string().min(3).max(1000) });

/** POST /api/copilot: streams one JSON object per line (steps, then the result). At most 2 run at once, server-wide. */
async function copilot(req: IncomingMessage, res: ServerResponse, ctx: Ctx) {
  const parsed = CopilotIn.safeParse(await readJsonBody(req));
  if (!parsed.success) return send(res, 400, { error: "Describe the goal in a sentence (3 to 1000 characters)." });
  if (ctx.copilotRunning.n >= COPILOT_CONCURRENCY) return send(res, 429, { error: "The copilot is busy. Try again in a few seconds." }, { "Retry-After": "5" });
  ctx.copilotRunning.n++;
  try {
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    const line = (o: unknown) => res.write(JSON.stringify(o) + "\n");
    try {
      const r = await designCampaign(parsed.data.goal, ctx.src, ctx.llm(), (s) => line({ type: "step", ...s }));
      line({ type: "result", ...r });
    } catch (e) {
      line({ type: "error", ...internalError(e, ctx.log) });
    }
    res.end();
  } finally {
    ctx.copilotRunning.n--;
  }
}

/** POST /api/campaigns/:id/epochs/:n/report. A6 reads `?narrate=none` from `url` here and returns `{ facts, template, root }`. */
async function epochReport(_url: URL, ctx: Ctx, id: string, n: number, e: EpochFile) {
  const prevPath = epochPath(ctx.src, id, n - 1);
  const prev = n > 0 && existsSync(prevPath) ? readJson<EpochFile>(prevPath) : null;
  return writeEpochReport(e, prev, ctx.llm());
}

// ---------------- campaigns ----------------
async function publish(req: IncomingMessage, ctx: Ctx) {
  const body = parse(PublishIn, await readJsonBody(req), true);
  const c = body.campaign;
  // the campaign must describe the real book for its pair, or Overview and Verify would label the wrong market
  const m = await ctx.src.market(c.pair);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!same(c.market, m.market) || !same(c.implementation, m.implementation) || c.pricePrecision !== m.pricePrecision || c.sizePrecision !== m.sizePrecision)
    throw new HttpError(400, `campaign: market details do not match the ${c.pair} book.`);
  if (ctx.cfg.publicDemo && listCampaigns(ctx.src).length >= 50) throw new HttpError(429, "This demo server holds 50 campaigns already.", { "Retry-After": "86400" });
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
  const id = parts[2];
  if (!id || !ID.test(id) || !existsSync(campaignPath(src, id))) return send(res, 404, { error: "No such campaign." });
  if (parts.length === 3) return send(res, 200, readJson(campaignPath(src, id)));
  if (parts[3] === "epochs" && parts.length === 4) {
    return send(res, 200, listEpochs(src, id).map((n) => {
      const e = readJson<EpochFile>(epochPath(src, id, n));
      return { n, fromBlock: e.fromBlock, toBlock: e.toBlock, root: e.root, metrics: epochMetrics(e), makersSeen: makersSeen(src, id, n, e), samples: e.samples.map((s) => ({ block: s.block, bidDepth: s.bidDepth, askDepth: s.askDepth, scored: s.scored })) };
    }));
  }
  if (parts[3] === "drop" && parts.length === 4 && req.method === "GET") {
    const f = `${src.dir}/${id}/drop.json`;
    return existsSync(f) ? send(res, 200, readJson(f)) : send(res, 404, { error: "No claim contract deployed for this campaign." });
  }
  if (parts[3] === "bot-sim" && parts.length === 4 && req.method === "GET") {
    const q = BotSimQuery.safeParse(query(url));
    if (!q.success) return send(res, 400, { error: "Pick a closed epoch and a size per side from 1 to 10,000,000." });
    if (!existsSync(epochPath(src, id, q.data.epoch))) return send(res, 400, { error: "Pick a closed epoch." });
    return send(res, 200, await botSim(src, id, q.data.epoch, q.data.size));
  }
  const n = Number(parts[4]);
  if (parts[3] === "epochs" && /^\d{1,7}$/.test(parts[4] ?? "") && existsSync(epochPath(src, id, n))) {
    const e = readJson<EpochFile>(epochPath(src, id, n));
    if (parts.length === 5) return send(res, 200, e);
    if (parts[5] === "logs" && parts.length === 6) {
      const bundle = epochPath(src, id, n).replace(".json", ".logs.json");
      if (!existsSync(bundle)) return send(res, 404, { error: "No log bundle; verify against the RPC instead." });
      res.writeHead(200, { "content-type": "application/json" });
      return createReadStream(bundle).pipe(res);
    }
    if (parts[5] === "claim" && parts.length === 7) {
      const acct = parse(Address, parts[6]).toLowerCase();
      const entries = e.cumulative.map((c) => [c.account, BigInt(c.amount)] as [string, bigint]);
      const entry = entries.find(([a]) => a === acct);
      if (!entry) return send(res, 404, { error: "This address has nothing to claim in this epoch." });
      const proof = merkleProof(entries, entry[0], entry[1]);
      return send(res, 200, { account: entry[0], cumulativeAmount: entry[1].toString(), root: e.root, proof, verifies: verifyProof(proof, e.root, leafHash(entry[0], entry[1])) });
    }
    if (parts[5] === "report" && parts.length === 6 && req.method === "POST") return send(res, 200, await epochReport(url, ctx, id, n, e));
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
  const ctx: Ctx = {
    src: opts.src ?? getSource(),
    cfg,
    log: opts.log ?? console.error,
    llm: () => (cfg.serverAiOff ? null : getLLM()),
    copilotRunning: { n: 0 },
  };
  const { src } = ctx;
  const now = opts.now ?? Date.now;
  const limiter = new RateLimiter(now);

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
    const p = url.pathname;
    const parts = p.split("/").filter(Boolean); // ["api", ...]
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
  const sweeper = setInterval(() => limiter.sweep(), 60_000);
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
  createReadStream(file).pipe(res);
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
