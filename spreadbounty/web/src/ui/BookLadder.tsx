import { useCallback, useEffect, useState } from "react";
import { api, fmt, type Book, type CampaignRow } from "../api";
import { Ladder, QuoteProbe } from "./charts";
import { ErrorNote, Skeleton } from "./Schedule";

/** The campaign's book as Ladder v2 plus the quote probe, with loading, empty and error states at final height. */
export function BookLadder({ campaign, depth = 99, probe = true, onBook }: { campaign: CampaignRow; depth?: number; probe?: boolean; onBook?: (b: Book) => void }) {
  const [book, setBook] = useState<Book | null>(null);
  const [tick, setTick] = useState<number | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setErr(null);
    setBook(null);
    api.book(campaign.pair, 1).then((b) => { setBook(b); onBook?.(b); }).catch((e) => setErr(String(e?.message ?? e)));
    // tick size snaps the probe to prices the book can actually hold
    fetch(`/api/market?pair=${encodeURIComponent(campaign.pair)}`).then((r) => (r.ok ? r.json() : null)).then((m: { tickSize?: number } | null) => setTick(m?.tickSize ?? null)).catch(() => setTick(null));
  }, [campaign.pair]);
  useEffect(load, [load]);

  const P = Number(campaign.pricePrecision);
  const decimals = campaign.pair.startsWith("MON") ? 6 : 4;
  const base = campaign.pair.split("/")[0]!;
  const levels = book ? Math.min(depth, book.asks.length) + Math.min(depth, book.bids.length) + 1 : Math.min(depth, 5) * 2 + 1;
  if (err) return <ErrorNote onRetry={load}>Couldn't read the {campaign.pair} book: {err}</ErrorNote>;
  if (!book) return <Skeleton rows={levels + 1} h={28} />;
  if (!book.bids.length && !book.asks.length) return <p className="note">No resting orders on {book.pair} in the last {book.windowHours} h of logs, up to block {fmt.n(book.head)}.</p>;
  const mid = book.refPrice ?? (book.bids[0] && book.asks[0] ? (book.bids[0].price + book.asks[0].price) / 2 : null);
  return (
    <>
      <Ladder bids={book.bids} asks={book.asks} refPrice={book.refPrice} bandBps={book.bandBps} unit={base} decimals={decimals} pricePrecision={P} depth={depth} />
      {probe && mid !== null && book.bandBps !== null && tick !== undefined && (
        <QuoteProbe key={`${mid}:${tick}`} mid={mid} pricePrecision={P} tick={tick} bandBps={book.bandBps} decimals={decimals} refLabel={book.refPrice !== null ? "REF" : "MID"} />
      )}
    </>
  );
}
