import type { ReactNode } from "react";

/** The working-paper header line of a page: "W/P A  CAMPAIGN LEDGER", fields on the right, a double rule under it. */
export function PageHead({ wp, title, children }: { wp: string; title: string; children?: ReactNode }) {
  return (
    <div className="wp">
      <span className="wp-ref"><b>W/P {wp}</b>{title}</span>
      {children && <span className="row" style={{ gap: 8 }}>{children}</span>}
    </div>
  );
}

/**
 * A schedule: one sheet of the working papers (replaces the generic panel).
 * The reference (A-1, V-2) sits in the top-right corner with the data label; the footer says who computed
 * and who checked the figures.
 */
export function Schedule({ id, title, desc, source, footer, children, className = "", aside }: {
  id: string; title: ReactNode; desc?: ReactNode; source?: ReactNode; footer?: ReactNode; children?: ReactNode; className?: string; aside?: ReactNode;
}) {
  const hid = `sch-${id}`;
  return (
    <section className={`schedule ${className}`} aria-labelledby={hid}>
      <header className="sch-head">
        <div className="sch-title">
          <h2 id={hid}>{title}</h2>
          {desc && <p className="sch-desc">{desc}</p>}
        </div>
        <div className="sch-corner">
          {aside}
          {source}
          <span className="sch-ref" aria-label={`Schedule ${id}`}>{id}</span>
        </div>
      </header>
      {children}
      {footer && <footer className="sch-foot">{footer}</footer>}
    </section>
  );
}

/** Ruled skeleton rows at the final height, so nothing jumps when data arrives. */
export function Skeleton({ rows, h = 32 }: { rows: number; h?: number }) {
  return <div className="skel" style={{ height: rows * h, backgroundSize: `100% ${h}px` }} aria-hidden />;
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="note bad row" role="alert" style={{ justifyContent: "space-between" }}>
      <span>{children}</span>
      {onRetry && <button className="btn small ghost" onClick={onRetry}>Retry</button>}
    </div>
  );
}
