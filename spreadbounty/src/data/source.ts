/**
 * Where market data comes from. `live` reads Monad mainnet over RPC; `demo` serves a deterministic
 * synthetic dataset (src/demo/generate.ts) so the app runs anywhere. Demo data is always labelled.
 */
import { existsSync, readFileSync } from "node:fs";
import { ethers } from "ethers";
import { BLOCK_SECONDS } from "../core/chain";
import { blockHashes, fetchBookLogs, provider, readMarket, resolveMarket } from "../core/fetch";
import type { RawLog } from "../core/rpc";

export type MarketInfo = Awaited<ReturnType<typeof readMarket>>;

export interface DataSource {
  kind: "live" | "demo";
  dir: string; // where campaign and epoch files live
  market(m: string): Promise<MarketInfo>;
  head(): Promise<number>;
  logs(market: string, from: number, to: number): Promise<RawLog[]>;
  blockHash(n: number): Promise<string>;
}

export const DEMO_DIR = "out/demo";
export const demoBlockHash = (n: number) => ethers.utils.id(`spreadbounty-demo-block-${n}`);

export function liveSource(): DataSource {
  const p = provider();
  const hash = blockHashes(p);
  return {
    kind: "live",
    dir: process.env.DATA_DIR ?? "out", // B1: DATA_DIR=data/shadow serves the committed shadow campaign
    market: (m) => readMarket(p, m),
    head: () => p.getBlockNumber(),
    logs: (market, from, to) => fetchBookLogs(p, resolveMarket(market), from, to),
    blockHash: hash,
  };
}

export function demoSource(): DataSource {
  const path = `${DEMO_DIR}/chain.json`;
  if (!existsSync(path)) throw new Error("demo data missing: run `npm run demo:gen`");
  const chain = JSON.parse(readFileSync(path, "utf8")) as { head: number; markets: Record<string, MarketInfo>; logs: Record<string, RawLog[]> };
  return {
    kind: "demo",
    dir: DEMO_DIR,
    async market(m) {
      const addr = resolveMarket(m).toLowerCase();
      const info = Object.values(chain.markets).find((x) => x.market.toLowerCase() === addr);
      if (!info) throw new Error(`demo has no market ${m}`);
      return { ...info, head: chain.head };
    },
    head: async () => chain.head,
    async logs(market, from, to) {
      const all = chain.logs[resolveMarket(market).toLowerCase()] ?? [];
      return all.filter((l) => l.blockNumber >= from && l.blockNumber <= to);
    },
    blockHash: async (n) => demoBlockHash(n),
  };
}

/** DATA_SOURCE=live reads Monad mainnet; anything else serves the labelled demo dataset. */
export function getSource(): DataSource {
  return process.env.DATA_SOURCE === "live" ? liveSource() : demoSource();
}

export async function recentHistory(src: DataSource, market: string, hours: number) {
  const head = await src.head();
  const from = head - Math.round((hours * 3600) / BLOCK_SECONDS);
  return { logs: await src.logs(market, from, head), from, to: head };
}
