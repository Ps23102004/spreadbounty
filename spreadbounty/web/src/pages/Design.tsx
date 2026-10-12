import { useRef, useState } from "react";
import { design, type StepNote, type WriterDesign } from "../ai/client";
import { writerLabel } from "../ai/providers";
import { api, fmt, type Config } from "../api";
import { openAccount, refreshSession, short, useSession } from "../ui/AccountDialog";
import { Provenance } from "../ui/bits";
import { Bars, ViewToggle } from "../ui/charts";
import { LedgerTable } from "../ui/LedgerTable";
import { MarginNote } from "../ui/MarginNote";
import { useWriterSettings } from "../ui/ModelDialog";
import { makePacer, type TapeLine } from "../ui/pacer";
import { ErrorNote, PageHead, Schedule, Skeleton } from "../ui/Schedule";
import { SourceLabel } from "../ui/SourceLabel";
import { Tape } from "../ui/Tape";

const EXAMPLES = [
  "Agora wants AUSD/USDC tight around 1.0, $50/day, hourly epochs",
  "Deepen MON/USDC within 0.25%, about $700 a week",
  "Keep AUSD two-sided within 10 bps, $30 a day",
];

const STEP_TITLES: Record<string, string> = {
  intent: "Reading the request",
  market: "Reading the market",
  history: "Replaying recent order-book history",
  backtest: "Backtesting settings",
  brief: "Writing the brief",
};

/** Optional typed judgments from the decision model (B2, gamma2). Absent means no judge ran. */
interface Judge {
  needsPair?: { ask: string; options: string[] };
  flags: { code: string; text: string }[];
  unsupported?: { sentence: string }[];
}
type Result = WriterDesign & { judge?: Judge };

/** W/P B: a sentence in, a backtested campaign out. The tape prints each real step as it finishes. */
export function Design({ config, onPublished }: { config: Config | null; onPublished: (id: string) => void }) {
  const [goal, setGoal] = useState(EXAMPLES[0]!);
  const [lines, setLines] = useState<TapeLine[]>([]);
  const [running, setRunning] = useState<StepNote | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<{ id: string; path: string } | null>(null);
  const [pubErr, setPubErr] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const session = useSession();
  const writer = useWriterSettings();

  const run = async (text = goal) => {
    abort.current?.abort();
    abort.current = new AbortController();
    const id = ++runId.current;
    setBusy(true);
    setLines([]);
    setRunning(null);
    setResult(null);
    setError(null);
    setPublished(null);
    setPubErr(null);
    // a line prints only when its step has finished; the pacer keeps at least 90 ms between lines (1 s cap)
    const pace = makePacer();
    const seen = new Set<string>();
    const who: Record<string, string> = {};
    let queue = Promise.resolve();
    const print = (l: TapeLine) => {
      if (seen.has(l.id)) return;
      seen.add(l.id);
      queue = queue.then(async () => {
        await pace();
        if (id === runId.current) setLines((cur) => [...cur, l]);
      });
    };
    const onStep = (s: StepNote) => {
      if (id !== runId.current) return;
      if (s.status === "running") {
        if (s.detail) who[s.step] = s.detail;
        setRunning(s);
      } else {
        const l = stepLine(s, who[s.step]);
        if (l) print(l);
      }
      if (s.note) print({ id: `${s.step}-note`, fig: "note", text: s.note, sym: "#", red: true, note: true });
    };
    try {
      const r: Result = await design(text, onStep, abort.current.signal);
      const quote = r.campaign.pair.split("/")[1] ?? "";
      print({ id: "pick", fig: `${r.recommended.bandBps} bps`, text: `picked · rest ${r.recommended.minRestBlocks} blocks · ${fmt.usd(budgetOf(r))} ${quote} per epoch`, sym: "*" });
      await queue;
      if (id === runId.current) setResult(r);
    } catch (e: any) {
      if (e?.name !== "AbortError" && id === runId.current) setError(String(e?.message ?? e));
    }
    if (id === runId.current) {
      setRunning(null);
      setBusy(false);
    }
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
      refreshSession(); // a 401 here means the session expired on the server
    }
  };
  const pickBook = (pair: string) => {
    const g = `${goal.trim().replace(/\s*Book: \S+\.$/, "")} Book: ${pair}.`;
    setGoal(g);
    run(g);
  };

  const label = <SourceLabel config={config} />;
  const r = result;
  const quote = r?.campaign.pair.split("/")[1] ?? "USDC";
  const candKey = (c: { bandBps: number; minRestBlocks: number }) => `${c.bandBps}-${c.minRestBlocks}`;
  const judge = r?.judge;

  return (
    <>
      <section className="page-head">
        <PageHead wp="B" title="Design a campaign">{label}</PageHead>
        <h1>Say what you want the book to look like. Get settings that history backs up.</h1>
        <p>A model, or plain rules, turns your sentence into five fields. The code replays recent Kuru order logs, backtests a grid of settings with the production scorer and picks one by a fixed rule. Any number in the brief that the backtest can't back up is thrown out.</p>
      </section>

      <Schedule id="B-1" title={<label htmlFor="goal">What should the campaign do?</label>}
        footer={<><span>{writerLabel(writer, config?.ai.model ?? null, undefined, config?.judge !== false)}</span><span>Rules win on any number you write out</span></>}>
        <textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={1000} rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }} />
        <div className="request-row">
          <div className="examples" role="group" aria-label="Examples">
            {EXAMPLES.map((x) => <button key={x} onClick={() => setGoal(x)} aria-pressed={goal === x}>{x}</button>)}
          </div>
          <button className="btn" onClick={() => run()} disabled={busy || goal.trim().length < 3 || !config}>
            {busy ? <><span className="spinner" aria-hidden /> Designing…</> : "Design campaign"}
          </button>
        </div>
        {judge?.flags.map((f) => <MarginNote key={f.code} tone="red" label="Judge">{f.text}</MarginNote>)}
      </Schedule>

      <div className="design-grid">
        <Schedule id="B-2" title="Tape" desc="One line per finished step, in the order the code ran them.">
          <Tape wrap lines={lines} label="Design steps" empty="Press Design campaign. Each step prints here when it finishes.">
            {running && <p className="tape-running"><span className="spinner" aria-hidden /> {STEP_TITLES[running.step] ?? running.step}{running.detail && !running.detail.startsWith("{") ? ` · ${running.detail}` : ""}</p>}
          </Tape>
          {error && <ErrorNote onRetry={() => run()}>{error}</ErrorNote>}
        </Schedule>

        <Schedule id="B-3" title={r ? (r.pilot ? "Recommended pilot" : "Recommended") : "Recommendation"} source={r ? <span className="badge">{r.campaign.pair}</span> : undefined}>
          {!r ? (
            busy ? <Skeleton rows={6} h={32} /> : <p className="muted">Your recommendation appears here.</p>
          ) : (
            <>
              {judge?.needsPair && (
                <div className="which-book" role="group" aria-labelledby="which-book">
                  <h3 id="which-book">Which book?</h3>
                  <p className="ink2">{judge.needsPair.ask} These numbers assume {r.campaign.pair}.</p>
                  <div className="row">{judge.needsPair.options.map((o) => <button key={o} className="btn ghost" onClick={() => pickBook(o)} disabled={busy}>{o}</button>)}</div>
                </div>
              )}
              <ul className="terms" aria-label="Recommended settings">
                <li><span className="k">Band</span><span className="v">{r.recommended.bandBps} bps</span></li>
                <li><span className="k">Rest</span><span className="v">{r.recommended.minRestBlocks} blocks</span></li>
                <li><span className="k">Two-sided</span><span className="v">{fmt.pct(r.recommended.twoSidedCoveragePct)}</span></li>
                <li><span className="k">Budget</span><span className="v">{fmt.usd(budgetOf(r))} {quote} / epoch</span></li>
              </ul>
              <p className="prose">{r.brief}</p>
              {judge?.unsupported?.map((u) => (
                <div key={u.sentence} className="struck">
                  <s>{u.sentence}</s>
                  <MarginNote tone="red" label="Judge">The facts from the backtest don't support this sentence, so the template text above replaced the model's brief.</MarginNote>
                </div>
              ))}
              <Provenance by={r.ai.briefBy} provider={r.ai.provider} model={r.ai.model} attempts={r.ai.groundingAttempts} where={r.ai.where} />
              <p className="muted small">Request read by {r.ai.intentBy === "model" ? `${r.ai.model}${r.ai.where === "browser" ? " in your browser" : ""}` : "rules"}. Numbers you write out always win over the model's reading.</p>
              <div className="publish">
                {session.address
                  ? <button className="btn" onClick={publish} disabled={!!published}>{published ? "Published" : `Publish under ${short(session.address)}`}</button>
                  : <button className="btn" onClick={openAccount}>Sign in to publish</button>}
                <p className="muted small">{session.address
                  ? "Publishes this campaign file on this server under your address. Funding happens when you deploy the distributor from the CLI."
                  : session.persona
                    ? "Demo personas are read-only. Sign in with a wallet to publish."
                    : "Publishing writes this campaign file under your wallet address, so it needs a signed-in wallet."}</p>
              </div>
              {published && <p className="note">Saved as <code>{published.path}</code>. Epoch 0 starts at block {fmt.n(r.campaign.replayFromBlock)}; makers see the rules before any order counts. <a href="#overview">Open the ledger</a></p>}
              {pubErr && <ErrorNote>{pubErr}</ErrorNote>}
            </>
          )}
        </Schedule>
      </div>

      {r && (
        <Schedule id="B-4" title="Every setting tried" desc="Same history, same budget. The rule: within 5 points of the best coverage, take your band if you named one, else the tightest; ties go to the cheaper."
          aside={<ViewToggle table={table} setTable={setTable} />} source={label}>
          {table ? (
            <LedgerTable rows={r.candidates} rowKey={candKey} caption="Every setting tried"
              rowClass={(c) => (candKey(c) === candKey(r.recommended) ? "highlight circled" : undefined)}
              cols={[
                { key: "band", head: "Band", cell: (c) => `${c.bandBps} bps` },
                { key: "rest", head: "Min rest", num: true, cell: (c) => c.minRestBlocks },
                { key: "cov", head: "Two-sided", num: true, cell: (c) => fmt.pct(c.twoSidedCoveragePct) },
                { key: "depth", head: `Depth (${quote})`, num: true, cell: (c) => fmt.n(c.avgDepthUsdc) },
                { key: "cost", head: "Cost/day per $1k", num: true, cell: (c) => (c.costPerDayPer1kDepth === null ? "–" : fmt.usd(c.costPerDayPer1kDepth)) },
                { key: "makers", head: "Makers", num: true, cell: (c) => c.makers },
                { key: "top", head: "Top maker", num: true, cell: (c) => fmt.pct(c.topMakerSharePct) },
              ]} />
          ) : (
            <div className="bars-2">
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
        </Schedule>
      )}
    </>
  );
}

const budgetOf = (r: WriterDesign) => Number(r.campaign.budgetPerEpoch) / 10 ** r.campaign.rewardDecimals;

/** A finished step as one tape line: the figure on the left, what it is in words, the adding-machine symbol. */
function stepLine(s: StepNote, who: string | undefined): TapeLine | null {
  const d = s.detail ?? "";
  if (s.step === "intent") {
    try {
      const o = JSON.parse(d) as { pair: string | null; bandBps: number | null; budgetPerDay: number; epochMinutes: number; budgetDefault?: boolean };
      return { id: "intent", fig: o.pair ?? "no pair", text: `request read by ${who ?? "rules"} · band ${o.bandBps ? `${o.bandBps} bps` : "open"} · ${o.budgetPerDay}/day${o.budgetDefault ? " (default, not in your sentence)" : ""} · ${o.epochMinutes}-min epochs`, sym: "#" };
    } catch {
      return { id: "intent", fig: "request", text: d || "read", sym: "#" };
    }
  }
  if (s.step === "market") {
    const i = d.indexOf(": ");
    return { id: "market", fig: i > 0 ? d.slice(0, i) : "market", text: i > 0 ? `market · ${d.slice(i + 2)}` : d, sym: "#" };
  }
  if (s.step === "history") {
    const m = d.match(/^(\d+) logs, (.*)$/);
    return { id: "history", fig: m ? fmt.n(Number(m[1])) : "history", text: m ? `order logs · ${m[2]}` : d, sym: "#" };
  }
  if (s.step === "backtest") {
    const m = d.match(/^(\d+) candidates; (.*)$/);
    return { id: "backtest", fig: m ? m[1]! : "backtest", text: m ? `settings tried · ${m[2]}` : d, sym: "◇" };
  }
  if (s.step === "brief") return { id: "brief", fig: "brief", text: d, sym: "#" };
  return d ? { id: s.step, fig: s.step, text: d, sym: "#" } : null;
}
