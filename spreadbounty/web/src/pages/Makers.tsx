import { useEffect, useState } from "react";
import { api, fmt, type BotSim, type CampaignRow, type Config, type EpochSummary } from "../api";
import { Copy } from "../ui/bits";
import { LedgerTable, type Col } from "../ui/LedgerTable";
import { MarginNote } from "../ui/MarginNote";
import { RestClock } from "../ui/RestClock";
import { ErrorNote, MarketTabs, PageHead, Schedule, Skeleton, type MarketTab } from "../ui/Schedule";
import { SourceLabel } from "../ui/SourceLabel";
import type { Status } from "./Overview";

const RULES = [
  { title: "Quote both sides", body: "A one-sided maker earns a third of the score. The bot keeps one bid and one ask up at all times." },
  { title: "Near the centre, not the edge", body: "Weight falls with the square of the distance from the centre: an order 35% into the band earns 42% of the maximum, while one 90% in earns 1%." },
  { title: "Let orders rest", body: "Only orders that have rested for the minimum time count, and every requote restarts that clock. The bot requotes only when an order drifts toward the band edge." },
  { title: "Stay safe", body: "Orders are post-only, so the bot never takes liquidity. An inventory cap limits each side, a peg guard pulls everything if a stablecoin leaves its reference, and Ctrl-C cancels every order." },
];

type Row = BotSim["results"][number];

/** W/P C: what quoting pays (Backtest), why patience pays (Rest clock), and how to run the bot (Run it). Claim is its own route. */
export function Makers({ campaign, status, config, sub }: { campaign: CampaignRow | null; status: Status; config: Config | null; sub: string }) {
  const tab: MarketTab = sub === "rest" ? "rest" : sub === "run" ? "run" : "backtest";
  const [epochs, setEpochs] = useState<EpochSummary[] | null>(null);
  const [n, setN] = useState<number | null>(null);
  const [size, setSize] = useState("2000");
  const [sim, setSim] = useState<BotSim | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
  const load = () => {
    if (!campaign) return;
    setSim(null);
    setEpochs(null);
    setErr(null);
    const P = Number(campaign.pricePrecision);
    if (campaign.refPrice) setPx(Number(campaign.refPrice) / P);
    else api.book(campaign.pair, 1).then((b) => setPx(b.bids[0] && b.asks[0] ? (b.bids[0].price + b.asks[0].price) / 2 : null)).catch(() => setPx(null));
    api.epochs(campaign.id)
      .then((es) => {
        setEpochs(es);
        const last = es.length ? es[es.length - 1]!.n : null;
        setN(last);
        if (last !== null) run(campaign.id, last, Number(size) || 2000);
      })
      .catch((e) => setErr(`Couldn't list the epochs: ${String(e?.message ?? e)}`));
  };
  useEffect(load, [campaign?.id]);

  const label = <SourceLabel config={config} campaign={campaign} />;
  const head = (h1: string | null) => (
    <section className="page-head">
      <PageHead wp="C" title="Make markets"><MarketTabs on={tab} />{label}</PageHead>
      {h1 ? <h1>{h1}</h1> : <h1><span className="skel-text">10.00 USDC every 60 minutes, for quoting both sides and letting orders rest.</span></h1>}
    </section>
  );

  if (!campaign) {
    if (status === "ready") return <>{head("No campaign to make markets on yet.")}<p className="ink2">When a sponsor publishes a campaign, its rules and backtest show up here. <a href="#design">Design one</a></p></>;
    return <>{head(null)}{status === "error" ? <ErrorNote>Can't read the campaigns from this server.</ErrorNote> : <Skeleton rows={8} h={41} />}</>;
  }
  const base = campaign.pair.split("/")[0]!;
  const quote = campaign.pair.split("/")[1]!;
  const budget = Number(campaign.budgetPerEpoch) / 10 ** campaign.rewardDecimals;
  const epochMin = Math.round((campaign.epochBlocks * 0.3) / 60);
  const file = `${campaign.id.includes("demo") ? "out/demo" : "out"}/campaign-${campaign.id}.json`;
  const sz = Number(size);
  const bot = sim?.results[0], naive = sim?.results[1];
  const cmds = commands(file, sz || 2000, px);

  return (
    <>
      {head(`${fmt.usd(budget)} ${quote} every ${epochMin} minutes, for quoting both sides and letting orders rest.`)}

      {tab === "backtest" && (
        <>
          <Schedule id="C-1" title="Backtest the reference bot" desc="Replays a closed epoch three times, once per strategy, and scores each with the same epoch builder that pays makers." source={label}>
            {epochs && epochs.length === 0 ? (
              <p className="ink2">No closed epoch to backtest yet. Epoch 0 closes {fmt.n(campaign.epochBlocks)} blocks after block {fmt.n(campaign.replayFromBlock)}.</p>
            ) : (
              <div className="controls">
                <label className="field">
                  <span className="label">Epoch</span>
                  <select value={n ?? ""} onChange={(e) => setN(Number(e.target.value))} disabled={!epochs}>
                    {(epochs ?? []).map((e) => <option key={e.n} value={e.n}>{e.n}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="label">Size per side</span>
                  <input type="text" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} size={7} aria-describedby="size-unit" />
                  <span className="field-unit" id="size-unit">{base}</span>
                </label>
                <button className="btn" disabled={busy || n === null || !(sz > 0)} onClick={() => n !== null && run(campaign.id, n, sz)}>
                  {busy ? <><span className="spinner" aria-hidden /> Backtesting…</> : "Backtest"}
                </button>
              </div>
            )}
            {err && <ErrorNote onRetry={sim || !epochs ? load : () => n !== null && run(campaign.id, n, sz)}>{err}</ErrorNote>}
            {busy && <p className="ink2 row" role="status"><span className="spinner" aria-hidden /> Replaying epoch {n} three times…</p>}
            {busy && !sim ? <Skeleton rows={4} h={41} /> : sim && bot && naive && (
              <>
                <LedgerTable rows={sim.results} rowKey={(r) => r.strategy} rowClass={(r) => (r === bot ? "highlight" : undefined)} caption={`Backtest, epoch ${sim.epoch}`} cols={cols(sim.quote)} />
                <div className="bt-foot">
                  <div className="stack">
                    <p>
                      {naive.payout < bot.payout
                        ? `Requoting on a timer sent ${fmt.n(naive.txs)} transactions and earned ${Math.round((1 - naive.payout / bot.payout) * 100)}% less, because each requote restarted the ${campaign.minRestBlocks}-block rest clock. The bot sent ${fmt.n(bot.txs)}.`
                        : `On this epoch the timer strategy matched the bot, at ${fmt.n(naive.txs)} transactions against ${fmt.n(bot.txs)}.`}
                    </p>
                    <MarginNote>{config?.synthetic ? "Synthetic data. " : ""}Gas not counted. Simple fill model: a taker who hit a worse price than ours is assumed to have hit us first.</MarginNote>
                  </div>
                  <div>
                    <h3>What the bot's quotes add, {fmt.n(sim.sizePerSide)} {sim.base} per side</h3>
                    <dl className="kv">
                      <dt>Depth, thinner side</dt><dd className="num">{fmt.n(bot.depthWithout)} to <b>{fmt.n(bot.depthWith)}</b> {sim.quote}</dd>
                      <dt>Two-sided coverage</dt><dd className="num">{fmt.pct(Math.round(bot.coverageWithout * 10) / 10)} to <b>{fmt.pct(Math.round(bot.coverageWith * 10) / 10)}</b></dd>
                      <dt>Two-sided at samples</dt><dd className="num">{fmt.pct(Math.round(bot.restingTwoSidedPct))}</dd>
                      <dt>Fills, net inventory</dt><dd className="num">{bot.fills} fills, {fmt.n(bot.inventory, 2)} {sim.base}</dd>
                    </dl>
                  </div>
                </div>
              </>
            )}
          </Schedule>
        </>
      )}

      {tab === "rest" && (
        <Schedule id="C-2" title="Rest clock" desc={`An order counts only after it has rested ${campaign.minRestBlocks} blocks. Every requote starts the count again, which is why flickering quotes earn nothing.`}>
          <RestClock need={campaign.minRestBlocks} />
        </Schedule>
      )}

      {tab === "run" && (
        <div className="run-grid">
          <Schedule id="C-3" title="Run it" desc="The reference bot is open source and follows the same scoring rules as the payout code." aside={<Copy text={cmds} label="Copy commands" />}>
            <pre className="tape-code">{cmds}</pre>
            <p className="note bad">Live mode trades real funds. Give the bot a fresh throwaway wallet holding only what you can lose (its key goes in the bot's environment, never in this page). Orders above the bot's per-order cap (default 100 {quote}) are refused.</p>
          </Schedule>
          <Schedule id="C-3a" title="How the bot quotes">
            <ol className="rules">
              {RULES.map((r) => <li key={r.title}><b>{r.title}</b><span>{r.body}</span></li>)}
            </ol>
          </Schedule>
        </div>
      )}
    </>
  );
}

const cols = (quote: string): Col<Row>[] => [
  { key: "strategy", head: "Strategy", cell: (r) => r.strategy },
  { key: "payout", head: `Payout (${quote})`, num: true, cell: (r) => fmt.usd(r.payout) },
  { key: "share", head: "Share", num: true, cell: (r) => fmt.pct(Math.round(r.sharePct * 10) / 10) },
  { key: "txs", head: "Txs", num: true, cell: (r) => fmt.n(r.txs) },
  { key: "fills", head: "Fills", num: true, cell: (r) => fmt.n(r.fills) },
  { key: "two", head: "Two-sided", num: true, cell: (r) => fmt.pct(Math.round(r.restingTwoSidedPct)) },
];

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
