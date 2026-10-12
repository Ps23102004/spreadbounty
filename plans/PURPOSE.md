# What Spreadbounty is for, and why we chose it

## The six-line answer

1. Kuru is Monad's on-chain order book, and some of its markets sit empty: on Oct 11 the official AUSD/USDC book had zero resting orders.
2. Projects that want deeper books pay market makers through private deals and cannot check what they got.
3. Spreadbounty lets a sponsor post a reward for keeping one book tight, and any maker earns it by quoting both sides and leaving the orders up.
4. Open code computes every payout from Kuru's public logs, so you can recompute it in your own browser, and a forged payout fails the check.
5. We chose it because all 10 judges in our review panel picked it over Paylink, it fits Track 1 and two event sponsors (Kuru, Agora), and Kuru's investors (Paradigm, Electric Capital) sit on the judging panel.
6. AI helps a sponsor set up a campaign and explains the results; it never decides who gets paid.

## Should we pivot? No.

Our panel of 10 judges (five roles, two model families) picked Spreadbounty 10 to 0, approved it 10 of 10 at an average of 7, and scored Paylink 5 with no approvals (`judging/FINAL-JUDGING.md`). Every judge tied the gap between 7 and 8 to evidence and packaging, not to the idea: synthetic data on every screen, no live transaction, and an unfinished submission kit. Most of that is fixable without money. The engineer judge built a closed epoch from 1,200 real mainnet blocks and `sb verify` matched its root from 4,082 logs fetched from the RPC; B1 in `FEATURE-PLAN.md` puts exactly that in the app. A pivot would throw away 32 passing tests, a vendored and reproducible 1inch distributor, a maker bot and the forged-payout demo that every judge remembered, with 36 hours left. The real risks stay real and should be said out loud rather than designed around: an empty book may mean no takers, no sponsor has signed, and Track 1's best fit is teams that have shipped a trading product. Two bounty angles need no extra build: Kuru's "Bring New Assets and Markets" (reviving an official market that had no resting orders), and possibly the Analytics/Risk Tool bounty (the shadow campaign is a depth audit of real makers), but only if the portal's criteria match, which nobody has read yet. Do not chase the Mobile Trading App or Cross-Border bounties; claim Privy only if C1 ships and works on the public URL.
