# AI runs on real models (B5)

What actually ran on Oct 11 (EDT), on a MacBook, against the labelled synthetic demo data (`DATA_SOURCE=demo`). Nothing here ran against mainnet logs.

Setup:
- **Model:** `gemma4:e4b-it-qat` in Ollama, behind a wake-on-connect proxy on `localhost:11434` that starts Ollama on the first call.
- **Request:** "Agora wants AUSD/USDC tight around 1.0, $50/day, hourly epochs".
- **Report:** epoch 2 of `ausd-usdc-demo`.
- **Decision model:** TypeSafe Jev (`jev-1.13.0`) through this server's `POST /api/judge`, with `TYPESAFE_API_KEY` in the server's environment.

## 1. Server model: `AI_PROVIDER=local`

`PORT=8797 DATA_SOURCE=demo AI_PROVIDER=local LOCAL_LLM_MODEL=gemma4:e4b-it-qat npx tsx src/server/index.ts`, called with `POST /api/copilot` and `POST /api/campaigns/ausd-usdc-demo/epochs/2/report`.

| step | time | intent read | grounding |
|---|---|---|---|
| copilot (first model call of the session, includes the wake-up) | 49.1 s | by the model: AUSD/USDC, budget 50/day, 60-min epochs, ref price 1, no band (rules agree) | brief written by the model, every number in the facts on the first attempt |
| epoch report | 36.3 s | n/a | written by the model, every number grounded on the first attempt |

The resulting campaign was AUSD/USDC, 9 bps band, 20-block minimum rest, 2.08 USDC per 60-minute epoch.

The report text was grounded but stiff: the 4B model wrote raw field names ("100 twoSidedCoveragePct", "costPer1kDepthUsdc was 1.14").

Jev, asked through `POST /api/judge`:

| judged | time | outcome |
|---|---|---|
| a separate test sentence ("Reward the top 5 makers by fills...") | 211 ms | flagged volume and named makers |
| the brief above | 171 ms | every sentence supported |
| the report above | 224 ms | one sentence unsupported: "For the next epoch, maintaining the 100 twoSidedCoveragePct while targeting a costPer1kDepthUsdc below 1.14 is suggested." |

## 2. Browser Writer: Local, `gemma4:e4b-it-qat`, model calls made from the tab

The Writer settings were set to Local, `http://localhost:11434/v1`, `gemma4:e4b-it-qat`. In the Browser pane, the page ran `design()` and `report()` from `web/src/ai/client.ts`, served by Vite on `localhost:5199` and proxied to the server above. The Design page doesn't call `client.design()` yet (alpha2 wires it), so this run called the module directly in the page.

| step | time | intent read | grounding | decision model |
|---|---|---|---|---|
| `design()` | 38.0 s | by the model in the browser; same fields as the server run | brief by the model, every number in the facts on the first attempt | no flags, no "Which book?", every brief sentence supported |
| `report("ausd-usdc-demo", 2)` | 32.8 s | n/a | the model's text passed the number check on the first attempt | the advice sentence was unsupported, so the template was shown, with the note "The decision model could not match a sentence to the facts. Used the template instead." |

- The campaign matched the server run exactly: AUSD/USDC, 9 bps, 20 blocks, `budgetPerEpoch` 2080000.
- The first step's detail (the tape's first line) was "gemma4:e4b-it-qat in your browser". The brief step's detail was "written by gemma4:e4b-it-qat in your browser, every number checked".
- Network log: the three model calls went straight from the page to `POST http://localhost:11434/v1/chat/completions` (Ollama's CORS allowed `http://localhost:5199`). Own-origin calls were `/api/copilot` (posted with `brief: "none"`), `/api/judge` and the epoch files; none carried a key. The local path uses no key.

## Notes from the run

- **Dev proxy vs the same-origin check.** `web/vite.config.ts` proxies `/api` with Vite's string shorthand, which sets `changeOrigin: true`. The proxied POST then arrives with `Host: localhost:8787` and `Origin: http://localhost:5173`, and the server's `assertSameOrigin` answers 403 "Cross-origin requests are not allowed." This affects every POST under `npm run dev`. For this run, Vite was started through its Node API with `proxy: { "/api": { target, changeOrigin: false } }`. Production (one origin) is unaffected.
- **The judge's flag is debatable.** The flagged report sentence is advice, not a factual claim. `docs/JUDGE.md` measures the same pattern (advice sits near the 0.5 line). The cost was showing the template instead of the model's words; no number changed.
- **Timing.** These are single runs, not benchmarks. The browser run came second, after the server run had woken the model.
- **Not run here.** Claude, OpenAI, Gemini, OpenRouter, LM Studio, llama.cpp and vLLM are covered by `test/ai.test.ts` and `test/byo.test.ts` against stand-ins. No local System One server (Von/Laya) answered Spreadbounty's questions (`docs/JUDGE.md`).
