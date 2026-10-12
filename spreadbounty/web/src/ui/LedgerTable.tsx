import type { ReactNode } from "react";
import { Tick } from "./Tick";

type Kind = "agreed" | "exception" | "pending";
export interface Col<T> { key: string; head: ReactNode; cell: (r: T, i: number) => ReactNode; num?: boolean; total?: ReactNode }

/**
 * A ruled ledger (DESIGN-BRIEF 3.4): condensed caps heads, right-aligned tabular figures, a narrow tick column on
 * the far right and totals under a double rule. Ticks draw only when `tick` says a row was checked, staggered
 * 40 ms and done inside 600 ms. Under 560 px the first column sticks and the table scrolls inside its sheet.
 */
export function LedgerTable<T>({ rows, cols, rowKey, rowClass, tick, tickHead, caption, footed }: {
  rows: T[];
  cols: Col<T>[];
  rowKey: (r: T) => string;
  rowClass?: (r: T) => string | undefined;
  tick?: (r: T) => Kind;
  tickHead?: ReactNode;
  caption?: string;
  footed?: boolean; // the totals were added up from the rows above (the sigma tickmark)
}) {
  const hasTotal = cols.some((c) => c.total !== undefined);
  return (
    <div className="ledger-wrap">
      <table className="ledger">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {cols.map((c) => <th key={c.key} scope="col" className={c.num ? "r" : undefined}>{c.head}</th>)}
            {tick && <th scope="col" className="tickcol r">{tickHead ?? <span className="sr-only">Checked</span>}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r)} className={rowClass?.(r)}>
              {cols.map((c, j) => j === 0
                ? <th key={c.key} scope="row" className={c.num ? "r" : undefined}>{c.cell(r, i)}</th>
                : <td key={c.key} className={c.num ? "r" : undefined}>{c.cell(r, i)}</td>)}
              {tick && <td className="tickcol r"><Tick kind={tick(r)} delay={Math.min(i * 0.04, 0.36)} /></td>}
            </tr>
          ))}
        </tbody>
        {hasTotal && (
          <tfoot>
            <tr className="total">
              {cols.map((c, j) => j === 0
                ? <th key={c.key} scope="row">{c.total ?? "Total"}</th>
                : <td key={c.key} className={c.num ? "r" : undefined}>{c.total}</td>)}
              {tick && <td className="tickcol r">{footed && <Tick kind="footed" delay={Math.min(rows.length * 0.04, 0.36)} />}</td>}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** What the tickmarks mean, printed once per page like the legend on a working-paper file. */
export function TickLegend() {
  return (
    <p className="tick-legend">
      <span className="label">Tickmarks</span>
      <span><Tick /> matches your browser's recompute</span>
      <span><Tick kind="exception" /> does not match</span>
      <span><Tick kind="footed" /> footed total</span>
      <span><Tick kind="pending" /> not checked in this browser yet</span>
    </p>
  );
}
