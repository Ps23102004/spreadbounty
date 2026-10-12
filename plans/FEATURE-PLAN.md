# Spreadbounty 36-hour feature plan

Clock: now Sun Oct 11, about 22:30 EDT. Submission cutoff assumed Tue Oct 13, 19:59 EDT (unverified; confirm in the portal). Build budget tonight: about 10 to 12 agent-hours. Tier A fits in 6.0 agent-hours.

Companion files: `DESIGN-BRIEF.md` (what it looks like), `SECURITY-PLAN.md` (controls and tests), `JUDGE-RUBRIC.md` (how the Opus judge scores), `PURPOSE.md` (why this product).

## Ground rules for every builder

1. Work on branch `redesign` in a worktree. `main` stays at today's tested state. If Tier A fails its gate, `main` (the current UI) is what gets submitted.
2. Every work package (WP) merges only when `npm run typecheck && npm run test:all && npm run build:web` pass, plus that WP's new tests.
3. Do not touch `src/core/**`, `src/drop/**`, `src/bot/**` or `contracts/**` except where a WP names the file. Scoring, payouts, Merkle and claim code stay as they are.
4. No new runtime dependency unless a WP names it. Allowed bump: `ethers` 5.7.1 to 5.8.0 (A4). Allowed optional add: `@privy-io/react-auth` (C1 only, lazy chunk).
5. The model never decides payouts. Nothing in `src/core`, `src/drop` or `src/bot` may import from `src/ai` or `web/src/ai` (boundary test in A0).
6. Every data-source label stays visible (`DESIGN-BRIEF.md` section 11). Nothing may say or imply that live trading, a live epoch or a mainnet payout happened.
7. Keep diffs small. Reuse `src/core` functions in the UI instead of re-deriving math (example: the quote probe calls `scoreSample`).
8. The implementer is never the judge. The Opus judge runs fresh, with `JUDGE-RUBRIC.md`.

## Lanes and merge order

| Lane | Owns | WPs |
|---|---|---|
| alpha (UI) | `web/index.html`, `web/src/styles.css`, `web/src/App.tsx`, `web/src/main.tsx`, `web/src/ui/*` (except `ModelDialog.tsx`), `web/src/pages/*` | A1, A2, A3, A5-web, A6 wiring, B3 |
| beta (server) | `src/server/*`, `test/server.test.ts`, `package.json` scripts and the ethers bump | A4, A5-server, B4 |
| gamma (AI) | `src/ai/*`, `web/src/ai/*`, `web/src/ui/ModelDialog.tsx`, `test/ai.test.ts`, `test/judge.test.ts` | A6, B2 |
| delta (data) | `src/cli/main.ts` (one new subcommand), `test/shadow.test.ts`, Verify's log-source code | B1, B5 |

Order: A0 first (15 min). Then alpha A1 to A3, beta A4 then A5-server, and gamma A6 run in parallel. gamma's two server edits (copilot body, report query) land after beta's A4 merge, as a rebase. alpha wires A5-web and A6 into the pages last. Then the Tier A gate.

## Schedule

| When (EDT) | What |
|---|---|
| Sun 23:15 to Mon 05:00 | Tier A build in three lanes, integration, Tier A gate (Opus judge, rubric dimensions that apply) |
| Mon 05:00 to 09:00 | Pause or overflow. If Tier A is red at 09:00, apply the A-tier cut fallbacks listed per WP and stop adding scope |
| Mon 09:00 to 15:00 | Tier B |
| Mon 15:00 to 17:00 | Full Opus judge pass, one fix batch, second verdict |
| Mon 17:00 to 22:00 | Submission tasks: screenshots, 2:00 video re-record (`DESIGN-BRIEF.md` section 13), README sections for the new features |
| Mon 22:00 | Tier C starts only if A and B are merged and every rubric dimension scored 8 or more |
| Tue 12:00 | Code freeze. After this, only fixes for a failing test or a wrong label |
| Tue 12:00 to 16:00 | Merge to `main`, tag `metropolis-submission`, deploy, smoke test, submit in the portal by 16:00 (four hours of slack) |

## Tier A (6.0 agent-hours): must ship, or the redesign does not merge

### A0. Baseline and guardrails (0.25 h, any lane)
- Goal: lock today's numbers so regressions show up.
- Files: `test/boundary.test.ts` (new), `package.json` (`test:boundary`, added to `test:all`).
- Steps: record `test:all` (32 pass when this plan was written; 94 pass at 388df15), typecheck, build, JS bundle size (680 KB today) in the PR description.
- Acceptance:
  - `test/boundary.test.ts` fails if any file under `src/core`, `src/drop`, `src/bot` imports `src/ai` or anything under `web/`.
  - It fails if `web/src` contains `dangerouslySetInnerHTML`.
  - It fails if `src/ai/prompts.ts` or `src/ai/http.ts` (once A6 creates them) import `node:` modules or `@anthropic-ai/sdk`.
  - It fails if `web/src/api.ts` imports `web/src/ai/keys.ts`.
  - After a build, it fails if `web/dist` contains `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, `SESSION_SECRET`, `BOT_KEY`, `SPONSOR_KEY`, `sk-ant-` or `AIza`.
- Cut: none; this is the safety net.

### A1. World tokens and the shell (0.75 h, alpha)
- Goal: replace the teal dashboard look with the "Working Papers" world at the token level, so every page changes at once.
- Files: `web/index.html` (fonts, contract comment, skip link target), `web/src/styles.css` (rewrite tokens, light and dark), `web/src/App.tsx` (header, `IndexTabs`, `SourceLabel`, Writer chip slot, wallet button slot, bottom bar, `#start` default route, campaign picker moved into Overview), `web/src/ui/bits.tsx` (remove `CountUp` use from pages, keep the export only if still used).
- Acceptance:
  - Tokens exactly as `DESIGN-BRIEF.md` section 2; no hex literal in any `.tsx` (grep returns nothing outside `index.html`'s favicon).
  - Only Archivo and Fragment Mono load.
  - At 375x812: `document.scrollingElement.scrollWidth === innerWidth` on every route; bottom bar with 5 items, each at least 44x44; data strip visible after scrolling to the bottom of every route.
  - At 1280x800: header on one line with the data label, Writer chip and wallet button.
  - The theme toggle still cycles system, light, dark and persists.
  - Skip link is the first tab stop.
- Cut fallback: keep the existing header layout and only swap tokens and fonts.

### A2. Signature components (1.25 h, alpha)
- Goal: build the world's own components and fix motion violations.
- Files: `web/src/ui/Schedule.tsx`, `web/src/ui/Tape.tsx`, `web/src/ui/Tick.tsx`, `web/src/ui/Stamp.tsx`, `web/src/ui/SourceLabel.tsx`, `web/src/ui/charts.tsx` (Ladder v2, Bars and DepthChart motion fixes), `web/src/styles.css`.
- Acceptance:
  - `grep -rn "width:" web/src --include=*.tsx` shows no `motion` `animate`/`initial` prop that animates `width`, `height`, `top` or `left`.
  - Ladder v2: highlighted band rows, double-rule reference line, `+N bps` and `-N bps` margin brackets, real `<table>` semantics, hover/focus shows size, makers and weight.
  - Quote probe: `<input type="range">`, keyboard operable, `aria-valuetext` set; weight comes from `scoreSample` in `src/core/score.ts`.
  - New test in `test/core.test.ts` (or `test/boundary.test.ts`): the probe helper's weight equals `scoreSample` on a one-order book for 20 cases, including exactly at the band edge (weight 0).
  - Tape prints lines only when pushed; at least 90 ms between lines; total pacing delay at most 1 s; red-ribbon variant; `aria-live="polite"`.
  - Stamp renders only when given a result; `role="status"` text; reduced motion is opacity only.
- Cut fallback: Tape and Stamp ship; Ladder v2 keeps today's layout with the highlighter band and `scaleX` bars, without the probe (probe moves to B3).

### A3. Start page and Verify on the tape (1.0 h, alpha)
- Goal: the first five minutes. One click from landing to "my browser recomputed this payout", one more to "a forged one fails".
- Files: `web/src/pages/Start.tsx` (new), `web/src/ui/useRecompute.ts` (new hook extracted from `Verify.tsx`: downloads files, logs, hashes, runs `verifyEpoch`, exposes `rows`, `outcome`, `forge`), `web/src/pages/Verify.tsx` (uses the hook and the Tape; `Steps` removed from Verify), `web/src/App.tsx` (route).
- Acceptance:
  - No hash, or first visit: `#start` renders. Deep links to `#overview`, `#design`, `#makers`, `#verify`, `#claim` still work.
  - At 1280x800 the first viewport shows, without scrolling: the headline, the data label, the ladder with the band, the "Recompute epoch N here" button, the forge switch.
  - Clicking Recompute on demo data prints the tape and lands VERIFIED in under 3 s. With forge on it lands EXCEPTION · DO NOT PAY, prints a red line, and shows the differing root characters.
  - Start and Verify reach the same verdict for the same epoch (they share `useRecompute`; a test can call the hook's pure core function `recompute(files, logs, hash, forged)` exported from `useRecompute.ts` with demo files and assert ok/not ok).
  - "Status, plainly" strip lists what ran on mainnet and what has not, matching the README status table word for word on facts.
  - Keyboard-only: Tab reaches Recompute and the forge switch; Enter and Space work.
- Cut fallback: Start shows the thesis, the ladder and a button that routes to `#verify` with the run started.

### A4. Security essentials (0.75 h, beta)
- Goal: a public URL a curious judge can poke without breaking it. Full detail in `SECURITY-PLAN.md`.
- Files: `src/server/security.ts` (new: headers, rate limiter, zod schemas, error sanitising), `src/server/index.ts`, `test/server.test.ts` (new), `package.json` (ethers 5.8.0, `test:server` in `test:all`), `.env.example` (new vars, no values).
- Acceptance (each a test in `test/server.test.ts`, run against a child server on a free port):
  - `/` and `/api/config` send the CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`; CSP includes `frame-ancestors 'none'` and `script-src 'self'`.
  - `/api/book?pair=FOO` returns 400 `{"error":"Unknown market."}`. No response body anywhere contains a stack trace, a file path or an `ethers` error string (forced 500 returns `{"error":"Internal error","id":"..."}`).
  - The seventh `POST /api/copilot` from one IP within a minute returns 429 with `Retry-After`; a third concurrent copilot returns 429.
  - `POST /api/campaigns` with a body missing `market` returns 400 and writes nothing (directory listing unchanged).
  - `GET /..%2f..%2fpackage.json` returns the app shell, not `package.json`.
  - Request bodies over 16 KB return 413.
  - `/api/book` responses are cached 15 s per pair (second call does not hit the data source; assert via a counter or timing).
  - `PUBLIC_DEMO=1` with `ANTHROPIC_API_KEY` set still reports `ai.provider: "off"` unless `SERVER_AI=on`.
  - `npm ls ethers` shows 5.8.0; `npm run test:all` still passes.
- Cut fallback: headers, validation, error sanitising and the copilot limit ship; the per-route limits for cheap endpoints wait.

### A5. Wallet sign-in and derived roles (0.75 h: beta 0.4 h server, alpha 0.35 h web)
- Goal: an identity layer that fits a permissionless product. Sign-In with Ethereum (EIP-4361) over any injected wallet, an HttpOnly session cookie, roles read from public files. Reading, verifying and claim lookups stay open to everyone.
- Files: `src/server/auth.ts` (new), `src/server/index.ts` (routes), `test/server.test.ts`, `web/src/ui/AccountDialog.tsx` (new), `web/src/api.ts` (auth calls), `web/src/pages/Design.tsx` (publish gating), `web/src/pages/Claim.tsx` ("Use my connected address").
- Routes: `GET /api/auth/nonce`, `POST /api/auth/verify`, `POST /api/auth/logout`, `GET /api/me`.
- Acceptance (server tests use `ethers.Wallet.createRandom()`):
  - Nonce flow returns an EIP-4361 message with this host as domain, chain ID 143, the nonce, issued-at and a 5-minute expiration. The server builds the message; the client only signs it.
  - Valid signature sets `sb_sess` with `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=28800`, and `Secure` when the request came over HTTPS (`X-Forwarded-Proto: https` with `TRUST_PROXY=1`).
  - Reusing a nonce, an expired nonce, a signature from another address, and a tampered cookie are all rejected (401, or treated as signed out).
  - A `POST` with a foreign `Origin` returns 403; a `POST` without `content-type: application/json` returns 415.
  - `POST /api/campaigns` requires a session; the stored campaign's `sponsor` equals the session address whatever the body says; caps at 3 per address per day and 50 in total return 429.
  - `GET /api/me` returns `{ address, roles: { sponsorOf: [...], makerIn: [{ campaign, epochs, cumulative }] } }` computed from campaign and epoch files.
  - Web: wallets discovered through EIP-6963 events, with `window.ethereum` as fallback; the dialog shows the exact message before signing; no wallet, rejected signature and expired nonce each show their neutral message; sign-in never asks to switch networks; "View as Maker A1" persona is read-only and labelled.
- What not to build: email or password, a user table, OAuth, refresh tokens, stored roles or an admin panel, gating Verify or Claim lookup behind login, server custody of keys, ENS lookups, EIP-1271 smart-contract wallet signatures (documented as a limit).
- Cut fallback: connect wallet and "View as" without SIWE; publish stays disabled on the public deploy (`PUBLIC_DEMO=1`) instead of open.

### A6. Bring your own model, in the browser (1.25 h, gamma, plus 0.25 h alpha wiring counted in A3/A5 slack)
- Goal: users pick Claude, GPT, Gemini, OpenRouter or a local model (Gemma, Qwen via Ollama, LM Studio, llama.cpp, vLLM). Keys stay in the browser and go straight to the provider. Measured on Oct 11: Anthropic, OpenAI, Gemini's OpenAI-compatible endpoint, OpenRouter and the Monad RPC all answer CORS preflights from a foreign origin; a local endpoint on `localhost:11434` allows `http://localhost:8787`.
- Files:
  - `src/ai/prompts.ts` (new, browser-safe): `IntentSchema`, `INTENT_SYSTEM`, `BRIEF_SYSTEM`, `REPORT_SYSTEM`, `ruleIntent`, `mergeIntent` (the "rules win on explicit numbers" merge, moved out of `designCampaign`), `templateBrief`. `pipeline.ts` and `report.ts` import from it and re-export what tests import today.
  - `src/ai/http.ts` (new, browser-safe): `openaiCompatible({ baseUrl, model, key, timeoutMs, fetchImpl })` (today's `local()` moved here; `llm.ts` uses it, so the server path is unchanged) and `anthropicMessages({ key, model, fetchImpl })` (fetch to `https://api.anthropic.com/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`; JSON through the same prompt, `extractJson` and zod path as local models). Both implement the existing `LLM` interface. No `process.env` reads inside.
  - `src/ai/pipeline.ts`: `designCampaign(goal, src, llm, onStep, opts?: { intent?: Intent; brief?: "server" | "none" })`; result gains `facts`.
  - `src/server/index.ts` (after A4): `/api/copilot` accepts `{ goal, intent?, brief? }` validated with zod; report route accepts `?narrate=none` and returns `{ facts, template, root }`.
  - `web/src/ai/keys.ts` (sessionStorage by default, localStorage only with "Remember on this device", `forget()`), `web/src/ai/writer.ts` (builds an `LLM` from settings; runs intent and brief in the browser with `groundedText` from `src/ai/grounding.ts`), `web/src/ui/ModelDialog.tsx`.
  - `web/src/api.ts`: a guard that throws in development if an own-origin request carries `authorization` or `x-api-key`.
- Providers in the Writer slot: None (default), This server (only when the operator enabled server AI), Anthropic, OpenAI (`https://api.openai.com/v1`), Google Gemini (`https://generativelanguage.googleapis.com/v1beta/openai`), OpenRouter (`https://openrouter.ai/api/v1`), Local (presets: Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`, llama.cpp `http://localhost:8080/v1`). Model ids are typed or picked from `GET {base}/models` ("List models"); defaults: `claude-opus-5-5` (today's default) for Anthropic, empty for the rest. Do not hard-code other model ids.
- Acceptance:
  - `test/ai.test.ts` keeps its 7 tests and adds: (a) `designCampaign` with an injected intent and `brief: "none"` returns the same campaign and candidates as the rules-only path for the three example sentences; (b) `openaiCompatible` against the in-process mock LLM returns schema-valid JSON from a prose-wrapped reply; (c) `anthropicMessages` sends the three required headers and parses a canned response (fake fetch); (d) the browser brief path rejects an invented number and falls back to the template (reuses `groundedText`).
  - With Local selected and Ollama running, Design shows "Written by gemma4:e4b-it-qat in your browser" and the grounding result; the tape's first line names the browser model.
  - With Anthropic selected, the Network panel shows the key only on requests to `api.anthropic.com`; no request to this origin carries `x-api-key` or `authorization`.
  - Keys are absent from `localStorage` unless "Remember" is ticked; "Forget key" clears both stores.
  - Model errors fall back per step and say so ("Anthropic rejected the key. Used rules instead.").
- Cut fallback: ship the OpenAI-compatible adapter only (covers OpenAI, Gemini, OpenRouter and every local server) and reach Claude through OpenRouter; the Anthropic adapter moves to B.

### Tier A gate (Mon, before 09:00)
- `npm run typecheck && npm run test:all && npm run build:web` green; test count at least 32 + 15.
- Opus judge scores rubric dimensions 1 to 9 for the Tier A scope; every scored dimension at least 8 and no hard-gate failure.
- If the gate fails after one fix batch: merge A4 (security) alone to `main`, keep the old UI, and continue Tier B items that do not depend on the redesign (B1 data, B5 docs).

## Tier B (4.75 agent-hours): should ship

### B1. Live shadow campaign and RPC-direct verify (1.25 h, delta)
- Goal: the judges' top no-cost credibility fix. Show which real Kuru makers would have earned what on MON/USDC, and let the browser recompute it straight from the Monad RPC, not from our server.
- Files: `src/cli/main.ts` (new `sb shadow <pair> [--epochs 3] [--epoch-blocks 1200]`: back-dates a campaign to `head - epochs*epochBlocks - 10`, writes the campaign file with a top-level `shadow: true` next to `rationale` (no change to the core `Campaign` type), builds epochs with the existing epoch builder), `web/src/ui/useRecompute.ts` (log source "Monad RPC, direct": `fetchBookLogs` from `src/core/fetch.ts` with a browser `StaticJsonRpcProvider`, 100-block chunks via `getLogsChunked`), `web/src/pages/Overview.tsx` and Start (shadow labels), `test/shadow.test.ts`.
- Acceptance:
  - `test/shadow.test.ts` runs `sb shadow` against `test/fake-chain.ts` and `sb verify` passes; a spy on the provider asserts every `eth_getLogs` range is at most 100 blocks.
  - On a live instance: the data label reads `MAINNET LOGS · SHADOW CAMPAIGN · NOTHING PAID`; payouts read "Would have earned"; Verify defaults to "Monad RPC, direct", reaches VERIFIED, and the Network panel shows `eth_getLogs` calls to the RPC.
  - RPC failure shows the request that failed, retries with backoff, then offers the server bundle with its trust note.
- Cut fallback: shadow data ships with server-bundle verify and the existing honest note ("logs come from this server's bundle; run `sb verify` for a chain-only check").

### B2. Decision model as a typed judge (1.0 h, gamma)
- Goal: use a System One model (TypeSafe Jev, or a local Von/Laya server that speaks `POST /v1/systemone`) where a typed, calibrated judgment beats both rules and free text. It never touches numbers that reach the campaign or payouts.
- Measured on Oct 11: `api.typesafe.ai` answers browser preflights with "Disallowed CORS origin", so Jev calls go through the server. TypeSafe's guidance is to keep its key server-side anyway; Jev costs $0.042 per million input tokens.
- Files: `src/ai/judge.ts` (questions and a small client; base URL fixed to `https://api.typesafe.ai/v1/systemone` on the server), `src/server/index.ts` (`POST /api/judge`, rate-limited; uses `TYPESAFE_API_KEY`, or a per-request `x-typesafe-key` header passed upstream and never logged), `web/src/ai/writer.ts` (local System One URL called browser-direct), `web/src/pages/Design.tsx` and Overview report (flags and support marks), `test/judge.test.ts`, `test/fixtures/sponsor-requests.json` (12 handwritten requests with expected flags).
- Judgments (one request, asked in parallel over the sponsor's sentence):
  - `pair` (Choice: AUSD/USDC, MON/USDC, none). Confidence under 0.7 or "none" makes the UI ask "Which book?" instead of defaulting to AUSD/USDC.
  - `wants_volume` (Noul): rewards trades or volume instead of resting quotes. Flag: "This campaign pays for resting depth inside a band, not volume."
  - `names_makers` (Noul): pays or excludes named makers. Flag: "Campaigns are open to every maker."
  - `price_promise` (Noul): asks to hold or guarantee a price. Flag: "Depth rewards don't defend a peg."
  - `one_sided` (Noul): wants only bids or only asks. Note: "One-sided quoting earns a third of the score."
  - After a brief or report is written: `supported_<i>` (Noul per sentence) "Is this sentence fully supported by the facts JSON?". Any sentence under 0.5 switches the text to the template and shows which sentence failed. This extends the numeric grounding guard to claims.
- Thresholds: flag at p of 0.6 or more; tunable constants; measured on the fixture.
- Acceptance:
  - `test/judge.test.ts` with a mock System One server: campaign objects are byte-identical with and without the judge (the judge cannot change numbers); a low-confidence pair answer returns `needsPair: true`; flags map to the copy above; an unsupported sentence forces the template.
  - If `TYPESAFE_API_KEY` is available, run the 12-request fixture once against real Jev and put the accuracy in the README. If not, the README says it ran only against a mock.
  - Local Von/Laya: only claim support for question types the local server answers; probe it before writing the README line.
- Where a decision model would be decoration (do not build): scoring or ranking makers, picking campaign settings (a fixed rule does that), a single "campaign risk score", approving publish, anything on-chain.
- Cut fallback: ship `pair` and `wants_volume` only.

### B3. Page recompositions and states (1.25 h, alpha)
- Goal: carry the world into Overview, Design, Make markets and Claim, and build every state in `DESIGN-BRIEF.md` section 8.
- Files: `web/src/pages/Overview.tsx`, `Design.tsx`, `Makers.tsx`, `Claim.tsx`, `web/src/ui/LedgerTable.tsx`, `web/src/ui/MarginNote.tsx`, `web/src/ui/SamplingStrip.tsx`, `web/src/ui/RestClock.tsx`.
- Acceptance:
  - Overview: boxed terms row, ruled KPI row with no count-up, LedgerTable with tick column filled after a session recompute, flicker margin note, tickmark legend.
  - Design: request schedule, tape of real steps, recommendation schedule with publish gating, "Every setting tried" with the chosen row highlighted.
  - Make markets: sub-tabs Backtest, Rest clock, Run it, Claim; rest clock at 300 ms per cell with Requote reset and its illustration label.
  - Verify: sampling strip uses the epoch file's real sample blocks.
  - Claim: proof lines ticked after `verifyProof` passes in the browser.
  - Every page shows its empty, loading (skeleton at final height) and error state; Lighthouse CLS under 0.1 on Overview.
- Cut fallback: Overview and Verify get the full treatment; Design, Make markets and Claim keep their layouts on the new tokens.

### B4. Public deployment (0.75 h, beta; USER ACTION needed)
- Goal: a URL judges can click, up through judging (Oct 14 to 27).
- USER ACTION (5 minutes): choose a Node host the team already has an account with (Render, Railway or Fly all fit: one long-running Node process, a writable disk for `out/`, streaming responses) and add the env vars. Agents must not create accounts.
- Files: `README.md` (deploy section), optional `Dockerfile` (about 10 lines) only if the host needs one.
- Two services from the same commit: `demo` (`DATA_SOURCE=demo`) and `live` (`DATA_SOURCE=live`, with the B1 shadow campaign built at deploy). An `ALT_URL` env var renders a "See it on Monad mainnet logs" link and back.
- Env: `PUBLIC_DEMO=1`, `TRUST_PROXY=1`, `SESSION_SECRET` (32 random bytes), `ALLOWED_HOSTS`, `SERVER_AI=off`, optional `TYPESAFE_API_KEY`, `CSP_CONNECT_EXTRA` for any extra model host.
- Acceptance: `curl -I` shows the A4 headers over HTTPS with `Strict-Transport-Security`; the Start recompute works on both services; sign-in works on the HTTPS origin; the demo-day fallback (Cloudflare quick tunnel from a laptop) is documented, not relied on.
- Cut fallback: no public URL; the README's `npm start` path and the video stay the demo.

### B5. Real local model run and docs (0.5 h, delta)
- Goal: close the overclaim that only a mock model was exercised.
- Steps: run the copilot and an epoch report with `gemma4:e4b-it-qat` through the browser Writer and through `AI_PROVIDER=local`; record time, intent read, and grounding outcome. Update the README sections "Pick the AI model" (browser picker, key handling), "Sign in" and "Security" with what actually ran.
- Acceptance: README lines match what ran; nothing claims a model or provider that was not run.

## Tier C (only if A and B are merged and every rubric dimension is 8 or more by Mon 22:00)

### C1. Privy embedded wallet (1.5 h; USER ACTION: Privy app id and allowed origin)
- Privy becomes one more EIP-1193 provider into the same SIWE flow; no Privy server verification. `@privy-io/react-auth` loads in a lazy chunk only when the user picks "Email or social login"; behind `VITE_PRIVY_APP_ID`; CSP gets Privy's domains only when the flag is set.
- Acceptance: main bundle size unchanged within 5 KB; sign-in with an email-created wallet produces a session; the button is absent without the env var.
- Bounty honesty: claim the Privy bounty only if this ships and works on the public URL.

### C2. Machine-readable campaign feed for agent makers (0.5 h)
- `GET /api/campaigns/open.json`: open campaigns with pair, band, rest, budget per hour and the epoch schedule, so bots and AI agents can discover them. This is the "agent makers" stretch from `PRODUCT.md`, with AI on the supply side and never in the money path.

## Deliberately excluded
- Email/password, user databases, OAuth, admin panels, stored roles.
- A server-side proxy for LLM keys (it would see keys and open an SSRF hole for arbitrary base URLs). The only pass-through is Jev, to one fixed upstream.
- Tailwind, shadcn, GSAP, WebGL, a React test framework, an icon library.
- Dynamic (one embedded-wallet integration at most: Privy, in C).
- Chasing the Mobile Trading App bounty: the app gets good on phones, but it is not a trading app.
- Placing Kuru orders or deploying the distributor from the UI. The bot and `drop` stay CLI tools with their existing guards.
- The funded mainnet Day-0 run. It is user-funded and lives in `day0/spreadbounty/LIVE-RUNBOOK.md`, outside this plan.
- Changes to scoring, sampling, Merkle or claim code.

## Biggest risk
Three lanes editing the same app overnight break the forge-and-verify moment or a data label just before the deadline, and the 2:00 video and screenshots no longer match the app. Controls: `useRecompute` is extracted first with a parity test; lanes own files; `main` keeps the working UI until the Tier A gate passes; the video is re-recorded only after the B gate (Mon 17:00); code freeze Tue 12:00.
