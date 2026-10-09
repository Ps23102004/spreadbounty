import { ethers } from "ethers";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { verifyEpoch } from "../../../src/core/epoch";
import { merkleRoot } from "../../../src/core/score";
import { api, fmt, makerName, type CampaignRow, type Config, type EpochFile, type EpochSummary } from "../api";
import { Reveal, Steps, type StepState } from "../ui/bits";

type Row = { key: string; title: string; detail?: string; state: StepState };
interface Outcome { ok: boolean; committed: string; recomputed: string; diffs: string[]; ms: number; forged: string | null }

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Add 1 token to the top maker's payout and rebuild a self-consistent Merkle root: what a dishonest operator would publish. */
function forge(f: EpochFile): { file: EpochFile; who: string } {
  const top = [...f.amounts].sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1))[0]!;
  const bump = BigInt(10 ** f.campaign.rewardDecimals);
  const amounts = f.amounts.map((a) => (a.account === top.account ? { ...a, amount: (BigInt(a.amount) + bump).toString() } : a));
  const cumulative = f.cumulative.map((a) => (a.account === top.account ? { ...a, amount: (BigInt(a.amount) + bump).toString() } : a));
  const root = merkleRoot(cumulative.map((c) => [c.account, BigInt(c.amount)] as [string, bigint]));
  return { file: { ...f, amounts, cumulative, root }, who: top.account };
}

export function Verify({ campaign, config }: { campaign: CampaignRow | null; config: Config | null }) {
  const [epochs, setEpochs] = useState<EpochSummary[]>([]);
  const [n, setN] = useState<number | null>(null);
  const [forged, setForged] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [out, setOut] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    api.epochs(campaign.id).then((es) => { setEpochs(es); setN(es.length ? es[es.length - 1]!.n : null); });
    setRows([]);
    setOut(null);
  }, [campaign?.id]);

  if (!campaign) return <p className="muted">No campaign to verify yet.</p>;
  const demo = config?.dataSource !== "live";

  const run = async () => {
    if (n === null) return;
    setBusy(true);
    setOut(null);
    const t0 = performance.now();
    const list: Row[] = [];
    const push = (r: Row) => { list.push(r); setRows([...list]); };
    const update = (key: string, patch: Partial<Row>) => { const i = list.findIndex((r) => r.key === key); list[i] = { ...list[i]!, ...patch }; setRows([...list]); };
    try {
      push({ key: "files", title: "Download the committed results", state: "running" });
      const files: EpochFile[] = [];
      for (let k = 0; k <= n; k++) files.push(await api.epoch(campaign.id, k));
      let forgedWho: string | null = null;
      if (forged) {
        const f = forge(files[n]!);
        files[n] = f.file;
        forgedWho = f.who;
      }
      update("files", { state: "done", detail: `${files.length} epoch file${files.length > 1 ? "s" : ""}; epoch ${n} commits root ${fmt.short(files[n]!.root)}${forged ? " (tampered copy)" : ""}` });

      push({ key: "logs", title: "Download the order-book logs", state: "running" });
      const logs = await api.logs(campaign.id, n);
      update("logs", { state: "done", detail: `${fmt.n(logs.length)} OrderCreated / Canceled / Trade logs from block ${fmt.n(campaign.replayFromBlock)} to ${fmt.n(files[n]!.toBlock)}. Their digest is checked against the file below, so a missing or edited log is caught.` });

      push({ key: "hashes", title: "Get block hashes for sample selection", state: "running" });
      let hash: (b: number) => Promise<string>;
      if (demo) {
        hash = async (b) => ethers.utils.id(`spreadbounty-demo-block-${b}`);
        update("hashes", { state: "done", detail: "Demo chain: hashes are keccak256(\"spreadbounty-demo-block-<n>\"), computed here. On mainnet they come from the RPC, so nobody can pick convenient sample blocks." });
      } else {
        const p = new ethers.providers.StaticJsonRpcProvider(config!.rpcUrl!, 143);
        const cache = new Map<number, string>();
        hash = async (b) => cache.get(b) ?? (await p.getBlock(b).then((x) => (cache.set(b, x.hash), x.hash)));
        await hash(files[n]!.toBlock);
        update("hashes", { state: "done", detail: `From ${config!.rpcUrl} directly, not from this server.` });
      }

      let prev: EpochFile | null = null;
      let last: Awaited<ReturnType<typeof verifyEpoch>> | null = null;
      for (const f of files) {
        const key = `e${f.epoch}`;
        push({ key, title: `Replay the book and score epoch ${f.epoch}`, state: "running" });
        await tick();
        const t = performance.now();
        last = await verifyEpoch(f, logs, hash, prev);
        const paid = last.recomputed.amounts.length;
        update(key, {
          state: last.ok ? "done" : "bad",
          detail: last.ok
            ? `${f.samples.length} sampled blocks, ${paid} maker${paid === 1 ? "" : "s"} paid, every field matches (${Math.round(performance.now() - t)} ms)`
            : `Mismatch in ${last.diffs.map((d) => d.split(":")[0]).join(", ")}`,
        });
        if (!last.ok) break;
        prev = f;
      }
      const target = files[files.length - 1]!;
      setOut({ ok: !!last?.ok && last.recomputed.epoch === target.epoch, committed: target.root, recomputed: last!.recomputed.root, diffs: last!.diffs, ms: Math.round(performance.now() - t0), forged: forgedWho });
    } catch (e: any) {
      push({ key: "err", title: "Could not finish", detail: String(e?.message ?? e), state: "bad" });
    }
    setBusy(false);
  };

  return (
    <>
      <section className="page-head">
        <span className="label">Verify · {campaign.pair}</span>
        <h1>Don't trust the payout list. Recompute it.</h1>
        <p>Your browser downloads the public order logs and runs the same scoring code the operator ran: replay every order, pick sample blocks from block hashes, score two-sided depth, split the budget, build the Merkle root. If one number was changed, the roots won't match.</p>
      </section>

      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <label className="label" htmlFor="vepoch">Up to epoch</label>
            <select id="vepoch" style={{ width: "auto" }} value={n ?? ""} onChange={(e) => setN(Number(e.target.value))}>
              {epochs.map((e) => <option key={e.n} value={e.n}>{e.n}</option>)}
            </select>
            <label className="switch"><input type="checkbox" checked={forged} onChange={(e) => setForged(e.target.checked)} /> Try a forged payout</label>
          </div>
          <button className="btn" onClick={run} disabled={busy || n === null}>{busy ? "Recomputing…" : "Recompute in this browser"}</button>
        </div>
        {forged && <p className="note">The tampered copy pays the top maker 1 extra token and carries a matching, well-formed Merkle root, so it looks valid on its own. Only recomputing from the logs exposes it.</p>}
        {!demo && <p className="note">Logs come from this server's bundle and are checked against the committed digest; block hashes come straight from the RPC. For a fully independent check, run <code>npm run sb -- verify out/{campaign.id}/epoch-{n}.json</code>, which pulls the logs from the chain too.</p>}
      </section>

      {rows.length > 0 && (
        <div className="grid-2">
          <section className="panel"><h2>Steps</h2><Steps items={rows} /></section>
          <AnimatePresence mode="wait">
            {out && (
              <Reveal key={String(out.ok) + out.committed}>
                <section className="panel" style={{ borderColor: out.ok ? "var(--good)" : "var(--critical)" }}>
                  <motion.div initial={{ scale: 1.25, opacity: 0, rotate: -4 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: "spring", bounce: 0.35, duration: 0.6 }}>
                    <span className={`stamp ${out.ok ? "good" : "bad"}`}>{out.ok ? "Verified" : "Mismatch: do not pay"}</span>
                  </motion.div>
                  <div className="roots">
                    <div className="root-row"><span className="label">Committed</span><span className="hash">{out.committed}</span></div>
                    <div className="root-row"><span className="label">Recomputed</span><HashDiff a={out.committed} b={out.recomputed} /></div>
                  </div>
                  <p className="ink2">
                    {out.ok
                      ? `Every sample, score, payout and the root match, recomputed in ${fmt.n(out.ms)} ms in your browser. Makers can claim against this root.`
                      : `${out.forged ? `${makerName(out.forged)} was given an extra token. ` : ""}The logs don't support this payout list. Fields that differ: ${out.diffs.map((d) => d.split(":")[0]).join(", ")}.`}
                  </p>
                </section>
              </Reveal>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

function HashDiff({ a, b }: { a: string; b: string }) {
  if (a === b) return <span className="hash">{b}</span>;
  return <span className="hash">{[...b].map((ch, i) => (ch === a[i] ? ch : <span key={i} className="diff">{ch}</span>))}</span>;
}
