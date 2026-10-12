# Opus judge rubric for the Spreadbounty push

Who: a fresh Opus agent that did not write any of the code, with no transcript from the builders. It reads `DESIGN-BRIEF.md`, `FEATURE-PLAN.md`, `SECURITY-PLAN.md` and `PURPOSE.md`, then checks the branch `redesign` (or the merged `main`) and the public URL if one exists.

Bar: **every dimension at 8 or more, and every hard gate passes.** Anything less goes back as one fix batch (at most two rounds), then the build lead decides what merges (`FEATURE-PLAN.md`, Tier A gate).

The judge scores what it ran and saw. A claim in a README or PR description earns nothing until the judge reproduces it.

## Hard gates (any failure blocks the merge, whatever the scores)

| Gate | How to check |
|---|---|
| G1 Tests | `cd spreadbounty && npm run typecheck && npm run test:all && npm run build:web` exits 0; test count is at least 32 plus the new suites |
| G2 Money path | `test/boundary.test.ts` passes; `grep -rn "from \"../ai\|src/ai\|web/src" src/core src/drop src/bot` is empty; no diff under `src/core`, `src/drop`, `contracts` except files the plan names |
| G3 Honesty | The data label is visible on every route at 1280x800 and 375x812, including after scrolling to the bottom. No UI string says or implies a live order, a live epoch or a mainnet payout. Shadow campaigns say "would have earned". The Start status strip matches the README status table |
| G4 Keys | With a browser model selected, no request to the app's own origin carries `authorization` or `x-api-key` (DevTools Network or `read_network_requests`); `web/dist` has no key prefixes or server env names |
| G5 Forge still caught | On Verify and on Start: recompute shows VERIFIED; with forge on, it shows EXCEPTION · DO NOT PAY |

## Dimensions (score 1 to 10)

Anchors: **4** = present but broken or confusing; **6** = works, generic, gaps a judge notices; **8** = works, distinctive, no material gaps, small polish items only; **10** = award-level, a judge would screenshot it.

### D1. First five minutes
- Check: open the root URL cold at 1280x800. Within 60 s, can you say what this is, who pays, who earns, and how to check it? Is "Recompute epoch N here" in the first viewport? Does one click reach VERIFIED and a second reach EXCEPTION? Repeat at 375x812.
- 8 means: thesis, ladder with band, data label and primary action all visible without scrolling on desktop; the aha in two clicks; the three doors lead where they say.

### D2. Visual craft and distinctiveness
- Check: screenshots of Start, Overview, Design, Verify at both viewports against the direction contract in `DESIGN-BRIEF.md` section 1.5. Grep `web/dist/index.html` for `f452f383`. Run `node /Users/parthsingh/.agents/skills/impeccable/scripts/detect.mjs --json web/src web/index.html` once.
- Questions: could someone guess this look from "crypto dashboard" alone (bad)? Are schedules, ruled tables, tickmarks, the tape, the stamp and the highlighter band present and consistent? Tokens only (no hex in `.tsx`)? Type is Archivo plus Fragment Mono with a clear scale?
- 8 means: the world is recognisable with the text removed, consistent across pages, no generic rounded-card grid left, detector findings fixed or justified.

### D3. Motion
- Check: `grep -rn "animate={{[^}]*width\|initial={{[^}]*width" web/src` is empty; watch recompute, forge, route changes, dialog open; toggle OS reduced motion and repeat.
- Questions: does motion follow real progress (tape lines and the stamp appear after the computation, never before)? Durations within the brief's table? No count-up on money, no hash scrambles, no infinite loops? Reduced motion respected?
- 8 means: every animated element in the brief's table behaves as specified; nothing on the never-animate list moves.

### D4. Interactions that teach the mechanism
- Check: the quote probe (weight changes, edge gives 0, keyboard works, value matches `scoreSample`), the highlighted band, the sampling strip (uses real sample blocks), the rest clock (300 ms per cell, requote resets), the forge catch.
- 8 means: a newcomer can explain "tight, two-sided, patient quotes earn; flickering earns nothing; nobody knows which block is sampled" after using them, and every illustration is labelled as one.

### D5. Identity and session
- Check: sign in with a test wallet (a browser wallet with a fresh throwaway account, or the server tests' `Wallet.createRandom()` flow). Read the message shown before signing. Inspect the cookie flags. Try: reuse a nonce, sign with another account, edit the cookie, POST from another origin, publish while signed out. Check `/api/me` roles against the files.
- 8 means: all A5 acceptance items hold; signing never forces a network switch; reading, verifying and claim lookups work signed out; "View as" personas are read-only and labelled.

### D6. AI layer
- Check: open the model dialog. Select Local (Ollama on this Mac has `gemma4:e4b-it-qat`), run Design and an epoch report; confirm provenance says "in your browser" and grounding ran. If a cloud key is available to the judge's operator, run one provider and watch the Network panel. Check storage behaviour (session by default, "Remember", "Forget"). If B2 shipped: send "Pay makers for volume on MON" and see the flag; check the pair prompt on "deepen the book"; confirm the campaign numbers are identical with and without the judge (`test/judge.test.ts`).
- 8 means: at least the OpenAI-compatible path and None work end to end in the browser; failures fall back per step with a clear message; the money-path rule holds; any decision-model feature adds a typed judgment the rules could not make.

### D7. Security
- Check: run `SECURITY-PLAN.md` section 4 checklist and section 3 tests. Probe locally: headers, `/api/book?pair=FOO`, a copilot burst, a 17 KB body, publish junk, the traversal URL. `npm ls ethers` is 5.8.0. Review `src/server/security.ts` and `src/server/auth.ts` for timing-safe comparison, fixed Jev upstream, no body logging.
- 8 means: every finding in `SECURITY-PLAN.md` section 1 is fixed and tested; nothing new is exploitable by an anonymous visitor.

### D8. Accessibility and responsive
- Check: Lighthouse accessibility on Start, Overview, Verify (target 95 or more); keyboard-only run of the first-five-minutes path; focus ring visible everywhere; 375x812 has no horizontal page scroll on any route; touch targets at least 44 px; contrast spot-checks against the brief's tables; dark theme screenshots.
- 8 means: all of the above hold, charts keep their table view, dialogs trap focus and return it.

### D9. States and resilience
- Check: stop the server and reload (error state); load a page with no campaign (empty state); throttle the network to Slow 3G (skeletons at final size, no layout jump); force an RPC failure on live Verify if B1 shipped (retry, then the labelled bundle fallback); reject a wallet signature; enter a bad model key.
- 8 means: every row in `DESIGN-BRIEF.md` section 8 that applies to shipped pages behaves as written.

### D10. Engineering health
- Check: diff size per WP; lanes stayed in their files; no new dependency except the ethers bump (and Privy in C1, lazy); JS bundle size within 760 KB uncompressed for the main chunk; no `any` added without reason; tests are small and meaningful.
- 8 means: minimal diffs, reused core functions instead of copies, tests that would fail if the feature broke.

## Evidence the judge must produce

1. The commands run and their exit codes (G1).
2. Screenshots saved to files: Start, Overview, Design, Verify (forged), Claim, Account dialog, Model dialog; each at 1280x800 and 375x812; plus Start in dark theme.
3. The Network-panel evidence for G4.
4. The security probes and their responses.
5. A table: dimension, score, one-line reason, the evidence item it rests on, and the single most valuable fix if under 10.
6. A verdict line: PASS (all at 8 or more, all gates pass), FIX (list of material fixes, at most 10, ordered by impact), or HOLD (a hard gate failed; name it).

## Scoring discipline
- Score the built product, not the plan. A feature that is in the plan and absent from the build scores as absent.
- Do not give credit for a feature cut to its fallback beyond what the fallback delivers.
- When unsure between two scores, give the lower one and say what evidence would raise it.
- The judge never edits code. It reports.
