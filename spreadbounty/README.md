# spreadbounty

Verifiable maker-depth incentives for Kuru order books on Monad. **What it is and why:** [PRODUCT.md](PRODUCT.md).

```bash
cd spreadbounty && npm install
npm test                                   # offline: 8 tests (replay, scoring, epoch build/verify, tamper detection, analytics)

npm run sb -- market AUSD/USDC             # live market facts (needs Monad RPC; no keys)

# AI campaign copilot (needs ANTHROPIC_API_KEY, or `ant auth login`)
npm run sb -- copilot "Agora wants AUSD/USDC two-sided within 15 bps of 1.0 for \$50/day, hourly epochs"

npm run sb -- epoch out/campaign-<id>.json 0        # after epoch 0 ends
npm run sb -- verify out/<id>/epoch-0.json          # anyone: recompute from chain and compare
npm run sb -- report out/<id>/epoch-0.json          # AI sponsor report from the verified numbers
```

Layout:
- `src/core/`: deterministic, no AI.
  - `book.ts`: log decode and replay
  - `score.ts`: sampling, scoring and the 1inch-format Merkle tree
  - `epoch.ts`: epoch files, build, verify and metrics
  - `analytics.ts`: history stats and backtests
  - `fetch.ts`: chain reads
- `src/ai/`: `copilot.ts` (Claude tool runner over the core's analytics) and `report.ts` (sponsor report).
- `src/cli/main.ts`: the `sb` command.

The Day-0 go/no-go test lives in [`../day0/spreadbounty`](../day0/spreadbounty).
