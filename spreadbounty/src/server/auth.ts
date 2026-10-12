/**
 * Sign-In with Ethereum (EIP-4361) and a stateless session cookie (plans/SECURITY-PLAN.md section 2.4).
 *
 *   GET  /api/auth/nonce?address=0x..   the server builds the exact message; the wallet only signs it
 *   POST /api/auth/verify {nonce, sig}  single-use nonce, 5-minute expiry, signer must be the address asked for
 *   cookie sb_sess = base64url({addr, exp}) "." base64url(HMAC-SHA256(SESSION_SECRET))
 *
 * No user table, no stored roles: roles are read from the public campaign and epoch files.
 * Smart-contract wallets (EIP-1271) are not supported: only EOAs can sign in.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { ethers } from "ethers";
import { CHAIN_ID } from "../core/chain";
import { HttpError } from "./security";

export const COOKIE = "sb_sess";
export const SESSION_SECONDS = 8 * 3600;
export const NONCE_MS = 5 * 60_000;
const MAX_PENDING = 10_000; // outstanding nonces; the auth rate limit keeps honest traffic far below this
export const STATEMENT = "Sign in to Spreadbounty. This signature does not move funds or approve anything.";

export interface SiweFields { domain: string; address: string; uri: string; nonce: string; issuedAt: string; expirationTime: string }

/** EIP-4361 message text, field order as the spec requires. */
export function siweMessage(f: SiweFields) {
  return [
    `${f.domain} wants you to sign in with your Ethereum account:`,
    f.address,
    "",
    STATEMENT,
    "",
    `URI: ${f.uri}`,
    "Version: 1",
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join("\n");
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function createAuth(secret: string | undefined, now: () => number = Date.now, warn: (m: string) => void = console.warn) {
  if (!secret) warn("SESSION_SECRET is not set: using a random secret for this run (everyone is signed out on restart).");
  else if (secret.length < 32) warn("SESSION_SECRET is shorter than 32 characters; use 32 random bytes.");
  const key = secret || randomBytes(32).toString("hex");
  const pending = new Map<string, { address: string; message: string; exp: number }>();
  const mac = (payload: string) => createHmac("sha256", key).update(payload).digest();

  const sweep = () => {
    const t = now();
    for (const [n, p] of pending) if (p.exp <= t) pending.delete(n);
  };

  return {
    sweep,

    /** A fresh single-use challenge for `address`, bound to this host. */
    challenge(address: string, domain: string, uri: string) {
      if (pending.size >= MAX_PENDING) sweep();
      if (pending.size >= MAX_PENDING) throw new HttpError(503, "Too many sign-ins in flight. Try again shortly.", { "Retry-After": "30" });
      const nonce = randomBytes(16).toString("hex"); // 128 bits
      const t = now();
      const checksummed = ethers.utils.getAddress(address.toLowerCase());
      const message = siweMessage({ domain, address: checksummed, uri, nonce, issuedAt: new Date(t).toISOString(), expirationTime: new Date(t + NONCE_MS).toISOString() });
      pending.set(nonce, { address: checksummed, message, exp: t + NONCE_MS });
      return { nonce, message, expiresAt: new Date(t + NONCE_MS).toISOString() };
    },

    /** Burns the nonce first (a failed attempt cannot be retried), then checks expiry and the signer. */
    verify(nonce: string, signature: string) {
      const p = pending.get(nonce);
      pending.delete(nonce);
      if (!p) throw new HttpError(401, "This sign-in request was already used or never issued. Start again.");
      if (p.exp <= now()) throw new HttpError(401, "This sign-in request expired. Start again.");
      let signer: string | null = null;
      try {
        signer = ethers.utils.verifyMessage(p.message, signature);
      } catch { /* malformed signature: same answer as a wrong one */ }
      if (signer !== p.address) throw new HttpError(401, "The signature does not match this address.");
      return p.address;
    },

    /** Set-Cookie value for a new session. */
    cookie(address: string, secure: boolean) {
      const payload = b64(JSON.stringify({ addr: address.toLowerCase(), exp: now() + SESSION_SECONDS * 1000 }));
      return `${COOKIE}=${payload}.${b64(mac(payload))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`;
    },
    clearCookie(secure: boolean) {
      return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
    },

    /** The signed-in address (lowercase), or null for a missing, tampered or expired cookie. */
    session(req: IncomingMessage): string | null {
      const raw = String(req.headers.cookie ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      if (!raw || raw.length > 512) return null;
      const [payload, sig, ...rest] = raw.split(".");
      if (!payload || !sig || rest.length) return null;
      const given = Buffer.from(sig, "base64url");
      const want = mac(payload);
      if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
      try {
        const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { addr?: unknown; exp?: unknown };
        if (typeof s.addr !== "string" || !/^0x[0-9a-f]{40}$/.test(s.addr) || typeof s.exp !== "number" || s.exp <= now()) return null;
        return s.addr;
      } catch {
        return null;
      }
    },
  };
}
export type Auth = ReturnType<typeof createAuth>;
