# The decision model (B2): measured

Spreadbounty asks a System One model (TypeSafe's Jev) for typed, calibrated judgments where a rule would be brittle and free text would be untrustworthy. The judge never changes a number that reaches a campaign or a payout. It adds three things to the Design result: a "Which book?" prompt, flags with fixed copy, and a list of sentences the facts don't support. An unsupported sentence switches the brief or report to the code-written template.

Code: `src/ai/judge.ts` (questions, thresholds, client), `POST /api/judge` in `src/server/index.ts`, `web/src/ai/writer.ts` (browser routing), `web/src/ai/client.ts` (integration). Tests: `test/judge.test.ts` (mock System One server; `npm run test:judge`).

## API used

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`, body `{ model: "jev-latest", state, questions }`. Answers: Noul `{ type: "noul", noul }`, Choice `{ type: "choice", choice, confidence, probabilities }`. Checked against docs.typesafe.ai/api and the live API on Oct 11; the live replies came from `jev-1.13.0`.
- The browser can't call Jev directly (TypeSafe rejects browser origins), so `POST /api/judge` calls it. The server builds every question; the client sends only `{ goal }` or `{ text, facts }` (strict zod, `goal` up to 1,000 characters, `text` up to 4,000). The upstream URL is a constant. The key is the request's `x-typesafe-key` header or the server's `TYPESAFE_API_KEY`. It goes only into the upstream `Authorization` header and is never logged, stored or echoed. With no key, an upstream error or a timeout (8 s), the route answers `{ judge: null, note }` and the page behaves exactly as before.

## Questions and thresholds

One request per sponsor sentence. All questions run in parallel:

| id | type | becomes |
|---|---|---|
| `pair` | Choice: AUSD/USDC, MON/USDC, none | "none", or confidence under 0.7: `needsPair: { ask: "Which book?", options }` |
| `wants_volume` | Noul | "This campaign pays for resting depth inside a band, not volume." |
| `names_makers` | Noul | "Campaigns are open to every maker." |
| `price_promise` | Noul | "Depth rewards don't defend a peg." |
| `one_sided` | Noul | "One-sided quoting earns a third of the score." |
| `supported_<i>` | Noul per sentence, state `{ facts }` | under 0.5: listed in `unsupported`, text switches to the template |

Flags are raised at p ≥ 0.6. The thresholds are constants at the top of `src/ai/judge.ts`. The support check runs only on model-written text; templates are code-written and skip it.

## Accuracy on the 12-request fixture (real Jev, Oct 11)

The fixture is `test/fixtures/sponsor-requests.json`: 12 handwritten requests, 5 judgments each (60 decisions). It includes two hard negatives: "better fills" (asks for depth, not volume) and "around the 1.0 peg" (a band reference, not a price promise).

| run | judgments right | requests fully right | latency per request |
|---|---|---|---|
| 1. first wording (untuned) | 58/60 | 10/12 | 108 to 247 ms |
| 2. after one rewording of `price_promise` | **59/60** | **11/12** | median 138 ms, max 187 ms |

- Run 1's two misses were both `price_promise` false positives: "tight around 1.0" (0.66) and "around the 1.0 peg" (0.78). After one rewording, with examples not taken from the fixture, they scored 0.41 and 0.64. The second case is still flagged; I left it as a known miss rather than tune further.
- Run 2 reused the fixture that motivated the rewording, so its accuracy is optimistic. Twelve requests is a small sample.
- `pair`: 12/12 in both runs. Both requests that name no book returned "none" (confidence 0.94 and 0.97), so the UI asks "Which book?".

Reproduce: `JUDGE_LIVE=1 npx tsx test/judge.test.ts` (needs `TYPESAFE_API_KEY`; prints the full table and never the key).

## Per-sentence support check (real Jev, Oct 11, demo facts)

Each text was the code-written template plus four invented sentences, for example "Wintermute quotes most of this book today." and "Makers left because the maker fee went up last week.":

| text | sentences | invented flagged | template sentences flagged | latency |
|---|---|---|---|---|
| design brief | 7 | 4/4 (p ≤ 0.03) | 1/3 | 142 ms |
| epoch report | 8 | 4/4 (p ≤ 0.06) | 1/4 | 177 ms |

The two flagged template sentences show the main risk: advice sits near the 0.5 line.
- "...if that stays high after the first epoch, lower the per-maker cap or widen the band..." scored 0.41. This is a false positive.
- "Coverage and spread were healthy; ..." scored 0.48. The report facts contain no spread figure, so the model's doubt is fair.

A false positive costs only a switch to the template, which is the safe direction. Templates themselves are never checked.

## Local System One (Von / Laya)

`web/src/ai/writer.ts` can call a local server that speaks `POST /v1/systemone` straight from the browser, with no key and no fallback to this server. It probes the server first with known-answer questions: a Choice whose right answer is not the first option, and two Nouls with opposite answers. It then asks only the question types the server got right.

Probed on Oct 11: the only local server on this Mac that speaks the API is the Laya cascade proxy (`~/Developer/ai-tools/laya-decision-engine/jev_proxy/proxy.py`, run on port 8771 because macOS holds 8770). It answers locally only jev-ultrafast's `operation` Choice. It forwards every other request to the real Jev with the caller's `Authorization` header. With no key, every Spreadbounty question came back 403 from upstream, and the probe returned `[]`. Its CORS preflight returns 501, so a browser can't call it either.

**Result: no local Von/Laya server answers any Spreadbounty question type today.** The browser path is built and tested only against the mock server in `test/judge.test.ts`. The same probe run against the live Jev returned `["choice","noul"]`.

## Not built (deliberately)

The judge doesn't score or rank makers, pick campaign settings, produce a single "risk score", approve publishing, or touch anything on-chain.
