# Spreadbounty

**One line:** Polymarket-style maker rewards for Monad's order books, except anyone can recompute every payout from Kuru's public logs.

## The problem

Kuru is Monad's on-chain order book. Every order, cancel and fill is a public event, and fees are 0/0 on the markets we checked. Many books are thin or empty:

- The AUSD/USDC book (`0x8cF49e…`) is an official Kuru market. Today it has **no resting orders** and its AMM vault isn't quoting (Day-0 check, Oct 9). A $500 AUSD→USDC swap on Kuru simply fails.
- Majors like MON/USDC have a few professional makers. Large size still slips: the fork study found $1K fills but $5K fails on cbBTC and WETH.

Projects that want depth (stablecoin issuers like Agora, Kuru itself, the Monad Foundation) pay for it in two ways today:

- **Private market-maker deals.** These are opaque, and the payer can't check what it got.
- **AMM liquidity incentives** (Pendle, Merkl). These pay for parked capital, not for tight quotes on the order book.

## What Spreadbounty does

1. **A sponsor funds a campaign** on one Kuru book. For example: "$50/day, keep AUSD/USDC two-sided within ±15 bps of 1.0000."
2. **Any maker can earn.** No sign-up and no token loan. They just rest bid and ask orders inside the band. Orders must rest at least 20 blocks, so flickering quotes earn nothing.
3. **The scorer samples the book about once a minute**, at a block chosen by a later block's hash, so nobody knows in advance which block counts. Each maker's score uses the same two-sided formula Polymarket uses: tighter and bigger scores more, and one-sided quoting earns a third.
4. **Each epoch produces a public epoch file.** It records the samples, the mid price and a book hash per sample, the scores, the payouts, and a Merkle root in the format of 1inch's `CumulativeMerkleDrop` contract. Makers claim from a contract the sponsor owns and pre-funds. We never hold funds.
5. **Anyone can run `sb verify`.** It refetches the logs, rebuilds the book, rescores and compares every field. An edited payout, a hidden log or swapped block hashes all fail (tested in `test/core.test.ts`).

**The demo, start to finish:**
1. A swap on the empty AUSD book reverts.
2. A maker posts a quote inside the band, and the same swap fills.
3. The epoch closes, the maker claims its payout, and Verify recomputes the root and matches it.

## Why us, why now, why Monad

**Why now:**
- **No market-making program in this ecosystem is checkable.** Kuru's ~$1.2M incentive program has reportedly ended (laya-trader). Monad's AUSD incentives (~$75K/week via Pendle, per news snippets) buy supply, not order-book depth.
- **No neighbour does what we do:**

  | Neighbour | What it does | What it lacks |
  |---|---|---|
  | Covenant ×2 (Metropolis entries) | Hires one market maker through a vault, on testnet | An open crowd of makers |
  | Polymarket Sponsor Rewards | Runs the same scoring | Scores off-chain, so payouts can't be checked |
  | Merkl | Pays incentives | Has no order-book campaign type |

**Why Monad:**
- **Kuru's order book is Monad-native**, and every order event names its owner, so the scorer can see who quoted what. 8/8 orders matched contract state on a 7,332-log mainnet replay.
- **Cheap blocks every ~300 ms** make once-a-minute sampling meaningful.
- **Honest limit:** the mechanism could port to other on-chain order books (Phoenix on Solana, Clober on Base). The pitch says so.

**Business:** a 3–5% take on campaign budgets, the same order of magnitude as Merkl. It starts as the scoring rail for existing depth budgets: Kuru, Agora, the Monad Foundation. Track 1 (Onchain Finance & Trading).

## Where AI fits (and where it must not)

**Not in the money path.** Scoring, payouts and verification are deterministic code. If a model decided who gets paid, "anyone can recompute it" would stop being true, and a judge would kill the idea in one question.

**Where AI earns its place:**

| Feature | What it does | Why it matters | Code |
|---|---|---|---|
| **Campaign Copilot** | A sponsor states a goal in plain English. The model fills a five-field form (pair, band, budget, epoch, reference price). Code reads the market, replays recent order logs, backtests a grid of settings with *our production scorer* and picks one by a fixed rule. The model then writes the brief. | Sponsors don't know what band, rest time or budget buys what. This turns "I want depth" into a published, testable campaign in under a minute. | `src/ai/pipeline.ts` |
| **Epoch Report** | After each epoch, a plain-language note to the sponsor: what the budget bought, how concentrated the rewards were, and what to change next epoch. It may only use numbers `epochMetrics()` computed. | Sponsors renew when they can see their return on spend. | `src/ai/report.ts` |
| **Grounding guard** | Every number in model-written text must appear in the facts the code gave it. Otherwise the model gets one retry naming the bad numbers, then a template takes over. The UI shows which happened. | Small local models invent figures, and a sponsor must never read an invented coverage number. | `src/ai/grounding.ts` |
| *Stretch:* agent makers | An MCP tool listing live campaigns and the $/hour each pays, so AI trading agents can discover them and join. | Puts AI on the supply side without trusting it with payouts. | not built |

**Runs on any model, or none.** The model's jobs are sized for what a 3–8B model does reliably: fill a small form, and paraphrase numbers it is handed. The backends are:
- Local models (Gemma, Qwen, Llama, MiniCPM…) through any OpenAI-compatible server: Ollama, LM Studio, llama.cpp, vLLM, or a DGX Spark box.
- Claude (Opus 5.5 with server-side refusal fallback).
- No model at all (rules and templates).

The recommendation is identical across all three, because code makes it. `npm run test:ai` proves this against a mock weak model that rejects JSON-schema mode, wraps JSON in prose, invents numbers, and goes offline.

## Status (Oct 9)

| Piece | State |
|---|---|
| Day-0 read-only checks on mainnet | ✅ market verified, tick 0.1 bps, replay 8/8, roots deterministic |
| Day-0 live maker/taker test | ⏳ needs funded throwaway wallets (`day0/spreadbounty`) |
| Core: replay, scoring, epoch files, verify, Merkle | ✅ built and tested offline (8 tests) |
| CLI `sb` (market, copilot, epoch, verify, report) | ✅ built; RPC and AI calls not yet run live |
| AI harness: Claude / local OpenAI-compatible / off, grounding guard | ✅ built; 7 tests against a mock weak local model. Not yet run against a real Gemma/Qwen (model downloads are blocked in the build sandbox) |
| Web app: overview, copilot, in-browser Verify with forged-payout demo, claim proof and calldata | ✅ built on the labelled demo dataset; screenshots in `docs/screenshots/` |
| Claim contract | Plan: unmodified 1inch `CumulativeMerkleDrop`, deployed and funded by the sponsor |
| Maker bot (requote on drift) | ✅ strategy, backtest and paper/live runner, 10 tests. Live path tested on a fake RPC serving demo data; **no mainnet order sent yet** (RPC blocked in the build sandbox) |
