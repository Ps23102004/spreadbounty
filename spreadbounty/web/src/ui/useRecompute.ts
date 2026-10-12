import { ethers } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_RPC } from "../../../src/core/chain";
import { verifyEpoch, type EpochFile } from "../../../src/core/epoch";
import { blockHashes } from "../../../src/core/fetch";
import type { RawLog } from "../../../src/core/rpc";
import { merkleRoot } from "../../../src/core/score";
import { api, fmt, type CampaignRow, type Config, type EpochSummary } from "../api";
import { BUNDLE_NOTE, rpcLogs, type LogSource } from "./logSource";
import { makePacer, type TapeLine } from "./pacer";

/** Add 1 token to the top maker's payout and rebuild a self-consistent Merkle root: what a dishonest operator would publish. */
export function forge(f: EpochFile): { file: EpochFile; who: string } {
  const top = [...f.amounts].sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1))[0]!;
  const bump = BigInt(10 ** f.campaign.rewardDecimals);
  const amounts = f.amounts.map((a) => (a.account === top.account ? { ...a, amount: (BigInt(a.amount) + bump).toString() } : a));
  const cumulative = f.cumulative.map((a) => (a.account === top.account ? { ...a, amount: (BigInt(a.amount) + bump).toString() } : a));
  const root = merkleRoot(cumulative.map((c) => [c.account, BigInt(c.amount)] as [string, bigint]));
  return { file: { ...f, amounts, cumulative, root }, who: top.account };
}

export interface EpochCheck { epoch: number; ok: boolean; samples: number; makersPaid: number; paid: bigint; diffs: string[]; ms: number }
export interface Outcome { ok: boolean; epoch: number; committed: string; recomputed: string; diffs: string[]; forgedWho: string | null; checks: EpochCheck[]; ms: number }

/**
 * The one recompute both Start and Verify run. Optionally forges the last file, then rebuilds every epoch
 * in order from the logs and block hashes with the production verifier, stopping at the first mismatch.
 * `ms` counts only the math (verifyEpoch), not downloads or display pacing.
 */
export async function recompute(
  files: EpochFile[],
  logs: RawLog[],
  hash: (block: number) => Promise<string>,
  forged: boolean,
  onEpoch?: (c: EpochCheck) => unknown,
): Promise<Outcome> {
  const fs = [...files];
  let forgedWho: string | null = null;
  if (forged) {
    const f = forge(fs[fs.length - 1]!);
    fs[fs.length - 1] = f.file;
    forgedWho = f.who;
  }
  const checks: EpochCheck[] = [];
  let prev: EpochFile | null = null;
  let last: Awaited<ReturnType<typeof verifyEpoch>> | null = null;
  for (const f of fs) {
    const t = performance.now();
    last = await verifyEpoch(f, logs, hash, prev);
    const c: EpochCheck = {
      epoch: f.epoch, ok: last.ok, samples: f.samples.length, makersPaid: last.recomputed.amounts.length,
      paid: last.recomputed.amounts.reduce((s, a) => s + BigInt(a.amount), 0n), diffs: last.diffs.map((d) => d.split(":")[0]!), ms: performance.now() - t,
    };
    checks.push(c);
    await onEpoch?.(c);
    if (!last.ok) break;
    prev = f;
  }
  const target = fs[fs.length - 1]!;
  return {
    ok: !!last?.ok && last.recomputed.epoch === target.epoch, epoch: target.epoch, committed: target.root, recomputed: last?.recomputed.root ?? "",
    diffs: last?.diffs.map((d) => d.split(":")[0]!) ?? [], forgedWho, checks, ms: Math.round(checks.reduce((s, c) => s + c.ms, 0)),
  };
}

/** Recomputes that passed in this browser session, for schedules that tick figures once checked here (Overview A-4). */
const passed = new Map<string, Outcome>();
export const checkedHere = (campaignId: string) => passed.get(campaignId) ?? null;

const STOP = Symbol("stale run");

/**
 * Downloads the epoch files and logs, picks the block-hash source, runs `recompute`, and prints each finished
 * step on the tape. Changing the epoch or the forge switch clears the result and cancels a run in flight.
 * Logs (B1, delta): on mainnet data (a live server, or a `shadow: true` campaign) they come straight from the Monad
 * RPC by default; if the RPC keeps failing, `logSource` switches to the server bundle and Retry uses it, with its note.
 */
export function useRecompute(campaign: CampaignRow | null, config: Config | null) {
  const [epochs, setEpochs] = useState<EpochSummary[] | null>(null);
  const [n, setN] = useState<number | null>(null);
  const [forged, setForgedState] = useState(false);
  const [lines, setLines] = useState<TapeLine[]>([]);
  const [checks, setChecks] = useState<EpochCheck[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);
  const onChain = config?.dataSource === "live" || !!(campaign as { shadow?: boolean } | null)?.shadow;
  const demo = !onChain;
  const [sourcePick, setLogSource] = useState<LogSource | null>(null);
  const logSource: LogSource = onChain ? sourcePick ?? "rpc" : "bundle";
  const rpcUrl = config?.rpcUrl ?? DEFAULT_RPC;

  const clear = useCallback(() => {
    runId.current++;
    setLines([]);
    setChecks([]);
    setOutcome(null);
    setError(null);
    setBusy(false);
  }, []);
  const loadEpochs = useCallback(() => {
    if (!campaign) return;
    clear();
    setLogSource(null);
    setEpochs(null);
    api.epochs(campaign.id)
      .then((es) => { setEpochs(es); setN(es.length ? es[es.length - 1]!.n : null); })
      .catch((e) => setError(`Couldn't list the epochs: ${String(e?.message ?? e)}`));
  }, [campaign?.id, clear]);
  useEffect(loadEpochs, [loadEpochs]);

  const setForged = (v: boolean) => { setForgedState(v); clear(); };
  const pick = (k: number) => { setN(k); clear(); };

  const run = async () => {
    if (!campaign || n === null || !config) return;
    const id = ++runId.current;
    setBusy(true);
    setOutcome(null);
    setError(null);
    setLines([]);
    setChecks([]);
    const list: TapeLine[] = [];
    const pace = makePacer();
    /** Print a line now, or reprint the line with the same id (progress). */
    const put = (l: TapeLine) => {
      if (id !== runId.current) return;
      const i = list.findIndex((x) => x.id === l.id);
      if (i >= 0) list[i] = l;
      else list.push(l);
      setLines([...list]);
    };
    const push = async (l: TapeLine) => {
      await pace();
      if (id !== runId.current) throw STOP;
      put(l);
    };
    let rpcFailed = false;
    const dec = 10 ** campaign.rewardDecimals;
    const quote = campaign.pair.split("/")[1] ?? "";
    try {
      const files = await Promise.all(Array.from({ length: n + 1 }, (_, k) => api.epoch(campaign.id, k)));
      await push({ id: "files", fig: String(files.length), text: `epoch file${files.length === 1 ? "" : "s"} downloaded`, sym: "#" });
      let logs: RawLog[];
      const host = new URL(rpcUrl).host;
      if (logSource === "rpc") {
        logs = await rpcLogs(rpcUrl, campaign.market, campaign.replayFromBlock, files[n]!.toBlock, {
          stale: () => id !== runId.current,
          progress: (d, t) => put({ id: "logs", fig: `${d}/${t}`, text: `eth_getLogs to ${host}, 100 blocks each`, sym: "#" }),
          retry: (req, err) => put({ id: "retry", fig: "retry", text: `${req} failed (${err}); backing off`, sym: "#" }),
        }).catch((e) => { rpcFailed = true; throw e; });
        await push({ id: "logs", fig: fmt.n(logs.length), text: `order logs from ${host}, direct`, sym: "#" });
      } else {
        logs = await api.logs(campaign.id, n);
        await push({ id: "logs", fig: fmt.n(logs.length), text: "order logs", sym: "#" });
        if (onChain) await push({ id: "trust", fig: "bundle", text: BUNDLE_NOTE, sym: "#" });
      }
      let hash: (b: number) => Promise<string>;
      if (demo) {
        hash = async (b) => ethers.utils.id(`spreadbounty-demo-block-${b}`);
        await push({ id: "hash", fig: "keccak", text: "block hashes, demo formula", sym: "#" });
      } else {
        hash = blockHashes(new ethers.providers.StaticJsonRpcProvider(rpcUrl, 143)); // cached, retried
        await hash(files[n]!.toBlock);
        await push({ id: "hash", fig: "rpc", text: `block hashes from ${host}`, sym: "#" });
      }
      const out = await recompute(files, logs, hash, forged, async (c) => {
        if (id !== runId.current) throw STOP;
        setChecks((cs) => [...cs, c]);
        await push(c.ok
          ? { id: `e${c.epoch}`, fig: String(c.samples), text: `samples · ${c.makersPaid} paid · epoch ${c.epoch}`, sym: "◇" }
          : { id: `e${c.epoch}`, fig: "mismatch", text: `${c.diffs.join(", ")} · epoch ${c.epoch}`, sym: "≠", red: true });
      });
      const last = out.checks[out.checks.length - 1]!;
      if (out.ok) {
        await push({ id: "paid", fig: fmt.usd(Number(last.paid) / dec), text: `${quote} paid · epoch ${out.epoch}`, sym: "+" });
        await push({ id: "root", fig: fmt.short(out.recomputed), text: `root · epoch ${out.epoch}`, sym: "*" });
        if (!forged) passed.set(campaign.id, out);
      } else {
        await push({ id: "committed", fig: fmt.short(out.committed), text: `committed root · epoch ${out.epoch}`, sym: "#", red: true });
        await push({ id: "root", fig: fmt.short(out.recomputed), text: `recomputed root · differs`, sym: "≠", red: true });
      }
      if (id === runId.current) setOutcome(out);
    } catch (e: any) {
      if (e === STOP) return;
      if (id === runId.current && rpcFailed) {
        // offer the server bundle: Retry now reads it, and says so on the tape
        setLogSource("bundle");
        put({ id: "retry", fig: "failed", text: String(e?.message ?? e), sym: "≠", red: true });
        setError(`The Monad RPC kept failing after retries with backoff: ${e?.message ?? e}. Retry recomputes from the server's bundle instead (${BUNDLE_NOTE}).`);
      } else if (id === runId.current) setError(String(e?.message ?? e));
    }
    if (id === runId.current) setBusy(false);
  };

  return { epochs, n, pick, forged, setForged, run, busy, lines, checks, outcome, error, demo, reload: loadEpochs, logSource, setLogSource, rpcUrl };
}
