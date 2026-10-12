import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";

/**
 * A5-web HOOK POINT (lane alpha, after beta's A5-server routes land).
 *
 * useSession() reads GET /api/me. Until that route exists it 404s and everyone is signed out,
 * which is a complete state: reading, verifying and claim lookups never need an account.
 * WalletButton opens AccountDialog; RoleChip shows who you are signed in as, or a labelled demo persona.
 * To finish A5-web: fill AccountDialog with EIP-6963 discovery, the SIWE message in a tape block,
 * sign/sign-out, roles and "View as" personas (DESIGN-BRIEF 5.8). Keep these three exports and props.
 */
export interface Session {
  address: string | null;
  roles: { sponsorOf: string[]; makerIn: { campaign: string; epochs: number[]; cumulative: string }[] } | null;
  persona: string | null; // read-only demo persona label, e.g. "Maker A1"
}
const SIGNED_OUT: Session = { address: null, roles: null, persona: null };

export function useSession(): Session {
  const [s, setS] = useState<Session>(SIGNED_OUT);
  useEffect(() => {
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { address?: string; roles?: Session["roles"] } | null) => me?.address && setS({ address: me.address, roles: me.roles ?? null, persona: null }))
      .catch(() => {});
  }, []);
  return s;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function RoleChip({ session }: { session: Session }) {
  if (session.persona) return <span className="chip" title="Demo persona: read-only, cannot publish">Viewing as <b>{session.persona}</b> · demo</span>;
  if (session.address) return <span className="chip mono" title={session.address}>{short(session.address)}</span>;
  return null;
}

export function WalletButton({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="chip" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {session.address ? <>You: <b className="mono">{short(session.address)}</b></> : <b><span className="hide-sm">Connect wallet</span><span className="show-sm">You</span></b>}
      </button>
      <AccountDialog open={open} onClose={() => setOpen(false)} session={session} />
    </>
  );
}

export function AccountDialog({ open, onClose, session }: { open: boolean; onClose: () => void; session: Session }) {
  return (
    <Dialog open={open} onClose={onClose} title="You">
      {session.address ? (
        <dl className="kv"><dt>Signed in</dt><dd className="mono">{session.address}</dd></dl>
      ) : (
        <p className="ink2">Wallet sign-in is not enabled on this server yet. You can read every campaign, recompute every payout and look up any claim without an account.</p>
      )}
      <div className="stack" style={{ gap: 6 }}>
        <span className="label">Roles (read from public files, never stored)</span>
        <dl className="kv">
          <dt>Sponsor of</dt><dd>{session.roles ? `${session.roles.sponsorOf.length} campaign${session.roles.sponsorOf.length === 1 ? "" : "s"}` : "Sign in to see"}</dd>
          <dt>Maker in</dt><dd>{session.roles ? `${session.roles.makerIn.reduce((n, m) => n + m.epochs.length, 0)} epochs` : "Sign in to see"}</dd>
          <dt>Verifier</dt><dd>Everyone can verify</dd>
        </dl>
      </div>
    </Dialog>
  );
}
