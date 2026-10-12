import { useEffect, useState } from "react";
import { fmt, makerName, type Book, type CampaignRow, type Config } from "../api";
import { BookLadder } from "../ui/BookLadder";
import { HashDiff } from "../ui/HashDiff";
import { Icon } from "../ui/icons";
import { ErrorNote, PageHead, Schedule } from "../ui/Schedule";
import { SourceLabel } from "../ui/SourceLabel";
import { Stamp } from "../ui/Stamp";
import { Tape } from "../ui/Tape";
import { Tick } from "../ui/Tick";
import { useRecompute, type Outcome } from "../ui/useRecompute";

const DOORS = [
  { href: "#design", title: "Fund depth", line: "Design a campaign from one sentence." },
  { href: "#makers", title: "Make markets", line: "See what quoting pays, run the bot." },
  { href: "#verify", title: "Check payouts", line: "Recompute every epoch, or look up a claim." },
];

/** W/P 0: the thesis, the mechanism on one schedule, the recompute in place, three doors, and what has really run. */
export function Start({ campaign, config, status }: { campaign: CampaignRow | null; config: Config | null; status: "loading" | "ready" | "error" }) {
  const rc = useRecompute(campaign, config);
  const [book, setBook] = useState<Book | null>(null);
  const latest = rc.epochs?.length ? rc.epochs[rc.epochs.length - 1]! : null;

  return (
    <>
      <PageHead wp="0" title="Start" />
      <div className="start">
        <div className="start-thesis">
          <h1 className="thesis">Sponsors pay for order-book depth on Monad. Anyone can recompute who earned it.</h1>
          <p className="support">Rewards go to makers who keep a Kuru book tight on both sides. Your browser can check every payout against public order logs.</p>
        </div>

        <div className="start-actions">
          <button className="btn recompute" onClick={rc.run} disabled={!latest || rc.busy || !config}>
            {rc.busy ? <><span className="spinner" aria-hidden /> Recomputing…</> : latest ? `Recompute epoch ${latest.n} here` : rc.epochs ? "No closed epoch to recompute yet" : status === "ready" && !campaign ? "No campaign to recompute yet" : status === "error" ? "Server unreachable" : "Loading epochs…"}
          </button>
          <label className="switch">
            <input type="checkbox" checked={rc.forged} onChange={(e) => rc.setForged(e.target.checked)} disabled={!latest} />
            Forge a payout
          </label>
        </div>

        <div className="start-tape">
          <Tape lines={rc.lines} rows={5} label="Recompute steps"
            empty={rc.forged
              ? "Forged copy ready: the top maker gets one extra token and a matching, well-formed Merkle root. Press Recompute."
              : "Press Recompute. Each line prints when your browser finishes that step."} />
          <Verdict outcome={rc.outcome} />
          {rc.error && <ErrorNote onRetry={rc.run}>{rc.error}</ErrorNote>}
        </div>

        <div className="start-book">
          {campaign ? (
            <Schedule id="A-1" className="book-sheet"
              title={<>{campaign.pair} book{book ? `, block ${fmt.n(book.head)}` : ""}</>}
              desc="Highlighted rows sit inside the reward band."
              source={<SourceLabel config={config} campaign={campaign} />}
              footer={<RootLine outcome={rc.outcome} root={latest?.root ?? null} n={latest?.n ?? null} />}>
              <BookLadder campaign={campaign} depth={4} onBook={setBook} />
            </Schedule>
          ) : (
            <p className="note">{config ? "No campaign is published on this server yet. Design one to see its book here." : "Loading the campaign…"}</p>
          )}
        </div>
      </div>

      <nav className="doors" aria-label="Where to go next">
        {DOORS.map((d) => (
          <a key={d.href} href={d.href} className="door">
            <span className="door-title">{d.title}<Icon.arrow /></span>
            <span className="door-line">{d.line}</span>
          </a>
        ))}
      </nav>

      <Status config={config} book={book} />
    </>
  );
}

function Verdict({ outcome }: { outcome: Outcome | null }) {
  return (
    <p className={`verdict${outcome ? (outcome.ok ? " ok" : " bad") : ""}`}>
      {outcome && (outcome.ok
        ? <>Every sample, score, payout and the root match. Your browser did the math in {fmt.n(outcome.ms)} ms.</>
        : <>{outcome.forgedWho ? `${makerName(outcome.forgedWho)} was given 1 extra token. ` : ""}The logs don't support this payout list.</>)}
    </p>
  );
}

function RootLine({ outcome, root, n }: { outcome: Outcome | null; root: string | null; n: number | null }) {
  // on a phone the stamp lands below the fold: bring the verdict into view once it exists
  useEffect(() => {
    if (!outcome || innerWidth >= 880) return;
    const t = requestAnimationFrame(() => document.querySelector(".on-root")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }));
    return () => cancelAnimationFrame(t);
  }, [outcome]);
  return (
    <div className="rootline">
      <div className="roots">
        {outcome && !outcome.ok ? (
          <>
            <div className="root-row"><span className="label">Committed</span><span className="hash" title={outcome.committed}>{fmt.short(outcome.committed)}</span></div>
            <div className="root-row"><span className="label">Recomputed</span><span title={outcome.recomputed}><HashDiff a={fmt.short(outcome.committed)} b={fmt.short(outcome.recomputed)} /></span></div>
          </>
        ) : (
          <div className="root-row"><span className="label">Root{n !== null ? ` · epoch ${n}` : ""}</span><span className="hash" title={outcome?.recomputed ?? root ?? undefined}>{outcome?.recomputed || root ? fmt.short(outcome?.recomputed ?? root!) : "…"}</span></div>
        )}
      </div>
      <p className="checked-by">
        Computed by <b>the scorer in src/core</b> · Checked by{" "}
        {outcome ? (outcome.ok ? <b>your browser <Tick /></b> : <b className="bad-ink">your browser: does not match <Tick kind="exception" /></b>) : <b>nobody here yet</b>}
      </p>
      <Stamp result={outcome} className="on-root" />
    </div>
  );
}

/** Copied from the README status table (Oct 11). Facts only; nothing here implies a live order or payout. */
function Status({ config, book }: { config: Config | null; book: Book | null }) {
  const live = config?.dataSource === "live";
  return (
    <section className="status" aria-labelledby="status-h">
      <h2 id="status-h" className="label">Status, plainly</h2>
      <ul>
        {live && book && (
          <li><Tick kind="footed" label="read just now" /><span>{book.pair} book, read-only, from the last {book.windowHours} h of order logs up to block {fmt.n(book.head)}: {book.bids.length + book.asks.length ? `${book.bids.length + book.asks.length} resting price levels` : "no resting orders"}. Orders resting longer than that are not counted.</span></li>
        )}
        <li><Tick label="checked on Oct 11, read-only" /><span>Mainnet, read-only (Oct 11): Kuru markets verified; 6,602 MON/USDC book logs replayed, 8 of 8 live orders match contract state. The AUSD/USDC book was empty.</span></li>
        <li><Tick kind="pending" label="not run yet" /><span>Not run yet: no live maker or taker orders.</span></li>
        <li><Tick kind="pending" label="not run yet" /><span>Not run yet: no closed live epoch, so nothing has been paid.</span></li>
        <li><Tick kind="pending" label="not run yet" /><span>Not run yet: the distributor is not deployed on Monad.</span></li>
      </ul>
    </section>
  );
}
