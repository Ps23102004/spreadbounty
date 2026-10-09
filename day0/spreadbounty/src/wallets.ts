/**
 * Create two fresh throwaway wallets and write their keys straight into .env, printing only addresses,
 * so private keys never land in a terminal log or a chat paste. Refuses to overwrite keys already set.
 *
 *   npm run wallets
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ethers } from "ethers";

const isKey = (v: string | undefined) => !!v && /^0x[0-9a-fA-F]{64}$/.test(v.trim());
const path = ".env";
let env = existsSync(path) ? readFileSync(path, "utf8") : readFileSync(".env.example", "utf8");

for (const name of ["MAKER_KEY", "TAKER_KEY"]) {
  const m = env.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (m && isKey(m[1])) {
    console.log(`${name} already set -> ${new ethers.Wallet(m[1]!.trim()).address} (left unchanged)`);
    continue;
  }
  const w = ethers.Wallet.createRandom();
  env = m ? env.replace(m[0], `${name}=${w.privateKey}`) : `${env.trimEnd()}\n${name}=${w.privateKey}\n`;
  console.log(`${name} created -> ${w.address}`);
}
writeFileSync(path, env, { mode: 0o600 });
console.log("\nKeys are in .env only (git-ignored). Fund the addresses above, then run `npm run full` (dry run).");
