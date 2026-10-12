# Spreadbounty — Day-0 go/no-go test

This test decides whether to build Spreadbounty. It checks, on Monad mainnet, everything the demo depends on:

- An outside maker can rest a quote on a Kuru order book.
- A taker's fill against that quote is attributed to the maker on-chain.
- Rebuilding the book from public logs matches contract state.
- Two independent replays give the same payout root.

The plan and the reasoning behind the test are in [`ideas/metropolis-opus-sonnet.md`](../../ideas/metropolis-opus-sonnet.md).

> **Status (Oct 11, 2026).** The read-only steps (`npm run check`) have run against Monad mainnet from a laptop: see `reports/`. On MON/USDC, 6,602 book logs replayed with 8/8 live orders matching `s_orders` and deterministic roots; the AUSD/USDC book was empty (0 logs). The **write** steps (resting a quote, a taker fill, publish and claim) have **not** run: they need funded throwaway wallets (`npm run full -- --yes`, about $25).

## Setup

```bash
cd day0/spreadbounty
npm install
npm run wallets           # creates .env with two fresh throwaway keys; prints ADDRESSES only. Never paste keys anywhere.
npm run selftest          # offline, should print "9 checks passed"
```

Fund the wallets. For the default AUSD/USDC market, the whole test costs about $25:

| Wallet | MON | Tokens |
|---|---|---|
| maker | ≥ 12 (about 10 is Monad's account reserve, the rest is gas) | ~12 AUSD + ~12 USDC |
| taker | ≥ 12 | ~6 USDC |

To get AUSD, swap a little USDC on LFJ or Skate.

On the MON/USDC fallback market, the maker also needs `ORDER_SIZE` MON on top of the reserve, and `minSize` may be large: one snippet says 200 MON, which is about $5–7.

## Run

```bash
npm run check                 # read-only, no keys needed: steps 1, 2, 5, 6
npm run full                  # dry run: prints the planned orders and swap, sends nothing
npm run full -- --yes         # sends mainnet txs: steps 1-7 (add --keep to leave margin funds deposited)

MARKET=0x065C9d28E428A0db40191a54d33d5b7c71a9C394 REF_PRICE= npm run check   # MON/USDC: replay against real makers
```

Every run writes `day0-report-<mode>-<ts>.json` with each step's result and every transaction hash.

## What each step proves

| Step | Check | Pass rule |
|---|---|---|
| 1b | `Router.verifiedMarket` and `MarginAccount.verifiedMarket` for the market | Both true. This proves `0x8cF49e…` is an official Kuru market, which the sponsor judge doubted. |
| 1d | Tick size in bps at the reference price | ≤ 5 bps, so a ±5 bps quote fits inside a ±15 bps campaign band |
| 2 | EIP-1967 implementation slot | Equals `0x5e34…99a0` (live on mainnet, equal to `Router.orderBookImplementation`). A WARN means the event decoder may not match: re-check the ABI before building. |
| 3 | Maker deposits, then posts a post-only bid and ask | Two `OrderCreated` logs with `owner` = maker, and `s_orders` agrees. `MarketStateError` means the book is disabled. |
| 4 | Taker swaps USDC→AUSD through `Router.anyToAnySwap` | A `Trade` log on our order id with `makerAddress` = maker and `txOrigin` = taker |
| 5 | Replay the book from logs (last `LOOKBACK_BLOCKS`) and compare with `s_orders` at the same block | ≥ 95% of up to 30 live orders match (owner, size, price, side). This also validates the assumption that `Trade.updatedSize` is the remaining size. |
| 6 | Fetch the logs twice (100-block and 50-block chunks), sample about 1 block a minute from block hashes, score, build a Merkle tree in the 1inch `CumulativeMerkleDrop` format | Identical roots. In full mode the maker's leaf proof also verifies. |
| 7 | Cancel leftover maker orders and withdraw margin | Informational |

## Decision

- **GO, build Spreadbounty:** `full` passes on AUSD/USDC. Passing on MON/USDC is also a GO; then use the "fills $1K, fails $5K" depth story for the demo instead of the empty stable book.
- **NO-GO, build Paylink:** steps 3–4 fail on **both** AUSD/USDC and MON/USDC, or step 6 roots differ.
- **Investigate, don't kill:** step 5 below 95%. Read the mismatches the script prints. The usual cause is an event the replay doesn't handle yet, which is a fix rather than a blocker.

## Known assumptions this test exists to settle

- `bestBidAsk()` is treated as 1e18-scaled. It is only used to centre quotes on a live book; the AUSD run uses `REF_PRICE=1.0`.
- `Trade.updatedSize` is the maker order's remaining size; step 5 checks this against contract state.
- The fork study (Karrenbelt/perpl_basis_trade) found `0x8cF49e…` enabled but empty, and the CSV's AUSD/USDC books disabled. Step 3 confirms or refutes this on today's chain.
- Kuru's AMM vault places no order logs, so any vault fills appear as `Trade` events on order ids the replay doesn't know, and are ignored. Step 1e reports whether a vault exists on the market.

## Files

- `src/day0.ts`: the go/no-go runner
- `src/book.ts`: decodes Kuru OrderBook logs and replays them into a book with snapshots
- `src/score.ts`: block-hash sampling, Polymarket-style two-sided score (integer maths), 1inch-compatible Merkle tree and proofs. This is the start of the real scorer.
- `src/abi.ts`: minimal ABIs, checked against `@kuru-labs/kuru-sdk` 0.0.95 by `test/selftest.ts`
- `src/config.ts`: mainnet addresses (from the monad-crypto/protocols CSV and the kuru-sdk-py constants) and env settings
