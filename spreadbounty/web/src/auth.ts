/**
 * Wallet sign-in (A5), browser side. Wallets are found through EIP-6963 events, with `window.ethereum` as the
 * fallback. The server builds the Sign-In with Ethereum message (EIP-4361); the wallet only signs it, and the
 * session lives in an HttpOnly cookie, so nothing here stores a token. Sign-in never asks to switch networks.
 *
 *   const [w] = await discoverWallets();
 *   const address = await connect(w);
 *   const c = await challenge(address);   // show c.message to the user before they sign
 *   const me = await signIn(w, address, c);
 */
export interface Eip1193Provider { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
export interface WalletInfo { uuid: string; name: string; icon: string; rdns: string }
export interface Wallet { info: WalletInfo; provider: Eip1193Provider }
export interface Challenge { nonce: string; message: string; expiresAt: string }
export interface Me {
  address: string;
  roles: { sponsorOf: string[]; makerIn: { campaign: string; epochs: number[]; cumulative: string }[] };
}

/** Errors whose message is written for the user (no wallet, declined signature, expired request...). */
export class SignInError extends Error {}

/** Wallets that announce themselves within `waitMs`; `window.ethereum` only when none do. */
export function discoverWallets(waitMs = 400): Promise<Wallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, Wallet>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<Wallet>).detail;
      if (d?.info?.uuid && typeof d.provider?.request === "function") found.set(d.info.uuid, d);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const injected = (window as { ethereum?: Eip1193Provider }).ethereum;
      if (!found.size && injected) found.set("injected", { info: { uuid: "injected", name: "Browser wallet", icon: "", rdns: "" }, provider: injected });
      resolve([...found.values()]);
    }, waitMs);
  });
}

const walletError = (e: unknown) =>
  new SignInError((e as { code?: number })?.code === 4001 ? "You declined in the wallet. Nothing was signed." : "The wallet did not respond. Try again.");

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new SignInError(body.error ?? `Sign-in failed (${r.status}).`);
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** The wallet's first account. */
export async function connect(w: Wallet): Promise<string> {
  let accounts: unknown;
  try {
    accounts = await w.provider.request({ method: "eth_requestAccounts" });
  } catch (e) {
    throw walletError(e);
  }
  const a = Array.isArray(accounts) ? accounts[0] : null;
  if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new SignInError("The wallet did not share an account.");
  return a;
}

/** Step 1: the exact message the user will sign (valid for 5 minutes, single use). */
export const challenge = (address: string) => call<Challenge>(`/api/auth/nonce?address=${encodeURIComponent(address)}`);

/** Step 2: sign the server's message (personal_sign, UTF-8 as hex) and open the session. */
export async function signIn(w: Wallet, address: string, c: Challenge): Promise<Me> {
  const hex = "0x" + Array.from(new TextEncoder().encode(c.message), (b) => b.toString(16).padStart(2, "0")).join("");
  let signature: unknown;
  try {
    signature = await w.provider.request({ method: "personal_sign", params: [hex, address] });
  } catch (e) {
    throw walletError(e);
  }
  if (typeof signature !== "string") throw new SignInError("The wallet returned no signature.");
  await call<{ address: string }>("/api/auth/verify", post({ nonce: c.nonce, signature }));
  const who = await me();
  if (!who) throw new SignInError("Signed in, but the session did not stick. Are cookies blocked?");
  return who;
}

/** The signed-in account and its roles, or null when signed out. */
export async function me(): Promise<Me | null> {
  const r = await fetch("/api/me", { credentials: "same-origin" });
  return r.ok ? ((await r.json()) as Me) : null;
}

export const signOut = () => call<{ ok: true }>("/api/auth/logout", post({}));
