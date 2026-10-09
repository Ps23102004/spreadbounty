/**
 * sb: Spreadbounty CLI
 *
 *   npm run sb -- market AUSD/USDC                       live market facts (read-only)
 *   npm run sb -- copilot "<goal>" [--agent]             AI: design + backtest a campaign -> campaign-*.json (any model, or none)
 *   npm run sb -- epoch out/campaign-X.json <n>          build epoch n from chain logs -> out/X/epoch-n.json (+ logs bundle)
 *   npm run sb -- verify out/X/epoch-n.json [--bundle]   recompute from chain (or the bundled logs) and compare
 *   npm run sb -- report out/X/epoch-n.json              AI: sponsor report from the verified numbers
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildEpoch, epochMetrics, epochRange, verifyEpoch, type Campaign, type EpochFile } from "../core/epoch";
import { blockHashes, fetchBookLogs, provider, readMarket } from "../core/fetch";
import type { RawLog } from "../core/rpc";

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const epochPath = (c: Campaign, n: number) => `out/${c.id}/epoch-${n}.json`;

async function main() {
  switch (cmd) {
    case "market": {
      console.log(JSON.stringify(await readMarket(provider(), args[0] ?? "AUSD/USDC"), null, 2));
      break;
    }
    case "copilot": {
      const goal = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--sponsor")).join(" ");
      if (!goal) throw new Error('usage: sb copilot "<what the sponsor wants>" [--agent]');
      if (args.includes("--agent")) {
        // Claude-only tool-calling agent (live RPC); the default pipeline below works with any model or none
        const { runCopilot } = await import("../ai/copilot");
        const r = await runCopilot(goal, { sponsor: flag("--sponsor") });
        console.log(`\n${r.brief}\n\ncampaign file: ${r.campaignFile ?? "none"}`);
        break;
      }
      const { designCampaign } = await import("../ai/pipeline");
      const { getLLM } = await import("../ai/llm");
      const { getSource } = await import("../data/source");
      const llm = getLLM();
      const src = getSource();
      console.error(`data: ${src.kind}${src.kind === "demo" ? " (synthetic)" : ""} | ai: ${llm ? `${llm.provider}:${llm.model}` : "off (rules + templates)"}`);
      const r = await designCampaign(goal, src, llm, (s) => s.status === "done" && console.error(`  ✓ ${s.step}: ${s.detail ?? ""}`));
      mkdirSync(src.dir, { recursive: true });
      const path = `${src.dir}/campaign-${r.campaign.id}.json`;
      writeFileSync(path, JSON.stringify({ ...r.campaign, rationale: r.brief }, null, 2));
      console.log(`\n${r.brief}\n\nbrief: ${r.ai.briefBy} | campaign file: ${path}`);
      break;
    }
    case "epoch": {
      const c = readJson<Campaign>(args[0]!);
      const n = Number(args[1] ?? 0);
      const p = provider();
      const { toBlock } = epochRange(c, n);
      const head = await p.getBlockNumber();
      if (toBlock > head) throw new Error(`epoch ${n} ends at block ${toBlock}; chain head is ${head} (~${Math.ceil(((toBlock - head) * 0.3) / 60)} min to go)`);
      const prev = n > 0 ? readJson<EpochFile>(epochPath(c, n - 1)) : null;
      console.error(`fetching logs ${c.replayFromBlock}..${toBlock} ...`);
      const logs = await fetchBookLogs(p, c.market, c.replayFromBlock, toBlock);
      const e = await buildEpoch(c, n, logs, blockHashes(p), prev);
      mkdirSync(`out/${c.id}`, { recursive: true });
      writeFileSync(epochPath(c, n), JSON.stringify(e, null, 2));
      writeFileSync(epochPath(c, n).replace(".json", ".logs.json"), JSON.stringify(logs));
      console.log(JSON.stringify(epochMetrics(e), null, 2));
      console.log(`wrote ${epochPath(c, n)} (root ${e.root})`);
      break;
    }
    case "verify": {
      const f = readJson<EpochFile>(args[0]!);
      const prev = f.epoch > 0 ? readJson<EpochFile>(epochPath(f.campaign, f.epoch - 1)) : null;
      const p = provider();
      const bundle = args[0]!.replace(".json", ".logs.json");
      const logs: RawLog[] =
        args.includes("--bundle") && existsSync(bundle)
          ? readJson<RawLog[]>(bundle)
          : await fetchBookLogs(p, f.campaign.market, f.campaign.replayFromBlock, f.toBlock);
      // block hashes always come from the chain: they are what makes sample choice unforgeable
      const v = await verifyEpoch(f, logs, blockHashes(p), prev);
      console.log(v.ok ? `VERIFIED epoch ${f.epoch}: root ${f.root} recomputed from ${logs.length} logs` : `MISMATCH:\n  ${v.diffs.join("\n  ")}`);
      process.exitCode = v.ok ? 0 : 1;
      break;
    }
    case "report": {
      const { writeEpochReport } = await import("../ai/report");
      const { getLLM } = await import("../ai/llm");
      const f = readJson<EpochFile>(args[0]!);
      const prevPath = args[0]!.replace(/epoch-(\d+)\.json$/, (_, n) => `epoch-${Number(n) - 1}.json`);
      const prev = f.epoch > 0 && existsSync(prevPath) ? readJson<EpochFile>(prevPath) : null;
      const r = await writeEpochReport(f, prev, getLLM());
      const out = args[0]!.replace(".json", ".report.md");
      writeFileSync(out, `${r.markdown}\n\nPayout root: \`${r.root}\`\n`);
      console.log(`${r.markdown}\n\nwritten by: ${r.ai.writtenBy} | wrote ${out}`);
      break;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 9).join("\n"));
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exitCode = 1;
});
