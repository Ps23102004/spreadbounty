import { ethers } from "ethers";
import { CHAIN_ID } from "../../../src/core/chain";
import { fetchBookLogs } from "../../../src/core/fetch";
import type { RawLog } from "../../../src/core/rpc";

/** Where Verify reads order logs: straight from a Monad RPC, or from this server's bundle. */
export type LogSource = "rpc" | "bundle";

/** The trust note shown whenever logs come from the server instead of the chain. */
export const BUNDLE_NOTE = "logs come from this server's bundle; run `sb verify` for a chain-only check";

const brief = (e: any) => String(e?.error?.message ?? e?.reason ?? e?.message ?? e).slice(0, 140);

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
  const p = new ethers.providers.StaticJsonRpcProvider(rpcUrl, CHAIN_ID);
  const total = Math.ceil((to - from + 1) / 100);
  const get = p.getLogs.bind(p);
  let done = 0;
  let failed = "";
  p.getLogs = async (f: Parameters<typeof get>[0]) => {
    if (on.stale()) throw new Error("stale run"); // a newer run started: stop asking the RPC
    const { fromBlock, toBlock } = (await f) as ethers.providers.Filter;
    const request = `eth_getLogs ${host} blocks ${fromBlock}–${toBlock}`;
    try {
      const logs = await get(f);
      on.progress(++done, total);
      return logs;
    } catch (e) {
      failed = request;
      on.retry(request, brief(e));
      throw e;
    }
  };
  try {
    return await fetchBookLogs(p, market, from, to);
  } catch (e) {
    throw new Error(`${failed || `eth_getLogs ${host}`} failed: ${brief(e)}`);
  }
}
