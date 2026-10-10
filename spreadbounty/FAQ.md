# Spreadbounty: questions judges ask

Each answer gives the claim, where to check it, and the limit we know of.

**1. What is new? Polymarket already pays makers this way.**
The scoring is Polymarket's liquidity-rewards formula, and random per-minute snapshots go back to Hummingbot's liquidity mining. Both score off-chain, so participants trust the operator. Spreadbounty scores from public Kuru logs, so anyone can recompute every payout, in a browser.
*Check:* the Verify page, `npm run sb -- verify`, and `test/core.test.ts`, where tampering is detected.

**2. Who do I have to trust?**
Only the distributor's owner: the unmodified 1inch `CumulativeMerkleDrop` lets its owner set any root. So the sponsor owns it, ideally through a multisig, and funds one epoch at a time. Our publisher refuses any root it can't recompute from the logs, any root that doesn't chain from the one on-chain, and any root the contract can't fully pay.
*Check:* `src/drop/drop.ts` (`checkPublish`) and `test/drop.test.ts`.
*Limit:* someone who publishes with their own tools bypasses those checks. That is why makers can verify a root before claiming.

**3. Can it be gamed?**
- **Spoofing:** samples land at a block chosen by a later block's hash, and an order counts only after resting 20 blocks (~6 s). A maker has to quote continuously to be sure of scoring.
- **Sybils:** payouts are pro-rata by size, so splitting across wallets earns nothing extra.
- **Self-quoting:** depth inside the band is real liquidity whoever posts it, and anyone can trade against it.
- *Limit:* a block producer could in principle bias which block gets sampled. We haven't measured that.

**4. Liquid books already have pros quoting at 4–12 bps. Won't rewards just go to them?**
On majors, largely yes. A third-party Kuru scan (a market-making retrospective, Sep–Oct 2026) put MON/USDC at 12.4 bps, with its fastest maker updating 288 times a minute. We start on thin books instead: the official AUSD/USDC market had no resting orders when we checked on Oct 9. The 20-block rest rule rewards orders that stay put, not requote speed.

**5. Why would a sponsor pay?**
Sponsors already pay for depth, through market-maker retainers and incentive programs, and can't check what they got. This makes that spend checkable. We have no signed sponsor; the ask is a one-week pilot.

**6. What is live on Monad mainnet?**
- **Done:** read-only checks against Kuru. The market's identity and implementation were confirmed, and in a 7,332-log replay 8 of 8 checked orders matched the contract's own state.
- **Pending:** live maker and taker orders, a closed live epoch, and a distributor deployed on Monad. [Live transaction hashes go here once they exist.]

All app screenshots and the bot backtest use a labelled **synthetic** dataset.

**7. How can I verify the claims in five minutes?**
`cd spreadbounty && npm install`, then:
- `npm test`, `npm run test:ai`, `npm run test:bot` and `npm run test:drop`: 32 tests.
- `npm start`, then open the Verify page and turn on "Try a forged payout".

`test:drop` deploys the real 1inch contract on a local EVM. Four makers claim exactly their totals with our proofs.

**8. Where does AI fit, and where doesn't it?**
A model reads the sponsor's sentence into five fields and explains numbers the code computed. Any number it invents is caught and replaced with template text. It runs on Claude, a local model, or no model. It never touches scoring, payouts or verification.
*Check:* `src/ai/grounding.ts` and `test/ai.test.ts`.

**9. How is this different from Covenant or Merkl?**
As we read their READMEs, the Covenant projects on Kuru have an issuer hire one market maker through a vault or escrow. Spreadbounty pays an open crowd of makers, with no loan and recomputable payouts. Merkl pays pools and vaults; we found no order-book campaign type.

**10. Why Monad?**
Kuru's order events name the order's owner, which makes per-maker scoring possible from logs alone. Blocks every ~300 ms make once-a-minute sampling at an unpredictable block practical.

**11. What would make this fail?**
- No makers besides us show up.
- Sponsors keep paying for depth through private deals.
- Kuru changes its contracts. Our decoder is pinned to the checked implementation and refuses any other.

The pilot tests the first two.

---
Code and history: `spreadbounty/`, all written Oct 8–10, 2026. Full write-up: `WRITEUP.md`.
