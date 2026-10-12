/** One printed tape line. Symbols as on a real adding machine: # count or id, + sum, ◇ subtotal, * final total, ≠ mismatch. */
export interface TapeLine { id: string; fig: string; text: string; sym: "#" | "+" | "◇" | "*" | "≠"; red?: boolean }

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
