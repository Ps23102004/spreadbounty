import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { api, fmt, makerName, type Book, type CampaignRow, type Config, type EpochFile, type EpochSummary, type Report } from "../api";
import { CountUp, Provenance, Reveal } from "../ui/bits";
import { DepthChart, Ladder, Legend, ViewToggle, type DepthPoint } from "../ui/charts";

const reportCache = new Map<string, Report>();

export function Overview({ campaign, config, onDesign }: { campaign: CampaignRow | null; config: Config | null; onDesign: () => void }) {
  const [epochs, setEpochs] = useState<EpochSummary[] | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [file, setFile] = useState<EpochFile | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    setEpochs(null);
    setSel(null);
    api.epochs(campaign.id).then((es) => { setEpochs(es); setSel(es.length ? es[es.length - 1]!.n : null); });
    api.book(campaign.pair, 1).then(setBook).catch(() => setBook(null));
  }, [campaign?.id]);
  useEffect(() => {
    if (!campaign || sel === null) return;
    setFile(null);
    api.epoch(campaign.id, sel).then(setFile);
  }, [campaign?.id, sel]);

  const base = campaign?.pair.split("/")[0] ?? "base";
  const quote = campaign?.pair.split("/")[1] ?? "quote";
  const S = Number(campaign?.sizePrecision ?? 1);
  const points: DepthPoint[] = useMemo(
    () => (epochs ?? []).flatMap((e) => e.samples.map((s) => ({ block: s.block, bid: Number(s.bidDepth) / S, ask: Number(s.askDepth) / S, epoch: e.n }))),
    [epochs, S],
  );

  if (!campaign)
    return (
      <section className="panel" style={{ justifyItems: "start", padding: 32 }}>
        <span className="label">No campaigns yet</span>
        <h1>Pay makers to keep a Kuru book tight, and let anyone check the math.</h1>
        <p className="ink2" style={{ maxWidth: "60ch" }}>Describe what you want in a sentence. The copilot backtests settings on recent order-book history and drafts a campaign you can publish.</p>
        <button className="btn" onClick={onDesign}>Design a campaign</button>
      </section>
    );

  const cur = epochs?.find((e) => e.n === sel) ?? null;
  const prev = epochs?.find((e) => sel !== null && e.n === sel - 1) ?? null;
  const m = cur?.metrics;
  const epochMin = Math.round((campaign.epochBlocks * 0.3) / 60);
  const budget = Number(campaign.budgetPerEpoch) / 10 ** campaign.rewardDecimals;
  const P = Number(campaign.pricePrecision);

  return (
    <>
      <section className="page-head">
        <span className="label">Campaign · {campaign.id}</span>
        {m ? (
          <div className="hero">
            <div className="stack" style={{ gap: 10 }}>
              <h1>{campaign.pair} stayed two-sided within {campaign.bandBps} bps{campaign.refPrice ? ` of ${(Number(campaign.refPrice) / P).toFixed(4)}` : " of mid"}</h1>
              <p>{campaign.rationale ?? ""}</p>
              <div className="row">
                <span className="badge">{campaign.bandBps} bps band</span>
                <span className="badge">rest ≥ {campaign.minRestBlocks} blocks</span>
                <span className="badge">{fmt.usd(budget)} {quote} per {epochMin}-min epoch</span>
                <span className="badge">sample every {campaign.sampleEvery} blocks</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="hero-figure"><CountUp value={Math.round(m.twoSidedCoveragePct * 10) / 10} decimals={m.twoSidedCoveragePct % 1 ? 1 : 0} /><small>%</small></div>
              <span className="muted">of {m.samplesWithPrice} samples in epoch {m.epoch}</span>
            </div>
          </div>
        ) : epochs && epochs.length === 0 ? (
          <div className="stack">
            <h1>{campaign.pair}: waiting for the first epoch</h1>
            <p>Published. Epoch 0 starts at block {fmt.n(campaign.replayFromBlock)} and runs {fmt.n(campaign.epochBlocks)} blocks (about {epochMin} minutes). Build it once it closes:</p>
            <div className="code-block">npm run sb -- epoch {config?.dataSource === "demo" ? "out/demo" : "out"}/campaign-{campaign.id}.json 0</div>
          </div>
        ) : (
          <h1 className="muted">Loading…</h1>
        )}
      </section>

      {epochs && epochs.length > 1 && (
        <div className="row">
          <span className="label">Epoch</span>
          <div className="tabs" role="group" aria-label="Epoch">
            {epochs.map((e) => <button key={e.n} aria-pressed={e.n === sel} onClick={() => setSel(e.n)}>{e.n}</button>)}
          </div>
          {cur && <span className="muted num" style={{ fontSize: "0.85rem" }}>blocks {fmt.n(cur.fromBlock)}–{fmt.n(cur.toBlock)}</span>}
        </div>
      )}

      {m && (
        <Reveal>
          <div className="kpis">
            <Kpi label={`Depth, thinner side`} value={fmt.n(m.avgTwoSidedDepthQuote)} unit={quote} delta={prev ? change(m.avgTwoSidedDepthQuote, prev.metrics.avgTwoSidedDepthQuote) : null} />
            <Kpi label="Cost per $1k of depth" value={m.costPer1kDepthQuote === null ? "–" : fmt.usd(m.costPer1kDepthQuote)} unit={quote} delta={prev && m.costPer1kDepthQuote !== null && prev.metrics.costPer1kDepthQuote !== null ? change(m.costPer1kDepthQuote, prev.metrics.costPer1kDepthQuote, true) : null} />
            <Kpi label="Paid of budget" value={fmt.usd(m.paidRewardTokens)} unit={`/ ${fmt.usd(m.budgetRewardTokens)}`} delta={null} />
            <Kpi label="Makers paid" value={String(m.makersPaid)} unit={`top ${fmt.pct(Math.round(m.topMakerSharePct * 10) / 10)}`} delta={prev ? diff(m.makersPaid, prev.metrics.makersPaid) : null} />
          </div>
        </Reveal>
      )}

      {points.length > 0 && (
        <div className="grid-2">
          <Reveal delay={0.05}>
            <section className="panel">
              <div className="panel-head">
                <div className="stack" style={{ gap: 2 }}>
                  <h2>Depth inside the band</h2>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>Resting orders that count, per sampled block, in {base}</span>
                </div>
                <ViewToggle table={table} setTable={setTable} />
              </div>
              {table ? (
                <div className="table-wrap" style={{ maxHeight: 300 }}>
                  <table>
                    <thead><tr><th>Epoch</th><th className="r">Block</th><th className="r">Bids</th><th className="r">Asks</th></tr></thead>
                    <tbody>{points.map((p) => <tr key={p.block}><td>{p.epoch}</td><td className="r">{fmt.n(p.block)}</td><td className="r">{fmt.n(p.bid)}</td><td className="r">{fmt.n(p.ask)}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : (
                <>
                  <Legend items={[{ label: "Bids in band", color: "var(--bid)" }, { label: "Asks in band", color: "var(--ask)" }]} />
                  <DepthChart points={points} unit={base} />
                </>
              )}
            </section>
          </Reveal>
          <Reveal delay={0.1}>
            <section className="panel">
              <div className="panel-head">
                <div className="stack" style={{ gap: 2 }}>
                  <h2>The book now</h2>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>Maker orders resting at block {book ? fmt.n(book.head) : "…"}; shaded rows earn rewards</span>
                </div>
              </div>
              {book && (book.bids.length || book.asks.length) ? (
                <Ladder bids={book.bids} asks={book.asks} refPrice={book.refPrice} bandBps={book.bandBps} unit={base} decimals={campaign.pair.startsWith("MON") ? 6 : 4} />
              ) : (
                <p className="muted">{book ? "No resting orders in the last hour of logs." : "Loading the book…"}</p>
              )}
            </section>
          </Reveal>
        </div>
      )}

      {cur && file && (
        <div className="grid-2">
          <Reveal delay={0.12}><Payouts cur={cur} file={file} quote={quote} /></Reveal>
          <Reveal delay={0.16}><ReportCard campaignId={campaign.id} n={cur.n} config={config} /></Reveal>
        </div>
      )}
    </>
  );
}

const change = (a: number, b: number, lowerIsBetter = false) => {
  if (!b) return null;
  const pct = ((a - b) / b) * 100;
  const better = lowerIsBetter ? pct < 0 : pct > 0;
  return { text: `${pct > 0 ? "+" : ""}${pct.toFixed(0)}% vs previous${lowerIsBetter && better ? " (cheaper)" : ""}`, better, up: pct > 0 };
};
const diff = (a: number, b: number) => (a === b ? { text: "same as previous", better: true, up: null } : { text: `${a > b ? "+" : ""}${a - b} vs previous`, better: a > b, up: a > b });

function Kpi({ label, value, unit, delta }: { label: string; value: string; unit: string; delta: { text: string; better: boolean; up: boolean | null } | null }) {
  return (
    <div className="kpi">
      <span className="label">{label}</span>
      <span><span className="kpi-value">{value}</span> <span className="muted" style={{ fontSize: "0.85rem" }}>{unit}</span></span>
      {delta && <span className="kpi-delta">{delta.up === null ? "" : delta.up ? "▲ " : "▼ "}{delta.text}</span>}
    </div>
  );
}

function Payouts({ cur, file, quote }: { cur: EpochSummary; file: EpochFile; quote: string }) {
  const dec = 10 ** file.campaign.rewardDecimals;
  const paid = new Map(file.amounts.map((a) => [a.account, Number(a.amount) / dec]));
  const cum = new Map(file.cumulative.map((a) => [a.account, Number(a.amount) / dec]));
  const orders = new Map(cur.makersSeen.map((m) => [m.owner.toLowerCase(), m.orders]));
  const total = [...paid.values()].reduce((a, b) => a + b, 0) || 1;
  const accounts = [...new Set([...paid.keys(), ...cum.keys(), ...orders.keys()])].sort((a, b) => (paid.get(b) ?? 0) - (paid.get(a) ?? 0) || (orders.get(b) ?? 0) - (orders.get(a) ?? 0));
  const unpaidActive = accounts.filter((a) => !paid.get(a) && (orders.get(a) ?? 0) > 0);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Who earned what</h2>
        <span className="muted" style={{ fontSize: "0.85rem" }}>{quote}, epoch {file.epoch}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Maker</th><th className="r">Orders</th><th>Share</th><th className="r">This epoch</th><th className="r">All epochs</th></tr></thead>
          <tbody>
            {accounts.map((a, i) => {
              const p = paid.get(a) ?? 0;
              return (
                <tr key={a} className={p ? "" : "dim"}>
                  <td title={a}><span className="addr">{makerName(a)}</span></td>
                  <td className="r">{orders.get(a) ?? 0}</td>
                  <td style={{ minWidth: 90 }}>
                    <span style={{ display: "block", background: "var(--surface-2)", borderRadius: 4, height: 10 }}>
                      <motion.span style={{ display: "block", height: "100%", borderRadius: "0 4px 4px 0", background: "var(--accent)" }} initial={{ width: 0 }} animate={{ width: `${(p / total) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.05 }} />
                    </span>
                  </td>
                  <td className="r">{p ? fmt.usd(p) : "–"}</td>
                  <td className="r">{cum.get(a) ? fmt.usd(cum.get(a)!) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {unpaidActive.length > 0 && (
        <p className="note">
          {unpaidActive.map(makerName).join(", ")} placed {unpaidActive.reduce((s, a) => s + (orders.get(a) ?? 0), 0)} orders and earned nothing: no order was resting inside {file.campaign.bandBps} bps for {file.campaign.minRestBlocks}+ blocks at a sampled block. Flickering quotes don't pay.
        </p>
      )}
    </section>
  );
}

function ReportCard({ campaignId, n, config }: { campaignId: string; n: number; config: Config | null }) {
  const key = `${campaignId}:${n}`;
  const [r, setR] = useState<Report | null>(reportCache.get(key) ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const rep = await api.report(campaignId, n);
      reportCache.set(key, rep);
      setR(rep);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
    setBusy(false);
  };
  useEffect(() => {
    const cached = reportCache.get(key) ?? null;
    setR(cached);
    if (!cached) run();
  }, [key]);
  const who = config?.ai.provider === "off" ? "the template" : config?.ai.model ?? "the model";
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Epoch report</h2>
        <button className="btn ghost small" onClick={run} disabled={busy}>{busy ? "Writing…" : "Rewrite"}</button>
      </div>
      {busy && !r && <p className="muted row"><span className="spinner" /> Writing with {who}…</p>}
      {err && <p className="note bad">{err}</p>}
      {r && (
        <motion.div key={r.markdown} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="stack" style={{ gap: 12 }}>
          <p className="prose">{r.markdown}</p>
          <Provenance by={r.ai.writtenBy} provider={r.ai.provider} model={r.ai.model} attempts={r.ai.groundingAttempts} />
          <span className="muted" style={{ fontSize: "0.8rem" }}>Payout root <span className="mono">{fmt.short(r.root)}</span></span>
        </motion.div>
      )}
    </section>
  );
}
