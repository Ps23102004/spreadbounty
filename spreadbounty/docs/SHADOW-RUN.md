# Shadow run: a campaign scored on real MON/USDC logs

A shadow campaign is a campaign file back-dated onto the real Kuru MON/USDC book on Monad mainnet and scored
with the production epoch builder. **Nobody was paid and nobody knew the campaign existed.** The amounts below
show what makers *would have earned* under these rules with a hypothetical budget. Everything was read over the
public RPC: no keys, nothing signed, nothing sent.

Every number on this page was printed by the commands below on 2026-10-12 (UTC).

## Commands

```bash
cd spreadbounty

# 1. build it (read-only RPC, default https://rpc.monad.xyz; 100-block eth_getLogs requests)
npm run sb -- shadow MON/USDC                       # defaults: --epochs 3 --epoch-blocks 1200

# 2. check it from the chain alone (logs and block hashes over RPC, no server, no bundle)
npm run sb -- verify data/shadow/mon-usdc-shadow-112650356/epoch-2.json

# 3. rebuild the same files byte for byte (also restores the log bundles, which are not committed)
npm run sb -- shadow MON/USDC --head 112653966

# 4. serve it: Verify defaults to "Monad RPC, direct" for a shadow campaign
npm run build:web && DATA_SOURCE=live DATA_DIR=data/shadow npm run serve
```

## Output of the run

```
head block used: 112653966 (rerun with --head 112653966 for the same files)
fetching MON/USDC book logs 112650356..112653955 from https://rpc.monad.xyz (read-only, 100-block requests)
fetched 10609 logs
epoch 0 (112650356-112651555): 3642 logs, 6 samples, two-sided 100%, 1 makers would have earned 10 USDC, root 0xeab526e43952a2d437af68317f9f1995f2988127f706bd15798c8cb628bce8df
epoch 1 (112651556-112652755): 7292 logs, 6 samples, two-sided 67%, 1 makers would have earned 10 USDC, root 0x341ad1071fb87454d99a9d3b088ad43868d9cdb84c66d7118b106b0aa80488a0
epoch 2 (112652756-112653955): 10609 logs, 6 samples, two-sided 67%, 1 makers would have earned 10 USDC, root 0xdeebd5611caf07f979372b54105b8bf8ea3618435d303d0ccff2b04396ca2176
would have earned, cumulative over 3 epochs (nothing was paid):
  0xd0f8a6422ccdd812f29d8fb75cf5fcd41483badc  30.000000 USDC
```

The per-epoch log counts are cumulative from the campaign start (an epoch is rebuilt from every log since block
112650356). The CLI now prints them as "N logs since block 112650356"; the pinned re-run in step 3 printed the same
numbers and roots with that wording.

```
$ npm run sb -- verify data/shadow/mon-usdc-shadow-112650356/epoch-0.json
VERIFIED epoch 0: root 0xeab526e43952a2d437af68317f9f1995f2988127f706bd15798c8cb628bce8df recomputed from 3642 logs
$ npm run sb -- verify data/shadow/mon-usdc-shadow-112650356/epoch-1.json
VERIFIED epoch 1: root 0x341ad1071fb87454d99a9d3b088ad43868d9cdb84c66d7118b106b0aa80488a0 recomputed from 7292 logs
$ npm run sb -- verify data/shadow/mon-usdc-shadow-112650356/epoch-2.json
VERIFIED epoch 2: root 0xdeebd5611caf07f979372b54105b8bf8ea3618435d303d0ccff2b04396ca2176 recomputed from 10609 logs
```

The pinned re-run (`--head 112653966`) wrote a campaign file, three epoch files and the epoch-2 log bundle that are
byte-identical (`cmp`) to the first run.

## The campaign

| Field | Value |
|---|---|
| Market | MON/USDC, `0x065C9d28E428A0db40191a54d33d5b7c71a9C394` (Kuru-verified, implementation `0x5e3446c6…99a0`) |
| Head block used | 112,653,966 |
| Campaign start (`replayFromBlock`) | 112,650,356 = head − 3 × 1,200 − 10 |
| Window | blocks 112,650,356 to 112,653,955; block timestamps 03:42:46 to 04:00:52 UTC (about 18 minutes) |
| Epochs | 3 of 1,200 blocks (epoch 0 spans 362 seconds) |
| Band | ±25 bps of the maker-book mid (no reference price) |
| Minimum rest | 20 blocks |
| Sampling | one sample per 200 blocks, chosen by block hash: 6 per epoch |
| Budget | a hypothetical 10 USDC per epoch (the demo campaign's budget) |
| Sponsor | none (`0x000…000`) |

## Who would have earned what

Three addresses placed orders on the book in the window. One would have earned the whole budget.

| Maker | Orders created (epoch 0 / 1 / 2) | Would have earned | Why |
|---|---|---|---|
| `0xd0f8…badc` | 488 / 504 / 304 | 10 + 10 + 10 = **30 USDC** | the only maker with in-band orders that had rested 20 blocks at a sample block; 409 of its 1,276 cancelled orders had lived 20 blocks or more |
| `0x34ae…3fc5` | 1,526 / 1,522 / 1,481 | 0 | 4,529 orders cancelled in the window; median life 0 blocks (cancelled in the block it was placed); none rested 20 blocks |
| `0x8cf6…866f` | 7 / 4 / 2 | 0 | 9 orders cancelled; median life 3 blocks; none rested 20 blocks |

Order counts come from the OrderCreated logs in each epoch's block range; lifetimes from creation to cancellation
for orders created and cancelled inside the window (log bundle `epoch-2.logs.json`). Addresses are public on chain;
we do not know who runs them.

| Epoch | Logs in epoch | Samples with a price | Two-sided coverage | Avg two-sided in-band depth | Makers who would have earned |
|---|---|---|---|---|---|
| 0 | 3,642 | 5 of 6 | 100% | 3,852 USDC | 1 |
| 1 | 3,650 | 6 of 6 | 67% | 3,109 USDC | 1 |
| 2 | 3,317 | 6 of 6 | 67% | 3,116 USDC | 1 |

## Verified in a browser, straight from the RPC

With `DATA_SOURCE=live DATA_DIR=data/shadow` on port 18823, the Verify page showed the label
`MAINNET LOGS · SHADOW CAMPAIGN · NOTHING PAID`, defaulted to "Monad RPC, direct" and printed on the tape:
3 epoch files downloaded, 10,609 order logs from rpc.monad.xyz direct, block hashes from rpc.monad.xyz, 6 samples
and 1 paid in each of epochs 0 to 2, root `0xdeeb…2176`, then the VERIFIED stamp (the math took 3,631 ms on the
first run). The Network panel showed 54 POST requests to `https://rpc.monad.xyz/`, one of them inspected as
`eth_getLogs` over `0x6b6ea04`..`0x6b6ea67` (100 blocks), and no request for the server's log bundle.
Screenshot: `docs/screenshots/redesign/sb-verify-rpc-direct.png`.

Failure path, checked against a local test proxy that answered every `eth_getLogs` with HTTP 503 and passed other
calls to rpc.monad.xyz: the tape printed each failing request (`eth_getLogs 127.0.0.1:18824 blocks …–… failed`)
while backing off, then a red line naming the request that finally failed, and an alert offering the server bundle
("logs come from this server's bundle; run `sb verify` for a chain-only check"). Retry read the bundle, printed
that note on the tape and reached VERIFIED.

## Limitations, plainly

- **Nothing was paid.** This is a back-dated campaign on a real book. Makers did not know about it, so it shows
  what the rules would have paid for behaviour that happened anyway, not how makers would behave under a live
  campaign.
- **The budget is made up.** 10 USDC per epoch is a placeholder; amounts scale linearly with it.
- **Short and coarse.** 18 minutes, 6 samples per epoch. One maker took 100% of every epoch; a longer run or
  denser sampling could change shares.
- **The book starts empty.** Campaign rules count only orders created at or after the start block, so the first
  sample (block 112,650,359, three blocks in) had no price.
- **Log bundles are not committed.** They are 2.5, 5.1 and 7.3 MB for epochs 0 to 2. A fresh clone serves the
  epoch files fine and Verify reads logs from the RPC; the server-bundle fallback and the "makers seen" list need
  the bundles, which step 3 rebuilds byte for byte.
- **Reproducible while the RPC serves these blocks.** Re-running with `--head 112653966` needs an RPC that still
  returns logs and block hashes for blocks 112,650,356 to 112,653,955. The `implementation` field is read at the
  latest block, so a future Kuru upgrade would change that one field.
- **One RPC.** Logs and block hashes both come from `rpc.monad.xyz`. For a check that trusts no single provider,
  run `sb verify` with `RPC_URL` pointing at your own node.
