/**
 * The claim side of Spreadbounty: deploy the unmodified 1inch CumulativeMerkleDrop, fund it, publish epoch roots,
 * and push or make claims. Every write is guarded by a check that can be run read-only first:
 *  - publish refuses a root it cannot recompute from the order logs (verifyEpoch), a root that doesn't chain from the
 *    one already on-chain, and a root the contract can't pay out in full;
 *  - status compares the deployed code with the committed build (immutables masked), so nobody claims against a lookalike.
 */
import { ethers } from "ethers";
import { epochRange, verifyEpoch, type Campaign, type EpochFile } from "../core/epoch";
import type { RawLog } from "../core/rpc";
import { leafHash, merkleProof, verifyProof } from "../core/score";
import { loadArtifact, type Artifact } from "./compile";

export interface DropRecord {
  campaign: string;
  chainId: number;
  address: string;
  token: string;
  owner: string;
  deployTx: string;
  deployBlock: number;
  rpcUrl: string | null; // where browsers can read it; null = the app's default RPC
  published: { epoch: number; root: string; tx: string }[];
}

export const dropArtifact = () => loadArtifact("CumulativeMerkleDrop");
export const dropContract = (address: string, p: ethers.Signer | ethers.providers.Provider) => new ethers.Contract(address, dropArtifact().abi as ethers.ContractInterface, p);
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)", "function transfer(address,uint256) returns (bool)"];

/** Deployed runtime code equals the committed build, ignoring the constructor-filled immutable (the token). */
export function codeMatches(onchain: string, a: Artifact = dropArtifact()): boolean {
  const mask = (hex: string) => {
    const b = ethers.utils.arrayify(hex);
    for (const refs of Object.values(a.immutableReferences)) for (const r of refs) b.fill(0, r.start, r.start + r.length);
    return ethers.utils.hexlify(b);
  };
  return onchain.length === a.deployedBytecode.length && mask(onchain) === mask(a.deployedBytecode);
}

export async function deployDrop(signer: ethers.Signer, token: string) {
  const a = dropArtifact();
  const f = new ethers.ContractFactory(a.abi as ethers.ContractInterface, a.bytecode, signer);
  const tx = f.getDeployTransaction(token);
  const gasLimit = (await signer.estimateGas(tx)).mul(120).div(100); // Monad bills the declared gas limit
  const c = await f.deploy(token, { gasLimit });
  const r = await c.deployTransaction.wait(1);
  return { address: c.address, txHash: r.transactionHash, block: r.blockNumber };
}

export interface DropState {
  address: string;
  codeOk: boolean;
  owner: string;
  token: string;
  root: string;
  balance: bigint;
  claimed: Map<string, bigint>;
}

export async function readDrop(p: ethers.providers.Provider, address: string, accounts: string[]): Promise<DropState> {
  const d = dropContract(address, p);
  const [code, owner, token, root] = await Promise.all([p.getCode(address), d.owner(), d.token(), d.merkleRoot()]);
  const balance = BigInt((await new ethers.Contract(token, ERC20, p).balanceOf(address)).toString());
  const claimed = new Map<string, bigint>();
  for (const a of accounts) claimed.set(a.toLowerCase(), BigInt((await d.cumulativeClaimed(a)).toString()));
  return { address, codeOk: codeMatches(code), owner: String(owner).toLowerCase(), token: String(token).toLowerCase(), root, balance, claimed };
}

/** What the contract must hold for every maker to claim their full total under this epoch's root. */
export function owed(e: EpochFile, claimed: Map<string, bigint>) {
  let total = 0n;
  for (const c of e.cumulative) {
    const left = BigInt(c.amount) - (claimed.get(c.account) ?? 0n);
    if (left > 0n) total += left;
  }
  return total;
}

export interface PublishCheck {
  ok: boolean;
  problems: string[];
  owedRaw: bigint;
  shortfallRaw: bigint;
  alreadyPublished: boolean;
}

/**
 * Everything that must hold before setMerkleRoot. `history` is the campaign's earlier epoch files (any subset);
 * the on-chain root must be zero or one of their roots, so a root nobody can account for blocks publishing.
 */
export async function checkPublish(opts: {
  epoch: EpochFile;
  history: EpochFile[];
  state: DropState;
  logs: RawLog[];
  blockHash: (n: number) => Promise<string>;
  signer: string;
  /** the token the drop should pay; defaults to the campaign's reward token (a test chain passes its mock) */
  expectedToken?: string;
}): Promise<PublishCheck> {
  const { epoch: e, state } = opts;
  const problems: string[] = [];
  if (!state.codeOk) problems.push("the contract's code does not match the committed CumulativeMerkleDrop build");
  const want = (opts.expectedToken ?? e.campaign.rewardToken).toLowerCase();
  if (state.token !== want) problems.push(`the contract pays ${state.token}, the campaign pays ${want}`);
  if (state.owner !== opts.signer.toLowerCase()) problems.push(`only the owner ${state.owner} can publish; signer is ${opts.signer}`);

  // cumulative totals inherit every earlier epoch, so the whole chain 0..n is recomputed, not just epoch n
  let prev: EpochFile | null = null;
  for (let k = 0; k <= e.epoch; k++) {
    const f = k === e.epoch ? e : opts.history.find((h) => h.epoch === k);
    if (!f) {
      problems.push(`epoch ${k} file is missing; every earlier epoch is needed to check the cumulative totals`);
      break;
    }
    const v = await verifyEpoch(f, opts.logs, opts.blockHash, prev);
    if (!v.ok) {
      problems.push(`epoch ${k} does not recompute from the logs: ${v.diffs.map((d) => d.split(":")[0]).join(", ")}`);
      break;
    }
    prev = f;
  }

  const known = new Map(opts.history.map((h) => [h.root, h.epoch]));
  const alreadyPublished = state.root === e.root;
  if (!alreadyPublished && state.root !== ethers.constants.HashZero && !known.has(state.root))
    problems.push(`the on-chain root ${state.root} is not one of this campaign's epoch roots; find out who set it before publishing`);
  const onEpoch = known.get(state.root);
  if (onEpoch !== undefined && onEpoch > e.epoch) problems.push(`the on-chain root is already epoch ${onEpoch}, newer than ${e.epoch}`);

  for (const c of e.cumulative) {
    const got = state.claimed.get(c.account) ?? 0n;
    if (got > BigInt(c.amount)) problems.push(`${c.account} already claimed ${got}, more than its total ${c.amount} in this root`);
  }
  const owedRaw = owed(e, state.claimed);
  const shortfallRaw = owedRaw > state.balance ? owedRaw - state.balance : 0n;
  return { ok: problems.length === 0, problems, owedRaw, shortfallRaw, alreadyPublished };
}

export async function publishRoot(signer: ethers.Signer, address: string, root: string) {
  const d = dropContract(address, signer);
  const gasLimit = (await d.estimateGas.setMerkleRoot(root)).mul(120).div(100);
  const tx = await d.setMerkleRoot(root, { gasLimit });
  const r = await tx.wait(1);
  return r.transactionHash as string;
}

export async function fundDrop(signer: ethers.Signer, token: string, address: string, amount: bigint) {
  const t = new ethers.Contract(token, ERC20, signer);
  const have = BigInt((await t.balanceOf(await signer.getAddress())).toString());
  if (have < amount) throw new Error(`signer holds ${have}, needs ${amount}`);
  const gasLimit = (await t.estimateGas.transfer(address, amount)).mul(120).div(100);
  const tx = await t.transfer(address, amount, { gasLimit });
  return (await tx.wait(1)).transactionHash as string;
}

/** Claim for one account (anyone may pay the gas; tokens always go to the account). */
export async function claimFor(signer: ethers.Signer, address: string, e: EpochFile, account: string) {
  const entries = e.cumulative.map((c) => [c.account, BigInt(c.amount)] as [string, bigint]);
  const entry = entries.find(([a]) => a === account.toLowerCase());
  if (!entry) throw new Error(`${account} is not in epoch ${e.epoch}'s payout tree`);
  const proof = merkleProof(entries, entry[0], entry[1]);
  if (!verifyProof(proof, e.root, leafHash(entry[0], entry[1]))) throw new Error("proof does not verify locally");
  const d = dropContract(address, signer);
  const args = [ethers.utils.getAddress(entry[0]), entry[1].toString(), e.root, proof] as const;
  try {
    await d.callStatic.claim(...args);
  } catch (err: any) {
    const name = (() => { try { return d.interface.parseError(err?.error?.data ?? err?.data).name; } catch { return null; } })();
    throw new Error(name === "NothingToClaim" ? "nothing left to claim" : name === "MerkleRootWasUpdated" ? "the on-chain root is not this epoch's root" : `claim would revert: ${name ?? err?.reason ?? err?.message}`);
  }
  const gasLimit = (await d.estimateGas.claim(...args)).mul(120).div(100);
  const tx = await d.claim(...args, { gasLimit });
  return (await tx.wait(1)).transactionHash as string;
}

export const epochToBlock = (c: Campaign, n: number) => epochRange(c, n).toBlock;
