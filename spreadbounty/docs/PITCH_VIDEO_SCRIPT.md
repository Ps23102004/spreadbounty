# Pitch video script (required, up to 2 minutes)

The portal asks: **introduce yourself, the problem, why you're building it.** This one is you on camera, so the script is written to be said out loud in plain words. Sentences in [brackets] are yours to fill in: only you know them, and a pitch that sounds like you beats one that sounds polished.

**Length:** 237 spoken words plus your two bracketed lines, about 270 in all: roughly 1:55 at a calm pace. If you run over, cut your bracketed lines first. Record it in one take, then trim.

## Five questions only you can answer (two minutes of thinking)

1. Who are you, in one breath? (Course and school, or what you do. One line.)
2. What got you interested in markets or on-chain trading? One true sentence, not a slogan.
3. What is the moment that made this problem real for you? (The empty AUSD/USDC book is a good one: it is real, dated, and checkable.)
4. Who are Aman, Aashna and Bence on this team, in four words each?
5. What do you want from Metropolis? (The honest default below: a one-week pilot with a sponsor.)

## The script

**0:00 to 0:15. Who I am**
"Hi, I'm Parth Singh. I'm [what you study or do, and where]. With Aman, Aashna and Bence, I built Spreadbounty for Metropolis on Monad."

**0:15 to 0:45. The problem**
"Kuru is Monad's on-chain order book. Some of its books are thin or empty. When we checked on October 11, the AUSD/USDC book, an official Kuru market, had no bids and no asks at all. Projects that want depth pay market makers through private deals, and they can't check what they got for the money."

**0:45 to 1:10. Why I'm building it**
"[One or two true sentences on why this matters to you.] What bothered us is simple: if someone pays for depth, anyone should be able to check the payout. Spreadbounty pays any maker who rests tight bids and asks on both sides. It scores them from Kuru's public logs, and each epoch ends in a Merkle root that anyone can recompute."

**1:10 to 1:40. The proof, on screen**
"Here's the check. One click, and my browser rebuilds the book from the public logs, and says: verified. Now I tamper with one payout by a single token. The Merkle root still looks valid on its own. I recompute: exception, do not pay."

**1:40 to 2:00. Honest status and close**
"What's done: 94 automated checks pass, and a read-only replay on Monad mainnet matched 8 of 8 live orders against the contract. What's not done: live orders and a live epoch on Monad. They're next, and what we're asking for is a one-week pilot with a sponsor. Spreadbounty: depth you can verify, on Monad."

## What to show while you talk

| Time | On screen | File to use |
|---|---|---|
| 0:00 to 0:15 | You on camera | your recording |
| 0:15 to 0:45 | The null book: `"bestBid": null, "bestAsk": null` | first scene of `media/spreadbounty-demo-2m.mp4` |
| 0:45 to 1:10 | You on camera, then the "A sponsor sets a bounty" scene | your recording, `media/spreadbounty-launch-20s.mp4` |
| 1:10 to 1:40 | Verified, then the forged payout and the EXCEPTION stamp | `media/walkthrough.mp4` (Start or Verify page) |
| 1:40 to 2:00 | The 8/8 replay card, then the closing card | `media/spreadbounty-launch-20s.mp4`, last scenes |

Every shot keeps its own label on screen (LIVE read-only, DEMO DATA, or SHADOW CAMPAIGN). Do not cut a demo-data shot so it looks like mainnet.

## Claims you can say, and the proof behind each

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
