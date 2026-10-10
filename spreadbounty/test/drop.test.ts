/**
 * Claim contract tests on a real in-process EVM (ganache, shanghai), no network: the vendored 1inch source is
 * byte-identical to upstream, the build is reproducible, our Merkle proofs verify on-chain, and the publish checks
 * stop a forged epoch, an unknown on-chain root, a non-owner and an unfunded root.
 *   npm run test:drop   (needs npm run demo:gen)
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";
import type { EpochFile } from "../src/core/epoch";
import { merkleRoot } from "../src/core/score";
import { demoSource } from "../src/data/source";
import { compile, loadArtifact } from "../src/drop/compile";
import { checkPublish, claimFor, codeMatches, deployDrop, fundDrop, owed, publishRoot, readDrop } from "../src/drop/drop";

process.chdir(new URL("..", import.meta.url).pathname);
let n = 0;
const ok = (m: string) => { n++; console.log(`  ok  ${m}`); };

// ---------- provenance and reproducible build ----------
const V = "contracts/vendor/1inch-merkle-distribution/";
const sha = (p: string) => createHash("sha256").update(readFileSync(V + p)).digest("hex");
assert.equal(sha("contracts/CumulativeMerkleDrop.sol"), "212cda8f0c66bee840c616cb95ffebb60935fbbe78f9176e344bde8609db2117");
assert.equal(sha("contracts/interfaces/ICumulativeMerkleDrop.sol"), "6bf0d43c48d1ee52baf9f93c6ae34fcdbe22d1be51640eace7062485e45ef9f8");
const fresh = compile();
const committed = loadArtifact("CumulativeMerkleDrop");
assert.equal(fresh[0]!.bytecode, committed.bytecode);
assert.equal(fresh[0]!.compiler.version, committed.compiler.version);
ok(`vendored 1inch source matches upstream sha256; recompiling with solc ${committed.compiler.version.split("+")[0]} reproduces the committed bytecode`);

// ---------- local chain ----------
const keys = Array.from({ length: 3 }, () => ethers.Wallet.createRandom().privateKey);
const g = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai", chainId: 1337 }, wallet: { accounts: keys.map((secretKey) => ({ secretKey, balance: "0x56BC75E2D63100000" })) } });
const p = new ethers.providers.Web3Provider(g as any);
const [sponsor, stranger, payer] = keys.map((k) => new ethers.Wallet(k, p));

const tm = loadArtifact("TokenMock");
const token = await new ethers.ContractFactory(tm.abi as any, tm.bytecode, sponsor).deploy("Test USDC", "tUSDC");
await token.deployed();
await (await token.mint(sponsor.address, 10n ** 15n)).wait();

const drop = await deployDrop(sponsor, token.address);
assert.ok(codeMatches(await p.getCode(drop.address)));
assert.ok(!codeMatches(await p.getCode(token.address)));
ok(`deployed CumulativeMerkleDrop at ${drop.address}; deployed code matches the build (token immutable masked); a lookalike doesn't`);

// ---------- publish checks against the real demo epochs ----------
const src = demoSource();
const dir = "out/demo/ausd-usdc-demo";
const ep = (k: number) => JSON.parse(readFileSync(`${dir}/epoch-${k}.json`, "utf8")) as EpochFile;
const [e0, e1, e2] = [ep(0), ep(1), ep(2)];
const logs = await src.logs(e2.campaign.market, e2.campaign.replayFromBlock, e2.toBlock);
const accounts = e2.cumulative.map((c) => c.account);
const check = async (e: EpochFile, who = sponsor.address, history = [e0, e1, e2].filter((h) => h.epoch !== e.epoch)) =>
  checkPublish({ epoch: e, history, state: await readDrop(p, drop.address, accounts), logs, blockHash: (b) => src.blockHash(b), signer: who, expectedToken: token.address });

let c = await check(e2);
assert.deepEqual(c.problems, []);
assert.equal(c.owedRaw, e2.cumulative.reduce((s, x) => s + BigInt(x.amount), 0n));
assert.equal(c.shortfallRaw, c.owedRaw);
ok(`epoch 2 recomputes from logs (epochs 0-2 chained); owes ${Number(c.owedRaw) / 1e6} tUSDC, all of it unfunded`);

// forged: +1 token to the top maker with a self-consistent root
const top = e2.cumulative.reduce((a, b) => (BigInt(a.amount) > BigInt(b.amount) ? a : b));
const forgedCum = e2.cumulative.map((x) => (x.account === top.account ? { ...x, amount: (BigInt(x.amount) + 1_000_000n).toString() } : x));
const forged: EpochFile = { ...e2, cumulative: forgedCum, root: merkleRoot(forgedCum.map((x) => [x.account, BigInt(x.amount)])) };
assert.ok((await check(forged)).problems.some((x) => x.includes("does not recompute")));
assert.ok((await check(e2, stranger.address)).problems.some((x) => x.includes("only the owner")));
assert.ok((await check(e2, sponsor.address, [e1])).problems.some((x) => x.includes("epoch 0 file is missing")));
ok("refuses: a forged but well-formed root, a non-owner signer, a missing earlier epoch");

// fund, publish epoch 1 then epoch 2 (cumulative: makers never lose an unclaimed epoch)
await fundDrop(sponsor, token.address, drop.address, (await check(e1)).shortfallRaw);
await publishRoot(sponsor, drop.address, e1.root);
c = await check(e2);
assert.deepEqual(c.problems, []);
assert.equal(c.shortfallRaw, owed(e2, new Map()) - owed(e1, new Map()));
await fundDrop(sponsor, token.address, drop.address, c.shortfallRaw);
await publishRoot(sponsor, drop.address, e2.root);
assert.equal((await check(e2)).alreadyPublished, true);
ok("publish epoch 1, then epoch 2 topping up only the difference; re-publishing is a no-op");

// claims: anyone pays gas, tokens go to the maker; second claim has nothing left
const balOf = async (a: string) => BigInt((await token.balanceOf(a)).toString());
for (const a of accounts) await claimFor(payer, drop.address, e2, a);
for (const x of e2.cumulative) assert.equal(await balOf(ethers.utils.getAddress(x.account)), BigInt(x.amount));
assert.equal(await balOf(drop.address), 0n);
await assert.rejects(claimFor(payer, drop.address, e2, accounts[0]!), /nothing left to claim/);
await assert.rejects(claimFor(payer, drop.address, e1, accounts[0]!), /not this epoch's root/);
ok(`${accounts.length} makers claimed their exact cumulative totals on-chain with our proofs; the drop is empty; double claims and stale roots revert`);

// someone sets a root nobody can account for -> publishing stops
await publishRoot(sponsor, drop.address, ethers.utils.id("who set this?"));
assert.ok((await check(e2)).problems.some((x) => x.includes("not one of this campaign's epoch roots")));
ok("an unknown on-chain root blocks the next publish");

console.log(`\n${n} tests passed`);
process.exit(0);
