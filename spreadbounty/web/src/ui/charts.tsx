import { motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { fmt, type Level } from "../api";
import { EASE_ENTER, T } from "./motion";
import { quoteWeight } from "./probe";

/** "Nice" axis ticks so every label sits on a round value the scale actually reaches. */
export function ticks(max: number, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}

export function ViewToggle({ table, setTable }: { table: boolean; setTable: (t: boolean) => void }) {
  return (
    <div className="tabs" role="group" aria-label="View">
      <button aria-pressed={!table} onClick={() => setTable(false)}>Chart</button>
      <button aria-pressed={table} onClick={() => setTable(true)}>Table</button>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}><span className="swatch" style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  );
}

// ---------------- depth over time: two series, epoch dividers, crosshair tooltip ----------------
export interface DepthPoint { block: number; bid: number; ask: number; epoch: number }

export function DepthChart({ points, unit, height = 240 }: { points: DepthPoint[]; unit: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.round(e.contentRect.width))));
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const H = height, L = 40, R = 8, T0 = 22, B = 26;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const { x, y, yt, x0, x1 } = useMemo(() => {
    const x0 = points[0]?.block ?? 0, x1 = points[points.length - 1]?.block ?? 1;
    const ymax = Math.max(1, ...points.map((p) => Math.max(p.bid, p.ask)));
    const yt = ticks(ymax);
    const top = yt[yt.length - 1]!;
    return { x0, x1, yt, x: (b: number) => L + ((b - x0) / Math.max(1, x1 - x0)) * (W - L - R), y: (v: number) => T0 + (1 - v / top) * (H - T0 - B) };
  }, [points, H, W]);
  const epochs = [...new Set(points.map((p) => p.epoch))];
  // depth is sampled per epoch and is not a continuous series across the boundary: draw each epoch on its own
  const path = (k: "bid" | "ask", e: number) => points.filter((p) => p.epoch === e).map((p, i) => `${i ? "L" : "M"}${x(p.block).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const sparse = points.length <= 36; // few samples: show each one
  const dividers = points.filter((p, i) => i > 0 && p.epoch !== points[i - 1]!.epoch);
  const firstOf = (e: number) => points.find((p) => p.epoch === e)!;

  const onMove = (ev: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.block) - px) < Math.abs(x(points[best]!.block) - px)) best = i; });
    setHover(best);
  };
  const hp = hover === null ? null : points[hover]!;
  // lines draw once on load (stroke, not width), then stay put
  const draw = { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: T.scene, ease: EASE_ENTER } };

  return (
    <div className="chart" ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`In-band depth per sample, bids and asks, in ${unit}`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: "pan-y" }}>
        <g className="grid">{yt.map((v) => <line key={v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} />)}</g>
        <g className="axis">
          {yt.map((v) => <text key={v} x={L - 8} y={y(v) + 4} textAnchor="end">{fmt.compact(v)}</text>)}
          {epochs.map((e) => <text key={e} x={x(firstOf(e).block) + 4} y={T0 - 8}>Epoch {e}</text>)}
          <text x={L} y={H - 6}>{fmt.n(x0)}</text>
          <text x={W - R} y={H - 6} textAnchor="end">block {fmt.n(x1)}</text>
        </g>
        {dividers.map((p) => <line key={p.block} x1={x(p.block) - 2} x2={x(p.block) - 2} y1={T0 - 18} y2={H - B} stroke="var(--edge)" strokeDasharray="3 3" />)}
        {epochs.map((e) => (
          <g key={e}>
            <motion.path key={`b${points.length}`} {...draw} d={path("bid", e)} fill="none" stroke="var(--bid)" strokeWidth={2} strokeLinejoin="round" />
            <motion.path key={`a${points.length}`} {...draw} d={path("ask", e)} fill="none" stroke="var(--ask)" strokeWidth={2} strokeLinejoin="round" />
          </g>
        ))}
        {sparse && points.map((p) => (
          <g key={p.block} aria-hidden>
            <circle cx={x(p.block)} cy={y(p.bid)} r={2.5} fill="var(--bid)" />
            <circle cx={x(p.block)} cy={y(p.ask)} r={2.5} fill="var(--ask)" />
          </g>
        ))}
        {hp && (
          <g>
            <line x1={x(hp.block)} x2={x(hp.block)} y1={T0} y2={H - B} stroke="var(--muted)" strokeWidth={1} />
            <circle cx={x(hp.block)} cy={y(hp.bid)} r={4} fill="var(--bid)" stroke="var(--sheet)" strokeWidth={2} />
            <circle cx={x(hp.block)} cy={y(hp.ask)} r={4} fill="var(--ask)" stroke="var(--sheet)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: `${Math.min(78, (x(hp.block) / W) * 100)}%`, top: 8, transform: "translateX(8px)" }}>
          <span className="muted">Epoch {hp.epoch} · block {fmt.n(hp.block)}</span>
          <span><span className="swatch" style={{ background: "var(--bid)" }} />Bids <b className="num">{fmt.n(hp.bid)}</b> {unit}</span>
          <span><span className="swatch" style={{ background: "var(--ask)" }} />Asks <b className="num">{fmt.n(hp.ask)}</b> {unit}</span>
        </div>
      )}
    </div>
  );
}

// ---------------- Ladder v2: the book as a depth-of-market ladder ----------------
/**
 * Asks above, bids below, a double rule at the reference. Rows inside the reward band carry a highlighter
 * swipe and a pencil bracket in the margin labelled with the band edge. Size bars grow with scaleX from the
 * left, never width. Hover, focus or tap a row for its size, makers and score weight; the weight is asked of
 * scoreSample (src/core/score.ts) through quoteWeight, not recomputed here.
 */
export function Ladder({ bids, asks, refPrice, bandBps, unit, decimals, pricePrecision, depth = 99 }: {
  bids: Level[]; asks: Level[]; refPrice: number | null; bandBps: number | null; unit: string; decimals: number; pricePrecision: number; depth?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const askRows = [...asks].sort((a, b) => a.price - b.price).slice(0, depth).reverse();
  const bidRows = [...bids].sort((a, b) => b.price - a.price).slice(0, depth);
  const bestAsk = askRows[askRows.length - 1]?.price, bestBid = bidRows[0]?.price;
  const mid = refPrice ?? (bestAsk !== undefined && bestBid !== undefined ? (bestAsk + bestBid) / 2 : null);
  const midRaw = mid === null ? null : BigInt(Math.round(mid * pricePrecision));
  const max = Math.max(1, ...askRows.concat(bidRows).map((r) => r.size));
  const bpsOf = (p: number) => (mid === null ? null : ((p - mid) / mid) * 1e4);
  const inBand = (p: number) => { const b = bpsOf(p); return b !== null && bandBps !== null && Math.abs(b) <= bandBps + 1e-9; };
  const weight = (p: number) => (midRaw === null || bandBps === null ? null : quoteWeight(BigInt(Math.round(p * pricePrecision)), midRaw, bandBps).twoSided);
  const firstAskIn = askRows.findIndex((r) => inBand(r.price));
  const lastBidIn = bidRows.map((r) => inBand(r.price)).lastIndexOf(true);
  const anyIn = firstAskIn >= 0 || lastBidIn >= 0;
  const keyOf = (l: Level) => `${l.isBuy ? "b" : "a"}${l.price}`;
  const all = [...askRows, ...bidRows];
  const act = all.find((l) => keyOf(l) === active) ?? null;

  const row = (l: Level, i: number, bracket: string, edge: string | null) => {
    const k = keyOf(l);
    const b = bpsOf(l.price);
    const band = inBand(l.price);
    const delay = Math.min(i * 0.03, 0.3);
    return (
      <tr key={k} tabIndex={0} className={`${l.isBuy ? "bid" : "ask"}${active === k ? " on" : ""}`}
        onPointerEnter={() => setActive(k)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(k)} onBlur={() => setActive(null)} onClick={() => setActive(k)}>
        <td className={`br ${bracket}`} aria-hidden>{edge && <span className="br-label">{edge}</span>}</td>
        <td className="px">
          {band && <motion.span className="hl" style={{ originX: 0 }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.3, delay: 0.45, ease: EASE_ENTER }} />}
          <span className="pv">{l.price.toFixed(decimals)}</span>
          <span className="sr-only">{band ? ", inside the band" : ", outside the band"}</span>
        </td>
        <td className="bp">{b === null ? "" : `${b > 0 ? "+" : ""}${b.toFixed(1)}`}</td>
        <td className="sz">
          <span className="track"><motion.span className="bar" style={{ originX: 0 }} initial={{ scaleX: 0 }} animate={{ scaleX: l.size / max }} transition={{ duration: T.scene, delay, ease: EASE_ENTER }} /></span>
          <span className="sv">{fmt.compact(l.size)}</span>
        </td>
      </tr>
    );
  };

  const w = act ? weight(act.price) : null;
  return (
    <div className="ladder">
      <table>
        <caption className="sr-only">Resting maker orders by price level, asks above the {refPrice !== null ? "reference" : "mid"} and bids below</caption>
        <thead><tr><th aria-hidden className="br" /><th scope="col">Price</th><th scope="col" className="r">bps</th><th scope="col">Size ({unit})</th></tr></thead>
        <tbody>
          {askRows.map((l, j) => row(l, j, firstAskIn >= 0 && j >= firstAskIn ? `on${j === firstAskIn ? " top" : ""}` : "", j === firstAskIn && bandBps !== null ? `+${bandBps} bps` : null))}
          {mid !== null && (
            <tr className="ref">
              <td className={`br${anyIn ? " on" : ""}`} aria-hidden />
              <td className="px"><span className="pv">{mid.toFixed(decimals)}</span></td>
              <td className="bp">{refPrice !== null ? "REF" : "MID"}</td>
              <td className="sz ref-note">{bandBps !== null ? `band ±${bandBps} bps` : ""}</td>
            </tr>
          )}
          {bidRows.map((l, j) => row(l, askRows.length + j, lastBidIn >= 0 && j <= lastBidIn ? `on${j === lastBidIn ? " bot" : ""}` : "", j === lastBidIn && bandBps !== null ? `−${bandBps} bps` : null))}
        </tbody>
      </table>
      <p className="ladder-readout" aria-live="polite">
        {act
          ? <><span className="mono">{act.price.toFixed(decimals)}</span> · {fmt.n(act.size, 2)} {unit} · {act.makers} maker{act.makers === 1 ? "" : "s"} · {w === null ? "no band set" : w > 0 ? `weight ${w.toFixed(2)} of the top score` : "outside the band, weight 0"}</>
          : "Hover, tap or focus a row for its size, makers and score weight."}
      </p>
    </div>
  );
}

// ---------------- the quote probe: move a hypothetical quote, read its weight from the scorer ----------------
export function QuoteProbe({ mid, pricePrecision: P, tick, bandBps, decimals, refLabel }: {
  mid: number; pricePrecision: number; tick: number | null; bandBps: number; decimals: number; refLabel: "REF" | "MID";
}) {
  const id = useId();
  const midRaw = BigInt(Math.round(mid * P));
  const tickRaw = BigInt(Math.max(1, Math.round(tick ?? mid * P * 1e-5))); // fallback: 0.1 bps
  const K = Math.ceil((1.3 * mid * P * bandBps) / 1e4 / Number(tickRaw));
  const [k, setK] = useState(() => Math.min(K, Math.round((mid * P * 6) / 1e4 / Number(tickRaw))));
  const priceRaw = midRaw + BigInt(k) * tickRaw;
  const price = Number(priceRaw) / P;
  const bps = (Number(priceRaw - midRaw) / Number(midRaw)) * 1e4;
  const w = quoteWeight(priceRaw, midRaw, bandBps);
  const inside = Math.abs(bps) <= bandBps + 1e-9;
  const where = bps > 0 ? "above" : bps < 0 ? "below" : "at";
  const ref = refLabel === "REF" ? "reference" : "mid";
  const half = 50 / 1.3;
  const style = { "--band-lo": `${50 - half}%`, "--band-hi": `${50 + half}%` } as CSSProperties;
  return (
    <div className="probe">
      <div className="probe-head">
        <label htmlFor={id} className="label">Try a quote</label>
        <span className="probe-val"><span className="mono">{price.toFixed(decimals)}</span> <span className="muted">{bps === 0 ? `at ${ref}` : `${Math.abs(bps).toFixed(1)} bps ${where}`}</span></span>
      </div>
      <input id={id} type="range" min={-K} max={K} step={1} value={k} style={style}
        onChange={(e) => setK(Number(e.target.value))}
        aria-valuetext={`${price.toFixed(decimals)}, ${Math.abs(bps).toFixed(1)} bps ${where} ${ref}, weight ${w.twoSided.toFixed(2)}`} />
      <div className="probe-scale" aria-hidden><span>−{Math.round(bandBps * 1.3)} bps</span><span>−{bandBps}</span><span>{refLabel}</span><span>+{bandBps}</span><span>+{Math.round(bandBps * 1.3)} bps</span></div>
      <div className="probe-out">
        <span className="meter" aria-hidden><span style={{ transform: `scaleX(${w.twoSided})` }} /></span>
        <p>{inside
          ? <>Inside the band. Weight <b>{w.twoSided.toFixed(2)}</b> of the top score with a matching {bps > 0 ? "bid" : "ask"}, <b>{w.oneSided.toFixed(2)}</b> on its own.</>
          : <>Outside the band: earns nothing.</>}</p>
      </div>
      <p className="probe-note">One side alone scores a third. Illustration only; no order is placed.</p>
    </div>
  );
}

// ---------------- horizontal bars for comparing candidates on one measure ----------------
export function Bars({ rows, max, unit, highlight, decimals }: { rows: { key: string; label: ReactNode; value: number | null }[]; max?: number; unit: string; highlight?: string; decimals?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((r, i) => (
        <div key={r.key} className={`hbar${r.key === highlight ? " on" : ""}`}>
          <span className="hbar-label">{r.key === highlight ? <span className="circled-label">{r.label}</span> : r.label}</span>
          <span className="track">
            <motion.span className="bar" style={{ originX: 0 }} initial={{ scaleX: 0 }} animate={{ scaleX: (r.value ?? 0) / top }} transition={{ duration: T.scene, delay: Math.min(i * 0.03, 0.3), ease: EASE_ENTER }} />
          </span>
          <span className="num" style={{ textAlign: "right" }}>{r.value === null ? "–" : `${fmt.n(r.value, decimals ?? (r.value < 100 && !Number.isInteger(r.value) ? 1 : 0))}${unit}`}</span>
        </div>
      ))}
    </div>
  );
}
