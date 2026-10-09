import { ethers } from "ethers";

export type RawLog = ethers.providers.Log;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * eth_getLogs over [from, to] in fixed-size chunks (Monad's public RPC caps a range at 100 blocks),
 * a few workers in parallel, with exponential backoff. Returns logs sorted by (block, logIndex).
 */
export async function getLogsChunked(
  provider: ethers.providers.JsonRpcProvider,
  filter: { address?: string; topics?: (string | string[] | null)[] },
  from: number,
  to: number,
  chunk = 100,
  workers = 4,
): Promise<RawLog[]> {
  const starts: number[] = [];
  for (let b = from; b <= to; b += chunk) starts.push(b);
  const out: RawLog[][] = new Array(starts.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < starts.length) {
        const k = next++;
        const b = starts[k]!;
        for (let attempt = 0; ; attempt++) {
          try {
            out[k] = await provider.getLogs({ ...filter, fromBlock: b, toBlock: Math.min(to, b + chunk - 1) });
            break;
          } catch (e) {
            if (attempt >= 6) throw e;
            await sleep(400 * 2 ** attempt);
          }
        }
      }
    }),
  );
  return out
    .flat()
    .filter((l) => !l.removed)
    .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

export async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= tries - 1) throw e;
      await sleep(400 * 2 ** attempt);
    }
  }
}
