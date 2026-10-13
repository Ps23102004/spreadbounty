# Pitch video script (required, up to 2 minutes)

The portal asks: **introduce yourself, the problem, why you're building it.** This one is you on camera, so the script is written to be said out loud in plain words. Sentences in [brackets] are yours to fill in: only you know them, and a pitch that sounds like you beats one that sounds polished.

**Length:** 237 spoken words plus your two bracketed lines, about 270 in all: roughly 1:55 at a calm pace. If you run over, cut your bracketed lines first. Record it in one take, then trim.

## One question only you can answer

Why did this problem catch you? One honest sentence, in your own words, goes in the 0:40 block. Everything else below is already written from what is true and checkable.

## The script (about 310 words: read briskly, roughly 2:05; cut the bracketed line and the reviewers line to get under 2:00)

**0:00. Who I am**
"Hey, I'm Parth Singh. I'm a computer science student in Indianapolis, originally from India, and I'm doing this one solo. I like building games, AI tools, and lately things on-chain. This is Spreadbounty, my Metropolis project on Monad."

**0:17. The problem**
"Here's the problem. Kuru is Monad's on-chain order book, and a lot of its books are thin. On October 11 I checked the AUSD/USDC book, an official Kuru market, and it had no bids and no asks. Projects pay market makers to fix that through private deals, and they can't check what they actually got."

**0:40. Why I'm building it**
"[One honest sentence on why this caught you.] What bugged me is simple: if you pay for liquidity, you should be able to check the payout yourself. Nobody should have to take my word for it."

**0:56. What it does, and the proof**
"So Spreadbounty pays any maker who rests tight bids and asks on both sides, scored from Kuru's public logs. Watch this: one click, my browser rebuilds the book and says verified. Now I change one payout by a single token. The root still looks valid, but recomputing says: exception, do not pay."

**1:20. Open source, and what's different about the AI**
"It's open source, MIT. The claim contract is 1inch's, unmodified. The scoring is Polymarket's formula. The app runs on React, ethers and Vite, and local models run through Ollama. Here's what's different about the AI: I built this with AI agents, but no model ever decides who gets paid. A test fails the build if it tries. Models only read the sponsor's sentence and explain numbers the code computed, and any invented number gets thrown out. Two independent AI reviewers went through it and found real bugs, and I fixed them."

**1:48. Honest status and close**
"Status, honestly: 94 tests pass, and a read-only replay on Monad matched 8 of 8 live orders. Live orders aren't done yet, and I'm asking for a one-week pilot. Spreadbounty: depth you can verify."

## Where each claim comes from

| You say | Proof in the repo |
|---|---|
| MIT, open source | `LICENSE` |
| Claim contract is 1inch's, unmodified | `spreadbounty/contracts/vendor`, sha256-checked in `test:drop` |
| Scoring is Polymarket's formula | `src/core/score.ts` doc comment, `docs/ARCHITECTURE.md` |
| React, ethers, Vite; local models via Ollama | `spreadbounty/package.json`, `docs/AI-RUNS.md` |
| No model decides a payout; a test fails the build | `test/boundary.test.ts`, grounding guard in `src/ai/grounding.ts` |
| Two independent AI reviewers found real bugs | `plans/JUDGE-RUBRIC.md`, commit history (verifier now compares every committed field) |

## What to show while you talk

| Time | On screen | File to use |
|---|---|---|
| 0:00 to 0:15 | You on camera | your recording |
| 0:15 to 0:45 | The null book: `"bestBid": null, "bestAsk": null` | first scene of `media/spreadbounty-demo-2m.mp4` |
| 0:45 to 1:10 | You on camera, then the "A sponsor sets a bounty" scene | your recording, `media/spreadbounty-launch-20s.mp4` |
| 1:10 to 1:40 | Verified, then the forged payout and the EXCEPTION stamp | `media/walkthrough.mp4` (Start or Verify page) |
| 1:40 to 2:00 | The 8/8 replay card, then the closing card | `media/spreadbounty-launch-20s.mp4`, last scenes |

Every shot keeps its own label on screen (LIVE read-only, DEMO DATA, or SHADOW CAMPAIGN). Do not cut a demo-data shot so it looks like mainnet.

## More claims you can say, and the proof behind each

| You say | Backed by |
|---|---|
| The AUSD/USDC book had no bids or asks on Oct 11 | `day0/spreadbounty/reports/2026-10-11-check-AUSD-USDC.json` |
| 8 of 8 live orders matched the contract | `day0/spreadbounty/reports/2026-10-11-check-MON-USDC.json`, re-run in `2026-10-12-check-MON-USDC.json` |
| 94 automated checks pass | `npm run test:all` exits 0 |
| A forged payout with a valid root is caught | `test/web.test.ts`, and the Verify page |
| Live orders and a live epoch are not done | the Status table in the root README |

Do **not** say: "live on mainnet", "users", "paid", "partners", or any dollar figure for volume. None of those is true yet.

## If you want a shorter cut (60 seconds)

Keep 0:00 to 0:15, the first two sentences of the problem, the proof scene, and the closing line. About 130 words.

## Recording checklist

- Record at 1920x1080, face lit from the front, a quiet room, phone on silent.
- Close the terminal windows and `.env` files, hide bookmarks, and check that no private key or wallet balance is on screen.
- Upload as unlisted, then paste the link into the project profile next to the repo.
- Check the final cut is 2:00 or less.
