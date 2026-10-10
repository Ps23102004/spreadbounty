# Spreadbounty demo video: 2:00

**Story in one line:** the AUSD/USDC book on Monad is empty. A sponsor pays for depth, makers earn by resting good quotes, and nobody has to trust us: the browser recomputes every payout and catches a forged one.

**Honesty rule for every shot.** Judges have to be able to verify what we built, so each scene carries an on-screen label saying where its data comes from:
- **LIVE · Monad mainnet (read-only)**
- **DEMO DATA (synthetic)**: the app's labelled dataset
- **LOCAL TEST CHAIN (1337)**

Never cut a demo-data shot so it looks like mainnet. The data chip in the app's top bar must stay in frame.

This script works **today**. Once the live Day-0 test has run, swap in the upgrade shots at the end and the video gets much stronger.

---

## Prep (about 20 minutes, the day before)

```bash
cd ~/hackathons-fall-2026/spreadbounty && git pull && npm install
ollama pull gemma3:4b                      # optional: so the AI chip reads "Local · gemma3:4b"
```

Four terminals:

```bash
# T1: local chain for the claim scene. Note the tUSDC address it prints.
npm run localchain

# T2: distributor on the local chain, funded and with epoch 2 published.
#     The key is ganache's public deterministic dev key #0: a test key only, never use it on Monad.
npm run demo:gen
rm -f out/demo/ausd-usdc-demo/drop.json    # needed after every localchain restart (the chain is in memory)
export RPC_URL=http://127.0.0.1:8545 SPONSOR_KEY=0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d
npm run drop -- deploy  out/demo/campaign-ausd-usdc-demo.json --allow-chain 1337 --token <tUSDC address> --yes
npm run drop -- publish out/demo/ausd-usdc-demo/epoch-2.json --allow-chain 1337 --fund --yes
npm run drop -- claim   out/demo/ausd-usdc-demo/epoch-2.json --allow-chain 1337 --account 0xde000000000000000000000000000000000000b2 --yes
unset RPC_URL SPONSOR_KEY
#     (B2 is claimed in advance so the Claim page can show both states: A1 claimable, B2 already paid)

# T3: the app. Without Ollama, use AI_PROVIDER=off and the chip reads "AI off · templates".
AI_PROVIDER=local LOCAL_LLM_MODEL=gemma3:4b npm start      # http://localhost:8787

# T4: the bot shot (paper mode on a replay of the demo chain; nothing is sent)
npm run fakechain
```

The demo dataset is deterministic, so `npm start` regenerating it keeps the same epoch roots, and the published root still matches.

**Screen set-up:**
- Record at 1920×1080 with browser zoom at 110–125%.
- Terminal font at 18–20 pt, on a dark theme.
- Hide bookmarks and extensions.
- Turn OS reduced motion OFF, so the charts animate.
- Close `.env` and any window that shows a key.
- Warm the local model with one copilot run before recording; the first run on a CPU is slow.

---

## The script

About 220 words of voice-over at a calm 140 wpm, plus pauses for the clicks, comes to 2:00. Record each scene as its own take.

| Time | Screen | Voice-over | Label |
|---|---|---|---|
| **0:00–0:12** | T4 terminal (or any): `npm run sb -- market AUSD/USDC`. Zoom on `"bestBid": null, "bestAsk": null, "spreadBps": null`. | "This is AUSD/USDC on Kuru, Monad's on-chain order book, read live from mainnet. No bids. No asks. A stablecoin with no book." | LIVE · Monad mainnet (read-only) |
| **0:12–0:24** | Deck slide 4 (the one-liner), or the app's Overview with the title in view. | "Issuers pay for depth through private deals they can't check. Spreadbounty pays any maker for tight, two-sided quotes, and anyone can recompute every payout from Kuru's public logs." | — |
| **0:24–0:45** | App → **Design a campaign**. Click the first example chip, then **Design campaign**. The steps stream in; the recommendation and brief appear. Hover the badge "Every number matched…", then click **Publish**. | "A sponsor types what they want. A local model reads the request. The code replays the book and backtests settings with the real scorer. Every number the model writes is checked, so it can't invent a result." | DEMO DATA (synthetic) |
| **0:45–1:02** | **Overview**. Count-up on 100%, hover the depth chart, then move to the payouts table and point at **Maker E5** (38 orders, nothing earned). | "Every hour is an epoch. The sponsor sees coverage, depth inside the band and cost per thousand dollars of depth. This maker placed thirty-eight orders and earned nothing: its quotes flickered and never rested twenty blocks." | DEMO DATA (synthetic) |
| **1:02–1:20** | **Make markets**: the bars show 2.28 vs 1.58 vs 0.07. Quick cut to T4: `RPC_URL=http://127.0.0.1:8546 npm run bot -- run out/demo/campaign-ausd-usdc-demo.json --size 1000` with a few ticks of "would: bid … (post-only)". | "Makers run our open-source bot. It quotes both sides and leaves good orders alone, because every requote resets the clock. Same size, two transactions instead of eight hundred sixty, and more reward." | DEMO DATA · bot in paper mode |
| **1:20–1:42** | **Verify**. Click **Recompute in this browser**: the steps tick and the stamp reads **Verified**. Flip **Try a forged payout**, recompute again: **Mismatch: do not pay**, with the red root diff. | "Now the point. My browser downloads the logs and recomputes every epoch: verified. Here's a forged payout. One extra token, with a perfectly valid Merkle root. Recompute: mismatch. Nobody has to trust us." | DEMO DATA (synthetic) |
| **1:42–1:55** | **Claim**. Click the **Maker A1** chip to show the distributor, "This epoch's root is live" and 14.98 claimable. Click **Maker B2**: claimed 11.84, "Nothing left to claim". | "Makers claim from 1inch's Merkle distributor, unmodified, which the sponsor owns and funds. We never hold the money." | LOCAL TEST CHAIN (1337) |
| **1:55–2:00** | Deck slide 15 (the ask), or the Spreadbounty wordmark. | "Spreadbounty. Depth you can verify, on Monad." | — |

**If you have MetaMask:**
1. Add network `http://127.0.0.1:8545` (chain id 1337).
2. Import a ganache dev account (any except #0).
3. In the Claim scene, click **Claim with wallet** for A1 instead of only showing it.

The click proves the wallet path. Otherwise, keep B2's "already claimed" state as the proof.

**If something fails on camera:**
- **The copilot hangs on a slow local model.** Cut to a take recorded with `AI_PROVIDER=off`. The steps and recommendation are identical, because code makes them.
- **`sb market` can't reach the RPC.** Re-record. Don't swap in a demo shot for the mainnet scene.

---

## Upgrade shots once the live Day-0 test runs

Each of these replaces a demo-data shot with mainnet evidence. Use a throwaway wallet with small funds.

| Replace | With |
|---|---|
| 0:00–0:12 hook | Keep it, then add 6 s: `cd ../day0/spreadbounty && npm run full -- --yes`. Show the maker's two post-only orders resting and the taker swap filling, with tx hashes. Then `npm run sb -- market AUSD/USDC` again: the bid and ask are present. Label: **LIVE · Monad mainnet**. |
| 1:02–1:20 bot | `npm run bot -- run out/campaign-<id>.json --size 50 --live --yes` with `BOT_KEY` set. Show one placed order with its tx hash. |
| 1:20–1:42 verify | After an epoch closes: `npm run sb -- epoch out/campaign-<id>.json 0`, then `npm run sb -- verify out/<id>/epoch-0.json`, which says "VERIFIED … recomputed from N logs" against the Monad RPC. Keep the forged-payout browser shot after it. |
| 1:42–1:55 claim | `npm run drop -- deploy` and `publish` on Monad (chain 143) with the sponsor key. Claim one maker's payout and show the explorer transaction. |

## After recording

- Burn in captions (VCs often watch muted) and keep the source labels on screen.
- Upload unlisted, and put the link in the project profile alongside the repo and write-up.
- Check the final cut is 2:00 or less, and that no frame shows a private key, `.env` or a wallet balance you don't want public.
