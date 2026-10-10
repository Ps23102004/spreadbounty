import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { fmt, type Level } from "../api";

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
  const H = height, L = 40, R = 8, T = 22, B = 26;
  const reduce = useReducedMotion();
  const clip = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const { x, y, yt, x0, x1 } = useMemo(() => {
    const x0 = points[0]?.block ?? 0, x1 = points[points.length - 1]?.block ?? 1;
    const ymax = Math.max(1, ...points.map((p) => Math.max(p.bid, p.ask)));
    const yt = ticks(ymax);
    const top = yt[yt.length - 1]!;
    return { x0, x1, yt, x: (b: number) => L + ((b - x0) / Math.max(1, x1 - x0)) * (W - L - R), y: (v: number) => T + (1 - v / top) * (H - T - B) };
  }, [points, H, W]);
  const path = (k: "bid" | "ask") => points.map((p, i) => `${i ? "L" : "M"}${x(p.block).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const dividers = points.filter((p, i) => i > 0 && p.epoch !== points[i - 1]!.epoch);
  const firstOf = (e: number) => points.find((p) => p.epoch === e)!;
  const epochs = [...new Set(points.map((p) => p.epoch))];

  const onMove = (ev: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.block) - px) < Math.abs(x(points[best]!.block) - px)) best = i; });
    setHover(best);
  };
  const hp = hover === null ? null : points[hover]!;

  return (
    <div className="chart" ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`In-band depth per sample, bids and asks, in ${unit}`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: "pan-y" }}>
        <defs><clipPath id={clip}><motion.rect x={0} y={0} height={H} initial={{ width: reduce ? W : 0 }} animate={{ width: W }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} /></clipPath></defs>
        <g className="grid">{yt.map((v) => <line key={v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} />)}</g>
        <g className="axis">
          {yt.map((v) => <text key={v} x={L - 8} y={y(v) + 4} textAnchor="end">{fmt.compact(v)}</text>)}
          {epochs.map((e) => <text key={e} x={x(firstOf(e).block) + 4} y={T - 8}>Epoch {e}</text>)}
          <text x={L} y={H - 6}>{fmt.n(x0)}</text>
          <text x={W - R} y={H - 6} textAnchor="end">block {fmt.n(x1)}</text>
        </g>
        {dividers.map((p) => <line key={p.block} x1={x(p.block) - 2} x2={x(p.block) - 2} y1={T - 18} y2={H - B} stroke="var(--hairline)" strokeDasharray="3 3" />)}
        <g clipPath={`url(#${clip})`}>
          <path d={path("bid")} fill="none" stroke="var(--bid)" strokeWidth={2} strokeLinejoin="round" />
          <path d={path("ask")} fill="none" stroke="var(--ask)" strokeWidth={2} strokeLinejoin="round" />
        </g>
        {hp && (
          <g>
            <line x1={x(hp.block)} x2={x(hp.block)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth={1} />
            <circle cx={x(hp.block)} cy={y(hp.bid)} r={4} fill="var(--bid)" stroke="var(--surface)" strokeWidth={2} />
            <circle cx={x(hp.block)} cy={y(hp.ask)} r={4} fill="var(--ask)" stroke="var(--surface)" strokeWidth={2} />
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

// ---------------- the book as a ladder: asks above, bids below, the reward band shaded ----------------
export function Ladder({ bids, asks, refPrice, bandBps, unit, decimals }: { bids: Level[]; asks: Level[]; refPrice: number | null; bandBps: number | null; unit: string; decimals: number }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const rows = [...asks].sort((a, b) => b.price - a.price).concat([...bids].sort((a, b) => b.price - a.price));
  const max = Math.max(1, ...rows.map((r) => r.size));
  const mid = refPrice ?? (bids[0] && asks[0] ? (Math.max(...bids.map((b) => b.price)) + Math.min(...asks.map((a) => a.price))) / 2 : null);
  const inBand = (p: number) => mid !== null && bandBps !== null && Math.abs(p - mid) / mid <= bandBps / 1e4;
  const bpsFrom = (p: number) => (mid === null ? null : ((p - mid) / mid) * 1e4);
  const midIndex = asks.length;
  return (
    <div className="stack" style={{ gap: 3 }} role="table" aria-label="Resting maker orders by price level">
      <div className="ladder-row label" role="row" style={{ display: "grid", gridTemplateColumns: "88px 56px minmax(0,1fr)", gap: 10 }}>
        <span role="columnheader">Price</span><span role="columnheader" style={{ textAlign: "right" }}>bps</span><span role="columnheader">Size ({unit})</span>
      </div>
      {rows.map((l, i) => {
        const k = `${l.isBuy}:${l.price}`;
        const bps = bpsFrom(l.price);
        return (
          <div key={k}>
            {i === midIndex && mid !== null && (
              <div style={{ display: "grid", gridTemplateColumns: "88px 56px minmax(0,1fr)", gap: 10, alignItems: "center", margin: "4px 0" }}>
                <span className="mono" style={{ fontWeight: 600 }}>{mid.toFixed(decimals)}</span>
                <span className="label" style={{ textAlign: "right" }}>{refPrice !== null ? "ref" : "mid"}</span>
                <span style={{ borderTop: "1px dashed var(--muted)" }} />
              </div>
            )}
            <div role="row" onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(null)}
              style={{ display: "grid", gridTemplateColumns: "88px 56px minmax(0,1fr)", gap: 10, alignItems: "center", padding: "3px 0", borderRadius: 6, background: inBand(l.price) ? "var(--band)" : undefined }}>
              <span role="cell" className="mono num">{l.price.toFixed(decimals)}</span>
              <span role="cell" className="num muted" style={{ textAlign: "right", fontSize: "0.8rem" }}>{bps === null ? "" : `${bps > 0 ? "+" : ""}${bps.toFixed(1)}`}</span>
              <span role="cell" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <motion.span
                  initial={{ width: reduce ? `${(l.size / max) * 82}%` : 0 }}
                  animate={{ width: `${(l.size / max) * 82}%` }}
                  transition={{ duration: 0.7, delay: reduce ? 0 : i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                  style={{ height: 18, minWidth: 3, borderRadius: "0 4px 4px 0", background: l.isBuy ? "var(--bid)" : "var(--ask)", opacity: hover && hover !== k ? 0.45 : 1, transition: "opacity .15s" }}
                />
                <span className="num" style={{ fontSize: "0.8rem", color: "var(--ink-2)", whiteSpace: "nowrap" }}>
                  {hover === k ? `${fmt.n(l.size, 2)} · ${l.makers} maker${l.makers > 1 ? "s" : ""}` : fmt.compact(l.size)}
                </span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- horizontal bars for comparing candidates on one measure ----------------
export function Bars({ rows, max, unit, highlight, decimals }: { rows: { key: string; label: ReactNode; value: number | null }[]; max?: number; unit: string; highlight?: string; decimals?: number }) {
  const reduce = useReducedMotion();
  const top = max ?? Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((r, i) => (
        <div key={r.key} style={{ display: "grid", gridTemplateColumns: "minmax(0, 150px) minmax(0, 1fr) 64px", gap: 10, alignItems: "center", fontSize: "0.85rem" }}>
          <span style={{ color: r.key === highlight ? "var(--ink)" : "var(--ink-2)", fontWeight: r.key === highlight ? 600 : 400 }}>{r.label}</span>
          <span style={{ background: "var(--surface-2)", borderRadius: 4, height: 14, overflow: "hidden" }}>
            <motion.span
              style={{ display: "block", height: "100%", borderRadius: "0 4px 4px 0", background: r.key === highlight ? "var(--accent)" : "var(--muted)", opacity: r.key === highlight ? 1 : 0.55 }}
              initial={{ width: reduce ? `${((r.value ?? 0) / top) * 100}%` : 0 }}
              animate={{ width: `${((r.value ?? 0) / top) * 100}%` }}
              transition={{ duration: 0.6, delay: reduce ? 0 : i * 0.05 }}
            />
          </span>
          <span className="num" style={{ textAlign: "right" }}>{r.value === null ? "–" : `${fmt.n(r.value, decimals ?? (r.value < 100 && !Number.isInteger(r.value) ? 1 : 0))}${unit}`}</span>
        </div>
      ))}
    </div>
  );
}
