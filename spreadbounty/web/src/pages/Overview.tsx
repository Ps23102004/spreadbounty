import { motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { report, type WriterReport } from "../ai/client";
import { writerLabel } from "../ai/providers";
import { api, fmt, makerName, type CampaignRow, type Config, type EpochFile, type EpochSummary } from "../api";
import { Provenance } from "../ui/bits";
import { BookLadder } from "../ui/BookLadder";
import { DepthChart, Legend, ViewToggle, type DepthPoint } from "../ui/charts";
import { LedgerTable, TickLegend, type Col } from "../ui/LedgerTable";
import { MarginNote } from "../ui/MarginNote";
import { useWriterSettings } from "../ui/ModelDialog";
import { EASE_ENTER, T } from "../ui/motion";
import { ErrorNote, PageHead, Schedule, Skeleton } from "../ui/Schedule";
import { SourceLabel } from "../ui/SourceLabel";
import { Tick } from "../ui/Tick";
import { checkedHere } from "../ui/useRecompute";

export type Status = "loading" | "ready" | "error";
const errText = (e: unknown) => String((e as Error)?.message ?? e);
/** Shadow campaigns (B1) carry a top-level `shadow: true` next to `rationale`; nothing in them was paid. */
const isShadow = (c: CampaignRow | null) => !!(c as { shadow?: boolean } | null)?.shadow;

/**
 * W/P A, the campaign ledger. Figures render at their final value (no count-up). Every block reserves its final
 * height while loading, so nothing below it moves when data lands.
 */
export function Overview({ campaign, campaigns, status, onPick, config, onRetry }: {
  campaign: CampaignRow | null; campaigns: CampaignRow[]; status: Status; onPick: (id: string) => void; config: Config | null; onRetry: () => void;
}) {
  const [epochs, setEpochs] = useState<EpochSummary[] | null>(null);
  const [epErr, setEpErr] = useState<string | null>(null);
  const [epTry, setEpTry] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [file, setFile] = useState<EpochFile | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [fileTry, setFileTry] = useState(0);
  const [table, setTable] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    let live = true;
    setEpochs(null);
    setEpErr(null);
    setSel(null);
    api.epochs(campaign.id)
      .then((es) => { if (live) { setEpochs(es); setSel(es.length ? es[es.length - 1]!.n : null); } })
      .catch((e) => live && setEpErr(errText(e)));
    return () => { live = false; };
  }, [campaign?.id, epTry]);
  useEffect(() => {
    if (!campaign || sel === null) return;
    let live = true;
    setFile(null);
    setFileErr(null);
    api.epoch(campaign.id, sel).then((f) => live && setFile(f)).catch((e) => live && setFileErr(errText(e)));
    return () => { live = false; };
  }, [campaign?.id, sel, fileTry]);

  const S = Number(campaign?.sizePrecision ?? 1);
  const points: DepthPoint[] = useMemo(
    () => (epochs ?? []).flatMap((e) => e.samples.map((s) => ({ block: s.block, bid: Number(s.bidDepth) / S, ask: Number(s.askDepth) / S, epoch: e.n }))),
    [epochs, S],
  );

  if (status === "error" && !campaign)
    return (
      <>
        <PageHead wp="A" title="Campaign ledger"><SourceLabel config={config} failed /></PageHead>
        <ErrorNote onRetry={onRetry}>Can't read the campaigns from this server, so there is no ledger to show.</ErrorNote>
      </>
    );
  if (status === "ready" && !campaign)
    return (
      <>
        <PageHead wp="A" title="Campaign ledger"><SourceLabel config={config} /></PageHead>
        <Schedule id="A-1" title="No campaign has closed an epoch yet">
          <p className="ink2">A sponsor describes the book they want in one sentence; the copilot backtests settings and drafts the campaign file.</p>
          <a className="btn" href="#design" style={{ justifySelf: "start" }}>Design a campaign</a>
        </Schedule>
      </>
    );

  const shadow = isShadow(campaign);
  const base = campaign?.pair.split("/")[0] ?? "";
  const quote = campaign?.pair.split("/")[1] ?? "";
  const cur = epochs?.find((e) => e.n === sel) ?? null;
  const prev = epochs?.find((e) => sel !== null && e.n === sel - 1) ?? null;
  const m = cur?.metrics ?? null;
  const waiting = !m && !epErr && !(epochs && epochs.length === 0); // still loading figures
  const label = <SourceLabel config={config} campaign={campaign} />;

  return (
    <>
      <section className="page-head ledger-head">
        <PageHead wp="A" title="Campaign ledger">
          {campaign && campaigns.length > 1 && (
            <label className="field">
              <span className="label">Campaign</span>
              <select value={campaign.id} onChange={(e) => onPick(e.target.value)}>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.pair} · {c.id} ({c.epochs} epoch{c.epochs === 1 ? "" : "s"})</option>)}
              </select>
            </label>
          )}
          {label}
        </PageHead>
        <Hero campaign={campaign} m={m} waiting={waiting} />
        {campaign ? <Terms campaign={campaign} /> : <ul className="terms" aria-hidden><li><span className="v skel-text">Band 15 bps · rest 20 blocks · budget 10.00 USDC / 60-min epoch</span></li></ul>}
      </section>

      {epErr && <ErrorNote onRetry={() => setEpTry((n) => n + 1)}>Couldn't list this campaign's epochs: {epErr}</ErrorNote>}

      {campaign && epochs && epochs.length === 0 ? (
        <Schedule id="A-1" title={`${campaign.pair} has not closed an epoch yet`} source={label}>
          <p className="ink2">Published. Epoch 0 starts at block {fmt.n(campaign.replayFromBlock)} and runs {fmt.n(campaign.epochBlocks)} blocks, about {epochMinutes(campaign)} minutes. The operator builds it once it closes:</p>
          <div className="code-block">npm run sb -- epoch {config?.dataSource === "demo" ? "out/demo" : "out"}/campaign-{campaign.id}.json 0</div>
          <p className="ink2">Nothing is paid until an epoch file and its Merkle root exist. <a href="#design">Design another campaign</a></p>
        </Schedule>
      ) : !epErr && (
        <>
          <div className="epoch-row">
            <span className="label" id="epoch-l">Epoch</span>
            {epochs && epochs.length > 0 ? (
              <div className="tabs" role="group" aria-labelledby="epoch-l">
                {epochs.map((e) => <button key={e.n} aria-pressed={e.n === sel} onClick={() => setSel(e.n)}>{e.n}</button>)}
              </div>
            ) : <span className="tabs skel-text" aria-hidden>0 1 2</span>}
            <span className="muted small num">{cur ? <>blocks {fmt.n(cur.fromBlock)} to {fmt.n(cur.toBlock)}</> : <span className="skel-text">blocks 111,974,000 to 111,985,999</span>}</span>
          </div>

          <div className="kpis" aria-busy={!m}>
            <Kpi label="Depth, thinner side" value={m && fmt.n(m.avgTwoSidedDepthQuote)} unit={quote} delta={m && prev ? change(m.avgTwoSidedDepthQuote, prev.metrics.avgTwoSidedDepthQuote, prev.n) : null} />
            <Kpi label="Cost per $1k of depth" value={m && (m.costPer1kDepthQuote === null ? "–" : fmt.usd(m.costPer1kDepthQuote))} unit={quote}
              delta={m && prev && m.costPer1kDepthQuote !== null && prev.metrics.costPer1kDepthQuote !== null ? change(m.costPer1kDepthQuote, prev.metrics.costPer1kDepthQuote, prev.n, true) : null} />
            <Kpi label={shadow ? "Would have paid, of budget" : "Paid of budget"} value={m && fmt.usd(m.paidRewardTokens)} unit={m ? `/ ${fmt.usd(m.budgetRewardTokens)}` : ""} delta={null} />
            <Kpi label={shadow ? "Makers who would have earned" : "Makers paid"} value={m && String(m.makersPaid)} unit={m ? `top ${fmt.pct(Math.round(m.topMakerSharePct * 10) / 10)}` : ""}
              delta={m && prev ? diff(m.makersPaid, prev.metrics.makersPaid, prev.n) : null} />
          </div>

          <div className="ledger-grid">
            <Schedule id="A-2" title="Depth inside the band" desc={`Resting orders that count, per sampled block, in ${base || "base units"}`} source={label}
              aside={<ViewToggle table={table} setTable={setTable} />}>
              {!epochs ? <Skeleton rows={8} h={33} /> : table ? (
                <div className="table-wrap" style={{ maxHeight: 290 }}>
                  <table>
                    <thead><tr><th>Epoch</th><th className="r">Block</th><th className="r">Bids</th><th className="r">Asks</th></tr></thead>
                    <tbody>{points.map((p) => <tr key={p.block}><td>{p.epoch}</td><td className="r">{fmt.n(p.block)}</td><td className="r">{fmt.n(p.bid)}</td><td className="r">{fmt.n(p.ask)}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  <Legend items={[{ label: "Bids in band", color: "var(--bid)" }, { label: "Asks in band", color: "var(--ask)" }]} />
                  <DepthChart points={points} unit={base} />
                </div>
              )}
            </Schedule>
            <Schedule id="A-3" title="The book now" desc="Maker orders resting in the last hour of logs. Highlighted rows sit inside the reward band." source={label}>
              {campaign ? <BookLadder campaign={campaign} depth={5} probe={false} /> : <Skeleton rows={12} h={28} />}
            </Schedule>

            <Payouts campaign={campaign} cur={cur} file={file} fileErr={fileErr} onRetry={() => setFileTry((n) => n + 1)} shadow={shadow} label={label} />
            {campaign && cur ? <ReportCard campaignId={campaign.id} n={cur.n} config={config} /> : (
              <Schedule id="A-5" title="Epoch report"><Skeleton rows={6} h={28} /></Schedule>
            )}
          </div>
          <TickLegend />
        </>
      )}
    </>
  );
}

function Hero({ campaign, m, waiting }: { campaign: CampaignRow | null; m: EpochSummary["metrics"] | null; waiting: boolean }) {
  const P = Number(campaign?.pricePrecision ?? 1);
  const ref = campaign?.refPrice ? `of ${(Number(campaign.refPrice) / P).toFixed(4)}` : "of mid";
  return (
    <div className="hero">
      <div className="stack hero-text">
        <h1>{campaign ? <>{campaign.pair}, two-sided within {campaign.bandBps} bps {ref}</> : <span className="skel-text">AUSD/USDC, two-sided within 15 bps of 1.0000</span>}</h1>
        <p className="hero-why">{campaign ? campaign.rationale ?? "" : <span className="skel-text">Demo campaign: keep AUSD/USDC two-sided within 15 bps of 1.0000 for 10 USDC per hour.</span>}</p>
      </div>
      <div className="hero-fig">
        {m ? (
          <>
            <div className="hero-figure">{fmt.pct(Math.round(m.twoSidedCoveragePct * 10) / 10).replace("%", "")}<small>%</small></div>
            <span className="muted small">of {m.samplesWithPrice} samples, epoch {m.epoch}</span>
          </>
        ) : (
          <>
            <div className="hero-figure">{waiting ? <span className="skel-text">100</span> : "–"}<small>%</small></div>
            <span className="muted small">{waiting ? <span className="skel-text">of 60 samples, epoch 2</span> : "no closed epoch"}</span>
          </>
        )}
      </div>
    </div>
  );
}

const epochMinutes = (c: CampaignRow) => Math.round((c.epochBlocks * 0.3) / 60);

/** The campaign's settings as filled-in form boxes. */
function Terms({ campaign: c }: { campaign: CampaignRow }) {
  const quote = c.pair.split("/")[1];
  return (
    <ul className="terms" aria-label="Campaign terms">
      <li><span className="k">Band</span><span className="v">{c.bandBps} bps</span></li>
      <li><span className="k">Rest</span><span className="v">≥ {c.minRestBlocks} blocks</span></li>
      <li><span className="k">Budget</span><span className="v">{fmt.usd(Number(c.budgetPerEpoch) / 10 ** c.rewardDecimals)} {quote} / {epochMinutes(c)}-min epoch</span></li>
      <li><span className="k">Sample</span><span className="v">every {c.sampleEvery} blocks</span></li>
    </ul>
  );
}

const change = (a: number, b: number, n: number, lowerIsBetter = false) => {
  if (!b) return null;
  const pct = ((a - b) / b) * 100;
  if (Math.round(pct) === 0) return `same as epoch ${n}`;
  return `${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(0)}% vs epoch ${n}${lowerIsBetter && pct < 0 ? ", cheaper" : ""}`;
};
const diff = (a: number, b: number, n: number) => (a === b ? `same as epoch ${n}` : `${a > b ? "up" : "down"} ${Math.abs(a - b)} vs epoch ${n}`);

/** One figure in the ruled KPI row. `value` null means loading: a placeholder at the same size, so nothing shifts. */
function Kpi({ label, value, unit, delta }: { label: string; value: string | null; unit: string; delta: string | null }) {
  return (
    <div className="kpi">
      <span className="label">{label}</span>
      <span>{value === null ? <span className="kpi-value skel-text">0,000</span> : <span className="kpi-value">{value}</span>} <span className="muted small">{unit}</span></span>
      <span className="kpi-delta">{delta ?? " "}</span>
    </div>
  );
}

interface PayRow { a: string; paid: number; cum: number; orders: number }

function Payouts({ campaign, cur, file, fileErr, onRetry, shadow, label }: {
  campaign: CampaignRow | null; cur: EpochSummary | null; file: EpochFile | null; fileErr: string | null; onRetry: () => void; shadow: boolean; label: ReactNode;
}) {
  const quote = campaign?.pair.split("/")[1] ?? "";
  const title = shadow ? "Who would have earned what" : "Who earned what";
  if (fileErr) return <Schedule id="A-4" title={title} source={label}><ErrorNote onRetry={onRetry}>Couldn't load the epoch file: {fileErr}</ErrorNote></Schedule>;
  if (!campaign || !cur || !file || file.epoch !== cur.n) return <Schedule id="A-4" title={title} desc={`${quote || "Payouts"}, this epoch and all epochs`} source={label}><Skeleton rows={7} h={41} /></Schedule>;

  const dec = 10 ** file.campaign.rewardDecimals;
  const paid = new Map(file.amounts.map((a) => [a.account, Number(a.amount) / dec]));
  const cum = new Map(file.cumulative.map((a) => [a.account, Number(a.amount) / dec]));
  const orders = new Map((cur.makersSeen ?? []).map((m) => [m.owner.toLowerCase(), m.orders]));
  const rows: PayRow[] = [...new Set([...paid.keys(), ...cum.keys(), ...orders.keys()])]
    .map((a) => ({ a, paid: paid.get(a) ?? 0, cum: cum.get(a) ?? 0, orders: orders.get(a) ?? 0 }))
    .sort((x, y) => y.paid - x.paid || y.orders - x.orders);
  const total = rows.reduce((s, r) => s + r.paid, 0);
  const totalCum = rows.reduce((s, r) => s + r.cum, 0);
  const unpaid = rows.filter((r) => !r.paid && r.orders > 0);

  // ticks only after this browser recomputed this epoch from the logs and the root matched
  const out = checkedHere(campaign.id);
  const passed = !!out?.checks.find((c) => c.epoch === file.epoch && c.ok) && (file.epoch !== out!.epoch || file.root === out!.committed);
  const earnHead = shadow ? "Would have earned" : "This epoch";

  const cols: Col<PayRow>[] = [
    { key: "maker", head: "Maker", cell: (r) => <span className="addr" title={r.a}>{makerName(r.a)}</span>, total: "Total" },
    { key: "orders", head: "Orders", num: true, cell: (r) => (cur.makersSeen ? fmt.n(r.orders) : "–"), total: cur.makersSeen ? fmt.n(rows.reduce((s, r) => s + r.orders, 0)) : "–" },
    {
      key: "share", head: "Share", cell: (r, i) => (
        <span className="track share" role="img" aria-label={`${total ? Math.round((r.paid / total) * 100) : 0}% of this epoch`}>
          <motion.span className="bar" style={{ originX: 0 }} initial={{ scaleX: 0 }} animate={{ scaleX: total ? r.paid / total : 0 }} transition={{ duration: T.scene, delay: Math.min(i * 0.03, 0.3), ease: EASE_ENTER }} />
        </span>
      ),
    },
    { key: "paid", head: earnHead, num: true, cell: (r) => (r.paid ? fmt.usd(r.paid) : "–"), total: fmt.usd(total) },
    { key: "cum", head: "All epochs", num: true, cell: (r) => (r.cum ? fmt.usd(r.cum) : "–"), total: fmt.usd(totalCum) },
  ];

  return (
    <Schedule id="A-4" title={title} desc={`${quote}, epoch ${file.epoch}${shadow ? ". Shadow campaign: nobody was paid" : ""}`} source={label}
      footer={<span>Computed by <b>the scorer in src/core</b> · Checked by {passed ? <b>your browser <Tick /></b> : <><b>nobody here yet</b> · <a href="#verify">Recompute</a></>}</span>}>
      <LedgerTable rows={rows} cols={cols} rowKey={(r) => r.a} rowClass={(r) => (r.paid ? undefined : "dim")} caption={`${title}, epoch ${file.epoch}`}
        tick={() => (passed ? "agreed" : "pending")}
        tickHead={passed ? "Checked" : <a href="#verify" className="tick-head">Not yet checked here. Recompute →</a>}
        footed={Math.abs(total - Number(cur.metrics.paidRewardTokens)) < 0.005} />
      {unpaid.length > 0 && (
        <MarginNote tone="red">
          {unpaid.map((r) => makerName(r.a)).join(", ")} placed {fmt.n(unpaid.reduce((s, r) => s + r.orders, 0))} orders and earned nothing: no order rested inside {file.campaign.bandBps} bps for {file.campaign.minRestBlocks}+ blocks at a sampled block. Flickering quotes don't pay.
        </MarginNote>
      )}
      {shadow && <MarginNote>Shadow campaign over real Kuru logs. Nobody was paid; these are the amounts the code would have paid.</MarginNote>}
    </Schedule>
  );
}

const reportCache = new Map<string, WriterReport>();

function ReportCard({ campaignId, n, config }: { campaignId: string; n: number; config: Config | null }) {
  const writer = useWriterSettings();
  const key = `${campaignId}:${n}:${writer.provider}:${writer.model}:${writer.baseUrl}`; // a new Writer writes a new report
  const [r, setR] = useState<WriterReport | null>(reportCache.get(key) ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const rep = await report(campaignId, n);
      reportCache.set(key, rep);
      setR(rep);
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  };
  useEffect(() => {
    const cached = reportCache.get(key) ?? null;
    setR(cached);
    if (!cached) run();
  }, [key]);
  const unsupported = (r as (WriterReport & { judge?: { unsupported?: { sentence: string }[] } }) | null)?.judge?.unsupported ?? [];
  return (
    <Schedule id="A-5" title="Epoch report" desc={`What epoch ${n} bought, in words. ${writerLabel(writer, config?.ai.model ?? null)}.`}
      aside={<button className="btn ghost small" onClick={run} disabled={busy}>{busy ? "Writing…" : "Rewrite"}</button>}>
      {busy && !r && <Skeleton rows={6} h={28} />}
      {err && <ErrorNote onRetry={run}>{err}</ErrorNote>}
      {r && (
        <div className="stack" style={{ gap: 12 }}>
          <p className="prose report">{r.markdown}</p>
          {unsupported.map((u) => (
            <div key={u.sentence} className="struck">
              <s>{u.sentence}</s>
              <MarginNote tone="red" label="Judge">The epoch facts don't support this sentence, so the template replaced the model's text.</MarginNote>
            </div>
          ))}
          <Provenance by={r.ai.writtenBy} provider={r.ai.provider} model={r.ai.model} attempts={r.ai.groundingAttempts} where={r.ai.where} />
          {r.ai.notes.map((t) => <MarginNote key={t} tone="red">{t}</MarginNote>)}
          <span className="muted small">Payout root <span className="mono">{fmt.short(r.root)}</span></span>
        </div>
      )}
    </Schedule>
  );
}
