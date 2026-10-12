import { fmt, makerName, type CampaignRow, type Config } from "../api";
import { ErrorNote, PageHead, Schedule, Skeleton } from "../ui/Schedule";
import { SourceLabel } from "../ui/SourceLabel";
import { Stamp } from "../ui/Stamp";
import { Tape } from "../ui/Tape";
import { Tick } from "../ui/Tick";
import { useRecompute } from "../ui/useRecompute";
import { HashDiff } from "../ui/HashDiff";
import { SamplingStrip } from "../ui/SamplingStrip";

/** W/P V: the full recompute. Same `useRecompute` as Start, so both reach the same verdict for the same epoch. */
export function Verify({ campaign, config }: { campaign: CampaignRow | null; config: Config | null }) {
  const rc = useRecompute(campaign, config);
  const shadow = !!(campaign as { shadow?: boolean } | null)?.shadow;
  if (!campaign) return <p className="note">No campaign to verify yet. Design and publish one first.</p>;
  const label = <SourceLabel config={config} campaign={campaign} />;
  const sel = rc.epochs?.find((e) => e.n === rc.n) ?? null;
  const out = rc.outcome;
  const dec = 10 ** campaign.rewardDecimals;
  const quote = campaign.pair.split("/")[1];

  return (
    <>
      <section className="page-head">
        <PageHead wp="V" title={`Recompute · ${campaign.pair}`}>{label}</PageHead>
        <h1>Don't trust the payout list. Recompute it.</h1>
        <p>Your browser downloads the public order logs and runs the same scoring code the operator ran: replay every order, pick sample blocks from block hashes, score two-sided depth, split the budget, build the Merkle root. Change one number and the roots stop matching.</p>
      </section>

      <Schedule id="V-1" title="What to recompute">
        {rc.epochs === null && !rc.error ? <Skeleton rows={2} h={28} /> : rc.epochs?.length === 0 ? (
          <p className="ink2">No closed epoch to verify yet. Epoch 0 closes {fmt.n(campaign.epochBlocks)} blocks after block {fmt.n(campaign.replayFromBlock)}.</p>
        ) : (
          <div className="controls">
            <label className="field">
              <span className="label">Up to epoch</span>
              <select value={rc.n ?? ""} onChange={(e) => rc.pick(Number(e.target.value))}>
                {(rc.epochs ?? []).map((e) => <option key={e.n} value={e.n}>{e.n}</option>)}
              </select>
            </label>
            <label className="switch">
              <input type="checkbox" checked={rc.forged} onChange={(e) => rc.setForged(e.target.checked)} />
              Forge a payout
            </label>
            <button className="btn recompute" onClick={() => { if (innerWidth < 880) document.getElementById("sch-V-2")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); rc.run(); }} disabled={rc.busy || rc.n === null || !config}>
              {rc.busy ? <><span className="spinner" aria-hidden /> Recomputing…</> : "Recompute in this browser"}
            </button>
          </div>
        )}
        {rc.forged && <p className="note">The forged copy pays the top maker 1 extra token and carries a matching, well-formed Merkle root, so it looks valid on its own. Only recomputing from the logs exposes it.</p>}
        {rc.error && <ErrorNote onRetry={rc.epochs ? rc.run : rc.reload}>{rc.error}</ErrorNote>}
      </Schedule>

      <div className="verify-grid">
        <Schedule id="V-2" title="Tape" desc="One line per finished step, printed by your browser." source={label}>
          <Tape lines={rc.lines} label="Recompute steps" empty="Nothing printed yet. Press Recompute in this browser." />
        </Schedule>

        <Schedule id="V-3" title="Roots" source={label}
          footer={<span>Computed by <b>the scorer in src/core</b> · Checked by {out ? <b className={out.ok ? "" : "bad-ink"}>your browser {out.ok ? <Tick /> : <Tick kind="exception" />}</b> : <b>nobody here yet</b>}</span>}>
          <div className="roots v-roots">
            <div className="root-row"><span className="label">Committed</span><span className="hash">{out?.committed ?? sel?.root ?? "…"}</span></div>
            <div className="root-row"><span className="label">Recomputed</span>{out ? <HashDiff a={out.committed} b={out.recomputed} /> : <span className="hash muted">not yet, in this browser</span>}</div>
          </div>
          <div className="v-verdict">
            <Stamp result={out} />
            <p className={out ? (out.ok ? "ok" : "bad-ink") : "muted"}>
              {out
                ? out.ok
                  ? `Every sample, score, payout and the root match. Your browser did the math in ${fmt.n(out.ms)} ms. ${shadow ? "Nothing was paid: this is what these makers would have earned." : "Makers can claim against this root."}`
                  : `${out.forgedWho ? `${makerName(out.forgedWho)} was given 1 extra token. ` : ""}The logs don't support this payout list. Fields that differ: ${out.diffs.join(", ")}.`
                : "The verdict prints here once the last epoch is rebuilt."}
            </p>
          </div>
          <table className="v-epochs">
            <thead><tr><th>Epoch</th><th className="r">Samples</th><th className="r">{shadow ? "Would earn" : "Makers paid"}</th><th className="r">{shadow ? "Would earn" : "Paid"} ({quote})</th><th className="r"><span className="sr-only">Check</span></th></tr></thead>
            <tbody>
              {(rc.epochs ?? []).filter((e) => rc.n === null || e.n <= rc.n).map((e) => {
                const c = rc.checks.find((x) => x.epoch === e.n);
                return (
                  <tr key={e.n}>
                    <td>{e.n}</td>
                    <td className="r">{c ? c.samples : e.samples.length}</td>
                    <td className="r">{c ? c.makersPaid : "–"}</td>
                    <td className="r">{c ? fmt.usd(Number(c.paid) / dec) : "–"}</td>
                    <td className="r tickcol">{c ? <Tick kind={c.ok ? "agreed" : "exception"} /> : <Tick kind="pending" />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Schedule>
      </div>

      <Schedule id="V-4" title="Sampling strip" desc={`Which blocks counted in epoch ${rc.n ?? ""}, and why nobody could choose them in advance.`} source={label}>
        <SamplingStrip campaign={campaign} n={rc.n} demo={rc.demo} />
      </Schedule>

      <Schedule id="V-5" title="What this proves, plainly">
        {rc.demo ? (
          <p className="ink2">This server runs the synthetic demo, so block hashes come from a fixed formula, <code>keccak256("spreadbounty-demo-block-&lt;n&gt;")</code>, computed here. The check is real: the same logs and hashes always give the same root, and the forged copy fails. On Monad the hashes come from the RPC, so nobody can pick convenient sample blocks.</p>
        ) : rc.logSource === "rpc" ? (
          <p className="ink2">Your browser fetched the logs itself, straight from the Monad RPC in 100-block chunks (open the Network tab and look for <code>eth_getLogs</code>), and the block hashes come from the same RPC. No file from this server is trusted for the check. {shadow ? "This campaign is a back-dated shadow campaign on real Kuru books: nobody was paid." : ""}</p>
        ) : (
          <p className="ink2">Logs come from this server's bundle and are checked against the committed digest; block hashes come straight from the RPC you can see in the Network tab. For a fully independent check, run <code>npm run sb -- verify</code> against the campaign file, which reads the chain only.</p>
        )}
      </Schedule>
    </>
  );
}
