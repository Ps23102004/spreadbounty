import { ethers } from "ethers";
import { useEffect, useState } from "react";
import { leafHash, verifyProof } from "../../../src/core/score";
import { api, fmt, makerName, type CampaignRow, type Claim as ClaimData, type EpochFile } from "../api";
import { Copy, Reveal } from "../ui/bits";

const DROP = new ethers.utils.Interface(["function claim(address account, uint256 cumulativeAmount, bytes32 expectedMerkleRoot, bytes32[] merkleProof)"]);

export function Claim({ campaign }: { campaign: CampaignRow | null }) {
  const [latest, setLatest] = useState<EpochFile | null>(null);
  const [addr, setAddr] = useState("");
  const [claim, setClaim] = useState<ClaimData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean | null>(null);

  useEffect(() => {
    if (!campaign) return;
    setLatest(null);
    setClaim(null);
    api.epochs(campaign.id).then(async (es) => {
      if (!es.length) return;
      const f = await api.epoch(campaign.id, es[es.length - 1]!.n);
      setLatest(f);
      if (f.cumulative[0]) setAddr(f.cumulative[0].account);
    });
  }, [campaign?.id]);

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
  const calldata = claim ? DROP.encodeFunctionData("claim", [claim.account, claim.cumulativeAmount, claim.root, claim.proof]) : "";

  return (
    <>
      <section className="page-head">
        <span className="label">Claim · {campaign.pair}</span>
        <h1>Makers claim their running total with one proof.</h1>
        <p>Payouts are cumulative: each epoch publishes one Merkle root over every maker's total so far, and the distributor pays the difference from what was already claimed. Skip a week and you lose nothing.</p>
      </section>

      <section className="panel">
        <label className="label" htmlFor="addr">Maker address</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input id="addr" type="text" className="mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x…" spellCheck={false} />
          <button className="btn" onClick={() => lookup()}>Look up</button>
        </div>
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
        <Reveal>
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
              <p className="note">No distributor is deployed for this {campaign.id.includes("demo") ? "demo " : ""}campaign yet, so there is nothing to send this to. Once the sponsor deploys and funds it, a wallet sends this call.</p>
            </section>
          </div>
        </Reveal>
      )}
    </>
  );
}
