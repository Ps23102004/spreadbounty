import { useEffect, useRef, type ReactNode } from "react";

/**
 * Native <dialog> opened with showModal(): focus trap, Escape and the top layer for free.
 * Opens with a 16 px rise and fade (CSS), closes with a 160 ms fade, and returns focus to the opener.
 * Shared by the Account dialog (A5) and the Model dialog (A6, web/src/ui/ModelDialog.tsx).
 */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.classList.remove("closing");
      d.showModal();
    } else if (!open && d.open) {
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const done = () => { d.classList.remove("closing"); d.close(); (opener.current as HTMLElement | null)?.focus?.(); };
      if (reduce) return done();
      d.classList.add("closing");
      const t = setTimeout(done, 160);
      return () => clearTimeout(t);
    }
  }, [open]);
  const id = `dlg-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={id}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-head">
        <h2 id={id}>{title}</h2>
        <button className="btn ghost small" onClick={onClose}>Close</button>
      </div>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}
