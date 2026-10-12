import { useEffect, useState } from "react";
import { api, fmt, type BotSim, type CampaignRow, type EpochSummary } from "../api";
import { Copy } from "../ui/bits";
import { MarketTabs, PageHead } from "../ui/Schedule";
import { Bars, ViewToggle } from "../ui/charts";

const RULES = [
  { title: "Quote both sides", body: "A one-sided maker earns a third of the score. The bot keeps one bid and one ask up at all times." },
  { title: "Near the centre, not the edge", body: "Weight falls with the square of the distance from the centre: an order 35% into the band earns 42% of the maximum, while one 90% in earns 1%." },
  { title: "Let orders rest", body: "Only orders that have rested for the minimum time count, and every requote restarts that clock. The bot requotes only when an order drifts toward the band edge." },
  { title: "Stay safe", body: "Orders are post-only, so the bot never takes liquidity. An inventory cap limits each side, a peg guard pulls everything if a stablecoin leaves its reference, and Ctrl-C cancels every order." },
];

export function Makers({ campaign }: { campaign: CampaignRow | null }) {
  const [epochs, setEpochs] = useState<EpochSummary[]>([]);
  const [n, setN] = useState<number | null>(null);
  const [size, setSize] = useState("2000");
  const [sim, setSim] = useState<BotSim | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const [px, setPx] = useState<number | null>(null);

  const run = async (id: string, epoch: number, sz: number) => {
    setBusy(true);
    setErr(null);
    try {
      setSim(await api.botSim(id, epoch, sz));
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
    setBusy(false);
  };
  useEffect(() => {
    if (!campaign) return;
    setSim(null);
    const P = Number(campaign.pricePrecision);
    if (campaign.refPrice) setPx(Number(campaign.refPrice) / P);
    else api.book(campaign.pair, 1).then((b) => setPx(b.bids[0] && b.asks[0] ? (b.bids[0].price + b.asks[0].price) / 2 : null)).catch(() => setPx(null));
    api.epochs(campaign.id).then((es) => {
      setEpochs(es);
      const last = es.length ? es[es.length - 1]!.n : null;
      setN(last);
      if (last !== null) run(campaign.id, last, Number(size) || 2000);
    });
  }, [campaign?.id]);

  if (!campaign) return <p className="muted">No campaign yet.</p>;
  const base = campaign.pair.split("/")[0]!;
  const quote = campaign.pair.split("/")[1]!;
  const budget = Number(campaign.budgetPerEpoch) / 10 ** campaign.rewardDecimals;
  const epochMin = Math.round((campaign.epochBlocks * 0.3) / 60);
  const file = `${campaign.id.includes("demo") ? "out/demo" : "out"}/campaign-${campaign.id}.json`;
  const sz = Number(size);
  const bot = sim?.results[0], naive = sim?.results[1];

  return (
    <>
      <section className="page-head">
        <PageHead wp="C" title={`Make markets · ${campaign.pair}`}><MarketTabs on="makers" /></PageHead>
        <h1>{fmt.usd(budget)} {quote} every {epochMin} minutes, for quoting both sides and letting orders rest.</h1>
        <p>The reference maker bot is open source and follows the same scoring rules as the payout code. Backtest it on a closed epoch below. The result is scored by the same epoch builder that pays makers, so the number is what you would have been paid.</p>
      </section>

      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <label className="label" htmlFor="mepoch">Epoch</label>
            <select id="mepoch" style={{ width: "auto" }} value={n ?? ""} onChange={(e) => setN(Number(e.target.value))}>
              {epochs.map((e) => <option key={e.n} value={e.n}>{e.n}</option>)}
            </select>
            <label className="label" htmlFor="msize">Size per side</label>
            <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <input id="msize" type="text" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} style={{ width: 110 }} />
              <span className="muted">{base}</span>
            </span>
          </div>
          <button className="btn" disabled={busy || n === null || !(sz > 0)} onClick={() => n !== null && run(campaign.id, n, sz)}>{busy ? "Backtesting…" : "Backtest"}</button>
        </div>
        {err && <p className="note bad">{err}</p>}
      </section>

      {busy && !sim && <p className="muted row"><span className="spinner" /> Replaying epoch {n} three times…</p>}

      {sim && bot && naive && (
        <>
          <div className="grid-2">
            <section className="panel" style={{ borderColor: "var(--edge)" }}>
              <div className="panel-head">
                <div className="stack" style={{ gap: 2 }}>
                  <h2>Payout per epoch</h2>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>{fmt.n(sim.sizePerSide)} {sim.base} per side, epoch {sim.epoch}, budget {fmt.usd(sim.budget)} {sim.quote}</span>
                </div>
                <ViewToggle table={table} setTable={setTable} />
              </div>
              {table ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Strategy</th><th className="r">Payout</th><th className="r">Share</th><th className="r">Txs</th><th className="r">Fills</th><th className="r">Two-sided</th></tr></thead>
                    <tbody>
                      {sim.results.map((r, i) => (
                        <tr key={r.strategy} className={i === 0 ? "highlight" : ""}>
                          <td>{r.strategy}</td><td className="r">{fmt.usd(r.payout)}</td><td className="r">{fmt.pct(Math.round(r.sharePct * 10) / 10)}</td>
                          <td className="r">{fmt.n(r.txs)}</td><td className="r">{r.fills}</td><td className="r">{fmt.pct(Math.round(r.restingTwoSidedPct))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Bars rows={sim.results.map((r) => ({ key: r.strategy, label: r.strategy, value: r.payout }))} unit="" decimals={2} highlight={sim.results[0]!.strategy} />
              )}
              <p className="ink2">
                {naive.payout < bot.payout
                  ? `Requoting on a timer sent ${fmt.n(naive.txs)} transactions and earned ${Math.round((1 - naive.payout / bot.payout) * 100)}% less, because each requote restarted the ${campaign.minRestBlocks}-block rest clock. The bot sent ${fmt.n(bot.txs)}.`
                  : `On this epoch the timer strategy matched the bot, at ${fmt.n(naive.txs)} transactions against ${fmt.n(bot.txs)}.`}
              </p>
            </section>
            <section className="panel">
              <h2>What your quotes add</h2>
              <dl className="kv">
                <dt>Book depth, thinner side</dt><dd className="num">{fmt.n(bot.depthWithout)} → <b>{fmt.n(bot.depthWith)}</b> {sim.quote}</dd>
                <dt>Two-sided coverage</dt><dd className="num">{fmt.pct(Math.round(bot.coverageWithout * 10) / 10)} → <b>{fmt.pct(Math.round(bot.coverageWith * 10) / 10)}</b></dd>
                <dt>Bot two-sided at samples</dt><dd className="num">{fmt.pct(Math.round(bot.restingTwoSidedPct))}</dd>
                <dt>Fills, net inventory</dt><dd className="num">{bot.fills} fills, {fmt.n(bot.inventory, 2)} {sim.base}</dd>
              </dl>
              <p className="note">The fill model is simple: a taker who hit a worse price than ours is assumed to have hit us first. Gas is not included, and a timer bot pays it {fmt.n(naive.txs)} times.</p>
            </section>
          </div>
        </>
      )}

      <div className="grid-2">
        <section className="panel">
          <h2>How the bot quotes</h2>
          <div className="stack" style={{ gap: 12 }}>
            {RULES.map((r, i) => (
              <div key={r.title} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 12 }}>
                <span className="step-icon done" style={{ flex: "none", fontSize: "0.72rem", fontWeight: 700 }}>{i + 1}</span>
                <span className="stack" style={{ gap: 2 }}><span className="step-title">{r.title}</span><span className="step-detail">{r.body}</span></span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Run it</h2><Copy text={commands(file, sz || 2000, px)} label="Copy commands" /></div>
          <div className="code-block">{commands(file, sz || 2000, px)}</div>
          <p className="note bad">Live mode trades real funds. Use a fresh throwaway wallet in <code>BOT_KEY</code> holding only what you can lose. Orders above <code>BOT_MAX_ORDER_QUOTE</code> (default 100 {quote}) are refused.</p>
        </section>
      </div>
    </>
  );
}

/** The live lines use a size under the default 100-quote notional cap, so they run as printed. */
function commands(file: string, size: number, px: number | null) {
  const liveSize = px ? Math.max(1, Math.floor(Math.min(size, 95 / px))) : null;
  const sig = (x: number) => Number(x.toPrecision(3));
  return `# backtest on a closed epoch
npm run bot -- sim ${file} --epoch 0 --size ${size}

# read-only: what it would do right now on mainnet
npm run bot -- plan ${file} --size ${size}

# paper loop: decides every 2 s, sends nothing
npm run bot -- run ${file} --size ${size}

# live, small (BOT_KEY = throwaway wallet in .env)
npm run bot -- deposit ${file} --base ${liveSize ?? "<size>"} --quote ${liveSize && px ? sig(liveSize * px * 1.02) : "<size x price>"} --yes
npm run bot -- run ${file} --size ${liveSize ?? "<size>"} --live --yes`;
}
