# spreadbounty

Verifiable maker-depth incentives for Kuru order books on Monad. **What it is and why:** [PRODUCT.md](PRODUCT.md).

![Spreadbounty](docs/media/hero.png)

[20-second launch video](docs/media/spreadbounty-launch-20s.mp4) · [2-minute demo](docs/media/spreadbounty-demo-2m.mp4) · [launch copy](docs/LAUNCH.md)

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

**Or bring your own model, in the browser.** The AI chip in the top bar picks the Writer: None, This server, Anthropic, OpenAI, Google Gemini, OpenRouter, or Local (Ollama, LM Studio, llama.cpp, vLLM). Model calls go straight from your tab to that provider. This server only runs the backtest, and the same grounding guard checks the browser's text.

**What has actually run** (Oct 11, demo data; times and outcomes in [docs/AI-RUNS.md](docs/AI-RUNS.md)):
- `gemma4:e4b-it-qat` through Ollama, as `AI_PROVIDER=local` and as the browser Writer (Local), for a copilot design and an epoch report. Intent and text were written by the model and passed the number check on the first try. In the browser run, the decision model then sent the report back to the template because of one advice sentence. Each step took about 33 to 49 s on a laptop.
- TypeSafe Jev (`jev-1.13.0`) as the decision model; see below.

The other providers in the picker are covered by tests with stand-ins (`test/byo.test.ts`); docs/AI-RUNS.md records no live run of them.

Local recipes:

```bash
# Ollama
ollama pull gemma4:e4b-it-qat    # the model in docs/AI-RUNS.md; any Ollama chat model id can be set
AI_PROVIDER=local LOCAL_LLM_MODEL=gemma4:e4b-it-qat npm start

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

### Decision model (optional): TypeSafe Jev

A second, different kind of model can check the words. Set `TYPESAFE_API_KEY` on the server, and Design and the epoch report ask Jev, TypeSafe's System One model, for typed, calibrated judgments:

- **Which book?** A Choice between AUSD/USDC, MON/USDC and none. If the answer is "none" or its confidence is under 0.7, the page asks "Which book?" instead of defaulting.
- **Flags with fixed copy** (Nouls, raised at p ≥ 0.6). Volume: "This campaign pays for resting depth inside a band, not volume." Named makers: "Campaigns are open to every maker." Holding a price: "Depth rewards don't defend a peg." One side only: "One-sided quoting earns a third of the score."
- **Claims, not just numbers.** One Noul per sentence of a model-written brief or report: is it supported by the facts JSON? Any sentence under 0.5 switches the text to the template and is named.

The judge never changes a campaign, a candidate or a number (`test/judge.test.ts` checks that the campaign is byte-identical with and without it). With no key, an error or a timeout, the page behaves exactly as without it.

Measured once against the real Jev (`jev-1.13.0`) on a 12-request handwritten fixture: **59/60 judgments right, 11/12 requests fully right, median 138 ms per request**. The untuned first wording scored 58/60. The per-sentence check flagged 8/8 invented claims. Details, misses and caveats: [docs/JUDGE.md](docs/JUDGE.md). A local System One server (Von or Laya speaking `POST /v1/systemone`) can be used from the browser with no key, but only for the question types it answers correctly when probed. The one local server probed here, the Laya cascade proxy, answered none, so no local judge is claimed.

### Keys and security

- **Browser keys** stay in this tab's `sessionStorage`. They move to `localStorage` only if you tick "Remember on this device", and **Forget key** clears both. A key is sent only to the provider it was typed for. Requests to this server carry no key header (`test/byo.test.ts`).
- **The TypeSafe key is the one exception.** Jev rejects browser origins, so a key typed for the judge goes to `POST /api/judge` as `x-typesafe-key`. The server forwards it only to the fixed `https://api.typesafe.ai/v1/systemone` and never stores, logs or echoes it (`test/judge.test.ts`). Without that header, the server uses its own `TYPESAFE_API_KEY`.
- **Server keys** (`ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`) live only in the server's environment. With `PUBLIC_DEMO=1` the server model stays off unless `SERVER_AI=on`. The model routes (`/api/judge`, reports, `/api/ai/health`, bot-sim) allow 10 requests per minute per IP.

## The app

| Page | What it does |
|---|---|
| **Overview** | Coverage, depth, cost per $1k and makers paid per epoch, with deltas. Also shows depth inside the band over time, the live book ladder with the reward band shaded, who earned what (including makers who quoted but didn't qualify), and the AI epoch report with its provenance. |
| **Design a campaign** | You type a sentence and steps stream in: intent, market, history replay, backtest, brief. You get a recommended setting, all candidates (chart or table), the brief with its grounding badge, and **Publish**. |
| **Make markets** | Backtests the maker bot against a naive timer requoter and a lazy edge quoter on any closed epoch, scored by the real epoch builder. It shows the payout per epoch, the depth the quotes add, and copy-paste commands to run the bot. |
| **Verify** | Your browser downloads the logs and re-runs the production scorer for every epoch, then compares Merkle roots. **Try a forged payout** tampers with the file and re-roots it consistently, and the check still catches it. |
| **Claim** | Look up any maker. The page shows the cumulative amount, the Merkle proof (re-checked in the browser) and the exact `claim(...)` calldata. Once a distributor is deployed, it also reads the live root and the amount already claimed from the chain, and offers **Claim with wallet**. |

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

## Claim contract

Payouts go through the **unmodified 1inch `CumulativeMerkleDrop`**, vendored in `contracts/vendor/` with upstream URLs and sha256 hashes. It is compiled with upstream's exact settings (solc 0.8.23, optimizer at 1,000,000 runs, shanghai), and the build is committed in `contracts/build/`. The sponsor deploys and funds it, and posts each epoch's root.

```bash
npm run drop -- deploy  out/campaign-<id>.json [--owner 0xMultisig] --yes   # signer becomes owner; --owner hands it over
npm run drop -- publish out/<id>/epoch-3.json --fund --yes                   # recompute epochs 0..3, top up, setMerkleRoot
npm run drop -- status  out/campaign-<id>.json                               # code check, live root, owed vs balance, claimed
npm run drop -- claim   out/<id>/epoch-3.json --all --yes                    # push payouts (anyone pays gas, tokens go to makers)
```

`publish` refuses to post a root in any of these cases:
- it doesn't recompute from the order logs (the whole chain from epoch 0);
- the on-chain root isn't one of this campaign's earlier roots;
- the signer isn't the owner;
- the deployed code differs from the committed build;
- the contract can't pay every maker in full (unless `--fund` is given).

Every command is a dry run without `--yes`. Only chain 143 is accepted unless `--allow-chain <id>` is passed. Writes need `SPONSOR_KEY` in `.env` (claims also accept `CLAIM_KEY`).

**Trust model.** The owner can set any root, so whoever owns the contract can redirect its balance. Keep the sponsor (or the sponsor's multisig) as owner, and fund one epoch at a time so the balance at risk stays small. Anyone can check a published root on the Verify page or with `sb verify` before claiming.

Try the whole flow locally, without touching Monad:

```bash
npm run localchain     # ganache (chain 1337) + a 6-decimal test token; prints its address
export RPC_URL=http://127.0.0.1:8545 SPONSOR_KEY=<ganache deterministic dev key 0>
npm run drop -- deploy  out/demo/campaign-ausd-usdc-demo.json --allow-chain 1337 --token <tUSDC> --yes
npm run drop -- publish out/demo/ausd-usdc-demo/epoch-2.json --allow-chain 1337 --fund --yes
npm start              # Claim page: "Claim with wallet" (point a wallet at the local chain)
```

## CLI

```bash
npm test                                   # 8 core tests: replay, scoring, epoch build/verify, tamper detection, analytics
npm run test:ai                            # 7 AI-harness tests against a mock weak local model (needs npm run demo:gen)
npm run test:bot                           # 10 maker-bot tests: strategy rules, backtests, live runner on the fake RPC
npm run test:drop                          # 7 claim-contract tests on an in-process EVM: provenance, reproducible build, on-chain claims, publish guards
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
- `src/drop/`: claim contract tooling.
  - `compile.ts`: reproducible build.
  - `drop.ts`: deploy, publish checks, fund, claim.
  - `main.ts`: the `drop` CLI.
- `src/data/source.ts`: live RPC or the demo dataset. `src/demo/generate.ts` builds the demo dataset.
- `src/server/index.ts`: the JSON API plus the built web app (node:http, no framework).
- `web/`: Vite + React 19 + motion. The pages import `../src/core` directly, so in-browser verification runs the same code.

The Day-0 go/no-go test lives in [`../day0/spreadbounty`](../day0/spreadbounty).
