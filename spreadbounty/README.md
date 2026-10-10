# spreadbounty

Verifiable maker-depth incentives for Kuru order books on Monad. **What it is and why:** [PRODUCT.md](PRODUCT.md).

![Overview](docs/screenshots/overview-light.png)

## Run it

```bash
cd spreadbounty && npm install
npm start                      # demo data + build + server -> http://localhost:8787
```

`npm start` runs on a **labelled synthetic dataset** (`src/demo/generate.ts`, deterministic): two markets, five makers, three closed epochs. One of the makers flickers its quotes and earns nothing. The top bar always says which data you're looking at.

For mainnet, use `DATA_SOURCE=live npm run serve`. It reads Kuru over `RPC_URL`, which defaults to the public Monad RPC.

For UI work, run `npm run serve` in one terminal and `npm run dev` in another. That starts Vite on :5173 with hot reload and proxies `/api` to :8787.

## Pick the AI model (or none)

The app runs the same pipeline with any of three backends. The model never decides payouts: it reads the sponsor's sentence into a few fields and explains numbers the code computed.

| Backend | How | Notes |
|---|---|---|
| **Local model** | `AI_PROVIDER=local LOCAL_LLM_MODEL=<id> npm run serve` | Works with any OpenAI-compatible server. `LOCAL_LLM_URL` defaults to Ollama at `http://localhost:11434/v1`. |
| **Claude** | `ANTHROPIC_API_KEY=… npm run serve` | Uses `claude-opus-5-5` unless `CLAUDE_MODEL` is set. |
| **None** | `AI_PROVIDER=off npm run serve` | Rules parse the request; templates write the text. Every page still works. |

Local recipes:

```bash
# Ollama
ollama pull gemma3:4b            # or qwen2.5:7b, llama3.2:3b, minicpm-v
AI_PROVIDER=local LOCAL_LLM_MODEL=gemma3:4b npm start

# LM Studio (server tab -> start), llama.cpp `llama-server -m model.gguf --port 8080`, vLLM, or a DGX Spark box on your LAN
AI_PROVIDER=local LOCAL_LLM_URL=http://localhost:1234/v1 LOCAL_LLM_MODEL=<model id> npm start
# optional: LOCAL_LLM_KEY (LM Studio / vLLM with auth), LOCAL_LLM_TIMEOUT_MS (default 120000; slow CPUs need more)
```

Click the AI chip in the top bar and then **Test connection** to check that the model answers.

### What makes small models safe here

- **Schema output with fallbacks.** JSON output tries a JSON-schema grammar first, then JSON mode, then plain text. JSON is pulled out of prose or code fences, `<think>` blocks are stripped, and the result is validated with zod.
- **Your numbers win.** Explicit numbers in the sponsor's sentence ("$50/day", "15 bps") are read by rules and override the model.
- **Grounding guard.** Every number in model-written text must appear in the facts it was given. Otherwise the model gets one retry naming the bad numbers, and then the template is used. The UI shows which happened and which numbers were rejected.

`npm run mock:llm` starts a stand-in "weak local model" on :11999 that invents numbers on its first draft, so you can watch the guard work without a GPU:

```bash
npm run mock:llm &
AI_PROVIDER=local LOCAL_LLM_URL=http://localhost:11999/v1 LOCAL_LLM_MODEL=mock npm start
```

## The app

| Page | What it does |
|---|---|
| **Overview** | Coverage, depth, cost per $1k and makers paid per epoch, with deltas. Also shows depth inside the band over time, the live book ladder with the reward band shaded, who earned what (including makers who quoted but didn't qualify), and the AI epoch report with its provenance. |
| **Design a campaign** | You type a sentence and steps stream in: intent, market, history replay, backtest, brief. You get a recommended setting, all candidates (chart or table), the brief with its grounding badge, and **Publish**. |
| **Make markets** | Backtests the maker bot against a naive timer requoter and a lazy edge quoter on any closed epoch, scored by the real epoch builder. It shows the payout per epoch, the depth the quotes add, and copy-paste commands to run the bot. |
| **Verify** | Your browser downloads the logs and re-runs the production scorer for every epoch, then compares Merkle roots. **Try a forged payout** tampers with the file and re-roots it consistently, and the check still catches it. |
| **Claim** | Look up any maker. The page shows the cumulative amount and the Merkle proof (re-checked in the browser) plus the exact `claim(...)` calldata for a 1inch `CumulativeMerkleDrop`. |

Light and dark themes are supported. All motion uses `motion` and respects reduced-motion settings.

## Maker bot

The bot is a reference maker for any campaign. It quotes both sides about 35% into the band. It leaves resting orders alone, because every requote restarts the minimum-rest clock, and requotes only when an order drifts toward the band edge or away from its target. Orders are post-only. There is an inventory cap per side, a peg guard that pulls all quotes when a stablecoin's book leaves its reference, and Ctrl-C cancels everything. There is no AI in the loop.

```bash
npm run bot -- sim  out/demo/campaign-ausd-usdc-demo.json --epoch 2 --size 2000   # backtest: bot vs naive vs lazy
npm run bot -- plan out/campaign-<id>.json --size 100                             # one read-only tick on mainnet
npm run bot -- run  out/campaign-<id>.json --size 100                             # paper loop: decides, sends nothing
npm run bot -- deposit out/campaign-<id>.json --base 100 --quote 100 --yes        # fund the Kuru margin account
npm run bot -- run  out/campaign-<id>.json --size 100 --live --yes                # live
npm run bot -- cancel-all out/campaign-<id>.json --yes
```

Live trading needs `BOT_KEY` in `.env`. It must be a **fresh throwaway wallet** holding only what you can lose. Orders worth more than `BOT_MAX_ORDER_QUOTE` (default 100 in quote units) are refused. Every transaction is simulated with `eth_call` before it is sent. The bot refuses to quote if the market's implementation differs from the campaign file. It never deposits on its own.

On demo epoch 2 with 2,000 AUSD per side:

| Strategy | Payout | Transactions |
|---|---|---|
| Bot | 2.28 USDC | 2 |
| Requote every 40 blocks | 1.58 USDC | 860 |
| Quote at the band edge | 0.07 USDC | 2 |

The fill model is simple and gas is not counted.

`npm run fakechain` serves the demo dataset as a read-only Monad JSON-RPC on :8546, so `RPC_URL=http://127.0.0.1:8546 npm run bot -- plan|run ...` exercises the live code path offline.

## CLI

```bash
npm test                                   # 8 core tests: replay, scoring, epoch build/verify, tamper detection, analytics
npm run test:ai                            # 7 AI-harness tests against a mock weak local model (needs npm run demo:gen)
npm run test:bot                           # 10 maker-bot tests: strategy rules, backtests, live runner on the fake RPC
npm run typecheck

npm run sb -- market AUSD/USDC             # live market facts (Monad RPC; no keys)
npm run sb -- copilot "Agora wants AUSD/USDC within 15 bps of 1.0, \$50/day, hourly"   # any backend, or none
npm run sb -- copilot "..." --agent        # Claude-only tool-calling variant
npm run sb -- epoch out/campaign-<id>.json 0        # after epoch 0 ends
npm run sb -- verify out/<id>/epoch-0.json          # anyone: recompute from chain and compare
npm run sb -- report out/<id>/epoch-0.json          # sponsor report from the verified numbers
```

## Layout

- `src/core/`: deterministic code with no AI. The CLI, the server and the browser all share it.
  - `book.ts`: decodes and replays order-book logs.
  - `score.ts`: sampling, scoring and the 1inch-format Merkle tree.
  - `epoch.ts`: epoch files, build, verify and metrics.
  - `analytics.ts`: history stats and backtests.
  - `fetch.ts`: chain reads.
- `src/ai/`:
  - `llm.ts`: one interface over Claude, local OpenAI-compatible servers, or none.
  - `pipeline.ts`: the copilot.
  - `report.ts`: epoch reports.
  - `grounding.ts`: the number checker.
  - `copilot.ts`: the Claude tool-runner agent.
- `src/bot/`:
  - `strategy.ts`: pure `decide()`.
  - `sim.ts`: backtest scored by `buildEpoch`.
  - `live.ts`: Kuru runner.
  - `main.ts`: the `bot` CLI.
- `src/data/source.ts`: live RPC or the demo dataset. `src/demo/generate.ts` builds the demo dataset.
- `src/server/index.ts`: the JSON API plus the built web app (node:http, no framework).
- `web/`: Vite + React 19 + motion. The pages import `../src/core` directly, so in-browser verification runs the same code.

The Day-0 go/no-go test lives in [`../day0/spreadbounty`](../day0/spreadbounty).
