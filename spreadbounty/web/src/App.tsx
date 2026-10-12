import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { api, type CampaignRow, type Config } from "./api";
import { Claim } from "./pages/Claim";
import { Design } from "./pages/Design";
import { Makers } from "./pages/Makers";
import { Overview } from "./pages/Overview";
import { Start } from "./pages/Start";
import { Verify } from "./pages/Verify";
import { RoleChip, useSession, WalletButton } from "./ui/AccountDialog";
import { Icon, Mark, ThemeIcon } from "./ui/icons";
import { WriterChip } from "./ui/ModelSlot";
import { SourceLabel } from "./ui/SourceLabel";

/** Five index tabs; Claim lives under Make markets (#claim still deep-links and lights that tab). */
const TABS = [
  { id: "start", label: "Start", icon: Icon.start },
  { id: "overview", label: "Overview", icon: Icon.overview },
  { id: "design", label: "Design", icon: Icon.design },
  { id: "makers", label: "Make markets", icon: Icon.makers },
  { id: "verify", label: "Verify", icon: Icon.verify },
] as const;
const ROUTES = ["start", "overview", "design", "makers", "claim", "verify"] as const;
type PageId = (typeof ROUTES)[number];

/** "#makers/rest" is page "makers", sub-tab "rest". */
const pageOf = (hash: string): PageId => {
  const h = hash.replace("#", "").split("/")[0] as PageId;
  return ROUTES.includes(h) ? h : "start";
};
const tabOf = (p: PageId) => (p === "claim" ? "makers" : p);

type Theme = "system" | "light" | "dark";
const loadTheme = (): Theme => {
  try {
    return (localStorage.getItem("sb-theme") as Theme) || "system";
  } catch {
    return "system";
  }
};
const EASE_ENTER = [0.16, 1, 0.3, 1] as const;
const EASE_EXIT = [0.7, 0, 0.84, 0] as const;
const EASE_MOVE = [0.65, 0, 0.35, 1] as const;

export function App() {
  const [hash, setHash] = useState(location.hash);
  const page = pageOf(hash);
  const sub = hash.split("/")[1] ?? "";
  const [config, setConfig] = useState<Config | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null); // null until the server answers
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const session = useSession();

  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("sb-theme", theme);
    } catch {
      /* private mode: theme just isn't remembered */
    }
  }, [theme]);

  const refresh = useCallback(async () => {
    const cs = await api.campaigns();
    setCampaigns(cs);
    setCampaignId((cur) => cur ?? cs.find((c) => c.epochs > 0)?.id ?? cs[0]?.id ?? null);
    return cs;
  }, []);
  const load = useCallback(() => {
    setError(null);
    api.config().then(setConfig).catch((e) => setError(String(e.message ?? e)));
    refresh().catch((e) => setError(String(e.message ?? e)));
  }, [refresh]);
  useEffect(load, [load]);

  // a new page starts at its top, and its heading takes focus once it has entered (not on the first load: the skip link comes first)
  const arrived = useRef(false);
  useEffect(() => {
    if (!arrived.current) { arrived.current = true; return; }
    window.scrollTo(0, 0);
    // focus the new page's heading as soon as it has mounted (the old route must leave first)
    let tries = 0;
    const t = setInterval(() => {
      const h = document.querySelector<HTMLElement>(`#content [data-page="${page}"] h1`);
      if (h || ++tries > 50) {
        clearInterval(t);
        if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      }
    }, 100);
    return () => clearInterval(t);
  }, [page]);

  const campaign = campaigns?.find((c) => c.id === campaignId) ?? null;
  const status = campaigns ? "ready" : error ? "error" : "loading";
  const skip = (e: MouseEvent) => {
    e.preventDefault(); // the hash is the router; don't navigate
    document.getElementById("content")?.focus();
  };
  const nextTheme = () => setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system");
  const themeBtn = (
    <button className="icon-btn" aria-label={`Theme: ${theme}. Change theme.`} title={`Theme: ${theme}`} onClick={nextTheme}>
      <ThemeIcon theme={theme} />
    </button>
  );
  const label = <SourceLabel config={config} campaign={campaign} failed={!!error} />;

  return (
    <>
      <a className="skip" href="#content" onClick={skip}>Skip to content</a>
      <div className="datastrip">{label}</div>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#start"><Mark />Spreadbounty</a>
          <nav className="itabs" aria-label="Main">
            {TABS.map((t) => {
              const on = tabOf(page) === t.id;
              return (
                <a key={t.id} className="itab" href={`#${t.id}`} aria-current={on ? "page" : undefined}>
                  {on && <motion.span layoutId="itab" className="itab-face" transition={{ duration: 0.24, ease: EASE_MOVE }} />}
                  <span className="itab-label">{t.label}</span>
                </a>
              );
            })}
          </nav>
          <div className="tools">
            {label}
            <WriterChip config={config} />
            <RoleChip session={session} />
            <WalletButton session={session} config={config} />
            <span className="theme-top">{themeBtn}</span>
          </div>
        </div>
      </header>

      <main id="content" tabIndex={-1}>
        {error && (
          <div className="note bad row" role="alert" style={{ justifyContent: "space-between" }}>
            <span>Can't reach the Spreadbounty server ({error}). Start it with <code>npm start</code>, then retry.</span>
            <button className="btn small" onClick={load}>Retry</button>
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            className="route"
            data-page={page}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_ENTER } }}
            exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_EXIT } }}
          >
            {page === "start" && <Start campaign={campaign} config={config} status={status} />}
            {page === "overview" && <Overview key={campaign?.id ?? "none"} campaign={campaign} campaigns={campaigns ?? []} status={status} onPick={setCampaignId} config={config} onRetry={load} />}
            {page === "design" && <Design config={config} onPublished={async (id) => { await refresh(); setCampaignId(id); }} />}
            {page === "makers" && <Makers campaign={campaign} status={status} config={config} sub={sub} />}
            {page === "verify" && <Verify campaign={campaign} config={config} status={status} />}
            {page === "claim" && <Claim campaign={campaign} config={config} status={status} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="site-foot">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", alignItems: "flex-start" }}>
          <p>Payouts come from public Kuru order logs and open code. Models read requests and explain verified numbers; they never score or pay.</p>
          <span className="theme-foot">{themeBtn}</span>
        </div>
      </footer>

      <nav className="bottombar" aria-label="Main, bottom bar">
        {TABS.map((t) => {
          const on = tabOf(page) === t.id;
          return (
            <a key={t.id} href={`#${t.id}`} aria-current={on ? "page" : undefined}>
              {on && <motion.span layoutId="bar-mark" className="bar-mark" transition={{ duration: 0.24, ease: EASE_MOVE }} />}
              <t.icon />
              <span>{t.label}</span>
            </a>
          );
        })}
      </nav>
    </>
  );
}
