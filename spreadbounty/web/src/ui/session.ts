import { useEffect, useSyncExternalStore } from "react";
import { me, type Me } from "../auth";

/**
 * Who you are (A5). One session store for the whole app: the header button, the Account dialog, Design's
 * publish gate and Claim's "Use my address" all read it. The session itself is the server's HttpOnly cookie;
 * nothing secret lives in this tab. Reading, verifying and claim lookups never need an account.
 */
export interface Persona { name: string; address: string }
export interface Session {
  address: string | null;
  roles: Me["roles"] | null;
  persona: Persona | null; // read-only demo persona: a label, never a session, never publishes
  checked: boolean; // the first session check has finished
  open: boolean; // the Account dialog
}

/**
 * When this browser's session cookie should expire (a timestamp, not a secret). GET /api/me answers 401 when
 * signed out, and the browser logs every 401 as a console error, so a visitor who never signed in here skips
 * the call. A stale hint (server restarted, cookie cleared) costs one 401, then the hint is gone.
 */
const HINT = "sb-signed-in-until";
export const SESSION_MS = 8 * 3600_000; // the cookie's Max-Age on the server
const hintLive = () => {
  try {
    return Number(localStorage.getItem(HINT) ?? 0) > Date.now();
  } catch {
    return true; // storage blocked: ask the server rather than guess
  }
};
export const setHint = (until: number | null) => {
  try {
    if (until) localStorage.setItem(HINT, String(until));
    else localStorage.removeItem(HINT);
  } catch {
    /* storage blocked: the next load asks the server */
  }
};

let state: Session = { address: null, roles: null, persona: null, checked: false, open: false };
const subs = new Set<() => void>();
export const emit = (patch: Partial<Session>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
export const getSession = () => state;
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

/** GET /api/me: a 200 without an address, a 401 or a network error all mean signed out. */
export async function refreshSession() {
  if (!hintLive()) return emit({ address: null, roles: null, checked: true });
  const who = await me().catch(() => null);
  if (!who?.address) setHint(null);
  emit({ address: who?.address ?? null, roles: who?.address ? who.roles : null, checked: true });
}
export const openAccount = () => emit({ open: true });
export const closeAccount = () => emit({ open: false });

let asked = false;
export function useSession(): Session {
  const s = useSyncExternalStore(subscribe, getSession);
  useEffect(() => {
    if (!asked) {
      asked = true;
      refreshSession();
    }
  }, []);
  return s;
}

