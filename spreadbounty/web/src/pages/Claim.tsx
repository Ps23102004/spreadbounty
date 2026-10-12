import { ethers } from "ethers";
import { useEffect, useState } from "react";
import { leafHash, verifyProof } from "../../../src/core/score";
import { api, fmt, makerName, type CampaignRow, type Claim as ClaimData, type Config, type DropRecord, type EpochFile } from "../api";
import { short, useSession } from "../ui/AccountDialog";
import { Copy } from "../ui/bits";
import { MarketTabs, PageHead } from "../ui/Schedule";
import { SourceLabel } from "../ui/SourceLabel";

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

export function Claim({ campaign, config }: { campaign: CampaignRow | null; config: Config | null }) {
  const [drop, setDrop] = useState<DropRecord | null>(null);
  const [chain, setChain] = useState<OnChain | null>(null);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [tx, setTx] = useState<{ hash?: string; error?: string; busy?: boolean } | null>(null);
  const [latest, setLatest] = useState<EpochFile | null>(null);
  const [addr, setAddr] = useState("");
  const [claim, setClaim] = useState<ClaimData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean | null>(null);
  const session = useSession();
  const mine = session.address ?? session.persona?.address ?? null;

  useEffect(() => {
    if (!campaign) return;
    setLatest(null);
    setClaim(null);
    setDrop(null);
    api.drop(campaign.id).then(setDrop);
    api.epochs(campaign.id).then(async (es) => {
      if (!es.length) return;
      const f = await api.epoch(campaign.id, es[es.length - 1]!.n);
      setLatest(f);
      if (f.cumulative[0]) setAddr(f.cumulative[0].account);
    });
  }, [campaign?.id]);

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

  if (!campaign) return <p className="muted">No campaign yet.</p>;
  const dec = 10 ** campaign.rewardDecimals;
  const quote = campaign.pair.split("/")[1];

  const lookup = async (a = addr) => {
    setErr(null);
    setClaim(null);
    setChecked(null);
    if (!ethers.utils.isAddress(a.trim())) return setErr("That isn't an address.");
    if (!latest) return setErr("No closed epoch yet.");
    try {
      const c = await api.claim(campaign.id, latest.epoch, a.trim().toLowerCase());
      setClaim(c);
      // check the proof here too: the server's "verifies" flag is not trusted
      setChecked(verifyProof(c.proof, c.root, leafHash(c.account, BigInt(c.cumulativeAmount))) && c.root === latest.root);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

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

  const calldata = claim ? DROP.encodeFunctionData("claim", [claim.account, claim.cumulativeAmount, claim.root, claim.proof]) : "";

  return (
    <>
      <section className="page-head">
        <PageHead wp="C-4" title={`Claim · ${campaign.pair}`}><MarketTabs on="claim" />{drop && drop.chainId !== 143 && <SourceLabel config={config} chainId={drop.chainId} />}</PageHead>
        <h1>Makers claim their running total with one proof.</h1>
        <p>Payouts are cumulative: each epoch publishes one Merkle root over every maker's total so far, and the distributor pays the difference from what was already claimed. Skip a week and you lose nothing.</p>
      </section>

      <section className="panel">
        <label className="label" htmlFor="addr">Maker address</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input id="addr" type="text" className="mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x…" spellCheck={false} />
          <button className="btn" onClick={() => lookup()}>Look up</button>
        </div>
        {mine && (
          <button className="btn ghost small" style={{ justifySelf: "start" }} onClick={() => { setAddr(mine); lookup(mine); }}>
            {session.address ? `Use my connected address (${short(mine)})` : `Use ${session.persona!.name} (demo persona)`}
          </button>
        )}
        {latest && (
          <div className="examples">
            {latest.cumulative.map((c) => (
              <button key={c.account} onClick={() => { setAddr(c.account); lookup(c.account); }}>{makerName(c.account)} · {fmt.usd(Number(c.amount) / dec)}</button>
            ))}
          </div>
        )}
        {err && <p className="note bad">{err}</p>}
      </section>

      {claim && latest && (
        <>
          <div className="grid-2">
            <section className="panel">
              <div className="panel-head">
                <h2>{fmt.usd(Number(claim.cumulativeAmount) / dec)} {quote}</h2>
                {checked ? <span className="badge good">Proof checks out in your browser</span> : <span className="badge bad">Proof does not verify</span>}
              </div>
              <dl className="kv">
                <dt>Account</dt><dd className="mono">{claim.account}</dd>
                <dt>Total through epoch</dt><dd>{latest.epoch}</dd>
                <dt>Root</dt><dd className="mono">{claim.root}</dd>
                <dt>Proof</dt>
                <dd className="stack" style={{ gap: 2 }}>{claim.proof.map((p) => <span key={p} className="hash">{p}</span>)}</dd>
              </dl>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Claim transaction</h2>
                <Copy text={calldata} label="Copy calldata" />
              </div>
              <p className="ink2">The distributor is a standard cumulative Merkle drop. This is the exact call a wallet sends:</p>
              <div className="code-block">{`claim(\n  ${claim.account},\n  ${claim.cumulativeAmount},\n  ${claim.root},\n  [${claim.proof.map((p) => `\n    ${p}`).join(",")}\n  ]\n)`}</div>
              <span className="label">Calldata</span>
              <div className="hash" style={{ maxHeight: 120, overflowY: "auto" }}>{calldata}</div>
              {drop ? (
                <div className="stack">
                  <dl className="kv">
                    <dt>Distributor</dt><dd className="mono">{drop.address}</dd>
                    <dt>Chain</dt><dd>{drop.chainId === 143 ? "Monad (143)" : `test chain ${drop.chainId}`}</dd>
                    {chain && <><dt>Live root</dt><dd>{chain.root === claim.root ? <span className="badge good">This epoch's root is live</span> : <span className="badge bad">On-chain root is a different epoch</span>}</dd></>}
                    {chain && <><dt>Already claimed</dt><dd className="num">{fmt.usd(Number(chain.claimed) / dec)} {quote}</dd></>}
                    {chain && <><dt>Claimable now</dt><dd className="num"><b>{fmt.usd(Math.max(0, Number(BigInt(claim.cumulativeAmount) - chain.claimed)) / dec)}</b> {quote}</dd></>}
                  </dl>
                  {chainErr && <p className="note bad">{chainErr}</p>}
                  <div className="row">
                    <button className="btn" onClick={sendWithWallet} disabled={tx?.busy || !chain || chain.root !== claim.root || BigInt(claim.cumulativeAmount) <= chain.claimed}>
                      {tx?.busy ? "Waiting for wallet…" : chain && BigInt(claim.cumulativeAmount) <= chain.claimed ? "Nothing left to claim" : "Claim with wallet"}
                    </button>
                    <span className="muted" style={{ fontSize: "0.82rem" }}>Anyone can send this; the tokens always go to {makerName(claim.account)}.</span>
                  </div>
                  {tx?.hash && <p className="note">Sent: <span className="mono">{tx.hash}</span></p>}
                  {tx?.error && <p className="note bad">{tx.error}</p>}
                </div>
              ) : (
                <p className="note">No distributor is deployed for this {campaign.id.includes("demo") ? "demo " : ""}campaign yet, so there is nothing to send this to. The sponsor deploys and funds it with <code>npm run drop -- deploy</code>, then publishes each verified epoch root.</p>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
