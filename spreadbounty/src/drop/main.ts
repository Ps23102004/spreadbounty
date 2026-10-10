/**
 * Claim contract tooling: the unmodified 1inch CumulativeMerkleDrop, deployed and funded by the sponsor.
 *
 *   npm run drop -- deploy  <campaign.json> [--owner 0x..] [--yes]        deploy (signer becomes owner; --owner hands it over)
 *   npm run drop -- status  <campaign.json>                               code check, root, balance, owed, claimed per maker
 *   npm run drop -- publish <epoch.json> [--fund] [--yes]                 recompute epochs 0..n, check, then setMerkleRoot
 *   npm run drop -- fund    <epoch.json> [--amount 12.5] [--yes]          top up to what this epoch's root owes (or a set amount)
 *   npm run drop -- claim   <epoch.json> (--account 0x.. | --all) [--yes] claim for makers (anyone pays gas; tokens go to the maker)
 *
 * Writes need SPONSOR_KEY (claims: CLAIM_KEY or SPONSOR_KEY) in .env, and --yes; without --yes every command is a dry run.
 * Mainnet only (chain 143) unless --allow-chain <id> is given, e.g. a local test chain; only then may --token override the reward token.
 * Epoch checks read logs from DATA_SOURCE (demo bundle or mainnet RPC), exactly like `sb verify`.
 */
import "dotenv/config";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ethers } from "ethers";
import { CHAIN_ID } from "../core/chain";
import type { Campaign, EpochFile } from "../core/epoch";
import { getSource } from "../data/source";
import { checkPublish, claimFor, deployDrop, fundDrop, publishRoot, readDrop, type DropRecord } from "./drop";

const [cmd, file, ...args] = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const has = (n: string) => args.includes(n);
const yes = has("--yes");
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8"));
const isKey = (k?: string) => !!k && /^0x[0-9a-fA-F]{64}$/.test(k.trim());

function usage(): never {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 14).join("\n"));
  process.exit(cmd ? 1 : 0);
}

async function chain() {
  const url = process.env.RPC_URL ?? "https://rpc.monad.xyz";
  const p = new ethers.providers.StaticJsonRpcProvider(url);
  const id = (await p.getNetwork()).chainId;
  const allowed = Number(flag("--allow-chain") ?? CHAIN_ID);
  if (id !== CHAIN_ID && id !== allowed) throw new Error(`RPC ${url} is chain ${id}; this tool targets Monad (${CHAIN_ID}). Pass --allow-chain ${id} for a test chain.`);
  return { p, id, url, mainnet: id === CHAIN_ID };
}
function signer(p: ethers.providers.Provider, env: "SPONSOR_KEY" | "CLAIM_KEY") {
  const k = (env === "CLAIM_KEY" ? process.env.CLAIM_KEY ?? process.env.SPONSOR_KEY : process.env.SPONSOR_KEY)?.trim();
  if (!isKey(k)) throw new Error(`${env === "CLAIM_KEY" ? "CLAIM_KEY or SPONSOR_KEY" : "SPONSOR_KEY"} in .env is missing or not a 0x-prefixed 32-byte key`);
  return new ethers.Wallet(k!, p);
}

/** campaign file -> its folder (<dir>/<id>/) where epoch files and drop.json live */
const campaignDir = (campaignFile: string, c: Campaign) => join(dirname(campaignFile), c.id);
const loadEpochDir = (epochFile: string) => {
  const dir = dirname(epochFile);
  const e = readJson<EpochFile>(epochFile);
  const history = readdirSync(dir).filter((f) => /^epoch-\d+\.json$/.test(f) && f !== basename(epochFile)).map((f) => readJson<EpochFile>(join(dir, f)));
  return { dir, e, history, dropPath: join(dir, "drop.json") };
};
const loadDrop = (path: string) => {
  if (!existsSync(path)) throw new Error(`${path} not found: deploy first (npm run drop -- deploy <campaign.json>)`);
  return readJson<DropRecord>(path);
};

async function main() {
  if (!cmd || !file) usage();
  const { p, id, url, mainnet } = await chain();

  if (cmd === "deploy") {
    const c = readJson<Campaign>(file);
    const dropPath = join(campaignDir(file, c), "drop.json");
    if (existsSync(dropPath)) throw new Error(`${dropPath} already records a deployment at ${readJson<DropRecord>(dropPath).address}; delete it deliberately to deploy again`);
    const token = flag("--token") ?? c.rewardToken;
    if (flag("--token") && mainnet) throw new Error("--token is only for test chains; on Monad the drop pays the campaign's reward token");
    if ((await p.getCode(token)) === "0x") throw new Error(`no token contract at ${token} on chain ${id}`);
    const t = new ethers.Contract(token, ["function decimals() view returns (uint8)", "function symbol() view returns (string)"], p);
    const [dec, sym] = await Promise.all([t.decimals(), t.symbol()]);
    if (Number(dec) !== c.rewardDecimals) throw new Error(`${sym} has ${dec} decimals; the campaign says ${c.rewardDecimals}`);
    const owner = flag("--owner");
    if (owner && !ethers.utils.isAddress(owner)) throw new Error("--owner is not an address");
    const s = signer(p, "SPONSOR_KEY");
    console.log(`deploy CumulativeMerkleDrop(${sym} ${token}) on chain ${id} from ${s.address}${owner ? `, then transfer ownership to ${owner}` : ""}`);
    if (!yes) return console.log("dry run: add --yes to send");
    const d = await deployDrop(s, token);
    let finalOwner = s.address;
    if (owner) {
      const tx = await new ethers.Contract(d.address, ["function transferOwnership(address)"], s).transferOwnership(owner);
      await tx.wait(1);
      finalOwner = owner;
    }
    const rec: DropRecord = { campaign: c.id, chainId: id, address: d.address, token, owner: finalOwner, deployTx: d.txHash, deployBlock: d.block, rpcUrl: mainnet ? null : url, published: [] };
    writeFileSync(dropPath, JSON.stringify(rec, null, 2));
    return console.log(`deployed ${d.address} (tx ${d.txHash}, block ${d.block}) -> ${dropPath}`);
  }

  if (cmd === "status") {
    const c = readJson<Campaign>(file);
    const dir = campaignDir(file, c);
    const rec = loadDrop(join(dir, "drop.json"));
    const epochs = existsSync(dir) ? readdirSync(dir).filter((f) => /^epoch-\d+\.json$/.test(f)).map((f) => readJson<EpochFile>(join(dir, f))).sort((a, b) => a.epoch - b.epoch) : [];
    const accounts = [...new Set(epochs.flatMap((e) => e.cumulative.map((x) => x.account)))];
    const st = await readDrop(p, rec.address, accounts);
    const dec = 10 ** c.rewardDecimals;
    const onEpoch = epochs.find((e) => e.root === st.root);
    console.log(`drop ${rec.address} on chain ${id}`);
    console.log(`  code matches committed 1inch build: ${st.codeOk ? "yes" : "NO"}`);
    console.log(`  owner ${st.owner} | token ${st.token} | balance ${Number(st.balance) / dec}`);
    console.log(`  root ${st.root} -> ${st.root === ethers.constants.HashZero ? "none published" : onEpoch ? `epoch ${onEpoch.epoch}` : "UNKNOWN ROOT"}`);
    if (onEpoch) {
      for (const x of onEpoch.cumulative) console.log(`  ${x.account}: total ${Number(x.amount) / dec}, claimed ${Number(st.claimed.get(x.account) ?? 0n) / dec}`);
      const { owed } = await import("./drop");
      const o = owed(onEpoch, st.claimed);
      console.log(`  owed ${Number(o) / dec}, ${o > st.balance ? `SHORT by ${Number(o - st.balance) / dec}` : "fully funded"}`);
    }
    const latest = epochs[epochs.length - 1];
    if (latest && latest.root !== st.root) console.log(`  latest epoch file is ${latest.epoch}: publish with npm run drop -- publish ${join(dir, `epoch-${latest.epoch}.json`)}`);
    return;
  }

  // ---------- epoch-file commands ----------
  const { e, history, dropPath } = loadEpochDir(file);
  const rec = loadDrop(dropPath);
  if (rec.chainId !== id) throw new Error(`${dropPath} is for chain ${rec.chainId}; RPC is chain ${id}`);
  const dec = 10 ** e.campaign.rewardDecimals;

  if (cmd === "publish" || cmd === "fund") {
    const s = signer(p, "SPONSOR_KEY");
    const st = await readDrop(p, rec.address, e.cumulative.map((x) => x.account));
    const src = getSource();
    console.error(`recomputing epochs 0..${e.epoch} from ${src.kind}${src.kind === "demo" ? " (synthetic)" : ""} logs...`);
    const logs = await src.logs(e.campaign.market, e.campaign.replayFromBlock, e.toBlock);
    const chk = await checkPublish({ epoch: e, history, state: st, logs, blockHash: (n) => src.blockHash(n), signer: s.address, expectedToken: rec.token });
    const shortfall = cmd === "fund" && flag("--amount") ? BigInt(Math.round(Number(flag("--amount")) * dec)) : chk.shortfallRaw;
    console.log(`epoch ${e.epoch} root ${e.root}: owes ${Number(chk.owedRaw) / dec}, contract holds ${Number(st.balance) / dec}${chk.shortfallRaw ? `, short ${Number(chk.shortfallRaw) / dec}` : ""}`);
    if (cmd === "publish" && !chk.ok) throw new Error(`refusing to publish:\n  - ${chk.problems.join("\n  - ")}`);
    if (cmd === "fund" && chk.problems.some((x) => x.includes("recompute"))) throw new Error(`refusing to fund a root that does not verify:\n  - ${chk.problems.join("\n  - ")}`);
    const willFund = shortfall > 0n && (cmd === "fund" || has("--fund"));
    if (cmd === "publish" && chk.shortfallRaw > 0n && !has("--fund")) throw new Error(`the contract can't pay this root in full; add --fund to transfer ${Number(chk.shortfallRaw) / dec} first, or run fund`);
    if (!yes) return console.log(`dry run: would ${willFund ? `transfer ${Number(shortfall) / dec} to the drop, then ` : ""}${cmd === "publish" ? (chk.alreadyPublished ? "do nothing (root already published)" : "setMerkleRoot") : ""}. Add --yes to send.`);
    if (willFund) console.log(`funded: ${await fundDrop(s, rec.token, rec.address, shortfall)}`);
    if (cmd === "publish" && !chk.alreadyPublished) {
      const tx = await publishRoot(s, rec.address, e.root);
      rec.published.push({ epoch: e.epoch, root: e.root, tx });
      writeFileSync(dropPath, JSON.stringify(rec, null, 2));
      console.log(`published epoch ${e.epoch}: ${tx}`);
    }
    return;
  }

  if (cmd === "claim") {
    const accounts = has("--all") ? e.cumulative.map((x) => x.account) : flag("--account") ? [flag("--account")!] : usage();
    const s = signer(p, "CLAIM_KEY");
    for (const a of accounts) {
      const total = e.cumulative.find((x) => x.account === a.toLowerCase());
      if (!yes) { console.log(`would claim ${total ? Number(total.amount) / dec : "?"} total for ${a}`); continue; }
      try {
        console.log(`${a}: ${await claimFor(s, rec.address, e, a)}`);
      } catch (err: any) {
        console.log(`${a}: ${err.message}`);
      }
    }
    if (!yes) console.log("dry run: add --yes to send");
    return;
  }
  usage();
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exitCode = 1;
});
