import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

const Check = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden><motion.path d="M2.5 6.5l2.2 2.2L9.5 3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35 }} /></svg>
);
const Cross = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" /></svg>
);

export type StepState = "pending" | "running" | "done" | "bad";
export function Steps({ items }: { items: { key: string; title: ReactNode; detail?: ReactNode; state: StepState }[] }) {
  return (
    <ol className="steps" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((s) => (
          <motion.li key={s.key} className="step" layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: s.state === "pending" ? 0.5 : 1, y: 0 }} transition={{ duration: 0.25 }}>
            <span className={`step-icon ${s.state === "done" ? "done" : s.state === "bad" ? "bad" : ""}`}>
              {s.state === "running" ? <span className="spinner" /> : s.state === "done" ? <Check /> : s.state === "bad" ? <Cross /> : null}
            </span>
            <span className="stack" style={{ gap: 1 }}>
              <span className="step-title">{s.title}</span>
              {s.detail && <span className="step-detail">{s.detail}</span>}
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

/** Where a piece of text came from: which model, where it ran, and whether its numbers passed the grounding check. */
export function Provenance({ by, provider, model, attempts, where }: { by: "model" | "template"; provider: string; model: string | null; attempts: { ungrounded: string[] }[]; where?: "browser" | "server" }) {
  const rejected = attempts.filter((a) => a.ungrounded.length);
  return (
    <div className="provenance">
      {by === "model" ? (
        <span className="badge accent">Written by {model ?? provider}{where === "browser" ? " in your browser" : where === "server" ? " on this server" : ""}</span>
      ) : (
        <span className="badge">{provider === "off" ? "Template, no model chosen" : "Template fallback"}</span>
      )}
      {by === "model" && <span className="badge good">Every number matched the data</span>}
      {rejected.length > 0 && (
        <span title={rejected.map((a) => a.ungrounded.join(", ")).join(" | ")}>
          {by === "model" ? "Earlier draft" : `${rejected.length} model draft${rejected.length > 1 ? "s" : ""}`} rejected for words or numbers not in the data: <span className="mono">{rejected.flatMap((a) => a.ungrounded).slice(0, 4).join(", ")}</span>
        </span>
      )}
    </div>
  );
}

export function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  return (
    <button
      className="btn ghost small"
      onClick={async (e) => {
        const b = e.currentTarget;
        try {
          await navigator.clipboard.writeText(text);
          b.textContent = "Copied";
        } catch {
          b.textContent = "Select and copy";
        }
        setTimeout(() => (b.textContent = label), 1400);
      }}
    >
      {label}
    </button>
  );
}
