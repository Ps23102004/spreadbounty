import type { CampaignRow, Config } from "../api";

/**
 * The honesty label (DESIGN-BRIEF section 3.1, section 11). Values come from /api/config and the campaign
 * file, never from campaign text. Never animated, never hidden, never truncated: it wraps.
 */
export type SourceKind = "synthetic" | "mainnet" | "shadow" | "testchain" | "unknown";

export function sourceOf(config: Config | null, campaign?: CampaignRow | null, chainId?: number | null): { kind: SourceKind; text: string; title: string } {
  if (chainId && chainId !== 143)
    return { kind: "testchain", text: `Local test chain ${chainId}`, title: `This distributor runs on a local test chain (chain id ${chainId}), not on Monad.` };
  if (!config) return { kind: "unknown", text: "Checking source…", title: "Waiting for the server to say where its data comes from." };
  if ((campaign as { shadow?: boolean } | null | undefined)?.shadow)
    return { kind: "shadow", text: "Mainnet logs · shadow campaign · nothing paid", title: "Real Kuru logs from Monad mainnet, scored as if a campaign had run. Nobody was paid." };
  if (config.synthetic)
    return { kind: "synthetic", text: "Demo · synthetic", title: "Synthetic order-book logs from src/demo/generate.ts. Market parameters are real; orders, makers and payouts are simulated. Set DATA_SOURCE=live for Monad mainnet." };
  return { kind: "mainnet", text: "Monad mainnet · read-only", title: `Read-only: order logs from Monad mainnet via ${config.rpcUrl ?? "the RPC"}. No order is placed and nothing is paid from this app.` };
}

export function SourceLabel({ config, campaign, chainId, failed }: { config: Config | null; campaign?: CampaignRow | null; chainId?: number | null; failed?: boolean }) {
  const s = failed && !config ? { kind: "unknown" as const, text: "Server unreachable", title: "The Spreadbounty server did not answer, so no data is shown." } : sourceOf(config, campaign, chainId);
  return (
    <span className={`source ${s.kind}`} title={s.title}>
      <span className="source-k">Data</span>
      <span className="source-v">{s.text}</span>
    </span>
  );
}
