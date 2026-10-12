import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_ENTER, T } from "./motion";
import { makePacer, type TapeLine } from "./pacer";

/**
 * The adding-machine tape. A line exists only once its step has finished; the caller pushes it.
 * Right-hand symbols as on a real machine: # count or id (non-add), + sum, ◇ subtotal, * final total, ≠ mismatch.
 * Mismatch lines print in the red half of the ribbon.
 */
export type { TapeLine };
export { makePacer };

export function Tape({ lines, rows, empty, label, children, wrap }: { lines: TapeLine[]; rows?: number; empty: string; label: string; children?: ReactNode; wrap?: boolean }) {
  return (
    <div className={wrap ? "tape wrap" : "tape"} style={rows ? { height: `calc(${rows} * var(--tape-line) + 2 * var(--s-4))` } : undefined}>
      <ol aria-live="polite" aria-label={label}>
        {lines.length === 0 && <li className="tape-empty">{empty}</li>}
        <AnimatePresence initial={false}>
          {lines.map((l) => (
            <motion.li
              key={l.id}
              layout="position"
              className={[l.red && "red", l.note && "tnote"].filter(Boolean).join(" ") || undefined}
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
      {children}
    </div>
  );
}
