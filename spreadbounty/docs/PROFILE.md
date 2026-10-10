# Spreadbounty: project profile

Paste-ready copy for the Metropolis public project profile. The portal's exact fields sit behind its login, so this covers the usual ones in several lengths. Character counts are in brackets; pick the variant that fits the field's limit. `[...]` marks something only you can fill.

## Basics

| Field | Value |
|---|---|
| Project name | Spreadbounty |
| Track | Onchain Finance & Trading (Track 1) |
| Tags | DeFi · market making · order book · liquidity incentives · Kuru · Merkle distributor · verifiable compute · AI copilot |
| Logo | `docs/profile/logo-512.png` (also 1024 px and `logo.svg`) |
| Cover / banner | `docs/profile/cover-1600x900.png` (16:9) |

## Tagline

- Pay for order-book depth on Monad. Verify every payout. [55]
- Maker rewards for Kuru that anyone can recompute [48]
- Verifiable depth for Monad's order books [40]

## One-liner

Sponsors fund maker rewards on Kuru's order books. Makers earn by quoting tight, and anyone can recompute every payout from public logs. [136]

## Short description

Spreadbounty lets anyone fund maker rewards on a Kuru order book, for example AUSD/USDC within 15 bps for $50/day. Makers earn by resting tight two-sided quotes. Every payout is recomputable from public logs, and makers claim from 1inch's Merkle distributor. [258]

## Medium description

Spreadbounty lets anyone fund maker rewards on a Kuru order book, such as "keep AUSD/USDC two-sided within 15 bps for $50/day". Any maker earns by resting tight bids and asks, scored about once a minute at block-hash-chosen samples with Polymarket's two-sided formula. Every epoch's payouts are recomputable by anyone from public Kuru logs, in a browser, and makers claim from an unmodified 1inch Merkle distributor the sponsor owns. An AI copilot turns a sponsor's sentence into a backtested campaign on Claude or a local model, and is kept out of the money path. It ships with an open-source maker bot. [604]

## Full description

Paste `WRITEUP.md`, or link it if the field takes a URL: https://github.com/Ps23102004/hackathons-fall-2026/blob/main/spreadbounty/WRITEUP.md

## How it uses Monad

Kuru, Monad's native order book, emits an event for every order, cancel and fill, and each event names the order's owner. That is what lets Spreadbounty score each maker from logs alone and lets anyone recompute the payout. Blocks every ~300 ms make once-a-minute sampling at an unpredictable block practical; a 20-block minimum rest is about six seconds. Campaigns target Monad mainnet (chain 143), where makers will claim from a distributor the sponsor funds. [461]

## Links

| Link | Value |
|---|---|
| Code | https://github.com/Ps23102004/hackathons-fall-2026/tree/main/spreadbounty |
| Write-up | https://github.com/Ps23102004/hackathons-fall-2026/blob/main/spreadbounty/WRITEUP.md |
| Demo video | [unlisted video link] |
| Deck | [deck share link; set sharing first] |
| Live demo | None hosted. It runs locally with `cd spreadbounty && npm install && npm start`. Say so rather than leaving the field empty. |
| Kuru market used | AUSD/USDC `0x8cF49e35D73B19433FF4d4421637AABB680dc9Cc` (Monad mainnet, read-only so far) |
| Our contracts on Monad | [CumulativeMerkleDrop address once deployed; none yet] |

The code links work only if the repository is public. Check its visibility before submitting.

## Tech stack

TypeScript · Node · ethers v5 · React 19 · Vite · motion · Solidity 0.8.23 (1inch CumulativeMerkleDrop, unmodified) · solc-js · ganache (tests) · Claude API or any OpenAI-compatible local model (Ollama, LM Studio, llama.cpp, vLLM) · Playwright (screenshots)

## Screenshots

Upload in this order. Every caption names its data source, because the app shots use the labelled synthetic dataset.

| File | Caption |
|---|---|
| `docs/screenshots/overview-light.png` | Sponsor overview: coverage, depth inside the band, cost per $1k of depth, and who earned what. Synthetic demo data. |
| `docs/screenshots/verify-forged.png` | A forged payout with a valid-looking Merkle root fails when the browser recomputes it from the logs. Synthetic demo data. |
| `docs/screenshots/design-dark.png` | Campaign copilot: one sentence in, a backtested campaign out; the model's invented numbers are rejected. Synthetic data, mock local model. |
| `docs/screenshots/makers-light.png` | Make markets: our bot against a timer requoter and an edge quoter, scored by the real epoch builder. Synthetic demo data. |
| `docs/screenshots/claim-light.png` | Claim from the unmodified 1inch distributor with a browser wallet. Local test chain. |

## Team

| Name | Role | Contact |
|---|---|---|
| [Name] | [Role] | [Contact] |

## Story fields (if the form asks for them)

**Inspiration.** Kuru's AUSD/USDC book had no resting orders when we checked it on mainnet on October 9. Sponsors who want depth today either sign private market-maker deals they can't audit or fund AMM incentives that don't reward tight quotes. Polymarket already pays makers this way, but scores them off-chain. On an on-chain order book, the scoring can be public. [350]

**What it does.** A sponsor funds a campaign on one Kuru book: a band, a budget and an epoch length. Any maker earns by resting bids and asks inside the band; flickering quotes earn nothing. Each epoch publishes samples, scores, payouts and one Merkle root. Anyone can recompute it in a browser, and makers claim from the 1inch distributor the sponsor funds. [340]

**How we built it.** A TypeScript core replays Kuru's order logs, samples the book at blocks chosen by later block hashes, scores with integer maths and builds a 1inch-format Merkle tree. The CLI, the server and the React app all run the same code. The AI copilot uses Claude or any OpenAI-compatible local model behind a grounding guard. The maker bot shares its scoring with the epoch builder. The 1inch contract is vendored, sha256-checked and compiled reproducibly. [448]

**Challenges.** Monad's public RPC caps log queries at 100 blocks, so the fetcher chunks and retries. The event decoder had to be pinned to Kuru's live implementation and checked against contract state. Small local models invent numbers, so every number in model text is checked against the facts; that check had a false positive on "per $1k", which we fixed with a regression test. And payouts must be bit-identical on every machine, so scoring is integer-only. [446]

**Accomplishments.** A forged payout with a perfectly valid Merkle root fails when anyone's browser recomputes it. Our proofs paid four makers exactly their totals on the real 1inch contract in tests. 32 automated tests cover scoring, verification, the AI harness, the bot and the claim contract. [275]

**What we learned.** Incentive design shows up in the data. Because every requote restarts the rest clock, in backtests on our synthetic dataset a bot that leaves good orders alone earned more with 2 transactions than a timer bot with 860. AI is useful at the edges: reading a sponsor's request and explaining verified numbers. It doesn't belong in the money path. [343]

**What's next.** Run the first live epoch on Monad mainnet and deploy the distributor. Then a one-week pilot with a sponsor on AUSD/USDC, an MCP tool that lists live campaigns so AI trading agents can join them, and per-maker caps. [214]
