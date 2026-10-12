import { ethers } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import { verifyEpoch, type EpochFile } from "../../../src/core/epoch";
import type { RawLog } from "../../../src/core/rpc";
import { merkleRoot } from "../../../src/core/score";
import { api, fmt, type CampaignRow, type Config, type EpochSummary } from "../api";
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
  const demo = config?.dataSource !== "live";

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
    const push = async (l: TapeLine) => {
      await pace();
      if (id !== runId.current) throw STOP;
      list.push(l);
      setLines([...list]);
    };
    const dec = 10 ** campaign.rewardDecimals;
    const quote = campaign.pair.split("/")[1] ?? "";
    try {
      const files = await Promise.all(Array.from({ length: n + 1 }, (_, k) => api.epoch(campaign.id, k)));
      await push({ id: "files", fig: String(files.length), text: `epoch file${files.length === 1 ? "" : "s"} downloaded`, sym: "#" });
      const logs = await api.logs(campaign.id, n);
      await push({ id: "logs", fig: fmt.n(logs.length), text: "order logs", sym: "#" });
      let hash: (b: number) => Promise<string>;
      if (demo) {
        hash = async (b) => ethers.utils.id(`spreadbounty-demo-block-${b}`);
        await push({ id: "hash", fig: "keccak", text: "block hashes, demo formula", sym: "#" });
      } else {
        const p = new ethers.providers.StaticJsonRpcProvider(config.rpcUrl!, 143);
        const cache = new Map<number, string>();
        hash = async (b) => cache.get(b) ?? (await p.getBlock(b).then((x) => (cache.set(b, x.hash), x.hash)));
        await hash(files[n]!.toBlock);
        await push({ id: "hash", fig: "rpc", text: "block hashes from the RPC", sym: "#" });
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
      if (id === runId.current) setError(String(e?.message ?? e));
    }
    if (id === runId.current) setBusy(false);
  };

  return { epochs, n, pick, forged, setForged, run, busy, lines, checks, outcome, error, demo, reload: loadEpochs };
}
