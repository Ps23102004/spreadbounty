# Spreadbounty design brief: "Working Papers"

Status: plan for the Oct 11 to Oct 13 2026 push. Builders implement this; an Opus judge scores the result with `JUDGE-RUBRIC.md`. Feature scope, hours and cut lines live in `FEATURE-PLAN.md`. Security lives in `SECURITY-PLAN.md`.

Scope: the web app in `spreadbounty/web/` (React 19, Vite, TypeScript, `motion` 13 already installed). No new UI framework, no Tailwind, no GSAP, no icon library. Everything below is CSS custom properties, inline SVG and the existing `motion` package.

## 0. Which skill drove which decision

| Decision | Skill | What it changed |
|---|---|---|
| Treat this as a replacement visual world, not polish on the teal dashboard; name the rut; roll the direction with `concept-seed.mjs` (seed key `f452f383`, assigned index 3) | `impeccable` (new-work.md) | Direction section 1, contract block, finish steps in section 15 |
| Mode split: the app is Operate; `#start` is a Persuade surface inside it | `impeccable` (modes) | Start page gets a thesis-first viewport; the other pages stay scan-first |
| Easing tokens (`0.16,1,0.3,1` in, `0.7,0,0.84,0` out, `0.65,0,0.35,1` move), duration budget, transform/opacity only | `design-motion-principles` | Motion tokens and the motion table (section 7); fixes the current `width` animations in `Ladder`, `Bars` and `Payouts` |
| Accessibility first: 4.5:1 text, 3:1 control edges, 44 px targets, bottom nav with at most 5 items, no hover-only meaning, table alternative for charts | `ui-ux-pro-max` (priority table, pro-rules checklist) | Palette contrast table, mobile bottom bar, the IA merge of Claim into Make markets |
| Rejected the database's "Modern Dark cinematic glassmorphism" style for fintech | `ui-ux-pro-max` output, read as the category rut | Light ledger default with a dark "carbon copy" theme; reason recorded in section 2 |
| Reserve space for async content, skeletons at exact size, `:focus-visible` everywhere, `tabular-nums`, Escape closes overlays, instant feedback under 100 ms | `vercel-web-design-guidelines` | States matrix (section 8), skeleton rules, `<dialog>` sheets |
| No generic gradients, every surface earns its place, 8 px rhythm, modular scale 1.25 | `taste-skill` | Spacing and type scale; no floating card grid; schedules replace generic panels |
| Component boundaries, typed props, all states designed | `frontend-design` | Component specs (section 3). Its Tailwind/shadcn default is declined: the app already has a token system and 36 hours is no time to migrate |
| Plain, active, specific copy; no em dashes; no pull-quote lines | `stop-slop` | Copy deck (section 12) and every UI string |
| A decision model returns typed choices and probabilities; code keeps the policy; judgments never generate numbers | `typesafe-ai` | The Judge slot in the model sheet and the margin flags (sections 3.9, 5.3) |
| Route the work across the skills above | `design-orchestrator` | This table |

The `impeccable` flow asks a human to confirm the direction on a decision page. This plan was written by a subagent with no way to ask, so the assigned direction is presented fully committed, with the challengers listed as alternates. The user can re-roll before the build starts (section 1.4).

## 1. Direction

### 1.1 The product in one sentence, the audience, the rut

- Mechanism: sponsors fund rewards for keeping a Kuru order book tight on both sides; any maker earns them; every payout is recomputed from public logs, in a browser.
- Audience and scene: a stablecoin issuer's or foundation's liquidity lead at a desk in daylight, checking what a depth budget bought; a market maker deciding whether a campaign pays; a VC judge clicking one link between calls, often on a phone.
- What the first surface must prove: "I can check every payout myself, and a forged one fails."
- The rut, kept out of the list: the dark trading terminal with neon green and red and glowing edges; its predictable opposite, cream editorial fintech with a serif display. The literal reading of the name ("bounty" as a wanted poster) gets at most one slot.

### 1.2 Grounded list, ordered by resonance

1. A professional depth-of-market price ladder (the vertical bid/ask ladder makers stare at all day).
2. An Admiralty nautical chart: soundings, a buoyed fairway, shallow-water tint. Depth as water depth.
3. **An auditor's working papers**: ruled ledger stock, schedule references (A-1, B-2), tickmarks in red pencil that say how each figure was checked, an adding-machine tape with a two-colour ribbon, rubber stamps, double rules under totals.
4. Security printing on bank notes and share certificates: guilloche, serial numbers, microprint.
5. A tide-gauge marigram and printed tide tables: depth over time, sampled at intervals against a chart datum.
6. A lottery draw machine: the public, unpredictable pick (block-hash sampling).
7. A wanted poster (the literal "bounty").

The seed assigned index 3: **auditor's working papers**. It is the strongest carrier of the product's thesis. Auditors re-perform calculations and "tick and tie" each figure to its source. That is what the Verify page does, and the finance people who sign depth budgets know this grammar by heart.

### 1.3 Challengers dealt by the seed, fused and weighed

Axes: audience identification, product clarity. None beats the assigned direction on both.

| Challenger | Fused with this product | Verdict |
|---|---|---|
| Rail split-flap departure board | Campaign board where rows are live campaigns and flaps cascade when a sample is drawn | Strong for makers (old exchange boards were split-flap) and for "live state"; weak on the thesis, it shows state, not checking. Lands near the dark terminal rut. Best alternate |
| Airport yellow wayfinding | Role doors on Start as yellow sign bands: "Fund depth", "Make markets", "Check payouts" | Clear for the first five minutes, foreign to finance; fuses poorly across dense tables |
| Design annual plate section | Each epoch a registered plate, the Verified seal as a stamp, mono token bar for data labels | Tasteful, generic; low audience identification |
| Airline timetable slide rack | One type size, raked glass slides | Fuses poorly: raked containers hurt dense numeric reading |
| Botanical folio | Epochs as plates of one plant | Fuses poorly: cream plates and engraved italics are the rut, no finance identity |
| Vertical video feed | One campaign per viewport, swipe to the next | Fuses poorly with an order book; a phone-only idea |

### 1.4 Re-roll

If the user rejects the direction, re-run `node /Users/parthsingh/.agents/skills/impeccable/scripts/concept-seed.mjs --scope direction --mode operate --platform web --from f452f383 --reroll 1` from `spreadbounty/` (use the real path, the symlinked path prints nothing) and replace sections 1 to 4. The split-flap board is the alternate the plan would take with a steer.

### 1.5 Direction contract (paste as the first child of `<body>` in `web/index.html`)

```html
<!--
THESIS: Spreadbounty is an auditor's working-paper file for a depth budget: every figure carries a tickmark that says how it was checked. It refuses the dark neon trading terminal and the cream editorial fintech page.
OWN-WORLD: ledger-green stock with ruled columns, graphite figures, schedule references in the corner, red-pencil exceptions, blue and orange pencil for bids and asks, yellow highlighter for the reward band, an adding-machine tape with a black and red ribbon, rubber stamps, double rules under totals.
STORY: a visitor sees who pays for what, watches their own browser recompute a payout and tick every line, forges one and sees the red exception, then picks a door: fund depth, make markets, or check payouts.
FIRST VIEWPORT: left 5 columns, thesis headline, one line of support, "Recompute epoch 2 here" and a forge switch, then the tape; right 7 columns, Schedule A-1 (the order book as a ladder with the highlighted band and a quote probe); the stamp lands on that schedule; a "Status, plainly" strip closes the viewport.
FORM: auditor's working papers, candidate 3 of 7, seed key f452f383.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->
```

## 2. Tokens

Dark or light: the scene is a desk in daylight, so the default is light ("Ledger"). Dark ("Carbon copy") follows `prefers-color-scheme` and the existing theme toggle. The `ui-ux-pro-max` database recommends dark-first for fintech; that is the category rut, so it is declined on purpose.

### 2.1 Colour

Strategy: Restrained (neutrals plus functional pencils), because this is an Operate app. Colour carries meaning only: bid, ask, band, checked, exception.

Light, "Ledger". Contrast measured with the WCAG formula against `--paper` / `--sheet`.

| Token | Hex | Role | On paper / sheet |
|---|---|---|---|
| `--paper` | `#ECF0E8` | Page ground: ledger-green stock | |
| `--sheet` | `#F7F9F4` | Schedules (panels), inputs | |
| `--tape` | `#FCFCF8` | Adding-machine tape, code blocks | |
| `--rule` | `#C6D1C0` | Column and row rules (decorative, 1 px) | 1.37 / 1.49 |
| `--edge` | `#74866F` | Input, button and control borders | 3.38 / 3.68 (meets 3:1) |
| `--ink` | `#1B201D` | Figures, headings, body | 14.32 / 15.59 |
| `--ink-2` | `#465049` | Secondary text | 7.27 / 7.91 |
| `--muted` | `#5A655E` | Labels, captions (never below 12 px) | 5.26 / 5.73 |
| `--bid` | `#2456A4` | Blue pencil: bids, links, focus ring | 6.18 / 6.73 |
| `--ask` | `#B5560F` | Orange pencil: ask bars and lines only | 4.23 / 4.60 (graphics) |
| `--ask-ink` | `#97470B` | Ask text | 5.65 / 6.15 |
| `--tick` | `#1E6A44` | Checked, verified, agreed | 5.69 / 6.19 |
| `--red` | `#B3261E` | Exception, mismatch, destructive. Never used for asks | 5.66 / 6.17 |
| `--highlight` | `#F2E27D` | Yellow highlighter: rows inside the reward band; ink on it 12.55 | |
| `--on-dark` | `#FFFFFF` | Text on `--ink`, `--tick`, `--red` fills | 16.52 / 6.56 / 6.54 |

Dark, "Carbon copy".

| Token | Hex | On paper / sheet |
|---|---|---|
| `--paper` | `#111518` | |
| `--sheet` | `#171C20` | |
| `--tape` | `#1C2227` | |
| `--rule` | `#2A3238` | decorative |
| `--edge` | `#5E6B74` | 3.35 / 3.13 |
| `--ink` | `#E3E8EC` | 14.87 / 13.91 |
| `--ink-2` | `#B2BBC3` | 9.43 / 8.82 |
| `--muted` | `#8E99A3` | 6.32 / 5.91 |
| `--bid` | `#82A9EF` | 7.75 / 7.25 |
| `--ask` and `--ask-ink` | `#EFA35F` | 8.80 / 8.23 |
| `--tick` | `#6CC49A` | 8.74 / 8.17 |
| `--red` | `#F0796F` | 6.70 / 6.27 |
| `--highlight` | `#4A4420` | ink on it 7.96 |

Rules:
- No hex literal in any `.tsx` file. Components read tokens only.
- Bid/ask stay blue/orange (safe for red-green colour blindness). Red means "exception" and nothing else.
- Pass/fail is never colour alone: a tick glyph plus a word, or a cross glyph plus a word.

### 2.2 Type

| Use | Face | Setting |
|---|---|---|
| Everything in the UI, display included | **Archivo** (variable, `wdth` 62..125, `wght` 100..900) | Body 16/1.5 `wdth 100 wght 400`. Headings `wdth 112 wght 750`, tracking -0.02em. Column heads `wdth 75 wght 600`, uppercase, +0.06em, 12 px |
| Tape lines, hashes, addresses, calldata, prices on the ladder | **Fragment Mono** 400 | 13 to 14 px, `tabular-nums` |

Why these: pre-printed accounting forms rank by width and weight in one grotesque family (condensed caps for column heads, extended titles). Archivo's width axis does that in one file. Adding-machine tapes and bank statements print grotesque monospace digits, not typewriter slabs, which is what Fragment Mono is. Both are on Google Fonts, neither is on the `impeccable` overused list. Remove Bricolage Grotesque, Instrument Sans and IBM Plex Mono.

Google Fonts URL: `https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Fragment+Mono&display=swap`

Scale (major third, 1.25, base 16): 12.8 (label floor; never smaller), 14, 16, 20, 25, 31.25, 39, 61. Hero figure: `clamp(3.5rem, 2rem + 5vw, 6rem)`, `wdth 125 wght 800`. Every number: `font-variant-numeric: tabular-nums`.

### 2.3 Space, grid, shape

- Spacing steps (px): 4, 8, 12, 16, 24, 32, 48, 64, 96. Tokens `--s-1` to `--s-9`.
- Grid: 12 columns, 24 px gutters, max width 1240 px; 16 px side gutters under 560 px.
- Radius: `--r-sheet: 2px` (forms have square corners), `--r-tab: 6px 6px 0 0` (index-divider tabs), `--r-stamp: 4px`. No pill-shaped cards. Small round "chips" survive only as tickmark legend dots.
- Rules, not shadows: 1 px `--rule` between rows; `3px double var(--edge)` under totals and the Merkle root (the accounting sign for "final"). One shadow only, on the dialog: `0 24px 48px -24px rgb(0 0 0 / .35)`.
- Z-index: header 10, bottom bar 10, data strip 11, dialog uses the native top layer.
- Breakpoints: 560, 880, 1120.

### 2.4 Motion tokens

```css
--ease-enter: cubic-bezier(0.16, 1, 0.3, 1);             /* entrances */
--ease-exit: cubic-bezier(0.7, 0, 0.84, 0);              /* exits, the stamp hit */
--ease-move: cubic-bezier(0.65, 0, 0.35, 1);             /* positional moves */
--t-micro: 160ms;  /* hover, press, toggle */
--t-small: 240ms;  /* tab change, dialog, tick draw */
--t-page: 320ms;   /* route change */
--t-scene: 600ms;  /* longest single scene; staggers stay inside 900ms total */
```

## 3. Components

All live in `web/src/ui/`. Each lists anatomy, states, motion and accessibility.

### 3.1 `SourceLabel` (honesty, always visible)
- A boxed form field: small caps label `DATA` on the left, value on the right.
- Values come from `/api/config` and the campaign file, never from campaign text: `DEMO · SYNTHETIC` (hatched left edge), `MONAD MAINNET · READ-ONLY`, `MAINNET LOGS · SHADOW CAMPAIGN · NOTHING PAID` (B1), `LOCAL TEST CHAIN 1337` (Claim page when the distributor record says chain 1337).
- Desktop: in the header. Under 880 px: a sticky 28 px strip above the header that never scrolls away. It is also printed inside every schedule that shows data (top right), so screenshots and video frames always carry it.
- Never animated, never hidden, never truncated (wraps instead).

### 3.2 `IndexTabs` (navigation)
- Desktop: divider tabs along the top edge of the sheet: Start, Overview, Design, Make markets, Verify. The active tab joins the sheet below it (same fill, no bottom border).
- Under 880 px: bottom bar, 5 items, icon plus label, each at least 44x44, `padding-bottom: env(safe-area-inset-bottom)`.
- Claim moves under Make markets as a sub-tab (`#claim` still deep-links and highlights Make markets).
- Icons: six inline SVGs drawn as 1.5 px pencil strokes in the world's grammar (tick, ruled columns, compass, ladder, tick-in-circle, receipt). No emoji, no icon package.
- Motion: the active tab indicator moves with `layoutId` (existing pattern), `--t-small`, `--ease-move`.

### 3.3 `Schedule` (replaces `.panel`)
- Anatomy: sheet with a schedule reference in the top-right corner (`A-1`, `V-2`), a title, an optional description, and an optional footer row "Computed by: scorer in src/core · Checked by: your browser" that fills in once a recompute passes.
- States: default, loading (ruled skeleton rows at final height), empty (one sentence plus one action), error (red-pencil note plus retry).

### 3.4 `LedgerTable`
- Condensed caps headers, ruled rows, right-aligned tabular figures, a narrow tick column on the far right, totals under a double rule.
- After a successful recompute in this session, each payout row gets a pencil tick (`--tick`) drawn in its tick column (staggered 40 ms, total under 600 ms). A row that disagrees gets a circled cross and stays red.
- Under 560 px, the first column sticks and the table scrolls inside its sheet; the page never scrolls sideways.

### 3.5 `Tick`
- SVG path drawn with `pathLength` 0 to 1, `--t-small`, entrance ease. Variants: `agreed` (tick in `--tick`), `exception` (circled cross in `--red`), `footed` (small sigma on totals). Auditors tick in red pencil, but red is reserved for exceptions here, so ticks use `--tick`.
- Screen readers get text: "checked against recomputation" or "does not match".

### 3.6 `Tape` (the adding-machine printer)
- A narrow strip of `--tape` paper with a torn top edge (CSS `mask` zigzag, 6 px). Lines in Fragment Mono. Right-hand symbol column like a real adding machine: `#` for counts and ids (non-add), `+` for sums, `*` for the final total, `◇` for subtotals.
- Example run (real values from the step results, never invented):
  ```
         3  EPOCH FILES            #
       389  ORDER LOGS             #
        60  SAMPLES  EPOCH 0       ◇
         2  MAKERS PAID            ◇
   0x6ed9…d621  ROOT  EPOCH 2      *
  ```
- A mismatch prints in the red half of the ribbon: the recomputed root line and the field names that differ.
- Behaviour: a line prints when the real step completes. Display pacing holds at least 90 ms between lines so fast steps stay readable; total added delay is capped at 1 s; lines never print before their step finishes.
- Motion: each new line enters with `translateY(100%) -> 0` and the strip scrolls up by one line height, `--t-micro`, entrance ease. Reduced motion: lines appear with no movement.
- A11y: `<ol aria-live="polite">`; the final result is also announced once through a `role="status"` element.

### 3.7 `Stamp`
- Rubber stamp text in Archivo `wdth 125 wght 800`, uppercase, double border, `--r-stamp`, rotated -4 deg (VERIFIED, `--tick`) or 3 deg (EXCEPTION · DO NOT PAY, `--red`). A light ink texture via an inline SVG `feTurbulence` mask at 8% strength; skip the mask if it costs more than 2 ms per frame.
- It lands on the schedule it certifies, half over the root line.
- Motion: scale 1.35 to 1 and opacity 0 to 1 in 180 ms with `--ease-exit` (a stamp accelerates into the paper), no bounce. Reduced motion: opacity only.
- Appears only after the result object exists. Never on a timer.

### 3.8 `Ladder` v2 (the order book)
- Rows: asks above, bids below, sorted by price. Columns: price (Fragment Mono), distance in bps, size bar plus value.
- Reference or mid line: a double rule across the ladder with `1.0000 REF` (or `MID`).
- The band: rows inside the band carry a yellow highlighter swipe behind the price cell; the band edges get pencil brackets in the left margin labelled `+15 bps` and `-15 bps`.
- Size bars: `transform: scaleX()` from the left edge (`transform-origin: left`), never `width`. Bars stagger 30 ms, total under 600 ms.
- Hover or focus on a row: shows exact size, maker count and the row's score weight `((band - dist) / band)^2` (0 outside the band), computed by calling `scoreSample` from `src/core/score.ts` with a one-order book. No second copy of the formula.
- The quote probe (section 6.1) sits under the ladder.
- A11y: real `<table>` semantics; the highlighter is backed by a visually hidden "inside band" cell text.

### 3.9 `MarginNote`
- Red-pencil handwriting is not used. A margin note is Archivo italic 14 px in `--red` or `--ink-2`, with a short pencil leader line to the figure it refers to.
- Used for: the flicker explanation on payouts, judge-model flags on a campaign request (B2), honesty notes ("Gas not counted").

### 3.10 `AccountDialog` and `ModelDialog`
- Native `<dialog>` opened with `showModal()`: focus trap, Escape and backdrop for free. Slide up 16 px plus fade, `--t-small`; close is a 160 ms fade.
- Specs in sections 5.7 and 5.8.

### 3.11 Buttons, inputs, switches
- Primary button: filled `--ink`, text `--on-dark`, `--r-sheet`, 44 px tall, condensed caps label. Secondary: 1 px `--edge` outline on `--sheet`. Destructive confirm: `--red` fill.
- Press feedback: `scale(0.98)` for 120 ms. Hover: background step, 160 ms.
- Inputs: 1 px `--edge`, 44 px tall, label always visible above (never placeholder-only), error text under the field in `--red`.
- Switch (forge): a ruled checkbox styled as a form tick box; checked shows a red cross. Native `<input type="checkbox">` underneath.

## 4. Information architecture

| Route | Tab | Purpose | Mode |
|---|---|---|---|
| `#start` (default on first visit and when no hash) | Start | Thesis, the mechanism on one schedule, recompute in place, three doors, status | Persuade |
| `#overview` | Overview | Campaign ledger: coverage, depth, cost, who earned what, epoch report | Operate |
| `#design` | Design | Copilot: sentence to backtested campaign, publish under your address | Operate |
| `#makers` | Make markets | Backtest, rest clock, run commands; sub-tab Claim | Operate |
| `#claim` | Make markets > Claim | Look up a maker, proof, calldata, wallet claim | Operate |
| `#verify` | Verify | Full recompute with forge, log source choice, tickmarked ledger | Operate |

The campaign picker moves into the Overview header (a form field `CAMPAIGN`), not a floating row above every page.

## 5. Page by page

Viewports used below: desktop 1280x800, mobile 375x812.

### 5.1 Start (`#start`), desktop

```
+--------------------------------------------------------------------------------------------+
| [mark] Spreadbounty  /Start/ Overview  Design  Make markets  Verify   [DATA|DEMO·SYNTHETIC] |
|                                                          [Writer: none v] [Connect wallet]  |
+--------------------------------------------------------------------------------------------+
| W/P 0  START                                                                               |
|                                         +-- A-1  AUSD/USDC book, block 111,990,000 ------+ |
| Sponsors pay for order-book depth       | DATA DEMO·SYNTHETIC                             | |
| on Monad. Anyone can recompute          | PRICE      BPS   SIZE (AUSD)                    | |
| who earned it.                          | 1.0009    +9.0   ======================== 6.2k  | |
|                                         | 1.0003    +3.0   ##======== 2.0k  <- highlighted | |
| Rewards go to makers who keep a Kuru    | 1.0002    +2.0   ##=== 768                       | |
| book tight on both sides. Your browser  | ============ 1.0000 REF ===== band +/-15 bps === | |
| can check every payout against public   | 0.9998    -2.0   ##== 483                        | |
| order logs.                             | 0.9997    -3.0   ##====== 2.0k                   | |
|                                         | 0.9991    -9.0   ======================== 6.2k  | |
| [ RECOMPUTE EPOCH 2 HERE ]  [x] Forge   | Try a quote  |----o--------|  1.0006           | |
|                                         | inside band, weight 0.36 of the top score        | |
| +-- tape ----------------------------+  |                       +---------------+          | |
| |       3  EPOCH FILES            #  |  |                       |   VERIFIED    | (stamp)  | |
| |     389  ORDER LOGS             #  |  |  ROOT 0x6ed9...d621   +---------------+          | |
| |  0x6ed9...d621  ROOT EPOCH 2    *  |  +--------------------------------------------------+ |
| +------------------------------------+                                                     |
| Fund depth ->   Make markets ->   Check payouts ->                                         |
+--------------------------------------------------------------------------------------------+
| STATUS, PLAINLY  [tick] mainnet read-only replay, 8 of 8 orders matched (Oct 11)            |
|                  [cross] no live order sent yet  [cross] no paid epoch  [cross] no distributor on Monad |
+--------------------------------------------------------------------------------------------+
```

- The whole block above the status strip fits in 800 px tall.
- "Recompute epoch 2 here" runs the same `useRecompute` hook as Verify on the latest closed epoch of the default campaign. The stamp lands on A-1. Forge on: the tape prints the red line, EXCEPTION lands, the differing root characters show in red.
- Doors: three text links with an arrow, set in condensed caps, each with one line under it ("Design a campaign from one sentence", "See what quoting pays, run the bot", "Recompute every epoch, or look up a claim").
- Status, plainly: three to four items copied from the README status table. In live mode the first item adds the live book state ("AUSD/USDC book: no resting orders at block N", read from `/api/book`).

### 5.2 Start, mobile

```
+-----------------------------+
| DATA  DEMO · SYNTHETIC      |  sticky 28 px
+-----------------------------+
| [mark] Spreadbounty  [You]  |
| Sponsors pay for order-book |
| depth on Monad. Anyone can  |
| recompute who earned it.    |
| [ RECOMPUTE EPOCH 2 HERE ]  |  full width, 48 px
| [x] Forge a payout          |
| +-- A-1 AUSD/USDC book ----+|
| | ladder, 8 rows, 32 px    ||
| | Try a quote |--o----|    ||  thumb 44 px
| +--------------------------+|
| tape (last 4 lines)         |
| Fund depth ->               |  each 56 px
| Make markets ->             |
| Check payouts ->            |
| Status, plainly (3 lines)   |
+-----------------------------+
| Start Overview Design Make Verify |  bottom bar + safe area
+-----------------------------+
```

### 5.3 Overview (`#overview`): Schedule A, campaign ledger

```
W/P A  CAMPAIGN LEDGER        [CAMPAIGN | ausd-usdc-demo v]                  [DATA|DEMO·SYNTHETIC]
AUSD/USDC stayed two-sided within 15 bps of 1.0000                         100%
Demo campaign: keep AUSD/USDC two-sided ...                                 of 60 samples, epoch 2
[BAND 15 bps][REST >= 20 blocks][BUDGET 10.00 USDC / 60-min epoch][SAMPLE every 200 blocks]   (boxed form fields)
EPOCH [0][1][/2/]  blocks 111,974,000 to 111,985,999
+ DEPTH, THINNER SIDE + COST PER $1K OF DEPTH + PAID OF BUDGET + MAKERS PAID +   one ruled row of figures
| 8,799 USDC         | 1.14 USDC              | 10.00 / 10.00  | 4  top 43.4% |   deltas: "up 19% vs epoch 1"
+---------------------------------------------------------------------------+
[A-2 Depth inside the band: chart | table]        [A-3 The book now: compact Ladder v2]
[A-4 Who earned what: LedgerTable + tick column]   [A-5 Epoch report: Writer provenance]
     margin note in red: "Maker E5 placed 38 orders and earned nothing: ..."
Tickmark legend: tick = matches your browser's recompute · circled cross = does not match · sigma = footed total
```

- The hero figure renders its final value. No count-up (section 7).
- A-4's tick column fills only if a recompute passed in this browser session (shared state from `useRecompute`); otherwise the column header reads "Not yet checked here. Recompute ->".
- A-5 Epoch report: shows who wrote it ("Written by gemma4:e4b-it-qat in your browser", "Template, no model chosen") and the grounding result. With a Judge chosen (B2), sentences the judge rates as unsupported get a red underline and the template replaces the text.
- Shadow campaigns (B1): payout column header reads "Would have earned", and a margin note says "Shadow campaign over real Kuru logs. Nobody was paid."

### 5.4 Design (`#design`): Schedule B

```
W/P B  DESIGN A CAMPAIGN
Say what you want the book to look like. Get settings that history backs up.
+-- B-1 Request ------------------------------------------------------------------------+
| WHAT SHOULD THE CAMPAIGN DO?                                                           |
| [ Agora wants AUSD/USDC tight around 1.0, $50/day, hourly epochs                     ] |
| examples as index cards: [Deepen MON/USDC within 0.25%...] [Keep AUSD two-sided...]    |
| Writer: gemma4:e4b-it-qat (your browser) · Judge: Jev (this server) · DATA DEMO          |
|                                                                [ DESIGN CAMPAIGN ]     |
+----------------------------------------------------------------------------------------+
+-- B-2 Tape (real steps) ---------+  +-- B-3 Recommendation -----------------------------+
|  READ REQUEST  gemma4 (browser)  #|  | [BAND 9 bps][REST 20 blocks][TWO-SIDED 100%]      |
|  MARKET  tick 0.10 bps            #|  | [BUDGET 2.08 USDC / epoch]                        |
|  423 LOGS  5 MAKERS               #|  | Brief text ...                                    |
|  6 CANDIDATES                     ◇|  | provenance: Written by ... · every number matched  |
|  BAND 9 / REST 20 PICKED          *|  | margin flag (judge): "You asked to reward volume. |
+-----------------------------------+  |   This campaign pays resting depth, not volume."   |
                                       | [ SIGN IN TO PUBLISH ] or [ PUBLISH UNDER 0xab..cd ]|
                                       +----------------------------------------------------+
+-- B-4 Every setting tried: bars | table; chosen row highlighted, circled in pencil ------+
```

- Pair confirmation (B2): when the Judge's pair choice has confidence under 0.7, or no model is set and the sentence names no pair, B-3 shows "Which book?" with two buttons before the backtest runs, instead of the current silent default to AUSD/USDC.
- Publish copy: "Publishes this campaign file on this server under your address. Funding happens when you deploy the distributor from the CLI." Signed-out users see "Sign in to publish" which opens the Account dialog.

### 5.5 Make markets (`#makers`): Schedule C, sub-tabs Backtest · Rest clock · Run it · Claim

```
W/P C  MAKE MARKETS   [Backtest][Rest clock][Run it][Claim]                   [DATA|DEMO·SYNTHETIC]
10.00 USDC every 60 minutes, for quoting both sides and letting orders rest.
C-1 Backtest:  EPOCH [2 v]  SIZE PER SIDE [2000] AUSD   [ BACKTEST ]
   LedgerTable: strategy | payout | share | txs | fills | two-sided   (bot row highlighted)
   margin note: "Synthetic data. Gas not counted. Simple fill model."
C-2 Rest clock (section 6.3)
C-3 Run it: commands in a tape-styled code block, [Copy commands], red warning about BOT_KEY
```

### 5.6 Verify (`#verify`): Schedule V

```
W/P V  RECOMPUTE
Don't trust the payout list. Recompute it.
+-- V-1 Controls --------------------------------------------------------------------------+
| UP TO EPOCH [2 v]   LOGS FROM (o) Monad RPC, direct  ( ) this server's bundle (live only) |
| [x] Forge a payout                                         [ RECOMPUTE IN THIS BROWSER ]   |
+------------------------------------------------------------------------------------------+
+-- V-2 Tape (7 cols) ------------------+  +-- V-3 Roots (5 cols) -------------------------+
| 3 EPOCH FILES                       # |  | COMMITTED   0x913f ... cf22                  |
| 389 ORDER LOGS  DIGEST OK           # |  | RECOMPUTED  0x6ed9 ... d621 (diff chars red) |
| HASHES  demo: keccak("...-n")       # |  | ===========================================  |
| EPOCH 0  60 SAMPLES  2 PAID         ◇ |  |        [ EXCEPTION · DO NOT PAY ]  (stamp)   |
| EPOCH 1  60 SAMPLES  3 PAID         ◇ |  | Maker A1 was given 1 extra token. Fields that |
| EPOCH 2  MISMATCH cumulative, root  * |  | differ: cumulative, root.                     |
+---------------------------------------+  +-----------------------------------------------+
V-4 Sampling strip (section 6.2)
V-5 What this proves, plainly: in demo mode block hashes are computed from a fixed formula; in live
    mode logs and hashes come from the RPC you can see in the Network tab.
```

- In demo mode the log-source choice is hidden (there is no RPC) and V-5 says so.
- Live mode default: logs straight from the RPC in 100-block chunks (B1). The tape prints progress per chunk group ("CHUNK 12/36"). On RPC failure: a red note with the failing request and a button "Use this server's bundle instead (checked against the committed digest)". The trust change is spelled out.

### 5.7 Claim (Make markets > Claim)

- Address field, "Use my connected address" when signed in, quick picks of demo makers.
- Left schedule: the cumulative amount (final value, large), then the proof lines, each ticked as `verifyProof` passes in the browser.
- Right schedule: `claim(...)` call, calldata in a tape block with Copy, distributor status. "Claim with wallet" is disabled with the reason printed beside it ("No distributor deployed for this demo campaign").

### 5.8 Account dialog ("You")

```
YOU
1  CONNECT     Wallets on this page: [MetaMask] [Rabby] [Phantom]   (EIP-6963)
               no wallet: "No browser wallet found. You can still verify and look up claims."
2  SIGN IN     The exact message, in a tape block:
               "spreadbounty.example wants you to sign in with your Ethereum account: 0xab..cd
                Sign in to Spreadbounty. This signature does not move funds or approve anything. ..."
               [ SIGN MESSAGE ]
3  SIGNED IN   0xab...cd   [Sign out]
ROLES (read from public files, not stored)
   Sponsor of 0 campaigns · Maker in 0 epochs · Verifier: everyone can verify
DEMO PERSONAS (read-only, labelled)   [View as Maker A1] [View as the demo sponsor]
```

- Signing never asks to switch networks. Chain ID 143 is a field in the message only.
- "View as" sets a read-only persona label in the header ("Viewing as Maker A1 · demo persona") and cannot publish.

### 5.9 Model dialog ("AI")

```
AI MODELS   Reads your request and explains numbers the code computed. Never scores or pays anyone.
WRITER
 (o) None: rules and templates
 ( ) This server: claude-opus-5-5          (shown only when the operator enabled server AI)
 ( ) Anthropic  ( ) OpenAI  ( ) Google Gemini  ( ) OpenRouter
 ( ) Local: Ollama | LM Studio | llama.cpp | vLLM
     BASE URL [http://localhost:11434/v1]   MODEL [gemma4:e4b-it-qat v] [List models]
     KEY [........]  [ ] Remember on this device   [Forget key]
     "Your key goes from this browser to api.anthropic.com. This server never receives it."
     [ TEST ]  -> "Answered in 840 ms" | "Anthropic rejected the key (401)"
JUDGE (optional; typed yes/no and pick-one answers)
 (o) None   ( ) Jev on this server   ( ) Jev with your TypeSafe key (passes through this server
     for each request, never stored)   ( ) Local System One server (Von/Laya) [http://localhost:8770]
```

- The header chip reads `Writer: none`, `Writer: gemma4 (browser)` or `Writer: Claude (browser)`.

## 6. Interactions that teach the mechanism

Each is real math from `src/core`, labelled as an illustration where it is one.

### 6.1 Quote probe (the band and the weight)
- A range input under the ladder spanning the band plus 30% on each side. Moving it shows the hypothetical price, its distance in bps and its weight from `scoreSample` (one order, one side). Outside the band: "outside the band, earns nothing". Under the value: "Quote one side only and the score is a third. Tight and two-sided wins."
- The thumb snaps to tick size. Keyboard: arrows move one tick; `aria-valuetext` reads "1.0006, 6 bps above reference, weight 0.36".
- Label: "Illustration on the current book. No order is placed."

### 6.2 Sampling strip (the draw)
- A horizontal strip of the epoch's blocks, with the real sample blocks from the epoch file marked. Clicking "How was this block picked?" animates a marker from the later block whose hash chose it to the sample block (`--ease-move`, 600 ms), then prints the rule: "sample = window start + hash(block N+k) mod 200".
- Uses `campaign.sampleEvery` and the sample list in the epoch file. Nothing is simulated.

### 6.3 Rest clock (why flickering pays nothing)
- A row of 20 cells, one per block. "Place quote" fills one cell every 300 ms (real Monad block time), so it takes 6 s to qualify. "Requote" empties it. A sample marker arrives at a random moment; if the clock is full, the quote scores, else a margin note says "Not rested 20 blocks: earns nothing".
- Label: "Illustration of the rule at 300 ms per block. No order is placed." Reduced motion: a static diagram with step buttons.

### 6.4 The forged payout (the catch)
- Present on Start and Verify. The forge adds one token to the top maker and rebuilds a valid-looking root (existing `forge()`); the recompute exposes it. The tape's red line and the stamp carry the moment; the roots schedule highlights the differing characters.

## 7. Motion spec

| Element | Trigger | Property | Duration | Easing | Reduced motion |
|---|---|---|---|---|---|
| Route change | hash change | opacity, translateY 6 px on enter | 320 ms in, 120 ms out | entrance / exit | opacity only, 120 ms |
| Tab indicator | route change | layout position | 240 ms | move | instant |
| Ladder size bars | data load | scaleX 0 to 1 from left | 600 ms, 30 ms stagger, cap 900 ms | entrance | final state |
| Highlighter band | ladder load | scaleX 0 to 1 from left | 450 ms after bars start | entrance | final state |
| Tape line | real step done | translateY 100% to 0, strip scroll | 160 ms, min 90 ms gap | entrance | instant |
| Tick | row verified | SVG pathLength 0 to 1 | 240 ms, 40 ms stagger, cap 600 ms | entrance | instant |
| Stamp | result object exists | scale 1.35 to 1, opacity 0 to 1 | 180 ms | exit curve | opacity only |
| Dialog | open / close | translateY 16 px, opacity | 240 ms / 160 ms | entrance / exit | opacity only |
| Sample marker | user click | translateX along strip | 600 ms | move | jump |
| Rest clock cell | 300 ms timer (real block time) | background fill | 120 ms | entrance | static diagram |
| Button press | pointerdown | scale 0.98 | 120 ms | move | none |

Hard rules:
- Animate `transform` and `opacity` only. Today's `Ladder`, `Bars`, `Payouts` share bars and the `DepthChart` clip animate `width`; replace with `scaleX` (chart: animate a `scaleX` on a clip group or `stroke-dashoffset`).
- Never animate: money figures and payout amounts (no count-up; delete `CountUp` use on the hero figure), hashes and roots (no scramble or "decoding" effect), addresses, data-source labels, error messages, table row order.
- Motion follows real progress. The stamp, ticks and tape lines appear when the computation finishes, never on a fixed timer, and never before the result exists.
- No infinite loops. The only looping element is the spinner during real network waits.
- Remove `Reveal` on-mount fades from content sections; content is visible by default (the current mobile screenshot shows faded sections caught mid-animation).
- `MotionConfig reducedMotion="user"` stays; CSS transitions get a `@media (prefers-reduced-motion: reduce)` override.

## 8. States

| Page | Empty | Loading | Error |
|---|---|---|---|
| Start | Live mode with no closed epoch: ladder shows the live book (empty book shows "No resting orders at block N"), recompute button reads "No closed epoch to recompute yet" | Ruled skeleton ladder, 8 rows at 32 px | Server unreachable: red note "Can't reach the Spreadbounty server. Retry" plus the command for local runs |
| Overview | "No campaign has closed an epoch yet" plus "Design a campaign" | Skeleton KPI row at final height, skeleton table rows | Per-schedule error with Retry; other schedules keep working |
| Design | Example index cards visible, results area shows one line "Your recommendation appears here" | Tape prints real steps; a line with a spinner for the running step | Model errors are per-step and fall back: "Anthropic rejected the key. Used rules instead." The run continues |
| Make markets | "No closed epoch to backtest yet" | "Replaying epoch 2 three times" with spinner; table skeleton | Red note with the server's message (validated, no internals) |
| Verify | "No closed epoch to verify yet" | Tape progress per step or per chunk group | RPC 429 or failure: note naming the request, auto-retry with backoff, then the bundle fallback button with its trust note |
| Claim | "This address has nothing to claim in this campaign" | Proof lines appear as checked | Contract read failed: note with the RPC used |
| Account | No wallet found (neutral, not red) | "Waiting for your wallet" | User rejected: neutral "Signature cancelled". Expired nonce: "That sign-in request expired. Try again" |
| Model | "No model: rules and templates" is a valid, complete state | Test shows spinner | 401, CORS blocked ("Your browser blocked the call to localhost:11434. Start Ollama with OLLAMA_ORIGINS=<this origin>"), timeout |

Skeletons reserve exact final heights (CLS under 0.1).

## 9. Responsive and mobile

- 375 px is a first-class target: no horizontal page scroll anywhere (tables scroll inside their schedule).
- Bottom bar with 5 tabs; sticky data strip at the top; dialogs become full-height sheets.
- Touch targets at least 44x44; the quote-probe thumb 44 px; rows that open details are 48 px.
- The ladder keeps 3 columns at 375 px: price 84 px, bps 48 px, bar flexible.
- Input font size 16 px (stops iOS zoom).
- Safe areas: `viewport-fit=cover` is already set; pad header and bottom bar with `env(safe-area-inset-*)`.
- Mobile Trading App bounty: the app becomes good on phones, but it is not a trading app; do not claim that bounty (see `PURPOSE.md`).

## 10. Accessibility checklist

- Text contrast 4.5:1 and control edges 3:1 (tables in section 2.1); dark theme meets the same.
- `:focus-visible` ring: 2 px `--bid`, 2 px offset, on every interactive element.
- "Skip to content" link first in tab order.
- Pass/fail never by colour alone.
- Every chart keeps its Table toggle.
- `aria-live="polite"` on tapes; one `role="status"` for the final verdict.
- Dialogs: native `<dialog>`, labelled by their heading, focus returns to the opener.
- Range inputs have `aria-valuetext`.
- Reduced motion honoured everywhere (section 7).
- Lighthouse accessibility at least 95 on Start, Overview and Verify.

## 11. Honesty rules in the UI

- The data label (`SourceLabel`) is on every route, in every data schedule, at every width, and in every screenshot and video frame.
- Words not allowed in the UI: "live" for anything synthetic, "audited", "trustless", "guaranteed", "the AI decides", "customers". "Live" appears only inside `MONAD MAINNET · READ-ONLY`.
- Shadow campaigns say "would have earned" and "Nobody was paid".
- Nothing implies an order was placed or a payout was made on mainnet. The Status strip on Start says what has and has not run.
- Every model-written sentence shows who wrote it and whether its numbers matched.
- The publish button says what it does: writes a campaign file under your address; funding is a separate CLI step.

## 12. Copy deck (key strings)

- Start headline: "Sponsors pay for order-book depth on Monad. Anyone can recompute who earned it."
- Start support: "Rewards go to makers who keep a Kuru book tight on both sides. Your browser can check every payout against public order logs."
- Primary action: "Recompute epoch 2 here". Forge switch: "Forge a payout".
- Doors: "Fund depth: design a campaign from one sentence." / "Make markets: see what quoting pays, run the bot." / "Check payouts: recompute every epoch, or look up a claim."
- Verified line: "Every sample, score, payout and the root match. Your browser did the math in 412 ms."
- Exception line: "Maker A1 was given 1 extra token. The logs don't support this payout list."
- Model privacy: "Your key goes from this browser to {host}. This server never receives it."
- Jev pass-through: "TypeSafe doesn't accept calls from browsers, so this key passes through this server for each request. It is never stored or logged."
- Footer: "Payouts come from public Kuru order logs and open code. Models read requests and explain verified numbers; they never score or pay."

## 13. Demo video shot list (2:00, re-record after Tier A and B land)

| Time | Shot | On screen |
|---|---|---|
| 0:00 to 0:10 | Start, live instance | Thesis; `MONAD MAINNET · READ-ONLY`; AUSD/USDC book with no resting orders |
| 0:10 to 0:30 | Start, demo instance | Highlighted band; drag the quote probe; weight changes; "one side earns a third" |
| 0:30 to 0:55 | Design | Model dialog: Writer gemma4 local, in browser; one sentence; tape prints real steps; Judge flag on a "reward volume" sentence |
| 0:55 to 1:30 | Verify | Recompute: ticks and VERIFIED; forge on: red tape line, EXCEPTION. Hold 2 s of silence |
| 1:30 to 1:45 | You, Claim | Connect wallet, sign the readable message, "View as Maker A1", proof lines ticked, calldata |
| 1:45 to 2:00 | Start status strip | What ran on mainnet and what has not; the ask: one-week pilot on AUSD/USDC |

Keep the data label in every frame. Burn captions. Record the AI-off take as a fallback.

## 14. What changes from today

Keep: the page set and routes, every computation, the forge demo, Table toggles, theme toggle, `MotionConfig`, the honest footer line, the brand mark's two offset bars (redrawn in `--ink` over a highlighter swipe, so the hero image and video stay recognisable).

Replace: teal accent and the three Google families; generic rounded `.panel` cards (become schedules); the `Steps` list on Verify (becomes the tape); the wrap-around mobile header (becomes data strip plus bottom bar); `CountUp` on the hero figure; on-mount `Reveal` fades; `width` animations.

Found while reading the current UI:
- `Ladder` animates `width` per row; `Bars` and `Payouts` share bars animate `width`; `DepthChart` animates a clip `width`.
- On mobile the nav wraps to two lines, chips and the theme button take a third line.
- The campaign `<select>` floats above every page with a negative margin.
- Reveal fades leave sections at low opacity in screenshots.

## 15. Finish (impeccable process, for the build lead)

1. After the first production build, grep `web/dist/index.html` for `f452f383` (the contract survived).
2. Run `node /Users/parthsingh/.agents/skills/impeccable/scripts/detect.mjs --json web/src web/index.html` once; fix the mechanical findings.
3. Capture desktop 1280x800 and mobile 375x812 screenshots of Start, Overview, Design, Verify; spawn `impeccable-finish-reviewer` fresh with this brief, the contract, the screenshots and the detector findings. Two review rounds at most.
4. Spawn `impeccable-documenter` to write `spreadbounty/DESIGN.md` from the built world.
5. The Opus judge then scores with `JUDGE-RUBRIC.md`.
