# Spreadbounty demo video: 2:00

**Story in one line:** the AUSD/USDC book on Monad is empty. A sponsor pays for depth, makers earn by resting good quotes, and nobody has to trust us: the browser recomputes every payout and catches a forged one.

The rendered cut is `docs/media/spreadbounty-demo-2m.mp4`. Its source is the HyperFrames project in `video/demo/`; the captions are burned in from the `CAPS` list in `video/demo/index.html`. This script matches that cut scene by scene.

**Honesty rule for every shot.** Judges have to be able to verify what we built, so each scene carries an on-screen label saying where its data comes from:
- **LIVE · Monad mainnet (read-only)**: a read of mainnet state or logs. Nothing is sent.
- **MAINNET LOGS · SHADOW CAMPAIGN · NOTHING PAID**: real Kuru logs scored as if a campaign had run. Amounts are what makers *would have earned*.
- **DEMO DATA (synthetic)**: the app's labelled dataset.
- **DEMO DATA · bot in paper mode**: the bot decides orders but sends nothing.
- **LOCAL TEST CHAIN (1337)**: the claim-contract tests on an in-process chain.

Never cut a demo-data shot so it looks like mainnet, and never call a shadow amount "paid". The data chip in the app's top bar must stay in frame. Nothing in this video is live trading, a payment or a distributor on Monad: those are still pending, and the closing card says so.

---

## How the cut is made

Every app screen is a real capture of the running app, taken by `video/capture/capture.mjs` (clicks only, as a user would). No model runs in this take.

```bash
cd spreadbounty && npm install && npm run build:web && npm run demo:gen
# demo instance (synthetic data)
env -u TYPESAFE_API_KEY -u ANTHROPIC_API_KEY -u OPENAI_API_KEY AI_PROVIDER=off PORT=18951 npm run serve
# shadow instance (real MON/USDC mainnet logs, nothing paid); its book needs ~6 s on first load
env -u TYPESAFE_API_KEY -u ANTHROPIC_API_KEY -u OPENAI_API_KEY DATA_SOURCE=live DATA_DIR=data/shadow AI_PROVIDER=off PORT=18952 npm run serve

# from the repo root, with HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_TELEMETRY=1
node video/capture/capture.mjs demo      # Start, Verify (honest and forged), Make markets, Claim, Design
node video/capture/capture.mjs shadow    # shadow Overview, and Design on live mainnet logs
video/sync.sh
cd video/demo && npx hyperframes check && npx hyperframes render --crf 25 --output ../../spreadbounty/docs/media/spreadbounty-demo-2m.mp4
```

---

## The script

| Time | Screen | Voice-over (burned-in captions) | Label |
|---|---|---|---|
| **0:00–0:12** | Terminal: `npm run sb -- market AUSD/USDC`. The JSON prints; `"bestBid": null`, `"bestAsk": null` and `"spreadBps": null` are highlighted. | "This is AUSD/USDC on Kuru, Monad's on-chain order book, read live from mainnet. No bids. No asks. A stablecoin with no book." | LIVE · Monad mainnet (read-only) |
| **0:12–0:22** | The one-liner, then the wordmark. | "Issuers pay for depth through private deals they can't check. Spreadbounty pays any maker for tight, two-sided quotes, and anyone can recompute every payout from Kuru's public logs." | none (no data) |
| **0:22–0:35** | **Design** on the demo instance. The first example sentence is in the box; click **Design campaign**. The tape prints each finished step, then **Recommended**: 9 bps band, 20-block rest, 100% two-sided, 2.08 USDC per epoch. The chip reads "Writer: none". | "A sponsor types what they want. Rules read it into five fields. No model is running in this take. Code replays the book and backtests settings with the real scorer. With a model on, any number it can't trace is rejected." | DEMO DATA (synthetic) |
| **0:35–0:40** | **Design** on the shadow instance, example "Deepen MON/USDC within 0.25%, about $700 a week". The page's own chip reads "Monad mainnet · read-only": 107,682 order logs, 2 makers in the last 3 hours, 25 bps band picked. | "The same copilot, read-only on Monad mainnet: the last three hours of real MON/USDC logs, replayed." | LIVE · Monad mainnet (read-only) |
| **0:40–0:55** | **Overview** of the shadow campaign: MON/USDC, two-sided within 25 bps of mid, 66.7% of 6 samples in epoch 2. Scroll to the depth, cost and "would have paid" figures, then to **Who would have earned what**. The one maker's row is boxed: Orders shows a dash, 10.00 would have earned. | "A shadow campaign: real MON/USDC logs from Monad mainnet, scored as if a campaign had run. Epoch 2: two-sided within 25 bps in 66.7% of 6 samples, 3,116 USDC of depth on the thinner side. One maker would have earned all 10 USDC of the hypothetical budget. Nothing was paid." | MAINNET LOGS · SHADOW CAMPAIGN · NOTHING PAID |
| **0:55–1:10** | **Make markets → Rest clock**: one placed quote rests while the sample block lands. Click **Backtest**: the reference bot earns 2.28 with 2 transactions; requoting every 40 blocks earns 1.58 with 860. Then the terminal: the bot in paper mode, `would: bid … (post-only)` and `would: ask … (post-only)`. | "An order counts only after it rests 20 blocks. Every requote starts the count again. So the bot leaves good orders alone: same size, 2 transactions instead of 860, and more reward. Makers run our open-source bot. Paper mode: nothing is sent." | DEMO DATA · bot in paper mode |
| **1:10–1:30** | **Verify**. Click **Recompute in this browser**: the tape prints the epoch files, the campaign terms read from this server's files, the order logs, the block hashes and each epoch, and the stamp reads **Verified**: "Once the sponsor publishes this root, makers can claim against it." Tick **Forge a payout** and recompute: the tape prints `mismatch amounts, cumulative, root`, the recomputed root shows its red diff, and the stamp reads **Exception · do not pay**. | "Now the point. Your browser downloads the logs and recomputes every epoch: verified. Here's a forged payout: one extra token, with a perfectly valid Merkle root. Recompute: mismatch. Nobody has to trust us." | DEMO DATA (synthetic) |
| **1:30–1:40** | The committed report `day0/spreadbounty/reports/2026-10-11-check-MON-USDC.json`: `[PASS] 5 replay vs s_orders … 8/8 match s_orders` and `[PASS] 6 root determinism`, with root A equal to root B. | "On Monad mainnet, read-only: 8 of 8 live orders matched the contract's own state in a 6,602-log MON/USDC replay. Two independent replays produced the same payout root. A re-run for this video matched 8 of 8 again." The re-run is `reports/2026-10-12-check-MON-USDC.json`. | LIVE · Monad mainnet (read-only) |
| **1:40–1:51** | **Claim** on the demo instance: Maker A1's 14.98 USDC running total, the proof checked by the browser, and the exact `claim(...)` call. **Claim with wallet** is disabled: "No distributor deployed for this demo campaign". Then the terminal: an excerpt of `npm run test:drop`, ending "7 tests passed". | "Makers would claim from 1inch's Merkle distributor, unmodified, which the sponsor owns and funds. We never hold the money. In tests on a local chain, four makers claimed exactly their totals." | DEMO DATA (synthetic), then LOCAL TEST CHAIN (1337) for the tests |
| **1:51–2:00** | Closing card: "Depth you can verify, on Monad.", the repo URL, and **Status, plainly**: "Read-only mainnet checks done; live orders, a live epoch and the distributor on Monad are pending." Then `npm run test:all → 94 checks pass` and the install command. | "Spreadbounty. Depth you can verify, on Monad." | none (no data) |

**If you re-shoot a scene:**
- **The rest clock lands its sample at a different block.** Either outcome is fine (the quote rested and scores, or it was sampled early and earns nothing). Keep the caption about the 20-block rule.
- **The shadow Design run is slow or the RPC is rate-limited.** Re-run it. Don't swap in a demo shot for a mainnet scene.
- **Any number on screen changes.** Update the caption and this table to the new number; captions only state what the shot shows.

---

## Upgrade shots once the live Day-0 test runs

Each of these replaces a demo-data or shadow shot with live mainnet evidence. Use a throwaway wallet with small funds.

| Replace | With |
|---|---|
| 0:00–0:12 hook | Keep it, then add 6 s: `cd ../day0/spreadbounty && npm run full -- --yes`. Show the maker's two post-only orders resting and the taker swap filling, with tx hashes. Then `npm run sb -- market AUSD/USDC` again: the bid and ask are present. Label: **LIVE · Monad mainnet**. |
| 0:55–1:10 bot | `npm run bot -- run out/campaign-<id>.json --size 50 --live --yes` with `BOT_KEY` set. Show one placed order with its tx hash. |
| 1:10–1:30 verify | After a live epoch closes: `npm run sb -- epoch out/campaign-<id>.json 0`, then `npm run sb -- verify out/<id>/epoch-0.json`, which says "VERIFIED … recomputed from N logs" against the Monad RPC. Keep the forged-payout browser shot after it. |
| 1:40–1:51 claim | `npm run drop -- deploy` and `publish` on Monad (chain 143) with the sponsor key. Claim one maker's payout and show the explorer transaction. |

## Before publishing

- Keep the burned-in captions (VCs often watch muted) and the source labels on screen.
- Check the final cut is 2:00 or less and under 25 MB, and that no frame shows a private key, `.env` or a wallet balance you don't want public.
- Upload unlisted, and put the link in the project profile alongside the repo and write-up.
