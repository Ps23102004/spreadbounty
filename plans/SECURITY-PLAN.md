# Spreadbounty security plan (public demo)

Scope: the Node server `src/server/index.ts`, the web app `web/`, the new sign-in and model features from `FEATURE-PLAN.md`. Out of scope: the 1inch distributor (unmodified, vendored, tested), the maker bot and `drop` CLIs (they already require throwaway keys, dry runs and `--yes`), and dynamic testing of anyone else's system.

## 1. What a judge poking the URL can do today

Checked on Oct 11 against `http://localhost:8787` (read-only probes) and by reading the code.

| # | Finding | Evidence | Impact | Fix (WP) |
|---|---|---|---|---|
| 1 | No security headers at all | `curl -I /` returns only content-type, date, connection | Clickjacking, MIME sniffing, no CSP to contain any future XSS (matters once API keys live in the browser) | Headers and CSP (A4) |
| 2 | Anyone can publish a campaign, with no schema | `POST /api/campaigns` accepts `z.record(z.string(), z.unknown())`; only `id` is checked | A body without `market` can make `bookSnapshot` throw on `c.market.toLowerCase()` (it depends on where the junk file sorts), turning `/api/book` into a 500 for every visitor until someone deletes the file; selecting such a campaign crashes the React tree (`campaign.pair.split`); unlimited 100 KB files fill the disk | Strict schema, session required, server-set sponsor, caps (A4, A5) |
| 3 | Internal errors leak to clients | `/api/book?pair=FOO` returns 500 with the `ethers` "invalid address" message | Reveals library versions and code paths | Validate params with zod, sanitise 500s (A4) |
| 4 | No rate limits on expensive routes | Copilot replays up to 118k logs in live mode (about 48 s per run); `bot-sim` replays an epoch three times per distinct `size`; `report` and `ai/health` call the model | One script exhausts CPU or the RPC quota; with a server Claude key, it runs up the bill | Per-IP limits, a copilot concurrency cap, `SERVER_AI=off` on public deploys (A4) |
| 5 | `/api/book` in live mode replays up to 3 h of logs per call | `hours` clamps to 3; 3 h is about 36,000 blocks, so about 360 chunked `eth_getLogs` calls | RPC quota exhaustion | 15 s cache per pair (A4) |
| 6 | Known-vulnerable `ethers` 5.7.1 in the runtime tree | `npm audit --omit=dev`: critical via `@ethersproject/signing-key` (elliptic), high via `ws`; fix is `ethers@5.8.0` | The bot and `drop` CLIs sign with private keys through this code | Bump to 5.8.0 (A4) |
| 7 | No request timeouts or body cap below 100 KB | `readBody` caps at 100 KB; node defaults for timeouts | Slow-body and large-body pressure | 16 KB JSON cap, `server.requestTimeout` 30 s (copilot stream exempt) (A4) |
| 8 | Static file serving | `normalize` plus `startsWith(WEB)`; the URL parser also resolves `..` | Looks safe; no test proves it | Regression test (A4) |

Things that are already right: campaign ids are regex-checked before touching the filesystem; claim proofs are re-checked in the browser; Verify takes block hashes from the RPC in live mode; the API returns JSON with `no-store`; `.env` is git-ignored; React escapes every model-written string (no `dangerouslySetInnerHTML`).

## 2. Controls

### 2.1 Headers (every response; `src/server/security.ts`)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' https://fonts.googleapis.com;
  font-src https://fonts.gstatic.com;
  img-src 'self' data:;
  connect-src 'self' https://rpc.monad.xyz <origin of RPC_URL>
              https://api.anthropic.com https://api.openai.com
              https://generativelanguage.googleapis.com https://openrouter.ai
              http://localhost:* http://127.0.0.1:* <CSP_CONNECT_EXTRA>;
  frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Strict-Transport-Security: max-age=31536000   (only when served over HTTPS)
```

Notes:
- `motion` and React set styles through the CSSOM, which `style-src` does not block. If the console shows a style violation after the build, add `'unsafe-inline'` to `style-src` only. Never to `script-src`.
- Wallet extensions inject their own scripts; page CSP does not block extension content scripts, and EIP-6963 discovery uses DOM events.
- Wallet icons from EIP-6963 are `data:` URIs, covered by `img-src`.
- A custom model host on a LAN (for example a DGX box) needs `CSP_CONNECT_EXTRA`; the model dialog says so when a fetch is blocked.
- C1 (Privy) adds Privy's origins to `script-src`, `frame-src` and `connect-src` only when `VITE_PRIVY_APP_ID` is set, and relaxes COOP to `same-origin-allow-popups` in that build only.

### 2.2 Rate limits and caps (stdlib `Map`, swept every minute)

| Route group | Limit |
|---|---|
| `POST /api/copilot` | 6 per minute per IP, at most 2 running at once (third gets 429) |
| `GET /api/campaigns/:id/bot-sim`, `POST .../report`, `GET /api/ai/health`, `POST /api/judge` | 10 per minute per IP |
| `GET /api/auth/nonce`, `POST /api/auth/verify` | 10 per minute per IP |
| `POST /api/campaigns` | 3 per address per day, 50 campaigns in total on a `PUBLIC_DEMO` server |
| Everything else under `/api` | 120 per minute per IP |

- The client IP is the socket address, or the first `X-Forwarded-For` hop only when `TRUST_PROXY=1`.
- 429 responses carry `Retry-After`.
- `bot-sim` accepts `size` from 1 to 10,000,000 and caches 50 results (today the cap is 1e9).

### 2.3 Input validation (zod at the edge)
- Query: `pair` must be one of `PAIRS`; `hours` 0.1 to 3; epoch numbers are non-negative integers that exist on disk; account must match `^0x[0-9a-fA-F]{40}$`; `blockhash` list stays capped at 2,000.
- Bodies: JSON only (`content-type: application/json`, else 415), 16 KB cap (413).
- Copilot: `goal` 3 to 1,000 characters; optional `intent` must pass `IntentSchema`; optional `brief` is `"server"` or `"none"`.
- Publish: a strict `CampaignSchema`. `id` must be `<pair-slug>-<digits>`; `chainId` 143; `market` and `implementation` must equal the values the server reads for that pair; `pair` in `PAIRS`; numeric strings match `^\d+$` within bounds (`bandBps` 1 to 500, `minRestBlocks` 1 to 10,000, `sampleEvery` 50 to 10,000, `epochBlocks` 600 to 288,000, `budgetPerEpoch` up to 10^12); `rewardToken` equals USDC; `rewardDecimals` 6; `sponsor` is overwritten with the session address; unknown keys rejected.
- 500s return `{ "error": "Internal error", "id": "<8 hex>" }`; the server logs the id with the error, never the request body.

### 2.4 Sign-in and session (A5)
- EIP-4361 message built by the server: domain from the `Host` header, accepted only if it is in `ALLOWED_HOSTS` (default `localhost`, `127.0.0.1`); URI; version 1; chain ID 143; a 128-bit random nonce; issued-at; expiration 5 minutes later; statement "Sign in to Spreadbounty. This signature does not move funds or approve anything."
- Nonces live in memory, single use, swept on expiry.
- Verification: `ethers.utils.verifyMessage(message, signature)` must equal the address the nonce was issued for. Smart-contract wallets (EIP-1271) are not supported; the dialog says so.
- Cookie `sb_sess` = base64url(`{ addr, exp }`) + "." + HMAC-SHA256 with `SESSION_SECRET` (random per boot if unset, which signs everyone out on restart). Compare with `crypto.timingSafeEqual`. `HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`, plus `Secure` over HTTPS. No server-side session store.
- CSRF: `SameSite=Strict`, JSON-only bodies, and an `Origin` check on every state-changing request (403 on mismatch).
- The session gates one thing: publishing a campaign. Reading, verifying, backtests and claim lookups stay open; that openness is the product.

### 2.5 Bring-your-own model keys (A6)
- LLM keys never reach this server. The browser calls the provider directly. CORS preflights checked on Oct 11 succeed for Anthropic (with `anthropic-dangerous-direct-browser-access`), OpenAI, Gemini's OpenAI-compatible endpoint and OpenRouter; local servers on `localhost` allow the local app origin.
- Storage: `sessionStorage` by default (gone when the tab closes); `localStorage` only after the user ticks "Remember on this device"; a "Forget key" button clears both. Keys never go into URLs, logs, error messages or analytics.
- Key input: `type="password"`, `autocomplete="off"`, `spellcheck="false"`.
- Structural guard: `web/src/api.ts` (own-origin calls) cannot import `web/src/ai/keys.ts` (boundary test), and in development it throws if an own-origin request carries `authorization` or `x-api-key`.
- XSS is the real threat to a browser-held key, so: CSP `script-src 'self'`, no third-party scripts in the default build, model output rendered as text only (no Markdown-to-HTML), no `dangerouslySetInnerHTML` (boundary test), `Referrer-Policy: no-referrer`.
- No server-side LLM proxy. It would see keys and, with client-chosen base URLs, become an SSRF tool against the host's internal network.
- The one exception is TypeSafe Jev, which rejects browser origins ("Disallowed CORS origin", probed Oct 11). `POST /api/judge` calls one fixed upstream, `https://api.typesafe.ai/v1/systemone`, with the operator's `TYPESAFE_API_KEY`, or with a per-request `x-typesafe-key` header that is forwarded and never stored or logged. The UI states this. The upstream URL is a constant; no client value can change it.
- Server AI (`ANTHROPIC_API_KEY` in env) stays off on public deploys unless `SERVER_AI=on`, and then it sits behind the copilot and report limits.

### 2.6 Secrets and the build
- Server-only env: `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, `SESSION_SECRET`, `BOT_KEY`, `SPONSOR_KEY`, `CLAIM_KEY`. Only `VITE_PRIVY_APP_ID` (a public id) may be `VITE_`-prefixed.
- `test/boundary.test.ts` greps `web/dist` for env names and key prefixes (`sk-ant-`, `AIza`) after the build. It does not grep for 64-hex strings, because event topics and roots legitimately appear.
- `.env.example` lists names only.

### 2.7 Dependencies
- Bump `ethers` to 5.8.0 (same API), re-run `test:all`.
- Record `npm audit --omit=dev` before and after in the PR. Remaining highs come through dev-only tooling (`@1inch/solidity-utils`, `ganache`, webpack and mocha chains) that never ships to the server runtime or the browser bundle. Do not run `npm audit fix --force` 36 hours before a deadline.
- No new runtime dependency in Tier A or B.

### 2.8 Honesty as a security property
- The data label comes from server config and the campaign file's location, never from campaign text, so a published campaign cannot relabel itself as live.
- Shadow campaigns carry `shadow: true` set by the CLI; the publish route rejects that key.

## 3. Tests (in `test/server.test.ts` and `test/boundary.test.ts` unless noted)

1. Headers present on `/` and `/api/config`; CSP includes `frame-ancestors 'none'` and `script-src 'self'`.
2. `/api/book?pair=FOO` returns 400 with `Unknown market.`; a forced 500 returns the generic body with an id and no stack.
3. Copilot rate limit (seventh request in a minute) and concurrency cap (third running request) return 429 with `Retry-After`.
4. Publish without a session returns 401; with a session but a schema-breaking body returns 400 and writes no file; `sponsor` is set to the session address; caps return 429; a `shadow` key is rejected.
5. Foreign `Origin` on POST returns 403; non-JSON POST returns 415; a 17 KB body returns 413.
6. SIWE: happy path; nonce reuse; expired nonce; wrong signer; tampered cookie.
7. Static traversal request returns the app shell.
8. `PUBLIC_DEMO=1` keeps server AI off.
9. `/api/judge` ignores any client attempt to set the upstream URL (it is not a parameter) and does not echo the key in errors (mock upstream).
10. Boundary: money-path imports, `dangerouslySetInnerHTML`, key module isolation, built-bundle secret grep.

## 4. Pre-submit checklist (Tue before 16:00)
- [ ] `curl -sI https://<public-url>/` shows every header in 2.1, including HSTS.
- [ ] A copilot burst from one IP gets 429 by the seventh request.
- [ ] Publish without sign-in gets 401; the public deploy shows at most 50 campaigns.
- [ ] DevTools Network with a browser model selected: no own-origin request carries a key.
- [ ] `grep -rE "sk-ant-|AIza|BOT_KEY|SPONSOR_KEY" web/dist` is empty.
- [ ] `npm audit --omit=dev` output saved in the PR.
- [ ] No `.env`, wallet or key visible in any screenshot or video frame.

## 5. After the hackathon (not now)
- EIP-1271 signatures for multisig sponsors.
- A durable store for campaigns if the product goes past demo scale.
- A CSP report endpoint.
- Re-run Trail of Bits static analysis (`static-analysis:semgrep`) on the server before any real-money pilot.
