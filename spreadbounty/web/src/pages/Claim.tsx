import { ethers } from "ethers";
import { useEffect, useState } from "react";
import { leafHash, verifyProof } from "../../../src/core/score";
import { api, fmt, makerName, type CampaignRow, type Claim as ClaimData, type Config, type DropRecord, type EpochFile } from "../api";
import { short, useSession } from "../ui/AccountDialog";
import { Copy } from "../ui/bits";
import { MarginNote } from "../ui/MarginNote";
import { ErrorNote, MarketTabs, PageHead, Schedule, Skeleton } from "../ui/Schedule";
import { SourceLabel } from "../ui/SourceLabel";
import { Tick } from "../ui/Tick";
import type { Status } from "./Overview";

const DROP = new ethers.utils.Interface([
  "function claim(address account, uint256 cumulativeAmount, bytes32 expectedMerkleRoot, bytes32[] merkleProof)",
  "function merkleRoot() view returns (bytes32)",
  "function cumulativeClaimed(address) view returns (uint256)",
  "error InvalidProof()",
  "error NothingToClaim()",
  "error MerkleRootWasUpdated()",
]);
const MONAD_RPC = "https://rpc.monad.xyz";

interface OnChain { root: string; claimed: bigint }
type Eip1193 = { request(a: { method: string; params?: unknown[] }): Promise<any> };
type Lookup = { state: "idle" } | { state: "busy" } | { state: "none"; text: string } | { state: "error"; text: string } | { state: "found"; claim: ClaimData; ok: boolean };

/** W/P C-4, under Make markets: look up a maker's running total, check its proof here, and get the exact claim call. */
export function Claim({ campaign, config, status }: { campaign: CampaignRow | null; config: Config | null; status: Status }) {
  const [drop, setDrop] = useState<DropRecord | null>(null);
  const [chain, setChain] = useState<OnChain | null>(null);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [tx, setTx] = useState<{ hash?: string; error?: string; busy?: boolean } | null>(null);
  const [latest, setLatest] = useState<EpochFile | null | undefined>(undefined); // undefined: loading; null: no closed epoch
  const [latestErr, setLatestErr] = useState<string | null>(null);
  const [addr, setAddr] = useState("");
  const [look, setLook] = useState<Lookup>({ state: "idle" });
  const session = useSession();
  const mine = session.address ?? session.persona?.address ?? null;

  const load = () => {
    if (!campaign) return;
    setLatest(undefined);
    setLatestErr(null);
    setLook({ state: "idle" });
    setDrop(null);
    api.drop(campaign.id).then(setDrop);
    api.epochs(campaign.id)
      .then(async (es) => {
        if (!es.length) return setLatest(null);
        const f = await api.epoch(campaign.id, es[es.length - 1]!.n);
        setLatest(f);
      })
      .catch((e) => setLatestErr(String(e?.message ?? e)));
  };
  useEffect(load, [campaign?.id]);

  const claim = look.state === "found" ? look.claim : null;
  useEffect(() => {
    if (!latest) return;
    const first = mine ?? latest.cumulative[0]?.account;
    if (first) { setAddr(first); lookup(first); }
  }, [latest]);
  const rpc = drop ? drop.rpcUrl ?? config?.rpcUrl ?? MONAD_RPC : null;
  useEffect(() => {
    setChain(null);
    setChainErr(null);
    setTx(null);
    if (!drop || !claim || !rpc) return;
    const p = new ethers.providers.StaticJsonRpcProvider(rpc, drop.chainId);
    const c = new ethers.Contract(drop.address, DROP, p);
    Promise.all([c.merkleRoot(), c.cumulativeClaimed(claim.account)])
      .then(([root, claimed]) => setChain({ root, claimed: BigInt(claimed.toString()) }))
      .catch((e) => setChainErr(`Could not read the contract via ${rpc}: ${String(e?.reason ?? e?.message ?? e).slice(0, 120)}`));
  }, [drop?.address, claim?.account, claim?.root, rpc]);

  const label = <SourceLabel config={config} campaign={campaign} chainId={drop?.chainId ?? null} />;
  const head = (
    <section className="page-head">
      <PageHead wp="C-4" title="Make markets · Claim"><MarketTabs on="claim" />{label}</PageHead>
      <h1>Makers claim their running total with one proof.</h1>
      <p>Each epoch publishes one Merkle root over every maker's total so far. The distributor pays the difference from what was already claimed, so skipping a week loses nothing.</p>
    </section>
  );
  if (!campaign) return <>{head}{status === "ready" ? <p className="ink2">No campaign yet, so nothing to claim. <a href="#design">Design one</a></p> : status === "error" ? <ErrorNote>Can't read the campaigns from this server.</ErrorNote> : <Skeleton rows={6} h={41} />}</>;

  const dec = 10 ** campaign.rewardDecimals;
  const quote = campaign.pair.split("/")[1];

  const lookup = async (a = addr) => {
    setTx(null);
    if (!ethers.utils.isAddress(a.trim())) return setLook({ state: "error", text: "That isn't an Ethereum address. It should start with 0x and have 40 hex characters." });
    if (!latest) return setLook({ state: "none", text: "No epoch has closed yet, so nobody has anything to claim." });
    setLook({ state: "busy" });
    try {
      const c = await api.claim(campaign.id, latest.epoch, a.trim().toLowerCase());
      // check the proof in this browser: the server's "verifies" flag is not trusted
      setLook({ state: "found", claim: c, ok: verifyProof(c.proof, c.root, leafHash(c.account, BigInt(c.cumulativeAmount))) && c.root === latest.root });
    } catch (e: any) {
      const text = String(e?.message ?? e);
      setLook(/nothing to claim/i.test(text) ? { state: "none", text: `${makerName(a.trim())} has nothing to claim in this campaign through epoch ${latest.epoch}.` } : { state: "error", text });
    }
  };

  const calldata = claim ? DROP.encodeFunctionData("claim", [claim.account, claim.cumulativeAmount, claim.root, claim.proof]) : "";
  const sendWithWallet = async () => {
    const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!eth || !drop || !claim) return setTx({ error: "No browser wallet found. Copy the calldata into any wallet that can send raw transactions." });
    setTx({ busy: true });
    try {
      const [from] = await eth.request({ method: "eth_requestAccounts" });
      const want = "0x" + drop.chainId.toString(16);
      if ((await eth.request({ method: "eth_chainId" })) !== want) await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
      const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from, to: drop.address, data: calldata }] });
      setTx({ hash });
    } catch (e: any) {
      setTx({ error: String(e?.message ?? e).slice(0, 200) });
    }
  };
  const left = claim && chain ? BigInt(claim.cumulativeAmount) - chain.claimed : null;
  const blocked = !drop
    ? `No distributor deployed for this ${campaign.id.includes("demo") ? "demo " : ""}campaign`
    : chainErr ? "Can't read the distributor" : !chain ? "Reading the distributor…"
    : chain.root !== claim?.root ? "The distributor holds a different epoch's root"
    : left !== null && left <= 0n ? "Nothing left to claim" : null;

  return (
    <>
      {head}

      <Schedule id="C-4" title={<label htmlFor="addr">Maker address</label>} desc={latest ? `Running totals through epoch ${latest.epoch}.` : undefined}>
        <div className="lookup">
          <input id="addr" type="text" className="mono" value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookup()} placeholder="0x…" spellCheck={false} autoComplete="off" />
          <button className="btn" onClick={() => lookup()} disabled={look.state === "busy" || latest === undefined}>{look.state === "busy" ? "Looking up…" : "Look up"}</button>
        </div>
        {mine && (
          <button className="btn ghost small" style={{ justifySelf: "start" }} onClick={() => { setAddr(mine); lookup(mine); }}>
            {session.address ? `Use my connected address (${short(mine)})` : `Use ${session.persona!.name} (demo persona)`}
          </button>
        )}
        {latest === undefined && !latestErr && <Skeleton rows={1} h={40} />}
        {latest && (
          <div className="examples" role="group" aria-label="Makers in this campaign">
            {latest.cumulative.map((c) => (
              <button key={c.account} aria-pressed={claim?.account === c.account} onClick={() => { setAddr(c.account); lookup(c.account); }}>
                {makerName(c.account)} · {fmt.usd(Number(c.amount) / dec)} {quote}
              </button>
            ))}
          </div>
        )}
        {latest === null && <p className="ink2">No epoch has closed yet, so nobody has anything to claim.</p>}
        {latestErr && <ErrorNote onRetry={load}>Couldn't read the latest epoch: {latestErr}</ErrorNote>}
        {look.state === "none" && <p className="note">{look.text}</p>}
        {look.state === "error" && <ErrorNote>{look.text}</ErrorNote>}
      </Schedule>

      {(look.state === "busy" || claim) && latest && (
        <div className="claim-grid">
          <Schedule id="C-5" title="Proof" desc="Each line hashes into the next. Your browser checks the whole path against the epoch's root." source={label}
            footer={claim && <span>Computed by <b>this server</b> · Checked by {look.state === "found" && look.ok ? <b>your browser <Tick /></b> : <b className="bad-ink">your browser: does not verify <Tick kind="exception" /></b>}</span>}>
            {!claim ? <Skeleton rows={6} h={36} /> : (
              <>
                <div className="claim-total">
                  <span className="hero-figure claim-figure">{fmt.usd(Number(claim.cumulativeAmount) / dec)}</span>
                  <span className="muted small">{quote} for {makerName(claim.account)}, all epochs through {latest.epoch}</span>
                </div>
                <ol className="proof">
                  <ProofLine k="leaf" v={leafHash(claim.account, BigInt(claim.cumulativeAmount))} ok={look.state === "found" && look.ok} i={0} note="keccak(account, amount)" />
                  {claim.proof.map((p, i) => <ProofLine key={p} k={`+ ${i + 1}`} v={p} ok={look.state === "found" && look.ok} i={i + 1} note="sibling" />)}
                  <ProofLine k="root" v={claim.root} ok={look.state === "found" && look.ok} i={claim.proof.length + 1} note={`epoch ${latest.epoch}`} total />
                </ol>
                {look.state === "found" && !look.ok && <MarginNote tone="red">This proof does not hash to the epoch's root. Don't send it.</MarginNote>}
              </>
            )}
          </Schedule>

          <Schedule id="C-6" title="Claim transaction" desc="A standard cumulative Merkle drop. This is the exact call a wallet sends." aside={claim && <Copy text={calldata} label="Copy calldata" />}>
            {!claim ? <Skeleton rows={6} h={36} /> : (
              <>
                <pre className="tape-code">{`claim(\n  ${claim.account},\n  ${claim.cumulativeAmount},\n  ${claim.root},\n  [${claim.proof.map((p) => `\n    ${p}`).join(",")}\n  ]\n)`}</pre>
                <details className="calldata">
                  <summary>Calldata, {(calldata.length - 2) / 2} bytes</summary>
                  <div className="hash">{calldata}</div>
                </details>
                {drop && (
                  <dl className="kv">
                    <dt>Distributor</dt><dd className="mono">{drop.address}</dd>
                    <dt>Chain</dt><dd>{drop.chainId === 143 ? "Monad (143)" : `local test chain ${drop.chainId}`}</dd>
                    {chain && <><dt>Root on the contract</dt><dd>{chain.root === claim.root ? <><Tick /> this epoch's root</> : <span className="bad-ink">a different epoch's root</span>}</dd></>}
                    {chain && <><dt>Already claimed</dt><dd className="num">{fmt.usd(Number(chain.claimed) / dec)} {quote}</dd></>}
                    {left !== null && <><dt>Claimable now</dt><dd className="num"><b>{fmt.usd(Math.max(0, Number(left)) / dec)}</b> {quote}</dd></>}
                  </dl>
                )}
                {chainErr && <ErrorNote>{chainErr}</ErrorNote>}
                <div className="row">
                  <button className="btn" onClick={sendWithWallet} disabled={!!blocked || tx?.busy}>{tx?.busy ? "Waiting for wallet…" : "Claim with wallet"}</button>
                  <span className="muted small">{blocked ?? `Anyone can send this; the tokens always go to ${makerName(claim.account)}.`}</span>
                </div>
                {!drop && <p className="ink2 small">The sponsor deploys and funds the distributor with <code>npm run drop -- deploy</code>, then publishes each verified epoch root.</p>}
                {tx?.hash && <p className="note">Sent: <span className="mono">{tx.hash}</span></p>}
                {tx?.error && <ErrorNote>{tx.error}</ErrorNote>}
              </>
            )}
          </Schedule>
        </div>
      )}
    </>
  );
}

/** One line of the Merkle path; its tick draws only after verifyProof passed in this browser. */
function ProofLine({ k, v, ok, i, note, total }: { k: string; v: string; ok: boolean; i: number; note: string; total?: boolean }) {
  return (
    <li className={total ? "total" : undefined}>
      <span className="pk">{k}</span>
      <span className="hash" title={v}>{v}</span>
      <span className="pn">{note}</span>
      <span className="tickcol">{ok ? <Tick delay={Math.min(i * 0.04, 0.36)} /> : <Tick kind="pending" />}</span>
    </li>
  );
}
