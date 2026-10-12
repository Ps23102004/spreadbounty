/** Pencil-stroke icons (1.5 px), drawn for this world. No icon package. */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Svg = ({ children, size = 22 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">{children}</svg>
);

export const Icon = {
  /** Start: a tickmark */
  start: () => <Svg><path {...P} d="M4 13.5l5 4.5L20 6" /></Svg>,
  /** Overview: ruled ledger columns */
  overview: () => <Svg><path {...P} d="M4 5h16v14H4zM4 9h16M9.5 9v10M15 9v10" /></Svg>,
  /** Design: a drafting compass */
  design: () => <Svg><path {...P} d="M12 3v2.5M12 5.5L6.5 20M12 5.5L17.5 20M8.2 15.5h7.6" /><circle {...P} cx="12" cy="5.5" r="1.2" /></Svg>,
  /** Make markets: a price ladder */
  makers: () => <Svg><path {...P} d="M7 3v18M17 3v18M7 7h10M7 11h10M7 15h10M7 19h10" /></Svg>,
  /** Verify: a tick in a circle */
  verify: () => <Svg><circle {...P} cx="12" cy="12" r="8.5" /><path {...P} d="M8 12.5l2.8 2.6L16.2 9" /></Svg>,
  /** Claim: a receipt */
  claim: () => <Svg><path {...P} d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3" /></Svg>,
  arrow: () => <Svg size={16}><path {...P} d="M4 12h15M14 7l5 5-5 5" /></Svg>,
};

/** The brand mark: two offset ink bars over a highlighter swipe. */
export const Mark = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden focusable="false">
    <rect x="1" y="8" width="24" height="10" fill="var(--highlight)" />
    <rect x="4" y="6" width="11" height="4" fill="var(--ink)" />
    <rect x="11" y="16" width="11" height="4" fill="var(--ink)" />
  </svg>
);

export function ThemeIcon({ theme }: { theme: "system" | "light" | "dark" }) {
  if (theme === "light") return <Svg size={16}><circle {...P} cx="12" cy="12" r="4" /><path {...P} d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></Svg>;
  if (theme === "dark") return <Svg size={16}><path {...P} d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" /></Svg>;
  return <Svg size={16}><circle {...P} cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></Svg>;
}
