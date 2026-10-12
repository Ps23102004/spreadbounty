# Live Day-0 runbook (about $25 of your own funds)

Goal: close the one gap every reviewer named. Rest a real quote on Kuru, get a real taker fill attributed to the maker on-chain, then (optionally) deploy the distributor and claim once. Report the transaction hashes, or report plainly that it did not work.

## Rules for the person running this
- Use **fresh throwaway wallets made by `npm run wallets`**. Never reuse a key that was ever pasted into a chat, a doc or a screenshot.
- Fund them with only what the table below says. Treat everything you fund as spendable.
- Do not paste `.env` or any private key anywhere. The tool prints addresses only.
- If any step fails, **keep the failure** in the report and say so in the write-up. A plain "pending" or "failed at step N" is better than a round-up.

## 1. Make the wallets (prints addresses only)
```bash
cd ~/Developer/spreadbounty/day0/spreadbounty
npm install
npm run wallets          # writes MAKER_KEY and TAKER_KEY into .env (gitignored); prints the two addresses
npm run selftest         # offline, expect "9 checks passed"
```

## 2. Fund them
Pick the market first. **MON/USDC is the recommended one**: it has a live book and makers, and its replay already matched 8/8 on Oct 11. AUSD/USDC's book is empty and you would first have to buy AUSD.

| Market | Maker wallet | Taker wallet |
|---|---|---|
| **MON/USDC (recommended)** | about 230 MON (the market's minimum order is 200 MON, about $5-6; ~11 MON account reserve; the rest is gas) and about 6 USDC for the bid side | about 12 MON for gas + about 6 USDC |
| AUSD/USDC | at least 12 MON + about 12 AUSD + about 12 USDC | at least 12 MON + about 6 USDC |

The step 3 dry run prints the exact amounts it will use. **Trust the dry run over this table.** Send funds on **Monad mainnet (chain 143)** to the addresses printed by `npm run wallets`. Double-check the network before sending.

## 3. Dry run first (sends nothing)
```bash
MARKET=0x065C9d28E428A0db40191a54d33d5b7c71a9C394 npm run full      # MON/USDC; prints planned orders and swap
```
Read the planned orders. Confirm the sizes match what you funded.

## 4. The live run (sends mainnet transactions)
```bash
MARKET=0x065C9d28E428A0db40191a54d33d5b7c71a9C394 npm run full -- --yes
```
It writes `day0-report-full-<timestamp>.json` with every step and every transaction hash. Pass rules per step are in `README.md`. Step 3 needs two `OrderCreated` logs for the maker, step 4 a `Trade` log naming the maker.

## 5. Optional: distributor and one claim
Needs the sponsor wallet to hold the campaign token on Monad. Follow `spreadbounty/README.md` ("Claim contract"): `npm run drop -- deploy ... --yes`, `publish ... --fund --yes`, `status`, `claim ... --all --yes`.

## 6. Hand the results back
Copy the report to `reports/` (it is gitignored by default, so copy deliberately):
```bash
cp day0-report-full-*.json reports/2026-10-12-full-MON-USDC.json
```
Then tell the assistant the transaction hashes (hashes are public, keys never are). It will update `WRITEUP.md`, `FAQ.md`, `docs/PROFILE.md` and the deck in one pass, replacing every "pending" with what actually happened.
