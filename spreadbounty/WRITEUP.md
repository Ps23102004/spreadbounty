# Spreadbounty

**Sponsors pay for order-book depth on Monad. Anyone can recompute who earned it.**

Track 1 · Onchain Finance & Trading · built on Kuru · [Demo video] · [Deck] · Code: `spreadbounty/` in this repository · Judge FAQ: `spreadbounty/FAQ.md`

> **Short version (for a one-paragraph field).** Spreadbounty lets anyone fund maker rewards on a Kuru order book, such as "keep AUSD/USDC two-sided within 15 bps for $50/day". Any maker earns by resting tight bids and asks, scored about once a minute at block-hash-chosen samples with Polymarket's two-sided formula. Every epoch's payouts are recomputable by anyone from public Kuru logs, in a browser, and makers claim from an unmodified 1inch Merkle distributor the sponsor owns. An AI copilot turns a sponsor's sentence into a backtested campaign on Claude or a local model, and is kept out of the money path. It ships with an open-source maker bot.

---

## The problem

Kuru is Monad's on-chain order book: every order, cancel and fill is a public event that names its owner. Many of its books are thin. On October 9 our read-only check found the official AUSD/USDC market with no resting orders. AUSD already swaps through Monad's AMMs; what's missing is an order book that traders and market makers can use with limit orders.

Projects that want depth, such as stablecoin issuers, the exchange and the chain's foundation, pay for it in two ways today:

- **Private market-maker deals.** The payer can't check what spread and size it got, block by block.
- **AMM-style incentives.** These reward parked capital, not tight quotes on an order book.

Neither lets a sponsor pay an open crowd of makers for depth they can verify.

## What Spreadbounty does

1. **A sponsor funds a campaign** on one Kuru book, for example "$50/day, keep AUSD/USDC two-sided within ±15 bps of 1.0000, hourly epochs."
2. **Any maker earns** by resting bids and asks inside the band. There is no sign-up, no allow-list and no token loan.
3. **The scorer samples the book about once a minute,** at a block chosen by a later block's hash, so nobody knows in advance which block counts. Each order earns `((band − dist) / band)² × size` once it has rested at least 20 blocks. Per maker, `Q = max(min(Qbid, Qask), max(Qbid, Qask)/3)`, so one-sided quoting earns a third and flickering quotes earn nothing.
4. **Each epoch publishes a file:** samples, mid prices, a hash of the book at each sample, scores, payouts, and one Merkle root of every maker's running total.
5. **Makers claim** from the unmodified 1inch `CumulativeMerkleDrop`, which the sponsor owns and funds. We never hold funds.
6. **Anyone can verify.** `sb verify`, or the Verify page in a browser, refetches the logs, rebuilds the book, rescores every sample and compares every field. An edited payout, a hidden log or swapped block hashes all fail.

## What we built

| Piece | What it does | Where |
|---|---|---|
| Scoring core | Log decoding and book replay, block-hash sampling, integer scoring, epoch files, verify, a 1inch-format Merkle tree. The CLI, the server and the browser all run it. | `src/core/` |
| Web app | Overview (coverage, depth, cost per $1k of depth, who earned what), Design a campaign, Make markets, **Verify** (an in-browser recompute with a forged-payout demo), and Claim (the proof re-checked in the browser, plus a wallet claim). | `web/` |
| Campaign copilot (AI) | The sponsor writes one sentence. A model fills a five-field form, code backtests a grid of settings with the production scorer, and the model writes a brief. Every number in the brief must appear in the backtest, or the text is replaced by a template. It runs on Claude, any OpenAI-compatible local model (Gemma, Qwen, Llama via Ollama, LM Studio or llama.cpp), or no model. | `src/ai/` |
| Maker bot | Quotes both sides about 35% into the band and requotes only on drift, because each requote restarts the rest clock. Orders are post-only, with an inventory cap, a peg guard and cancel-all on exit. Paper mode is the default. Backtests are scored by the epoch builder itself. | `src/bot/` |
| Claim contract tooling | The vendored, sha256-checked 1inch source is built reproducibly with upstream's settings. `drop deploy / publish / fund / claim` refuses a root that doesn't recompute from the logs, doesn't chain from the on-chain root, or isn't fully funded. | `contracts/`, `src/drop/` |
| Day-0 checks | Read-only checks against Kuru on mainnet: market identity, tick size, implementation, and a log replay checked against contract state. | `day0/spreadbounty/` |

**AI is kept out of the money path.** Scoring, payouts and verification are deterministic code. If a model decided who gets paid, "anyone can recompute it" would stop being true.

## Evidence you can check

- **32 automated tests:**
  - `npm test`: 8 core tests, including tamper detection.
  - `npm run test:ai`: 7 tests against a mock weak local model that invents numbers and wraps JSON in prose.
  - `npm run test:bot`: 10 tests, including the live runner against a fake RPC serving recorded data.
  - `npm run test:drop`: 7 tests on an in-process EVM. Four makers claimed exactly their totals from the real 1inch contract using our proofs; forged roots, unknown roots and non-owner publishes are refused.
- **Mainnet replay.** In a 7,332-log replay of Kuru's MON/USDC market, 8 of 8 checked orders matched the contract's own `s_orders` state.
- **Maker bot backtest** on the labelled synthetic dataset (2,000 AUSD per side, 10 USDC per epoch):

  | Strategy | Payout | Transactions |
  |---|---|---|
  | Our bot | 2.28 USDC | 2 |
  | Requote every 40 blocks | 1.58 USDC | 860 |
  | Quote at the band edge | 0.07 USDC | 2 |

- **Run it yourself:** `cd spreadbounty && npm install && npm start`, then open http://localhost:8787. The demo dataset is labelled "Demo data (synthetic)" on every page. `DATA_SOURCE=live` reads Monad mainnet.
- **Build window.** All code was written between October 8 and 10, 2026, and the git history is public.

## Prior art, and what is new

The scoring is Polymarket's liquidity-rewards formula: quadratic distance, two-sided minimum, one-sided at a third. Random per-minute snapshots go back to Hummingbot's liquidity-mining campaigns. Both score off-chain, so participants have to trust the operator. Merkl pays incentives but has no order-book campaign type.

What is new here is that **every payout is recomputable from public on-chain logs** by anyone, in a browser, against an open crowd of makers, and claims go through an unmodified, widely used distributor that the sponsor controls. The mechanism could port to other on-chain order books. We start on Kuru because that's where the depth is missing now.

## Why Monad

- Kuru's order events name the order's owner, which is what makes per-maker scoring possible from logs alone.
- Blocks every ~300 ms make once-a-minute sampling at an unpredictable block practical. A 20-block rest is about six seconds.

## Business

A 3–5% take on campaign budgets, the same order of magnitude as incentive platforms like Merkl. The first buyers are the people who already spend on depth: stablecoin issuers, the exchange and the foundation. These are targets; nobody has signed. Supply is permissionless, including trading bots and AI agents.

## Status and limits

- **Built and tested:** everything above.
- **Not yet done on mainnet:**
  - live maker and taker orders through our bot;
  - a closed live epoch verified from the RPC;
  - the distributor deployed on Monad;
  - a run against a real local model.

  [Replace this line with the live Day-0 transaction hashes once they exist.]
- **Trust model:** the distributor's owner can set any root, so the sponsor should own it, ideally through a multisig, and fund it one epoch at a time. Publishing is guarded by recomputation, and anyone can check a root before claiming.
- **Simplifications:** the bot backtest uses a simple fill model and doesn't count gas. Sponsors set a fixed reference price for stablecoin pairs; other pairs use the replayed maker mid.

## Team

[Names, roles, contact]
