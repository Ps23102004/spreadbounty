# Launch kit: Spreadbounty

Use only these facts. Every claim below was checked on Oct 11, 2026.

## What is verified (say these)
- 32 automated tests pass (`npm run test:all`).
- Read-only checks against Monad mainnet: the Kuru MON/USDC market is verified; a replay of 6,602 real book logs matched 8 of 8 live orders against the contract's own state; two independent replays gave the same payout root. Committed report: `day0/spreadbounty/reports/2026-10-11-check-MON-USDC.json`.
- The AUSD/USDC book was empty at the time of the check.
- The claim contract is 1inch's unmodified `CumulativeMerkleDrop`, vendored and sha256-checked against upstream.
- The browser recomputes every payout from public logs and catches a forged one (synthetic data in the demo).

## What is NOT done (say this plainly, every time)
- No live maker or taker orders on Monad yet.
- No closed live epoch; the distributor is not deployed on Monad.
- No users, no signed sponsor. The ask is a one-week pilot.

## Launch video
`docs/media/spreadbounty-launch-20s.mp4` (20 s). Its closing card says read-only mainnet checks are done and live orders, a live epoch and the distributor on Monad are pending. Every mainnet number on screen comes from the committed report above.

## Social posts

**X (under 280 characters)**
> Sponsors pay for order-book depth they can't check. Spreadbounty pays makers from public logs, and anyone can recompute every payout in the browser. Read-only replay on Monad mainnet: 8/8 live orders matched. Live orders are next. github.com/Ps23102004/spreadbounty

**LinkedIn**
> We built Spreadbounty for the Metropolis hackathon: verifiable maker incentives for Kuru order books on Monad.
>
> The problem: protocols pay market makers for depth but can't check what they got. We rebuild the book from public logs, score two-sided depth per epoch, and publish a Merkle root anyone can recompute.
>
> Status, plainly: 32 tests pass. A read-only replay of 6,602 MON/USDC book logs matched 8 of 8 live orders against the contract's state. Live orders, a live epoch and the distributor on Monad are not done yet.
>
> Code, write-up and the 2-minute demo: github.com/Ps23102004/spreadbounty

**Reddit (r/ethdev, first-person, no hype)**
> Title: Replayed 6,602 Kuru MON/USDC book logs on mainnet and checked them against the contract's own order state
>
> Built a small tool that rebuilds a CLOB's maker-depth scoring from public logs. On a read-only run against Monad mainnet, 8 of 8 live orders matched `s_orders`, and two independent replays produced the same Merkle root. Not done: live orders and a live epoch. Feedback welcome on the scoring rules, the Merkle layout and the replay logic: github.com/Ps23102004/spreadbounty

## README embeds
```markdown
![Spreadbounty](docs/media/hero.png)

[Watch the 20-second launch video](docs/media/spreadbounty-launch-20s.mp4) · [2-minute demo](docs/media/spreadbounty-demo-2m.mp4)

![One screen, two payers](docs/media/launch.gif)
```
GitHub does not play repo-relative `.mp4` links inline. For an inline player, drag the MP4 into the README editor on github.com; GitHub then gives an inline `user-attachments` link.

## Badge
```markdown
![tests](https://img.shields.io/badge/tests-32%20passing-brightgreen)
![status](https://img.shields.io/badge/mainnet-read--only%20verified-blue)
```
