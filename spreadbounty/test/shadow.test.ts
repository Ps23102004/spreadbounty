/**
 * B1 shadow campaign, offline: `sb shadow` against the fake chain (test/fake-chain.ts) through a JSON-RPC spy that
 * records every eth_getLogs range and serves block hashes (demo formula), then `sb verify` on the result.
 *   npm run test:shadow   (needs demo data: npm run demo:gen)
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { EpochFile } from "../src/core/epoch";
import { demoBlockHash } from "../src/data/source";
import { startFakeChain } from "./fake-chain";

let count = 0;
const ok = (m: string) => { count++; console.log(`  ok  ${m}`); };
const hex = (n: number) => "0x" + n.toString(16);

const chain = await startFakeChain();
const ranges: [number, number][] = [];
const spy = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw) as { id: unknown; method: string; params: any[] };
  res.setHeader("content-type", "application/json");
  if (body.method === "eth_getBlockByNumber") {
    const n = parseInt(body.params[0], 16);
    const z = "0x" + "0".repeat(64);
    return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {
      hash: demoBlockHash(n), parentHash: n > 0 ? demoBlockHash(n - 1) : z, number: hex(n), timestamp: hex(n), nonce: "0x0000000000000000",
      difficulty: "0x0", gasLimit: "0x0", gasUsed: "0x0", miner: "0x" + "0".repeat(40), extraData: "0x", transactions: [], baseFeePerGas: "0x0",
    } }));
  }
  if (body.method === "eth_getLogs") ranges.push([parseInt(body.params[0].fromBlock, 16), parseInt(body.params[0].toBlock, 16)]);
  const r = await fetch(chain.url, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
  res.end(await r.text());
});
await new Promise<void>((r) => spy.listen(0, "127.0.0.1", r));
const rpc = `http://127.0.0.1:${(spy.address() as AddressInfo).port}`;

const dir = mkdtempSync(join(tmpdir(), "sb-shadow-"));
const sb = (args: string[], dataDir = dir) =>
  promisify(execFile)(join("node_modules", ".bin", "tsx"), ["src/cli/main.ts", ...args], { env: { ...process.env, RPC_URL: rpc, DATA_DIR: dataDir } })
    .then((r) => ({ code: 0, out: r.stdout }), (e) => ({ code: e.code as number, out: `${e.stdout}${e.stderr}` }));

try {
  const run = await sb(["shadow", "MON/USDC"]);
  assert.equal(run.code, 0, run.out);
  const head = Number(run.out.match(/head block used: (\d+)/)?.[1]);
  assert.ok(head > 0, "prints the head block it used");
  const from = head - 3 * 1200 - 10;
  const id = `mon-usdc-shadow-${from}`;
  const camp = JSON.parse(readFileSync(`${dir}/campaign-${id}.json`, "utf8"));
  assert.equal(camp.shadow, true);
  assert.equal(camp.replayFromBlock, from);
  assert.equal(camp.epochBlocks, 1200);
  assert.match(camp.rationale, /Nothing was paid/);
  ok(`sb shadow back-dates the campaign to head - 3*1200 - 10 (${from}) and marks the file shadow: true`);

  const files = [0, 1, 2].map((n) => JSON.parse(readFileSync(`${dir}/${id}/epoch-${n}.json`, "utf8")) as EpochFile);
  assert.deepEqual(files.map((f) => f.toBlock), [from + 1199, from + 2399, from + 3599]);
  assert.ok(files[2]!.toBlock < head, "the last epoch closes before the head");
  assert.ok(files.every((f, n) => n === 0 || f.prevRoot === files[n - 1]!.root), "epochs chain");
  assert.ok(files[2]!.cumulative.length > 0, "some maker would have earned");
  assert.ok(existsSync(`${dir}/${id}/epoch-2.logs.json`));
  ok(`three chained epochs built by the production builder (${files[2]!.cumulative.length} makers would have earned)`);

  const v = await sb(["verify", `${dir}/${id}/epoch-2.json`]);
  assert.equal(v.code, 0, v.out);
  assert.match(v.out, /^VERIFIED epoch 2/m);
  ok("sb verify recomputes epoch 2 from the chain (logs and block hashes over RPC): VERIFIED");

  assert.ok(ranges.length >= 2 * 36, `expected at least 72 eth_getLogs calls, saw ${ranges.length}`);
  assert.ok(ranges.every(([a, b]) => b >= a && b - a + 1 <= 100), `a range over 100 blocks: ${JSON.stringify(ranges.find(([a, b]) => b - a + 1 > 100))}`);
  ok(`every eth_getLogs request spans at most 100 blocks (${ranges.length} requests)`);

  const again = mkdtempSync(join(tmpdir(), "sb-shadow-"));
  assert.equal((await sb(["shadow", "MON/USDC", "--head", String(head)], again)).code, 0);
  for (const n of [0, 1, 2]) assert.equal(readFileSync(`${again}/${id}/epoch-${n}.json`, "utf8"), readFileSync(`${dir}/${id}/epoch-${n}.json`, "utf8"));
  rmSync(again, { recursive: true, force: true });
  ok("--head pins the run: the same head gives byte-identical epoch files");

  const f = files[2]!;
  const top = f.cumulative[0]!;
  writeFileSync(`${dir}/${id}/epoch-2.json`, JSON.stringify({ ...f, cumulative: f.cumulative.map((c) => (c === top ? { ...c, amount: String(BigInt(c.amount) + 1n) } : c)) }, null, 2));
  const t = await sb(["verify", `${dir}/${id}/epoch-2.json`]);
  assert.equal(t.code, 1, t.out);
  assert.match(t.out, /MISMATCH/);
  assert.match(t.out, /cumulative/);
  ok("a tampered epoch file (one maker +1 unit) fails sb verify");
} finally {
  spy.close();
  chain.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${count} tests passed`);
