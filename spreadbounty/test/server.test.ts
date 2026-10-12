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
import { ethers } from "ethers";
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
    if (gate) await gate;
    calls.logs++;
    return base.logs(...a);
  },
};
const serverLog: string[] = [];
const servers: Server[] = [];
let clock = Date.now();
const SECRET = "test-session-secret-0123456789abcdef0123456789";
async function boot(env: Record<string, string> = {}, data: DataSource = src) {
  const app = createApp({ src: data, env: { TRUST_PROXY: "1", SESSION_SECRET: SECRET, ...env }, now: () => clock, log: (m) => serverLog.push(m) });
  servers.push(app);
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
}
const jsonReq = (body: unknown, ip: string, extra: Record<string, string> = {}): RequestInit => ({
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...extra }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const json = jsonReq;
const from = (ip: string): RequestInit => ({ headers: { "x-forwarded-for": ip } });
const campaignFiles = () => readdirSync(dir).filter((f) => f.startsWith("campaign-")).sort();
const DEMO_HEAD = await base.head();
/** A publishable campaign body for the demo AUSD/USDC book: the demo campaign's rules, starting 300 blocks from now. */
const demoCampaign = (): Record<string, unknown> => {
  const { rationale: _r, ...c } = JSON.parse(readFileSync(`${dir}/campaign-ausd-usdc-demo.json`, "utf8"));
  return { ...c, replayFromBlock: DEMO_HEAD + 300 };
};

/** Full SIWE round trip with a local wallet; returns the `sb_sess=...` cookie pair. */
async function signIn(base: string, wallet: ethers.Wallet, ip: string) {
  const c = await (await fetch(`${base}/api/auth/nonce?address=${wallet.address}`, from(ip))).json();
  const r = await fetch(base + "/api/auth/verify", json({ nonce: c.nonce, signature: await wallet.signMessage(c.message) }, ip));
  assert.equal(r.status, 200, "sign-in");
  await r.text();
  return r.headers.get("set-cookie")!.split(";")[0]!;
}
const sponsor = ethers.Wallet.createRandom();

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

// ---------- 6. publish: session required; strict schema; junk on disk cannot break /api/book ----------
{
  const before = campaignFiles();
  const anon = await fetch(url + "/api/campaigns", jsonReq({ campaign: { ...demoCampaign(), id: "ausd-usdc-1" } }, "10.6.0.1"));
  assert.equal(anon.status, 401);
  await anon.text();
  const cookie = await signIn(url, sponsor, "10.6.0.1");
  const authed = (body: unknown, ip: string) => jsonReq(body, ip, { cookie });
  const { market: _m, ...noMarket } = demoCampaign();
  const r = await fetch(url + "/api/campaigns", authed({ campaign: { ...noMarket, id: "ausd-usdc-1" } }, "10.6.0.1"));
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
    { ...demoCampaign(), id: "ausd-usdc-8", refPrice: "0" }, // would divide by zero when the epoch is built
    { ...demoCampaign(), id: "ausd-usdc-9", sampleEvery: 10_000, epochBlocks: 600 }, // no sample window fits
    { ...demoCampaign(), id: "ausd-usdc-10", replayFromBlock: 1e12 }, // far future: would sort first and redraw the book
    { ...demoCampaign(), id: "ausd-usdc-11", replayFromBlock: 0 },
  ]) {
    const rb = await fetch(url + "/api/campaigns", authed({ campaign: bad }, "10.6.0.1"));
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
ok("publish: no session -> 401; missing market, shadow key, wrong book, wrong pair id, traversal id, bad numbers, zero ref price, sample > epoch, start far from now, non-USDC reward -> 400, nothing written; junk files cannot break /api/book");

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

// ---------- 9. Sign-In with Ethereum ----------
{
  const wallet = ethers.Wallet.createRandom();
  const ip = "10.9.0.1";
  const port = new URL(url).port;
  const nonceRes = await fetch(`${url}/api/auth/nonce?address=${wallet.address.toLowerCase()}`, from(ip));
  const c = await nonceRes.json();
  assert.match(c.nonce, /^[0-9a-f]{32}$/);
  const lines = c.message.split("\n");
  assert.equal(lines[0], `127.0.0.1:${port} wants you to sign in with your Ethereum account:`);
  assert.equal(lines[1], wallet.address, "checksummed address");
  assert.equal(lines[3], "Sign in to Spreadbounty. This signature does not move funds or approve anything.");
  for (const l of [`URI: http://127.0.0.1:${port}`, "Version: 1", "Chain ID: 143", `Nonce: ${c.nonce}`]) assert.ok(lines.includes(l), l);
  const issued = Date.parse(lines.find((l: string) => l.startsWith("Issued At: ")).slice(11));
  const expires = Date.parse(lines.find((l: string) => l.startsWith("Expiration Time: ")).slice(17));
  assert.equal(expires - issued, 5 * 60_000);

  assert.equal((await fetch(url + "/api/me", from(ip))).status, 401, "signed out");
  const verify = await fetch(url + "/api/auth/verify", json({ nonce: c.nonce, signature: await wallet.signMessage(c.message) }, ip));
  assert.equal(verify.status, 200);
  assert.deepEqual(await verify.json(), { address: wallet.address });
  const setCookie = verify.headers.get("set-cookie")!;
  assert.match(setCookie, /^sb_sess=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800$/, "no Secure over plain http");
  const cookie = setCookie.split(";")[0]!;
  const me = await (await fetch(url + "/api/me", { headers: { cookie, "x-forwarded-for": ip } })).json();
  assert.deepEqual(me, { address: wallet.address, roles: { sponsorOf: [], makerIn: [] } });

  // the same nonce again, even with a valid signature
  const replay = await fetch(url + "/api/auth/verify", json({ nonce: c.nonce, signature: await wallet.signMessage(c.message) }, ip));
  assert.equal(replay.status, 401);
  assert.match((await replay.json()).error, /already used/);
  // signed by someone else
  const c2 = await (await fetch(`${url}/api/auth/nonce?address=${wallet.address}`, from(ip))).json();
  const other = ethers.Wallet.createRandom();
  const wrong = await fetch(url + "/api/auth/verify", json({ nonce: c2.nonce, signature: await other.signMessage(c2.message) }, ip));
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("set-cookie"), null);
  await wrong.text();
  // the failed attempt burned that nonce too
  assert.equal((await fetch(url + "/api/auth/verify", json({ nonce: c2.nonce, signature: await wallet.signMessage(c2.message) }, ip))).status, 401);
  // expired: 5 minutes and a second later
  const c3 = await (await fetch(`${url}/api/auth/nonce?address=${wallet.address}`, from("10.9.0.2"))).json();
  clock += 5 * 60_000 + 1000;
  const late = await fetch(url + "/api/auth/verify", json({ nonce: c3.nonce, signature: await wallet.signMessage(c3.message) }, "10.9.0.2"));
  assert.equal(late.status, 401);
  assert.match((await late.json()).error, /expired/);
  // garbage signature of the right shape: 401, not 500
  const c4 = await (await fetch(`${url}/api/auth/nonce?address=${wallet.address}`, from("10.9.0.2"))).json();
  const junk = await fetch(url + "/api/auth/verify", json({ nonce: c4.nonce, signature: "0x" + "00".repeat(65) }, "10.9.0.2"));
  assert.equal(junk.status, 401);
  await junk.text();

  // tampered cookies are signed out
  const [payload, sig] = cookie.slice("sb_sess=".length).split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ addr: other.address.toLowerCase(), exp: clock + 3_600_000 })).toString("base64url");
  const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
  const otherSecret = await boot({ SESSION_SECRET: "a-different-secret-for-another-deployment-xx" });
  const foreign = await signIn(otherSecret, wallet, "10.9.0.3");
  for (const bad of [`sb_sess=${forgedPayload}.${sig}`, `sb_sess=${payload}.${flip(sig!)}`, `sb_sess=${payload}`, `sb_sess=${payload}.${sig}.x`, "sb_sess=", foreign])
    assert.equal((await fetch(url + "/api/me", { headers: { cookie: bad, "x-forwarded-for": ip } })).status, 401, bad.slice(0, 40));
  // and an expired session is signed out
  clock += 8 * 3600_000;
  assert.equal((await fetch(url + "/api/me", { headers: { cookie, "x-forwarded-for": ip } })).status, 401, "session older than 8 h");
  clock -= 8 * 3600_000;
}
ok("SIWE: server-built EIP-4361 message (host, chain 143, nonce, 5-min expiry); valid signature -> HttpOnly SameSite=Strict cookie -> /api/me; reused, burned, expired, wrong-signer and junk signatures -> 401; tampered, foreign-secret and expired cookies are signed out");

{
  const wallet = ethers.Wallet.createRandom();
  const c = await (await fetch(`${url}/api/auth/nonce?address=${wallet.address}`, { headers: { "x-forwarded-for": "10.9.1.1", "x-forwarded-proto": "https" } })).json();
  assert.ok(c.message.includes(`URI: https://127.0.0.1:${new URL(url).port}`));
  const r = await fetch(url + "/api/auth/verify", json({ nonce: c.nonce, signature: await wallet.signMessage(c.message) }, "10.9.1.1", { "x-forwarded-proto": "https" }));
  assert.match(r.headers.get("set-cookie")!, /; Secure$/);
  await r.text();
  // without TRUST_PROXY the forwarded headers are ignored: no Secure, and X-Forwarded-For cannot dodge the limit
  const direct = await boot({ TRUST_PROXY: "0" });
  const c2 = await (await fetch(`${direct}/api/auth/nonce?address=${wallet.address}`, { headers: { "x-forwarded-proto": "https" } })).json();
  assert.ok(c2.message.includes("URI: http://"));
  const codes: number[] = [];
  for (let i = 0; i < 11; i++) {
    const rr = await fetch(`${direct}/api/auth/nonce?address=${wallet.address}`, { headers: { "x-forwarded-for": `10.99.0.${i}` } });
    codes.push(rr.status);
    await rr.text();
  }
  assert.equal(codes.filter((x) => x === 429).length, 2, "10 per minute per socket address, whatever X-Forwarded-For says");
  // a Host this deploy does not serve cannot be named in a message
  const res = await raw(url, `GET /api/auth/nonce?address=${wallet.address} HTTP/1.1\r\nHost: evil.example\r\nX-Forwarded-For: 10.9.1.2\r\nConnection: close\r\n\r\n`);
  assert.match(res, /^HTTP\/1\.1 400/);
  // CSRF: a foreign Origin cannot complete a sign-in, and a form post is not JSON
  const c3 = await (await fetch(`${url}/api/auth/verify`, json({}, "10.9.1.3", { origin: "https://evil.example" }))).status;
  assert.equal(c3, 403);
  const form = await fetch(url + "/api/auth/verify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "10.9.1.3" }, body: "nonce=x" });
  assert.equal(form.status, 415);
  await form.text();
  // logout clears the cookie
  const out = await fetch(url + "/api/auth/logout", json({}, "10.9.1.3"));
  assert.match(out.headers.get("set-cookie")!, /^sb_sess=; .*Max-Age=0/);
  await out.text();
}
ok("SIWE: Secure cookie and https URI behind a trusted proxy only; X-Forwarded-For ignored without TRUST_PROXY; unknown Host -> 400; foreign Origin -> 403; form post -> 415; logout clears the cookie");

// ---------- 10. publish as a signed-in sponsor; caps; roles ----------
{
  const cookie = await signIn(url, sponsor, "10.10.0.1");
  const ids: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = await fetch(url + "/api/campaigns", jsonReq({ campaign: { ...demoCampaign(), id: `ausd-usdc-${100 + i}`, bandBps: 40, refPrice: "10100000", sponsor: "0xDE00000000000000000000000000000000005150" }, rationale: "test" }, "10.10.0.1", { cookie }));
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.deepEqual(body, { id: `ausd-usdc-${100 + i}`, path: `campaign-ausd-usdc-${100 + i}.json` });
    ids.push(body.id);
  }
  const stored = JSON.parse(readFileSync(`${dir}/campaign-ausd-usdc-101.json`, "utf8"));
  assert.equal(stored.sponsor, sponsor.address, "sponsor is the session address, whatever the body said");
  const fourth = await fetch(url + "/api/campaigns", jsonReq({ campaign: { ...demoCampaign(), id: "ausd-usdc-104" } }, "10.10.0.1", { cookie }));
  assert.equal(fourth.status, 429, "fourth publish in a day");
  assert.ok(Number(fourth.headers.get("retry-after")) > 0);
  await fourth.text();

  const book = await (await fetch(url + "/api/book?pair=AUSD/USDC&hours=2.5", from("10.10.0.1"))).json();
  assert.deepEqual([book.bandBps, book.refPrice], [15, 1], "a new publish cannot redraw the public book over the running campaign");

  // maker role: put this wallet into the payouts of demo epochs 1 and 2 (temp copy only)
  for (const [n, amt] of [[1, "1500000"], [2, "2500000"]] as const) {
    const f = `${dir}/ausd-usdc-demo/epoch-${n}.json`;
    const e = JSON.parse(readFileSync(f, "utf8"));
    e.amounts.push({ account: sponsor.address.toLowerCase(), amount: amt });
    e.cumulative.push({ account: sponsor.address.toLowerCase(), amount: amt });
    writeFileSync(f, JSON.stringify(e));
  }
  const me = await (await fetch(url + "/api/me", { headers: { cookie, "x-forwarded-for": "10.10.0.1" } })).json();
  assert.equal(me.address, sponsor.address);
  assert.deepEqual([...me.roles.sponsorOf].sort(), ids);
  assert.deepEqual(me.roles.makerIn, [{ campaign: "ausd-usdc-demo", epochs: [1, 2], cumulative: "2500000" }]);

  // 50 campaigns in total on a PUBLIC_DEMO server
  const full = mkdtempSync(join(tmpdir(), "sb-server-full-"));
  for (let i = 0; i < 50; i++) writeFileSync(`${full}/campaign-ausd-usdc-${i}.json`, JSON.stringify({ ...demoCampaign(), id: `ausd-usdc-${i}` }));
  const pub = await boot({ PUBLIC_DEMO: "1" }, { ...src, dir: full });
  const pubCookie = await signIn(pub, ethers.Wallet.createRandom(), "10.10.0.2");
  const capped = await fetch(pub + "/api/campaigns", jsonReq({ campaign: { ...demoCampaign(), id: "ausd-usdc-999" } }, "10.10.0.2", { cookie: pubCookie }));
  assert.equal(capped.status, 429);
  assert.match((await capped.json()).error, /50 campaigns/);
  rmSync(full, { recursive: true, force: true });
}
{
  // sign-in is free: one IP with many wallets still gets 5 publishes a day
  const ip = "10.10.2.1";
  const codes: number[] = [];
  for (let w = 0; w < 2; w++) {
    const cookie = await signIn(url, ethers.Wallet.createRandom(), ip);
    for (let i = 0; i < 3; i++) {
      const r = await fetch(url + "/api/campaigns", jsonReq({ campaign: { ...demoCampaign(), id: `ausd-usdc-2${w}${i}` } }, ip, { cookie }));
      codes.push(r.status);
      await r.text();
    }
  }
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
}
ok("publish: signed-in sponsor -> 201, stored sponsor = session address, book keeps the running campaign's band; 4th per address and 6th per IP in a day -> 429; 50 total on PUBLIC_DEMO -> 429; /api/me roles from public files");

{
  // what the Design page does: copilot result -> publish, as a signed-in sponsor
  const ip = "10.10.1.1";
  const cookie = await signIn(url, ethers.Wallet.createRandom(), ip);
  for (const goal of ["Deepen AUSD/USDC within 15 bps for $50 a day", "MON/USDC two-sided, about $700 a week, 30 minute epochs"]) {
    const stream = await (await fetch(url + "/api/copilot", json({ goal }, ip))).text();
    const result = JSON.parse(stream.trim().split("\n").pop()!);
    assert.equal(result.type, "result");
    const r = await fetch(url + "/api/campaigns", jsonReq({ campaign: result.campaign, rationale: result.brief }, ip, { cookie }));
    assert.equal(r.status, 201, await r.text());
  }
}
ok("publish: campaigns the copilot designs (AUSD and MON) pass the strict schema");

// ---------- 11. adversarial-pass regressions ----------
{
  const ip = "10.11.0.1";
  // read-only routes refuse writes instead of answering them
  for (const [method, path] of [["POST", "/api/campaigns/ausd-usdc-demo"], ["DELETE", "/api/campaigns"], ["PUT", "/api/campaigns/ausd-usdc-demo/epochs/0"], ["GET", "/api/campaigns/ausd-usdc-demo/epochs/0/report"]]) {
    const r = await fetch(url + path, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: method === "GET" ? undefined : "{}" });
    assert.equal(r.status, 405, `${method} ${path}`);
    await r.text();
  }
  // bot-sim and reports share two server-wide slots: a third concurrent backtest gets 429, not a third replay
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  const held = [101, 102].map((size, i) => fetch(`${url}/api/campaigns/ausd-usdc-demo/bot-sim?epoch=2&size=${size}`, from(`10.11.1.${i}`)));
  await new Promise((r) => setTimeout(r, 100));
  const third = await fetch(`${url}/api/campaigns/ausd-usdc-demo/bot-sim?epoch=2&size=103`, from("10.11.1.9"));
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get("retry-after")) > 0);
  await third.text();
  gate = null;
  release();
  for (const r of await Promise.all(held)) assert.equal(r.status, 200, await r.text());
  // "/x/" and "//x" spellings land in the same rate bucket as "/x"
  const sims: number[] = [];
  for (const path of Array.from({ length: 11 }, (_, i) => (i % 2 ? "/api/campaigns//ausd-usdc-demo/bot-sim" : "/api/campaigns/ausd-usdc-demo/bot-sim/"))) {
    const r = await fetch(`${url}${path}?epoch=2&size=5`, from("10.11.3.1"));
    sims.push(r.status);
    await r.text();
  }
  assert.deepEqual(sims, [...Array(10).fill(200), 429]);
  // deep JSON, prototype keys and a nested goal are plain 400s
  for (const body of ["[".repeat(8000) + "]".repeat(8000), '{"__proto__":{"admin":true},"goal":"x"}', `{"goal":${"[".repeat(5000)}${"]".repeat(5000)}}`]) {
    const r = await fetch(url + "/api/copilot", json(body, `10.11.2.${body.length % 200}`));
    assert.equal(r.status, 400);
    await r.text();
  }
  assert.equal(({} as Record<string, unknown>).admin, undefined, "no prototype pollution");
  assert.equal((await fetch(url + "/api/config", from(ip))).status, 200, "still up");
}
ok("adversarial regressions: writes to read-only routes -> 405; third concurrent backtest -> 429; trailing/double-slash paths share the 10/min model bucket; deep/prototype JSON -> 400, no pollution");

{
  const before = serverLog.length;
  await boot({ SESSION_SECRET: "" });
  assert.ok(serverLog.slice(before).some((l) => /SESSION_SECRET is not set/.test(l)), "warns when the secret is random per boot");
}
assert.throws(() => createApp({ src, env: { SESSION_SECRET: "too-short" } }), /at least 32 characters/);
ok("SESSION_SECRET unset -> random per boot, with a logged warning; set but short -> refuses to start");

await Promise.all(servers.map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })));
rmSync(dir, { recursive: true, force: true });
console.log(`${count} tests passed`);
