import { ethers } from "ethers";
import { motion } from "motion/react";
import { useEffect, useId, useState, type MouseEvent } from "react";
import { api, fmt, type CampaignRow, type EpochFile } from "../api";
import { EASE_MOVE, T } from "./motion";
import { explainSample } from "./sampling";
import { ErrorNote, Skeleton } from "./Schedule";
import { Tick } from "./Tick";

/**
 * The draw (DESIGN-BRIEF 6.2): the epoch's real sample blocks from its epoch file, one per window of
 * `sampleEvery` blocks. "How was this block picked?" moves a marker from the block that closes the window to the
 * sample block, then redoes the rule here: window start + (hash of the closing block mod sampleEvery).
 * Nothing is simulated; in demo mode the closing block's hash is also recomputed from the demo formula.
 */
export function SamplingStrip({ campaign, n, demo }: { campaign: CampaignRow; n: number | null; demo: boolean }) {
  const [file, setFile] = useState<EpochFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [w, setW] = useState(0);
  const [shown, setShown] = useState(0); // how many times "How was this block picked?" ran
  const [done, setDone] = useState(false);
  const id = useId();

  useEffect(() => {
    if (n === null) return;
    let live = true;
    setFile(null);
    setErr(null);
    setShown(0);
    setW(0);
    api.epoch(campaign.id, n).then((f) => live && setFile(f)).catch((e) => live && setErr(String(e?.message ?? e)));
    return () => { live = false; };
  }, [campaign.id, n, tries]);

  if (n === null) return <p className="ink2">No closed epoch yet, so no blocks have been drawn.</p>;
  if (err) return <ErrorNote onRetry={() => setTries((t) => t + 1)}>Couldn't load epoch {n}: {err}</ErrorNote>;
  if (!file) return <Skeleton rows={5} h={32} />;

  const every = file.campaign.sampleEvery;
  const samples = file.samples;
  const s = samples[Math.min(w, samples.length - 1)];
  if (!s) return <p className="ink2">Epoch {n} has no sample blocks.</p>;
  const { start, offset, agrees } = explainSample(s, every);
  const hashOk = demo ? ethers.utils.id(`spreadbounty-demo-block-${s.closer}`) === s.closerHash : null;
  const pct = (b: number) => ((b - start + 0.5) / every) * 100;
  const pick = (k: number) => { setW(k); setShown(0); setDone(false); };
  const onStrip = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    pick(Math.min(samples.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * samples.length))));
  };

  return (
    <div className="sampling">
      <div className="ss-overview">
        <svg viewBox={`0 0 ${samples.length * 10} 28`} preserveAspectRatio="none" onClick={onStrip} aria-hidden>
          {samples.map((x, i) => {
            const st = x.closer - every + 1;
            const at = i * 10 + ((x.block - st) / every) * 10;
            return (
              <g key={x.block}>
                {i === w && <rect x={i * 10} y={0} width={10} height={28} className="ss-on" />}
                <line x1={i * 10} x2={i * 10} y1={20} y2={28} className="ss-win" />
                <line x1={at} x2={at} y1={4} y2={24} className="ss-pick" />
              </g>
            );
          })}
        </svg>
        <div className="ss-axis num"><span>{fmt.n(file.fromBlock)}</span><span>{samples.length} windows of {every} blocks, one sample each</span><span>{fmt.n(file.toBlock)}</span></div>
      </div>

      <div className="ss-pickrow">
        <label htmlFor={id} className="label">Window</label>
        <input id={id} type="range" min={0} max={samples.length - 1} value={w} onChange={(e) => pick(Number(e.target.value))}
          aria-valuetext={`Window ${w + 1} of ${samples.length}, blocks ${start} to ${s.closer}, sample block ${s.block}`} />
        <span className="num small">Window {w + 1} of {samples.length} · blocks {fmt.n(start)} to {fmt.n(s.closer)}</span>
      </div>

      <div className="ss-zoom" aria-hidden>
        <span className="ss-sample" style={{ left: `${pct(s.block)}%` }}><span>sample {fmt.n(s.block)}</span></span>
        <span className="ss-closer"><span>closes the window, {fmt.n(s.closer)}</span></span>
        {shown > 0 && (
          <motion.span key={shown} className="ss-track" initial={{ x: `${pct(s.closer)}%` }} animate={{ x: `${pct(s.block)}%` }}
            transition={{ duration: T.scene, ease: EASE_MOVE }} onAnimationComplete={() => setDone(true)}>
            <span className="ss-marker" />
          </motion.span>
        )}
      </div>

      <div className="row">
        <button className="btn ghost" onClick={() => { setDone(false); setShown((k) => k + 1); }}>How was this block picked?</button>
        <span className="muted small">Nobody knows a window's hash until its last block is final, so nobody can pick the block that counts.</span>
      </div>

      {shown > 0 && done && (
        <ol className="tape-code ss-rule" aria-live="polite">
          <li><span>sample</span><span>= window start + (hash of block {fmt.n(s.closer)} mod {every})</span></li>
          <li><span>hash</span><span className="mono">{fmt.short(s.closerHash)}{hashOk === null ? " (from the epoch file)" : hashOk ? " (recomputed here from the demo formula)" : " (does not match the demo formula)"}</span>{hashOk !== null && <Tick kind={hashOk ? "agreed" : "exception"} />}</li>
          <li><span>=</span><span>{fmt.n(start)} + {offset} = {fmt.n(start + offset)}</span><Tick kind={agrees ? "agreed" : "exception"} /></li>
          <li className={agrees ? undefined : "bad-ink"}><span>file</span><span>sample block {fmt.n(s.block)}: {agrees ? "matches" : "does not match"}</span></li>
        </ol>
      )}
    </div>
  );
}
