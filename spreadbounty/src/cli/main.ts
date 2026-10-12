/**
 * sb: Spreadbounty CLI
 *
 *   npm run sb -- market AUSD/USDC                       live market facts (read-only)
 *   npm run sb -- copilot "<goal>" [--agent]             AI: design + backtest a campaign -> campaign-*.json (any model, or none)
 *   npm run sb -- epoch out/campaign-X.json <n>          build epoch n from chain logs -> out/X/epoch-n.json (+ logs bundle)
 *   npm run sb -- verify out/X/epoch-n.json [--bundle]   recompute from chain (or the bundled logs) and compare
 *   npm run sb -- report out/X/epoch-n.json              AI: sponsor report from the verified numbers
 *   npm run sb -- shadow MON/USDC [--epochs 3] [--epoch-blocks 1200] [--head N]   back-dated campaign on real logs, nothing paid
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildEpoch, epochMetrics, epochRange, verifyEpoch, type Campaign, type EpochFile } from "../core/epoch";
import { CHAIN_ID, DEFAULT_RPC, USDC } from "../core/chain";
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
      // the previous epoch sits next to this one (out/X/ or data/shadow/X/)
      const prev = f.epoch > 0 ? readJson<EpochFile>(args[0]!.replace(/epoch-\d+\.json$/, `epoch-${f.epoch - 1}.json`)) : null;
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
    case "shadow": {
      // B1: a campaign back-dated onto the real book, scored from mainnet logs. Read-only RPC: no keys, nothing signed or paid.
      const pair = args[0] && !args[0].startsWith("--") ? args[0] : "MON/USDC";
      const int = (name: string, def: number) => {
        const v = Number(flag(name) ?? def);
        if (!Number.isSafeInteger(v) || v < 1) throw new Error(`${name} must be a positive whole number`);
        return v;
      };
      const epochs = int("--epochs", 3), epochBlocks = int("--epoch-blocks", 1200);
      const p = provider();
      const m = await readMarket(p, pair);
      const head = flag("--head") ? int("--head", 0) : await p.getBlockNumber();
      const from = head - epochs * epochBlocks - 10; // 10 blocks short of the head, so every log is final
      const to = from + epochs * epochBlocks - 1;
      const c: Campaign = {
        id: `${m.pair.replace("/", "-").toLowerCase()}-shadow-${from}`,
        chainId: CHAIN_ID,
        market: m.market,
        pair: m.pair,
        implementation: m.implementation,
        pricePrecision: m.pricePrecision,
        sizePrecision: m.sizePrecision,
        refPrice: null, // maker-book mid
        bandBps: 25, // the copilot's default band for a volatile pair
        minRestBlocks: 20,
        sampleEvery: 200,
        replayFromBlock: from,
        epochBlocks,
        budgetPerEpoch: "10000000", // a hypothetical 10 USDC per epoch, as in the demo campaign; nothing is paid
        rewardToken: USDC,
        rewardDecimals: 6,
        sponsor: "0x0000000000000000000000000000000000000000",
      };
      const dir = process.env.DATA_DIR ?? "data/shadow"; // serve it with DATA_SOURCE=live DATA_DIR=data/shadow
      console.log(`head block used: ${head} (rerun with --head ${head} for the same files)`);
      console.log(`fetching ${m.pair} book logs ${from}..${to} from ${process.env.RPC_URL ?? DEFAULT_RPC} (read-only, 100-block requests)`);
      const logs = await fetchBookLogs(p, c.market, from, to);
      console.log(`fetched ${logs.length} logs`);
      mkdirSync(`${dir}/${c.id}`, { recursive: true });
      const rationale = `Shadow campaign: real ${m.pair} Kuru order logs from Monad mainnet, scored as if a campaign had started at block ${from}: ${epochs} epochs of ${epochBlocks} blocks, ±${c.bandBps} bps of the maker-book mid, a hypothetical 10 USDC per epoch. Nothing was paid; amounts show what makers would have earned.`;
      writeFileSync(`${dir}/campaign-${c.id}.json`, JSON.stringify({ ...c, rationale, shadow: true }, null, 2));
      const hash = blockHashes(p);
      let prev: EpochFile | null = null;
      for (let n = 0; n < epochs; n++) {
        const e = await buildEpoch(c, n, logs, hash, prev);
        const path = `${dir}/${c.id}/epoch-${n}.json`;
        writeFileSync(path, JSON.stringify(e, null, 2));
        writeFileSync(path.replace(".json", ".logs.json"), JSON.stringify(logs.filter((l) => l.blockNumber <= e.toBlock)));
        const x = epochMetrics(e);
        console.log(`epoch ${n} (${x.blocks}): ${e.logCount} logs since block ${from}, ${x.samples} samples, two-sided ${x.twoSidedCoveragePct.toFixed(0)}%, ${x.makersPaid} makers would have earned ${x.paidRewardTokens} USDC, root ${e.root}`);
        prev = e;
      }
      console.log(`would have earned, cumulative over ${epochs} epochs (nothing was paid):`);
      for (const a of [...prev!.cumulative].sort((x, y) => (BigInt(y.amount) > BigInt(x.amount) ? 1 : -1)))
        console.log(`  ${a.account}  ${(Number(a.amount) / 1e6).toFixed(6)} USDC`);
      console.log(`wrote ${dir}/campaign-${c.id}.json and ${dir}/${c.id}/epoch-0..${epochs - 1}.json; check: npm run sb -- verify ${dir}/${c.id}/epoch-${epochs - 1}.json`);
      break;
    }
    case "report": {
      const { writeEpochReport } = await import("../ai/report");
      const { getLLM } = await import("../ai/llm");
      const f = readJson<EpochFile>(args[0]!);
      const prevPath = args[0]!.replace(/epoch-(\d+)\.json$/, (_, n) => `epoch-${Number(n) - 1}.json`);
      const prev = f.epoch > 0 && existsSync(prevPath) ? readJson<EpochFile>(prevPath) : null;
      // shadow campaigns paid nobody; the flag sits on the campaign file next to the epoch directory
      const campaignFile = join(dirname(dirname(args[0]!)), `campaign-${f.campaign.id}.json`);
      const shadow = existsSync(campaignFile) && readJson<{ shadow?: boolean }>(campaignFile).shadow === true;
      const r = await writeEpochReport(f, prev, getLLM(), shadow);
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
