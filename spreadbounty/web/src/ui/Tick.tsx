import { motion, useReducedMotion } from "motion/react";
import { EASE_ENTER, T } from "./motion";

/**
 * A tickmark, drawn like a pencil stroke (pathLength 0 to 1). It renders only when a check has finished,
 * so the draw itself reports real progress. Pass/fail is never colour alone: each kind carries its own glyph
 * and screen-reader text.
 */
const TEXT = { agreed: "checked against recomputation", exception: "does not match", footed: "footed total", pending: "not yet checked" } as const;

export function Tick({ kind = "agreed", delay = 0, size = 16 }: { kind?: keyof typeof TEXT; delay?: number; size?: number }) {
  const reduce = useReducedMotion();
  const draw = { initial: { pathLength: reduce ? 1 : 0 }, animate: { pathLength: 1 }, transition: { duration: T.small, delay: reduce ? 0 : delay, ease: EASE_ENTER } };
  const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <span className={`tick tick-${kind}`}>
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
        {kind === "agreed" && <motion.path {...P} {...draw} d="M2.5 8.5l3.5 3.5L13.5 3.5" />}
        {kind === "exception" && (
          <>
            <motion.circle {...P} {...draw} cx="8" cy="8" r="6.5" />
            <motion.path {...P} {...draw} d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
          </>
        )}
        {kind === "footed" && <motion.path {...P} {...draw} d="M12 3.5H4.5L8.5 8l-4 4.5H12" />}
        {kind === "pending" && <path {...P} d="M4 8h8" />}
      </svg>
      <span className="sr-only">{TEXT[kind]}</span>
    </span>
  );
}
