import { useReducedMotion } from "motion/react";
import { useEffect, useReducer, type CSSProperties } from "react";
import { MarginNote } from "./MarginNote";
import { Tick } from "./Tick";

/**
 * Why flickering pays nothing (DESIGN-BRIEF 6.3). One cell per block, filled every 300 ms (Monad's block time),
 * so a quote needs `need` blocks to qualify. Requote empties the clock. A sample lands at a block nobody picked
 * in advance; if the clock is full the quote scores. Reduced motion: no timer, a Next block button instead.
 */
type Phase = "idle" | "resting" | "done";
interface S { phase: Phase; block: number; rested: number; sampleAt: number; atSample: number }
type A = "place" | "requote" | "step";

const BLOCK_MS = 300;

export function RestClock({ need = 20 }: { need?: number }) {
  const reduce = useReducedMotion();
  const [s, dispatch] = useReducer((s: S, a: A): S => {
    if (a === "place") return { phase: "resting", block: 0, rested: 0, atSample: 0, sampleAt: Math.round(need * 0.5) + Math.floor(Math.random() * need * 1.25) };
    if (s.phase !== "resting") return s;
    if (a === "requote") return { ...s, rested: 0 };
    const block = s.block + 1, rested = s.rested + 1;
    return block >= s.sampleAt ? { ...s, block, rested, phase: "done", atSample: rested } : { ...s, block, rested };
  }, { phase: "idle", block: 0, rested: 0, sampleAt: 0, atSample: 0 });

  useEffect(() => {
    if (s.phase !== "resting" || reduce) return;
    const t = setInterval(() => dispatch("step"), BLOCK_MS);
    return () => clearInterval(t);
  }, [s.phase, reduce]);

  const filled = Math.min(s.rested, need);
  const full = s.rested >= need;
  const scored = s.phase === "done" && s.atSample >= need;
  return (
    <div className="restclock">
      <div className="rc-controls">
        <button className="btn" onClick={() => dispatch("place")} disabled={s.phase === "resting"}>{s.phase === "idle" ? "Place quote" : "Place a new quote"}</button>
        <button className="btn ghost" onClick={() => dispatch("requote")} disabled={s.phase !== "resting"}>Requote</button>
        {reduce && <button className="btn ghost" onClick={() => dispatch("step")} disabled={s.phase !== "resting"}>Next block</button>}
        <span className="rc-count num" aria-live="off">{s.phase === "idle" ? "No quote yet" : `Block +${s.block} · rested ${Math.min(s.rested, need)} of ${need}${s.rested > need ? `, ${s.rested} so far` : ""}`}</span>
      </div>

      <div className="rc-row" style={{ "--n": need } as CSSProperties} role="img" aria-label={`Rest clock: ${filled} of ${need} blocks rested${full ? ", qualifies" : ""}`}>
        {Array.from({ length: need }, (_, i) => <span key={i} className={`rc-cell${i < filled ? (full ? " full" : " on") : ""}`} />)}
        {s.phase === "done" && <span className={`rc-sample${s.atSample > need * 0.7 ? " flip" : ""}`} style={{ left: `${(Math.min(s.atSample, need) / need) * 100}%` }}><span>sample</span></span>}
      </div>
      <div className="rc-scale" aria-hidden><span>1</span><span>{need} blocks · {(need * BLOCK_MS) / 1000} s</span></div>

      <div className="rc-out" role="status">
        {s.phase === "idle" && <p className="ink2">Place a quote and watch it rest. A sample block arrives at a moment you can't predict.</p>}
        {s.phase === "resting" && <p className="ink2">{full ? "Rested long enough. It counts at the next sample, as long as you leave it alone." : "Resting. Requote now and the clock starts over."}</p>}
        {s.phase === "done" && (scored
          ? <p className="ok-ink"><Tick label="this quote scores" /> Sampled at block +{s.block}. The quote had rested {s.atSample} blocks, so it scores.</p>
          : <MarginNote tone="red">Sampled at block +{s.block}. Not rested {need} blocks (only {s.atSample}): earns nothing.</MarginNote>)}
      </div>
      <p className="probe-note">Illustration of the rule at 300 ms per block. No order is placed.</p>
    </div>
  );
}
