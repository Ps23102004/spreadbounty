import { useRef, useState } from "react";
import { api, fmt, type Config, type DesignResult, type Step } from "../api";
import { Provenance, Steps, type StepState } from "../ui/bits";
import { PageHead } from "../ui/Schedule";
import { Bars, ViewToggle } from "../ui/charts";

const EXAMPLES = [
  "Agora wants AUSD/USDC tight around 1.0, $50/day, hourly epochs",
  "Deepen MON/USDC within 0.25%, about $700 a week",
  "Keep AUSD two-sided within 10 bps, $30 a day",
];

const STEP_TITLES: Record<string, string> = {
  intent: "Read the request",
  market: "Read the market",
  history: "Replay recent order-book history",
  backtest: "Backtest settings",
  brief: "Write the brief",
};
const ORDER = Object.keys(STEP_TITLES);

export function Design({ config, onPublished }: { config: Config; onPublished: (id: string) => void }) {
  const [goal, setGoal] = useState(EXAMPLES[0]!);
  const [steps, setSteps] = useState<Record<string, Step>>({});
  const [result, setResult] = useState<DesignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [published, setPublished] = useState<{ id: string; path: string } | null>(null);
  const [pubErr, setPubErr] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const run = async () => {
    abort.current?.abort();
    abort.current = new AbortController();
    setRunning(true);
    setSteps({});
    setResult(null);
    setError(null);
    setPublished(null);
    setPubErr(null);
    try {
      const r = await api.copilot(goal, (s) => setSteps((cur) => ({ ...cur, [s.step]: s })), abort.current.signal);
      setResult(r);
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(String(e?.message ?? e));
    }
    setRunning(false);
  };
  const publish = async () => {
    if (!result) return;
    setPubErr(null);
    try {
      const p = await api.publish(result.campaign, result.brief);
      setPublished(p);
      onPublished(p.id);
    } catch (e: any) {
      setPubErr(String(e?.message ?? e));
    }
  };

  const modelName = config.ai.provider === "off" ? "rules and templates (no model)" : `${config.ai.model}${config.ai.provider === "local" ? " (local)" : ""}`;
  const items = ORDER.filter((k) => steps[k] || running).map((k) => {
    const s = steps[k];
    const state: StepState = s?.status === "done" ? "done" : s ? "running" : "pending";
    return { key: k, title: STEP_TITLES[k]!, detail: s?.detail ? prettyDetail(k, s.detail, result) : undefined, state };
  });
  const r = result;
  const quote = r?.campaign.pair.split("/")[1] ?? "USDC";
  const candKey = (c: { bandBps: number; minRestBlocks: number }) => `${c.bandBps}-${c.minRestBlocks}`;

  return (
    <>
      <section className="page-head">
        <PageHead wp="B" title="Design a campaign" />
        <h1>Say what you want the book to look like. Get settings that history backs up.</h1>
        <p>The model turns your sentence into a few fields. The code then replays the last hours of Kuru order logs, backtests a grid of settings and picks one by a fixed rule. The model writes the brief last, and any number it can't trace back to the backtest is rejected.</p>
      </section>

      <section className="panel">
        <label className="label" htmlFor="goal">What should the campaign do?</label>
        <textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={1000} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }} />
        <div className="examples">{EXAMPLES.map((x) => <button key={x} onClick={() => setGoal(x)}>{x}</button>)}</div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: "0.85rem" }}>Using {modelName} · {config.synthetic ? "demo data (synthetic)" : "Monad mainnet"}</span>
          <button className="btn" onClick={run} disabled={running || goal.trim().length < 3}>{running ? "Working…" : "Design campaign"}</button>
        </div>
      </section>

      {(items.length > 0 || error) && (
        <div className="grid-2">
          <section className="panel">
            <h2>Steps</h2>
            <Steps items={items} />
            {error && <p className="note bad">{error}</p>}
          </section>
          {r ? (
            <>
              <section className="panel" style={{ borderColor: "var(--accent)" }}>
                <div className="panel-head">
                  <h2>{r.pilot ? "Recommended pilot" : "Recommended"}</h2>
                  <span className="badge accent">{r.campaign.pair}</span>
                </div>
                <div className="kpis" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  <div className="kpi"><span className="label">Band</span><span className="kpi-value">{r.recommended.bandBps} bps</span></div>
                  <div className="kpi"><span className="label">Minimum rest</span><span className="kpi-value">{r.recommended.minRestBlocks} blocks</span></div>
                  <div className="kpi" style={{ borderLeft: 0, borderTop: "1px solid var(--hairline)" }}><span className="label">Two-sided in backtest</span><span className="kpi-value">{fmt.pct(r.recommended.twoSidedCoveragePct)}</span></div>
                  <div className="kpi" style={{ borderTop: "1px solid var(--hairline)" }}><span className="label">Budget per epoch</span><span style={{ whiteSpace: "nowrap" }}><span className="kpi-value">{fmt.usd(Number(r.campaign.budgetPerEpoch) / 1e6)}</span> <span className="muted">{quote}</span></span></div>
                </div>
                <p className="prose">{r.brief}</p>
                <Provenance by={r.ai.briefBy} provider={r.ai.provider} model={r.ai.model} attempts={r.ai.groundingAttempts} />
                <span className="muted" style={{ fontSize: "0.8rem" }}>Request read by {r.ai.intentBy === "model" ? r.ai.model : "rules"}; explicit numbers in your sentence always win over the model's reading.</span>
                <div className="row">
                  <button className="btn" onClick={publish} disabled={!!published}>{published ? "Published" : "Publish campaign"}</button>
                  {published && <a className="btn ghost" href="#overview">Open overview</a>}
                </div>
                {published && <p className="note">Saved as <code>{published.path}</code>. Epoch 0 starts at block {fmt.n(r.campaign.replayFromBlock)}; makers see the rules before any order counts.</p>}
                {pubErr && <p className="note bad">{pubErr}</p>}
              </section>
            </>
          ) : (
            <section className="panel"><p className="muted">The recommendation appears here when the backtest finishes.</p></section>
          )}
        </div>
      )}

      {r && (
        <>
          <section className="panel">
            <div className="panel-head">
              <div className="stack" style={{ gap: 2 }}>
                <h2>Every setting tried</h2>
                <span className="muted" style={{ fontSize: "0.85rem" }}>Same history, same budget. Rule: within 5 points of the best coverage, take your band if you named one, else the tightest; ties go to the cheaper.</span>
              </div>
              <ViewToggle table={table} setTable={setTable} />
            </div>
            {table ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Band</th><th className="r">Min rest</th><th className="r">Two-sided</th><th className="r">Depth ({quote})</th><th className="r">Cost/day per $1k</th><th className="r">Makers</th><th className="r">Top maker</th></tr></thead>
                  <tbody>
                    {r.candidates.map((c) => (
                      <tr key={candKey(c)} className={candKey(c) === candKey(r.recommended) ? "highlight" : ""}>
                        <td>{c.bandBps} bps</td><td className="r">{c.minRestBlocks}</td><td className="r">{fmt.pct(c.twoSidedCoveragePct)}</td>
                        <td className="r">{fmt.n(c.avgDepthUsdc)}</td><td className="r">{c.costPerDayPer1kDepth === null ? "–" : fmt.usd(c.costPerDayPer1kDepth)}</td>
                        <td className="r">{c.makers}</td><td className="r">{fmt.pct(c.topMakerSharePct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                <div className="stack">
                  <span className="label">Two-sided coverage</span>
                  <Bars rows={r.candidates.map((c) => ({ key: candKey(c), label: `${c.bandBps} bps · rest ${c.minRestBlocks}`, value: c.twoSidedCoveragePct }))} max={100} unit="%" highlight={candKey(r.recommended)} />
                </div>
                <div className="stack">
                  <span className="label">Qualifying depth, {quote}</span>
                  <Bars rows={r.candidates.map((c) => ({ key: candKey(c), label: `${c.bandBps} bps · rest ${c.minRestBlocks}`, value: c.avgDepthUsdc }))} unit="" highlight={candKey(r.recommended)} />
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

/** Step details arrive as short strings; the intent step is JSON, shown as plain fields. */
function prettyDetail(step: string, detail: string, r: DesignResult | null) {
  if (step === "intent" && detail.startsWith("{")) {
    try {
      const o = JSON.parse(detail) as { pair: string; bandBps: number | null; budgetPerDay: number; epochMinutes: number; refPrice: number | null };
      return `${o.pair} · band ${o.bandBps ?? "not given"}${o.bandBps ? " bps" : ""} · ${o.budgetPerDay}/day · ${o.epochMinutes}-min epochs${o.refPrice ? ` · ref ${o.refPrice}` : ""}${r ? ` · read by ${r.intentBy === "model" ? r.ai.model : "rules"}` : ""}`;
    } catch {
      return detail;
    }
  }
  if (step === "intent") return `using ${detail}`;
  return detail;
}
