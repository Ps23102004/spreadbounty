import { useEffect, useState } from "react";
import type { Config } from "../api";
import { challenge, connect, discoverWallets, signIn, signOut, SignInError, type Challenge, type Me, type Wallet } from "../auth";
import { Dialog } from "./Dialog";
import { closeAccount, emit, openAccount, setHint, SESSION_MS, type Persona, type Session } from "./session";
import { Tick } from "./Tick";

/** The Account dialog (A5) and the header controls. The session store and GET /api/me live in session.ts. */
export { closeAccount, openAccount, refreshSession, useSession, type Persona, type Session } from "./session";

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Header label for a demo persona; a signed-in address shows on the wallet button instead. */
export function RoleChip({ session }: { session: Session }) {
  if (!session.persona || session.address) return null;
  return (
    <button className="chip persona" onClick={() => emit({ persona: null })} title="Demo persona: read-only, cannot publish. Click to stop viewing as this persona.">
      Viewing as <b>{session.persona.name}</b> · demo
    </button>
  );
}

export function WalletButton({ session, config }: { session: Session; config: Config | null }) {
  return (
    <>
      <button className="chip wallet" onClick={openAccount} aria-haspopup="dialog">
        {session.address
          ? <>You: <b className="mono">{short(session.address)}</b></>
          : <b><span className="hide-sm">Connect wallet</span><span className="show-sm">You</span></b>}
      </button>
      <AccountDialog session={session} config={config} />
    </>
  );
}

const MONAD = 143;
/** The demo dataset's top maker and sponsor (src/demo/generate.ts): read-only viewpoints for a judge without a wallet. */
const PERSONAS: Persona[] = [
  { name: "Maker A1", address: "0xde000000000000000000000000000000000000a1" },
  { name: "the demo sponsor", address: "0xDE00000000000000000000000000000000005150" },
];

type Pending = { w: Wallet; address: string; c: Challenge; chain: number | null };
type Msg = { text: string; tone: "neutral" | "bad" };

const said = (e: unknown, fallback: string): Msg => {
  const text = e instanceof SignInError ? e.message : fallback;
  if (/expired/i.test(text)) return { text: "That sign-in request expired. Get a new message and sign again.", tone: "neutral" };
  if (/declined/i.test(text)) return { text: "Signature cancelled. Nothing was signed.", tone: "neutral" };
  return { text, tone: "bad" };
};

export function AccountDialog({ session, config }: { session: Session; config: Config | null }) {
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<"connect" | "message" | "sign" | "out" | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const open = session.open;

  useEffect(() => {
    if (!open || session.address) return;
    setMsg(null);
    setWallets(null);
    discoverWallets().then(setWallets);
  }, [open, session.address]);

  const ask = async (w: Wallet, address: string, chain: number | null) => {
    setBusy("message");
    try {
      setPending({ w, address, chain, c: await challenge(address) });
    } catch (e) {
      setMsg(said(e, "The server did not issue a sign-in message. Try again."));
    }
    setBusy(null);
  };
  const pick = async (w: Wallet) => {
    setMsg(null);
    setPending(null);
    setBusy("connect");
    try {
      const address = await connect(w);
      // read only, to explain; signing in never asks the wallet to switch networks
      const chain = await w.provider.request({ method: "eth_chainId" }).then((x) => parseInt(String(x), 16)).catch(() => NaN);
      await ask(w, address, Number.isFinite(chain) ? chain : null);
    } catch (e) {
      setMsg(said(e, "The wallet did not respond. Try again."));
      setBusy(null);
    }
  };
  const sign = async () => {
    if (!pending) return;
    setMsg(null);
    if (Date.parse(pending.c.expiresAt) <= Date.now()) return setMsg(said(new SignInError("expired"), ""));
    setBusy("sign");
    try {
      const who = await signIn(pending.w, pending.address, pending.c);
      setHint(Date.now() + SESSION_MS);
      setPending(null);
      emit({ address: who.address, roles: who.roles, persona: null, checked: true });
    } catch (e) {
      setMsg(said(e, "Sign-in failed. Try again."));
    }
    setBusy(null);
  };
  const out = async () => {
    setBusy("out");
    await signOut().catch(() => {}); // the server clears the cookie; either way this tab forgets the session
    setHint(null);
    emit({ address: null, roles: null });
    setBusy(null);
  };

  const expired = pending ? Date.parse(pending.c.expiresAt) <= Date.now() : false;
  const until = pending ? new Date(pending.c.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const step = session.address ? 3 : pending ? 2 : 1;

  return (
    <Dialog open={open} onClose={closeAccount} title="You">
      <ol className="acct-steps">
        <li className={step === 1 ? "on" : "done"}>
          <span className="acct-n" aria-hidden>1</span>
          <div className="acct-body">
            <h3>Connect</h3>
            {session.address ? (
              <p className="ink2">Connected.</p>
            ) : wallets === null ? (
              <p className="ink2 row"><span className="spinner" aria-hidden /> Looking for wallets in this browser…</p>
            ) : wallets.length === 0 ? (
              <div className="stack" style={{ gap: 6 }}>
                <p>No browser wallet found. You can still verify every payout and look up any claim.</p>
                <p className="ink2">To sign in, add a wallet extension such as <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">MetaMask</a> or <a href="https://rabby.io/" target="_blank" rel="noopener noreferrer">Rabby</a>, then reload this page.</p>
              </div>
            ) : (
              <div className="wallets" role="group" aria-label="Wallets on this page">
                {wallets.map((w) => (
                  <button key={w.info.uuid} className="btn ghost" onClick={() => pick(w)} disabled={!!busy} aria-pressed={pending?.w.info.uuid === w.info.uuid}>
                    {w.info.icon.startsWith("data:image/") && <img src={w.info.icon} alt="" width={20} height={20} />}
                    {w.info.name}
                  </button>
                ))}
                {(busy === "connect" || busy === "message") && <span className="ink2 row"><span className="spinner" aria-hidden /> Waiting for your wallet…</span>}
              </div>
            )}
          </div>
        </li>

        <li className={step === 2 ? "on" : step === 3 ? "done" : ""}>
          <span className="acct-n" aria-hidden>2</span>
          <div className="acct-body">
            <h3>Sign in</h3>
            {session.address ? (
              <p className="ink2">Signed with a message that moves no funds.</p>
            ) : pending ? (
              <div className="stack">
                <p className="ink2">Your wallet will show this exact text. It moves no funds and approves nothing.</p>
                <pre className="siwe" tabIndex={0} aria-label="Sign-in message">{pending.c.message}</pre>
                {pending.chain !== null && pending.chain !== MONAD && (
                  <p className="note">Your wallet is on chain {pending.chain}, not Monad ({MONAD}). You don't need to switch: the message names chain {MONAD} and nothing is sent on-chain.</p>
                )}
                <div className="row">
                  {expired
                    ? <button className="btn" onClick={() => ask(pending.w, pending.address, pending.chain)} disabled={!!busy}>Get a new message</button>
                    : <button className="btn" onClick={sign} disabled={!!busy}>{busy === "sign" ? <><span className="spinner" aria-hidden /> Waiting for your wallet…</> : "Sign message"}</button>}
                  <span className="muted small">{expired ? "This message expired." : `Valid until ${until}, once.`}</span>
                </div>
              </div>
            ) : (
              <p className="muted">Pick a wallet first. You see the message before your wallet asks for a signature.</p>
            )}
          </div>
        </li>

        <li className={step === 3 ? "on" : ""}>
          <span className="acct-n" aria-hidden>3</span>
          <div className="acct-body">
            <h3>Signed in</h3>
            {session.address ? (
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="mono acct-addr"><Tick label="signed in" /> {session.address}</span>
                <button className="btn ghost small" onClick={out} disabled={busy === "out"}>{busy === "out" ? "Signing out…" : "Sign out"}</button>
              </div>
            ) : (
              <p className="muted">Not signed in. Only publishing a campaign needs it.</p>
            )}
          </div>
        </li>
      </ol>

      {msg && <p className={`note${msg.tone === "bad" ? " bad" : ""}`} role={msg.tone === "bad" ? "alert" : "status"}>{msg.text}</p>}

      <div className="stack" style={{ gap: 8 }}>
        <h3 className="label">Roles, read from public files, never stored</h3>
        <ul className="roles">
          <li><span className="k">Sponsor</span><span className="v">{session.roles ? plural(session.roles.sponsorOf.length, "campaign") : "sign in to see"}</span></li>
          <li><span className="k">Maker</span><span className="v">{session.roles ? makerLine(session.roles) : "sign in to see"}</span></li>
          <li><span className="k">Verifier</span><span className="v">everyone can verify</span></li>
        </ul>
      </div>

      {config?.synthetic && (
        <div className="stack" style={{ gap: 8 }}>
          <h3 className="label">Demo personas, read-only</h3>
          <p className="ink2 small">See the demo as one of its accounts without a wallet. A persona can't sign or publish.</p>
          <div className="row">
            {PERSONAS.map((p) => (
              <button key={p.name} className="btn ghost small" aria-pressed={session.persona?.name === p.name} disabled={!!session.address}
                onClick={() => emit({ persona: session.persona?.name === p.name ? null : p, open: false })}>
                View as {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const makerLine = (r: Me["roles"]) => {
  const epochs = r.makerIn.reduce((n, m) => n + m.epochs.length, 0);
  return epochs ? `paid in ${plural(epochs, "epoch")}, ${plural(r.makerIn.length, "campaign")}` : "no paid epochs";
};
