import { ethers } from "ethers";
import { CHAIN_ID } from "../../../src/core/chain";
import { fetchBookLogs } from "../../../src/core/fetch";
import type { RawLog } from "../../../src/core/rpc";

/** Where Verify reads order logs: straight from a Monad RPC, or from this server's bundle. */
export type LogSource = "rpc" | "bundle";

/** The trust note shown whenever logs come from the server instead of the chain. */
export const BUNDLE_NOTE = "logs come from this server's bundle; run `sb verify` for a chain-only check";

const brief = (e: any) => `${e?.status ? `HTTP ${e.status} ` : ""}${e?.error?.message ?? e?.reason ?? e?.message ?? e}`.slice(0, 140);

/**
 * B1 (delta): a campaign's book logs straight from a Monad RPC, in the browser. Same code as the CLI:
 * `fetchBookLogs` -> `getLogsChunked`, 100-block eth_getLogs requests with exponential backoff. Reports each finished
 * request and each failed one; a final failure throws naming the request that failed.
 */
export async function rpcLogs(
  rpcUrl: string,
  market: string,
  from: number,
  to: number,
  on: { stale: () => boolean; progress: (done: number, total: number) => void; retry: (request: string, error: string) => void },
): Promise<RawLog[]> {
  const host = new URL(rpcUrl).host;
  const p = new ethers.providers.StaticJsonRpcProvider({ url: rpcUrl, throttleLimit: 1 }, CHAIN_ID); // ethers retries a 429 up to 12 times by default (minutes); core backs off per chunk
  const total = Math.ceil((to - from + 1) / 100);
  const get = p.getLogs.bind(p);
  let done = 0;
  let over = false; // set once the fetch gave up: the other workers stop asking and stop printing
  const requestOf = new WeakMap<object, string>();
  p.getLogs = async (f: Parameters<typeof get>[0]) => {
    if (over || on.stale()) throw new Error("stopped"); // gave up, or a newer run started
    const { fromBlock, toBlock } = (await f) as ethers.providers.Filter;
    const request = `eth_getLogs ${host} blocks ${fromBlock}–${toBlock}`;
    try {
      const logs = await get(f);
      on.progress(++done, total);
      return logs;
    } catch (e) {
      if (e && typeof e === "object") requestOf.set(e, request);
      if (!over) on.retry(request, brief(e));
      throw e;
    }
  };
  try {
    return await fetchBookLogs(p, market, from, to);
  } catch (e) {
    over = true;
    throw new Error(`${(e && typeof e === "object" && requestOf.get(e)) || `eth_getLogs ${host}`} failed: ${brief(e)}`);
  }
}
