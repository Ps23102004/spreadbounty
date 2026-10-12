// Captures REAL screens of the running Spreadbounty app. No interventions: clicks only, as a user would.
// Usage: node video/capture/capture.mjs demo   (app on :8787, npm start / AI_PROVIDER=off, synthetic data)
//        node video/capture/capture.mjs live   (app on :18787, DATA_SOURCE=live AI_PROVIDER=off, read-only mainnet)
import { createRequire } from "node:module";
const puppeteer = createRequire(import.meta.url)("/Users/parthsingh/.local/lib/node_modules/hyperframes/node_modules/puppeteer-core");
const mode = process.argv[2] ?? "demo";
const base = mode === "live" ? "http://localhost:18787" : "http://localhost:8787";
const out = new URL("./shots/", import.meta.url).pathname + mode + "-";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-first-run", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
const shot = async (name, full = true) => { await page.screenshot({ path: out + name + ".png", fullPage: full }); console.log("shot", name); };
const clickText = async (sel, text) => {
  const ok = await page.evaluate((sel, text) => { const b = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(text)); if (b) b.click(); return !!b; }, sel, text);
  if (!ok) throw new Error(`no ${sel} "${text}"`);
};
const waitText = (text, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const go = async (hash) => { await page.goto(`${base}/#${hash}`, { waitUntil: "networkidle0" }); await sleep(2500); };

if (mode === "demo") {
  await go("overview"); await shot("overview");
  await go("design"); await shot("design-0-input", false);
  await clickText("button", "Design campaign");
  for (let i = 1; i <= 6; i++) { await sleep(180); await shot(`design-1-steps-${i}`, false); }
  await waitText("Publish campaign"); await sleep(1500); await shot("design-2-result");
  await go("makers"); await waitText("Backtest"); await sleep(3000); await shot("makers");
  await go("verify"); await shot("verify-0", false);
  await clickText("button", "Recompute in this browser");
  for (let i = 1; i <= 4; i++) { await sleep(120); await shot(`verify-1-run-${i}`, false); }
  await waitText("Verified"); await sleep(1200); await shot("verify-2-ok", false);
  await page.click("label.switch input"); await sleep(600); await shot("verify-3-forged-on", false);
  await clickText("button", "Recompute in this browser");
  await waitText("Mismatch: do not pay"); await sleep(1200); await shot("verify-4-mismatch", false);
  // a clean forged run: fresh page, toggle on, recompute (no earlier "Verified" result on screen)
  await go("overview"); await go("verify"); await page.click("label.switch input"); await sleep(600); await shot("verify-5-forged-fresh", false);
  await clickText("button", "Recompute in this browser");
  await sleep(120); await shot("verify-6-forged-running", false);
  await waitText("Mismatch: do not pay"); await sleep(1200); await shot("verify-7-mismatch-fresh", false);
  await go("claim"); await shot("claim-0", false);
  await clickText(".examples button", "Maker A1"); await sleep(1500); await shot("claim-a1");
  await clickText(".examples button", "Maker B2"); await sleep(1500); await shot("claim-b2");
} else {
  await go("overview"); await shot("overview", false);
  await go("design");
  await clickText(".examples button", "Deepen MON/USDC"); await sleep(400); await shot("design-0-input", false);
  await clickText("button", "Design campaign");
  for (let i = 1; i <= 4; i++) { await sleep(1500); await shot(`design-1-steps-${i}`, false); }
  await page.waitForFunction(() => document.body.innerText.includes("Publish campaign") || document.querySelector(".note.bad"), { timeout: 600000 });
  await sleep(1500); await shot("design-2-result");
}
await browser.close();
