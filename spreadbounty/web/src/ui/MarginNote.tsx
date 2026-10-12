import type { ReactNode } from "react";

/**
 * A note in the margin of a schedule (DESIGN-BRIEF 3.9): Archivo italic with a short pencil leader to the figure
 * it refers to. Red for exceptions and judge flags, graphite for honesty notes ("Gas not counted").
 */
export function MarginNote({ children, tone = "pencil", label }: { children: ReactNode; tone?: "pencil" | "red"; label?: string }) {
  return (
    <p className={`margin-note ${tone}`}>
      <span className="leader" aria-hidden />
      {label && <span className="mn-label">{label}</span>}
      <span>{children}</span>
    </p>
  );
}
