import { AnimatePresence, motion } from "motion/react";
import { EASE_ENTER, T } from "./motion";

/**
 * The adding-machine tape. A line exists only once its step has finished; the caller pushes it.
 * Right-hand symbols as on a real machine: # count or id (non-add), + sum, ◇ subtotal, * final total, ≠ mismatch.
 * Mismatch lines print in the red half of the ribbon.
 */
export interface TapeLine { id: string; fig: string; text: string; sym: "#" | "+" | "◇" | "*" | "≠"; red?: boolean }

export function Tape({ lines, rows, empty, label }: { lines: TapeLine[]; rows?: number; empty: string; label: string }) {
  return (
    <div className="tape" style={rows ? { height: `calc(${rows} * var(--tape-line) + 2 * var(--s-4))` } : undefined}>
      <ol aria-live="polite" aria-label={label}>
        {lines.length === 0 && <li className="tape-empty">{empty}</li>}
        <AnimatePresence initial={false}>
          {lines.map((l) => (
            <motion.li
              key={l.id}
              layout="position"
              className={l.red ? "red" : undefined}
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: T.micro, ease: EASE_ENTER }}
            >
              <span className="fig">{l.fig}</span>
              <span className="txt">{l.text}</span>
              <span className="sym" aria-hidden>{l.sym}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}

/**
 * Display pacing for the tape: holds at least `gap` ms between lines so fast steps stay readable,
 * and never adds more than `budget` ms in total. Await it before pushing a finished line.
 */
export function makePacer(gap = 90, budget = 1000) {
  let last = 0;
  let spent = 0;
  return async () => {
    const now = performance.now();
    const wait = Math.min(last ? Math.max(0, last + gap - now) : 0, Math.max(0, budget - spent));
    spent += wait;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = performance.now();
  };
}
