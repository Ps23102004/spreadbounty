/**
 * Server security tests (plans/SECURITY-PLAN.md section 3): boots the real app on an ephemeral port over a copy of
 * the demo data and pokes it like a curious judge would. No network, no API key.
 *   npm run test:server   (needs demo data: npm run demo:gen)
 */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/index";
import { DEMO_DIR, demoSource, type DataSource } from "../src/data/source";

let count = 0;
const ok = (m: string) => { count++; console.log(`  ok  ${m}`); };

// ---------- fixture: demo data in a temp dir, with a data source we can count, slow down and break ----------
const dir = mkdtempSync(join(tmpdir(), "sb-server-"));
cpSync(`${DEMO_DIR}/campaign-ausd-usdc-demo.json`, `${dir}/campaign-ausd-usdc-demo.json`);
cpSync(`${DEMO_DIR}/ausd-usdc-demo`, `${dir}/ausd-usdc-demo`, { recursive: true });
const base = demoSource();
const calls = { logs: 0 };
let gate: Promise<void> | null = null; // while set, market() waits: holds copilot runs open
let breakMarket = false; // market() throws an ethers-style error: forces a 500
const src: DataSource = {
  ...base,
  dir,
  async market(m) {
    if (gate) await gate;
    if (breakMarket) throw new Error('invalid address (argument="address", value="0xzz", code=INVALID_ARGUMENT, version=address/5.8.0)');
    return base.market(m);
  },
  async logs(...a) {
    calls.logs++;
    return base.logs(...a);
  },
};
const serverLog: string[] = [];
const servers: Server[] = [];
let clock = Date.now();
async function boot(env: Record<string, string> = {}) {
  const app = createApp({ src, env: { TRUST_PROXY: "1", ...env }, now: () => clock, log: (m) => serverLog.push(m) });
  servers.push(app);
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
}
const json = (body: unknown, ip: string, extra: Record<string, string> = {}): RequestInit => ({
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...extra }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const from = (ip: string): RequestInit => ({ headers: { "x-forwarded-for": ip } });
const campaignFiles = () => readdirSync(dir).filter((f) => f.startsWith("campaign-")).sort();
/** A publishable campaign body for the demo AUSD/USDC book (the demo campaign minus its rationale). */
const demoCampaign = (): Record<string, unknown> => {
  const { rationale: _r, ...c } = JSON.parse(readFileSync(`${dir}/campaign-ausd-usdc-demo.json`, "utf8"));
  return c;
};

/** A raw HTTP/1.1 request, for request targets fetch() refuses to send. */
function raw(url: string, request: string): Promise<string> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const s = connect(Number(port), hostname, () => s.write(request));
    let out = "";
    s.on("data", (d) => (out += d));
    s.on("end", () => resolve(out));
    s.on("error", reject);
    s.setTimeout(3000, () => { s.destroy(); resolve(out); });
  });
}

const url = await boot();

// ---------- 1. headers on the shell and the API ----------
for (const path of ["/", "/api/config"]) {
  const r = await fetch(url + path, from("10.1.0.1"));
  const csp = r.headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  for (const host of ["https://rpc.monad.xyz", "https://api.anthropic.com", "https://api.openai.com", "https://generativelanguage.googleapis.com", "https://openrouter.ai", "http://localhost:*", "http://127.0.0.1:*"])
    assert.ok(csp.split("; ").find((d) => d.startsWith("connect-src"))!.split(" ").includes(host), `connect-src allows ${host}`);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.match(r.headers.get("permissions-policy") ?? "", /camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  assert.equal(r.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(r.headers.get("strict-transport-security"), null, "no HSTS over plain http");
  await r.text();
}
{
  const r = await fetch(url + "/api/config", { headers: { "x-forwarded-for": "10.1.0.1", "x-forwarded-proto": "https" } });
  assert.equal(r.headers.get("strict-transport-security"), "max-age=31536000");
  await r.text();
}
ok("headers: CSP (script-src 'self', frame-ancestors 'none', model + RPC hosts in connect-src), nosniff, no-referrer, Permissions-Policy, COOP; HSTS only over HTTPS");

// ---------- 2. validation and sanitised errors ----------
{
  const r = await fetch(url + "/api/book?pair=FOO", from("10.2.0.1"));
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: "Unknown market." });
  for (const q of ["hours=99", "hours=abc", "hours=-1"]) assert.equal((await fetch(`${url}/api/book?${q}`, from("10.2.0.1"))).status, 400, q);
  assert.equal((await fetch(url + "/api/market?pair=0xzz", from("10.2.0.1"))).status, 400);
  assert.equal((await fetch(url + "/api/campaigns/ausd-usdc-demo/epochs/0/claim/0xnot-an-address", from("10.2.0.1"))).status, 400);
  assert.equal((await fetch(url + "/api/campaigns/ausd-usdc-demo/bot-sim?epoch=0&size=1000000000", from("10.2.0.1"))).status, 400);

  breakMarket = true;
  const r500 = await fetch(url + "/api/book?pair=MON/USDC&hours=2", from("10.2.0.1"));
  const body = await r500.text();
  breakMarket = false;
  assert.equal(r500.status, 500);
  const parsed = JSON.parse(body);
  assert.deepEqual(Object.keys(parsed).sort(), ["error", "id"]);
  assert.equal(parsed.error, "Internal error");
  assert.match(parsed.id, /^[0-9a-f]{8}$/);
  for (const leak of ["invalid address", "INVALID_ARGUMENT", "version=", "    at ", "/Users/", ".ts:"]) assert.ok(!body.includes(leak), `500 body leaks ${leak}`);
  assert.ok(serverLog.some((l) => l.includes(parsed.id) && l.includes("invalid address")), "the real error is logged server-side under the id");
  assert.equal((await fetch(url + "/api/book?pair=MON/USDC&hours=2", from("10.2.0.1"))).status, 200, "a failed fetch is not cached");
}
ok("validation: unknown pair -> 400 'Unknown market.', bad hours/account/size -> 400; forced 500 -> {error, id} only, detail stays in the server log");

// ---------- 3. /api/book cache ----------
{
  const before = calls.logs;
  const a = await (await fetch(url + "/api/book?pair=AUSD/USDC&hours=1.5", from("10.3.0.1"))).json();
  const mid = calls.logs;
  const b = await (await fetch(url + "/api/book?pair=AUSD/USDC&hours=1.5", from("10.3.0.1"))).json();
  assert.equal(mid - before, 1);
  assert.equal(calls.logs, mid, "second call within 15 s does not touch the data source");
  assert.deepEqual(a, b);
  clock += 16_000;
  await (await fetch(url + "/api/book?pair=AUSD/USDC&hours=1.5", from("10.3.0.1"))).json();
  assert.equal(calls.logs, mid + 1, "refetched after 15 s");
}
ok("/api/book: cached 15 s per pair and window");

// ---------- 4. bodies: size, type, origin ----------
{
  const big = JSON.stringify({ goal: "x".repeat(17 * 1024) });
  const r = await fetch(url + "/api/copilot", json(big, "10.4.0.1"));
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /16 KB/);
  // chunked, no content-length: caught while streaming
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode("x".repeat(1024))); c.close(); } });
  const r2 = await fetch(url + "/api/copilot", { ...json("", "10.4.0.2"), body: stream, duplex: "half" } as RequestInit);
  assert.equal(r2.status, 413);
  await r2.text();
  const r3 = await fetch(url + "/api/copilot", { method: "POST", headers: { "content-type": "text/plain", "x-forwarded-for": "10.4.0.3" }, body: JSON.stringify({ goal: "deepen AUSD" }) });
  assert.equal(r3.status, 415);
  await r3.text();
  const r4 = await fetch(url + "/api/copilot", json({ goal: "deepen AUSD" }, "10.4.0.4", { origin: "https://evil.example" }));
  assert.equal(r4.status, 403);
  await r4.text();
  const r5 = await fetch(url + "/api/copilot", json("{not json", "10.4.0.5"));
  assert.equal(r5.status, 400);
  assert.deepEqual(await r5.json(), { error: "Body must be valid JSON." });
}
ok("bodies: 17 KB -> 413 (with and without content-length), text/plain -> 415, foreign Origin -> 403, broken JSON -> 400");

// ---------- 5. rate limits ----------
{
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) {
    const r = await fetch(url + "/api/copilot", json({ goal: "x" }, "10.5.0.1"));
    codes.push(r.status);
    if (r.status === 429) assert.ok(Number(r.headers.get("retry-after")) > 0, "429 carries Retry-After");
    await r.text();
  }
  assert.deepEqual(codes, [400, 400, 400, 400, 400, 400, 429]);
  assert.equal((await fetch(url + "/api/copilot", json({ goal: "x" }, "10.5.0.2"))).status, 400, "another client is unaffected");

  // concurrency: two copilot runs in flight, the third gets 429
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  const runA = await fetch(url + "/api/copilot", json({ goal: "Deepen AUSD/USDC within 15 bps for $50 a day" }, "10.5.1.1"));
  const runB = await fetch(url + "/api/copilot", json({ goal: "Deepen AUSD/USDC within 15 bps for $50 a day" }, "10.5.1.2"));
  assert.equal(runA.status, 200);
  assert.equal(runB.status, 200);
  const third = await fetch(url + "/api/copilot", json({ goal: "Deepen AUSD/USDC within 15 bps for $50 a day" }, "10.5.1.3"));
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get("retry-after")) > 0);
  await third.text();
  gate = null;
  release();
  for (const r of [runA, runB]) assert.match(await r.text(), /"type":"result"/);
  const after = await fetch(url + "/api/copilot", json({ goal: "Deepen AUSD/USDC within 15 bps for $50 a day" }, "10.5.1.3"));
  assert.match(await after.text(), /"type":"result"/, "slots free again after the runs finish");
}
ok("rate limits: 7th copilot call in a minute -> 429 + Retry-After; third concurrent copilot run -> 429");

// ---------- 6. publish: strict schema; junk on disk cannot break /api/book ----------
{
  const before = campaignFiles();
  const { market: _m, ...noMarket } = demoCampaign();
  const r = await fetch(url + "/api/campaigns", json({ campaign: { ...noMarket, id: "ausd-usdc-1" } }, "10.6.0.1"));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /market/);
  for (const bad of [
    { ...demoCampaign(), id: "ausd-usdc-2", shadow: true }, // only the CLI may label a shadow campaign
    { ...demoCampaign(), id: "ausd-usdc-3", market: "0x065C9d28E428A0db40191a54d33d5b7c71a9C394" }, // another book
    { ...demoCampaign(), id: "mon-usdc-4" }, // id names the wrong pair
    { ...demoCampaign(), id: "../../etc" },
    { ...demoCampaign(), id: "ausd-usdc-5", bandBps: 0 },
    { ...demoCampaign(), id: "ausd-usdc-6", budgetPerEpoch: "1e30" },
    { ...demoCampaign(), id: "ausd-usdc-7", rewardToken: "0x0000000000000000000000000000000000000001" },
  ]) {
    const rb = await fetch(url + "/api/campaigns", json({ campaign: bad }, "10.6.0.1"));
    assert.equal(rb.status, 400, JSON.stringify(bad).slice(0, 80));
    await rb.text();
  }
  assert.deepEqual(campaignFiles(), before, "nothing written");
  // a junk file dropped on disk by hand still cannot break the book or the list
  writeFileSync(`${dir}/campaign-junk.json`, JSON.stringify({ id: "junk" }));
  writeFileSync(`${dir}/campaign-broken.json`, "{not json");
  const book = await fetch(url + "/api/book?pair=AUSD/USDC&hours=0.5", from("10.6.0.1"));
  assert.equal(book.status, 200);
  assert.equal((await book.json()).pair, "AUSD/USDC");
  const list = await (await fetch(url + "/api/campaigns", from("10.6.0.1"))).json();
  assert.deepEqual(list.map((c: { id: string }) => c.id), ["ausd-usdc-demo"]);
  rmSync(`${dir}/campaign-junk.json`);
  rmSync(`${dir}/campaign-broken.json`);
}
ok("publish: missing market, shadow key, wrong book, wrong pair id, traversal id, bad numbers, non-USDC reward -> 400, nothing written; junk files cannot break /api/book");

// ---------- 7. static traversal and malformed request targets ----------
{
  const shell = await (await fetch(url + "/", from("10.7.0.1"))).text();
  for (const p of ["/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json", "/../../package.json", "/..\\..\\package.json"]) {
    const body = await (await fetch(url + p, from("10.7.0.1"))).text();
    assert.ok(!body.includes('"name": "spreadbounty"'), `${p} served package.json`);
    assert.equal(body, shell, `${p} returns the app shell`);
  }
  const res = await raw(url, "GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  assert.match(res, /^HTTP\/1\.1 400/);
  assert.equal((await fetch(url + "/api/config", from("10.7.0.1"))).status, 200, "server still up");
}
ok("static: traversal attempts return the app shell; a malformed request target is a 400, not a crash");

// ---------- 8. server AI stays off on the public demo ----------
{
  const saved = { key: process.env.ANTHROPIC_API_KEY, provider: process.env.AI_PROVIDER };
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
  delete process.env.AI_PROVIDER;
  const pub = await boot({ PUBLIC_DEMO: "1" });
  assert.equal((await (await fetch(pub + "/api/config")).json()).ai.provider, "off");
  assert.equal((await (await fetch(pub + "/api/ai/health")).json()).provider, "off");
  const on = await boot({ PUBLIC_DEMO: "1", SERVER_AI: "on" });
  assert.equal((await (await fetch(on + "/api/config")).json()).ai.provider, "claude");
  process.env.ANTHROPIC_API_KEY = saved.key;
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
  if (saved.provider !== undefined) process.env.AI_PROVIDER = saved.provider;
}
ok("PUBLIC_DEMO=1 with ANTHROPIC_API_KEY set reports ai.provider off unless SERVER_AI=on");

await Promise.all(servers.map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })));
rmSync(dir, { recursive: true, force: true });
console.log(`${count} tests passed`);
