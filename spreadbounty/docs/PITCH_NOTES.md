# Spreadbounty pitch rehearsal notes

**First, check whether there is a live pitch at all.** Public pages describe judging (Oct 14–27) as per-track review of the submission: video, write-up, code. If there's no live session, spend the rehearsal on the video voice-over and on the Q&A below, which also covers a judge call or a Discord thread.

The deck is "Spreadbounty pitch" (15 slides, with speaker notes on every slide). The voice-over script is in `DEMO_SCRIPT.md`.

---

## The one thing to land

> **Anyone can recompute every payout.** A forged payout with a valid-looking Merkle root fails in a browser.

Everything else supports that sentence. If you run short of time, cut to the Verify slide.

## Three-minute cut (11 slides)

Skip slides 3 (Today), 7 (Dashboard), 9 (Copilot) and 13 (Business). Say the business model in one line on the Ask slide.

| Slide | Time | Say this, then move on |
|---|---|---|
| 1 Cover | 0:00–0:10 | "Spreadbounty: sponsors pay for order-book depth on Monad, and anyone can recompute who earned it." |
| 2 Problem | 0:10–0:30 | "On October 9 Kuru's AUSD/USDC book had zero resting orders. A stablecoin with no book." |
| 4 One-liner | 0:30–0:45 | "Polymarket's maker rewards, moved onto an on-chain order book, so the scoring is public." |
| 5 How | 0:45–1:05 | Fund, quote, sample, publish, claim. "Only the first step needs trust." |
| 6 Score | 1:05–1:20 | "Tight, two-sided and patient wins. Flickering quotes earn nothing." |
| 8 Verify | 1:20–1:55 | **Slow down here.** "This forged file pays one maker an extra token, with a perfectly valid root. Recompute: mismatch." |
| 10 Makers | 1:55–2:10 | "Our open-source bot earns more with 2 transactions than a timer bot with 860. Synthetic data, and I say so." |
| 11 Claim | 2:10–2:25 | "1inch's distributor, unmodified. Our publisher refuses any root it can't recompute." |
| 12 Why Monad | 2:25–2:35 | "Every order names its owner, every 300 milliseconds." |
| 14 Status | 2:35–2:50 | State plainly what's live and what isn't. Never round up. |
| 15 Ask | 2:50–3:00 | "Fund one week of depth on AUSD/USDC and check every cent yourself. We take 3 to 5 percent." |

## Five-minute cut (all 15 slides)

Use the speaker notes as written. The budget, by slide, is 10 / 20 / 20 / 15 / 25 / 20 / 20 / 35 / 25 / 25 / 20 / 20 / 15 / 20 / 10 seconds, about 5:00. The copilot slide (9) is the one to drop if you're over.

## Delivery

- **Pause after the Verify mismatch.** Two seconds of silence does more than any adjective.
- **Say "synthetic" out loud** whenever you show demo-data numbers. Judges forgive simulation and don't forgive being misled.
- **Numbers you say must be on screen** or in the repo. No new figures in the room.
- **Words to avoid:**
  - "audited" (nobody has audited our setup);
  - "live", until the Day-0 hashes exist;
  - "customers" (only targets);
  - "trustless" (the distributor owner is trusted);
  - "the AI decides" (it never does).

## Numbers to have cold

| Number | Where it comes from |
|---|---|
| 0 resting orders on AUSD/USDC | Our read-only check, Oct 9 |
| 8 of 8 orders matched contract state, 7,332-log replay | Our Day-0 check |
| 20-block minimum rest ≈ 6 s; one sample per ~minute | Campaign rules; ~300 ms blocks |
| 2.28 vs 1.58 vs 0.07 USDC; 2 vs 860 txs | Bot backtest, **synthetic** demo epoch 2 |
| 32 automated tests; 4 makers claimed exact totals on the real 1inch contract | Test suite (local EVM) |
| 3–5% take | Business model; the same order as Merkl |
| [Day-0 tx hashes] | Fill in once the live test runs |

## Hard questions, short answers

Answer in at most 20 seconds, in three parts: **the answer, the evidence, the limit.** Every one of these was raised by a judge agent in our idea review or follows from the design.

**"Isn't this just Polymarket's formula?"**
Yes, on purpose: it's a formula makers already understand. Polymarket scores off-chain, so you trust them. Here every input is a Kuru log, and the browser recomputes the payout. That part is new.

**"Majors are already 4–12 bps with pros updating hundreds of times a minute. Won't a small pool just go to them and change nothing?"**
On majors, probably yes. A third-party scan we relied on put MON/USDC at 12.4 bps, with the fastest maker updating 288 times a minute. That's why we start on thin books like AUSD/USDC, where there was nothing. On a major, the sponsor still buys verifiable depth inside the band, and the 20-block rest rule rewards patience, not speed.

**"Your demo funds its own maker."**
For the demo, yes. It proves the mechanics end to end. The bot is open source and needs no sign-up, so any maker can run it. Getting makers who aren't us is the pilot's job, and we don't claim it has happened.

**"Can it be gamed?"**
- **Spoofing:** samples land at a block chosen by a later block's hash, and orders must have rested 20 blocks, so you have to quote continuously.
- **Sybil:** payouts are pro-rata by size, so splitting wallets gains nothing.
- **Wash or self-quoting:** depth inside the band is real liquidity whoever posts it, and anyone can trade against it.
- **The limit:** a block producer could in principle bias which block gets sampled. We haven't measured that.

**"Who do I have to trust?"**
The distributor's owner, who can set any root. So the sponsor owns it, ideally through a multisig, and funds one epoch at a time. Our publisher refuses roots it can't recompute, and anyone can verify a root before claiming.

**"Why would a sponsor pay for this?"**
Sponsors already pay for depth, through market-maker retainers and incentive programs, without being able to check what they got. This makes that spend checkable. The ask is a one-week pilot. We have no signed sponsor and don't claim one.

**"Covenant already does maker deals on Kuru."**
As our research read their READMEs, an issuer hires one market maker through a vault or escrow. Spreadbounty is an open crowd of makers with recomputable payouts. The two are complementary.

**"Why not Merkl?"**
Merkl pays pools and vaults, and we found no order-book campaign type. It could even become a distribution channel for these payouts later.

**"Doesn't requoting cost makers too much gas?"**
A third-party study measured per-block requoting at about $16 an hour lost on MON/USDC. That's exactly why the rest rule exists and why our bot leaves good orders alone: 2 transactions against 860 in the backtest.

**"What happens if Kuru upgrades its contracts?"**
The decoder is pinned to the implementation it was checked against. The bot and the tools refuse to run against a different one until it's re-verified.

**"Why is AI in this at all?"**
For the sponsor's experience: one sentence in, a backtested campaign out. It never touches scoring or payouts, every number it writes is checked, and the product works with no model.

**"What's actually live?"**
Say exactly what has run on mainnet. Today that's the read-only checks. After the Day-0 test it will be the hashes. Then name what's next.

## Drills (about 60 minutes in total)

1. **Read-through with notes** (10 min): the 3-minute cut, out loud, with a timer.
2. **No notes** (10 min): two runs. Each must land 2:50–3:10.
3. **Record yourself** (15 min): watch it back once and cut every filler phrase you hear.
4. **Q&A fire drill** (15 min): someone picks five questions at random from above. Answer each in 20 seconds or less: answer, evidence, limit.
5. **Failure drill** (10 min): rehearse "The demo stalled, so here's the recorded run," then switch to the video without apologising twice.

## Before you present

- [ ] Deck placeholders filled: team, contact, pilot budget
- [ ] Day-0 hashes on the Status slide, or the slide says plainly they're pending
- [ ] Video open in a tab as the fallback for any live demo
- [ ] App running locally (`npm start`) if you'll demo live, with the "Demo data (synthetic)" chip visible
- [ ] No `.env`, wallet or key visible on any screen you share
