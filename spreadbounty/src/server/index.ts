/**
 * Spreadbounty API + web app server (node:http, no framework).
 *
 *   npm run serve            http://localhost:8787   (DATA_SOURCE=demo by default; DATA_SOURCE=live for mainnet)
 */
import "dotenv/config";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { z } from "zod";
import { decodeBookLogs, replay } from "../core/book";
import type { RawLog } from "../core/rpc";
import { DEFAULT_RPC } from "../core/chain";
import { epochMetrics, type Campaign, type EpochFile } from "../core/epoch";
import { leafHash, merkleProof, verifyProof } from "../core/score";
import { aiConfig, getLLM } from "../ai/llm";
import { designCampaign, PAIRS } from "../ai/pipeline";
import { writeEpochReport } from "../ai/report";
import { getSource, recentHistory } from "../data/source";
import { compareStrategies } from "../bot/sim";

const PORT = Number(process.env.PORT ?? 8787);
const WEB = "web/dist";
const src = getSource();
const ID = /^[a-z0-9-]{1,80}$/;

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const readBody = async (req: IncomingMessage) => {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > 100_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
};
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8"));
const campaignPath = (id: string) => `${src.dir}/campaign-${id}.json`;
const epochPath = (id: string, n: number) => `${src.dir}/${id}/epoch-${n}.json`;

function listCampaigns() {
  if (!existsSync(src.dir)) return [];
  return readdirSync(src.dir)
    .filter((f) => /^campaign-.+\.json$/.test(f))
    .map((f) => readJson<Campaign & { rationale?: string }>(join(src.dir, f)))
    .map((c) => ({ ...c, epochs: listEpochs(c.id).length }))
    .sort((a, b) => b.replayFromBlock - a.replayFromBlock);
}
function listEpochs(id: string) {
  const dir = `${src.dir}/${id}`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => f.match(/^epoch-(\d+)\.json$/)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Every address that placed an order during the epoch, paid or not (shows who quoted but did not qualify). */
function makersSeen(id: string, n: number, e: EpochFile) {
  const bundle = epochPath(id, n).replace(".json", ".logs.json");
  if (!existsSync(bundle)) return [];
  const counts = new Map<string, number>();
  for (const ev of decodeBookLogs(readJson<RawLog[]>(bundle).filter((l) => l.blockNumber >= e.fromBlock && l.blockNumber <= e.toBlock)))
    if (ev.kind === "create") counts.set(ev.order.owner, (counts.get(ev.order.owner) ?? 0) + 1);
  return [...counts.entries()].map(([owner, orders]) => ({ owner, orders })).sort((a, b) => b.orders - a.orders);
}

/** Resting maker orders aggregated by price level: what the order book looks like now (from logs alone). */
async function bookSnapshot(pair: string, hours: number) {
  const m = await src.market(pair);
  const camp = listCampaigns().find((c) => c.market.toLowerCase() === m.market.toLowerCase());
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
async function botSim(id: string, n: number, size: number) {
  const key = `${id}:${n}:${size}`;
  if (simCache.has(key)) return simCache.get(key);
  const c = readJson<Campaign>(campaignPath(id));
  const baseline = existsSync(epochPath(id, n)) ? readJson<EpochFile>(epochPath(id, n)) : undefined;
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
  if (simCache.size > 50) simCache.clear();
  simCache.set(key, out);
  return out;
}

const CopilotIn = z.object({ goal: z.string().min(3).max(1000) });
const PublishIn = z.object({ campaign: z.record(z.string(), z.unknown()), rationale: z.string().max(4000).optional() });

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const p = url.pathname;
  const parts = p.split("/").filter(Boolean); // ["api", ...]

  if (p === "/api/config" && req.method === "GET") {
    const ai = aiConfig();
    return send(res, 200, {
      dataSource: src.kind,
      synthetic: src.kind === "demo",
      rpcUrl: src.kind === "live" ? process.env.RPC_URL ?? DEFAULT_RPC : null,
      ai: { provider: ai.provider, model: ai.provider === "claude" ? ai.claudeModel : ai.provider === "local" ? ai.localModel : null, endpoint: ai.provider === "local" ? ai.localUrl : null },
      pairs: PAIRS,
    });
  }
  if (p === "/api/ai/health" && req.method === "GET") {
    // one tiny round trip so a sponsor can see whether their local model (Ollama, LM Studio, llama.cpp...) answers
    const llm = getLLM();
    if (!llm) return send(res, 200, { ok: false, provider: "off", reason: "No model configured: rules and templates are used." });
    const t0 = Date.now();
    try {
      const out = await llm.text("Reply with the single word: ready", "Are you there?", 20);
      return send(res, 200, { ok: !!out, provider: llm.provider, model: llm.model, latencyMs: Date.now() - t0, reply: (out ?? "").slice(0, 60) });
    } catch (e: any) {
      return send(res, 200, { ok: false, provider: llm.provider, model: llm.model, latencyMs: Date.now() - t0, reason: String(e?.message ?? e).slice(0, 200) });
    }
  }
  if (p === "/api/market" && req.method === "GET") return send(res, 200, await src.market(url.searchParams.get("pair") ?? "AUSD/USDC"));
  if (p === "/api/book" && req.method === "GET") {
    const hours = Math.min(3, Math.max(0.1, Number(url.searchParams.get("hours") ?? 1)));
    return send(res, 200, await bookSnapshot(url.searchParams.get("pair") ?? "AUSD/USDC", hours));
  }
  if (p === "/api/blockhash" && req.method === "GET") {
    // demo only: in live mode the browser asks the RPC itself so verification doesn't trust this server
    if (src.kind !== "demo") return send(res, 400, { error: "live mode: fetch block hashes from the RPC directly" });
    const ns = (url.searchParams.get("n") ?? "").split(",").map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 2000);
    return send(res, 200, Object.fromEntries(await Promise.all(ns.map(async (n) => [n, await src.blockHash(n)]))));
  }

  if (p === "/api/copilot" && req.method === "POST") {
    const parsed = CopilotIn.safeParse(await readBody(req));
    if (!parsed.success) return send(res, 400, { error: "Describe the goal in a sentence (3 to 1000 characters)." });
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    const line = (o: unknown) => res.write(JSON.stringify(o) + "\n");
    try {
      const r = await designCampaign(parsed.data.goal, src, getLLM(), (s) => line({ type: "step", ...s }));
      line({ type: "result", ...r });
    } catch (e: any) {
      line({ type: "error", error: String(e?.message ?? e) });
    }
    return res.end();
  }

  if (parts[1] === "campaigns") {
    if (parts.length === 2 && req.method === "GET") return send(res, 200, listCampaigns());
    if (parts.length === 2 && req.method === "POST") {
      const body = PublishIn.safeParse(await readBody(req));
      if (!body.success) return send(res, 400, { error: "Missing campaign." });
      const c = body.data.campaign as unknown as Campaign;
      if (!ID.test(String(c.id))) return send(res, 400, { error: "Campaign id must be lowercase letters, digits and dashes." });
      mkdirSync(src.dir, { recursive: true });
      if (existsSync(campaignPath(c.id))) return send(res, 409, { error: "A campaign with this id is already published." });
      writeFileSync(campaignPath(c.id), JSON.stringify({ ...c, rationale: body.data.rationale }, null, 2));
      return send(res, 201, { id: c.id, path: campaignPath(c.id) });
    }
    const id = parts[2]!;
    if (!ID.test(id) || !existsSync(campaignPath(id))) return send(res, 404, { error: "No such campaign." });
    if (parts.length === 3) return send(res, 200, readJson(campaignPath(id)));
    if (parts[3] === "epochs" && parts.length === 4) {
      return send(res, 200, listEpochs(id).map((n) => {
        const e = readJson<EpochFile>(epochPath(id, n));
        return { n, fromBlock: e.fromBlock, toBlock: e.toBlock, root: e.root, metrics: epochMetrics(e), makersSeen: makersSeen(id, n, e), samples: e.samples.map((s) => ({ block: s.block, bidDepth: s.bidDepth, askDepth: s.askDepth, scored: s.scored })) };
      }));
    }
    if (parts[3] === "bot-sim" && parts.length === 4 && req.method === "GET") {
      const n = Number(url.searchParams.get("epoch") ?? 0);
      const size = Number(url.searchParams.get("size") ?? 2000);
      if (!Number.isInteger(n) || n < 0 || !existsSync(epochPath(id, n))) return send(res, 400, { error: "Pick a closed epoch." });
      if (!(size > 0 && size <= 1e9)) return send(res, 400, { error: "Size per side must be a positive number." });
      return send(res, 200, await botSim(id, n, size));
    }
    const n = Number(parts[4]);
    if (parts[3] === "epochs" && Number.isInteger(n) && existsSync(epochPath(id, n))) {
      const e = readJson<EpochFile>(epochPath(id, n));
      if (parts.length === 5) return send(res, 200, e);
      if (parts[5] === "logs") {
        const bundle = epochPath(id, n).replace(".json", ".logs.json");
        if (!existsSync(bundle)) return send(res, 404, { error: "No log bundle; verify against the RPC instead." });
        res.writeHead(200, { "content-type": "application/json" });
        return createReadStream(bundle).pipe(res);
      }
      if (parts[5] === "claim" && parts[6]) {
        const acct = parts[6].toLowerCase();
        const entries = e.cumulative.map((c) => [c.account, BigInt(c.amount)] as [string, bigint]);
        const entry = entries.find(([a]) => a === acct);
        if (!entry) return send(res, 404, { error: "This address has nothing to claim in this epoch." });
        const proof = merkleProof(entries, entry[0], entry[1]);
        return send(res, 200, { account: entry[0], cumulativeAmount: entry[1].toString(), root: e.root, proof, verifies: verifyProof(proof, e.root, leafHash(entry[0], entry[1])) });
      }
      if (parts[5] === "report" && req.method === "POST") {
        const prev = n > 0 && existsSync(epochPath(id, n - 1)) ? readJson<EpochFile>(epochPath(id, n - 1)) : null;
        return send(res, 200, await writeEpochReport(e, prev, getLLM()));
      }
    }
  }
  return send(res, 404, { error: "Not found." });
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png" };

function staticFile(res: ServerResponse, pathname: string) {
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let file = join(WEB, safe);
  if (!file.startsWith(WEB) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB, "index.html");
  if (!existsSync(file)) {
    res.writeHead(503, { "content-type": "text/plain" });
    return res.end("Web app not built. Run `npm run build:web`, or use `npm run dev` for the dev server.");
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else staticFile(res, url.pathname);
  } catch (e: any) {
    if (!res.headersSent) send(res, 500, { error: String(e?.message ?? e) });
    else res.end();
  }
}).listen(PORT, () => {
  const ai = aiConfig();
  console.log(`Spreadbounty on http://localhost:${PORT}  |  data: ${src.kind}${src.kind === "demo" ? " (synthetic)" : ""}  |  ai: ${ai.provider}${ai.provider === "local" ? ` ${ai.localModel} @ ${ai.localUrl}` : ai.provider === "claude" ? ` ${ai.claudeModel}` : ""}`);
});
