// Captures REAL screens of the running (redesigned) Spreadbounty app into video/shared/ui/r-*.png. Clicks only, as a user would.
// Usage (from spreadbounty/):  npm run demo:gen && AI_PROVIDER=off PORT=18951 npm run serve                                  (demo, synthetic)
//                              DATA_SOURCE=live DATA_DIR=data/shadow AI_PROVIDER=off PORT=18952 npm run serve             (shadow: real mainnet logs, nothing paid)
//        node video/capture/capture.mjs demo|shadow [W H]     default 1440x900 at 2x into shared/ui/; other sizes at 1x into shared/ui/<H>/
//        Full-page PNGs (the sticky top bar sits at the image top, which hf.js pins). Only shots the videos use; sync.sh copies shared/ui/*.png.
import { createRequire } from "node:module";
const puppeteer = createRequire(import.meta.url)("/Users/parthsingh/.local/lib/node_modules/hyperframes/node_modules/puppeteer-core");
const mode = process.argv[2] ?? "demo";
const W = +(process.argv[3] ?? 1440), H = +(process.argv[4] ?? 900), dpr = W === 1440 ? 2 : 1;
const base = mode === "shadow" ? "http://localhost:18952" : "http://localhost:18951";
const dir = new URL(W === 1440 ? "../shared/ui/" : `../shared/ui/${H}/`, import.meta.url).pathname;
(await import("node:fs")).mkdirSync(dir, { recursive: true });
const out = dir + "r-" + (mode === "shadow" ? "shadow-" : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, protocolTimeout: 900000, args: ["--no-first-run", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: dpr });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
const shot = async (name, full = true) => { await page.screenshot({ path: out + name + ".png", fullPage: full }); console.log("shot", out + name); };
const clickText = async (sel, text) => {
  const ok = await page.evaluate((sel, text) => { const b = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().toLowerCase().startsWith(text.toLowerCase())); if (b) b.click(); return !!b; }, sel, text);
  if (!ok) throw new Error(`no ${sel} "${text}"`);
};
const until = (fn, timeout = 120000) => page.waitForFunction(fn, { timeout, polling: 200 });
const idle = () => until(() => !document.querySelector(".btn.recompute .spinner"));
const settle = mode === "shadow" ? 8000 : 2500; // the shadow book needs ~6 s on first load
const go = async (hash) => { await page.goto(`${base}/#${hash}`, { waitUntil: "networkidle0", timeout: 60000 }); await sleep(settle); };
const forge = () => page.click("label.switch input");

if (mode === "shadow") {
  // Overview of the shadow campaign (real mainnet logs, nothing paid), and the copilot reading live mainnet logs (read-only)
  await go("overview"); await shot("overview");
  await go("design"); await clickText(".examples button", "Deepen MON/USDC"); await clickText("button", "Design campaign");
  await until(() => document.querySelector(".publish, .note.bad"), 600000); await sleep(2000); await shot("design-result");
} else {
  // Start: press Recompute, let the tape finish
  await go("start"); await clickText("button.recompute", "Recompute");
  await idle(); await until(() => document.querySelector("p.verdict.ok, p.verdict.bad")); await sleep(2500); await shot("start");
  // Verify: honest run, then forged on top of it, then a fresh forged run (EXCEPTION)
  await go("verify"); await shot("verify-0");
  await clickText("button.recompute", "Recompute"); await sleep(300); await shot("verify-running");
  await idle(); await until(() => document.querySelector(".v-verdict p.ok, .v-verdict p.bad-ink")); await sleep(2500); await shot("verify-ok");
  await forge(); await sleep(600); await shot("verify-forged-on");
  await clickText("button.recompute", "Recompute"); await idle(); await until(() => document.querySelector(".v-verdict p.bad-ink")); await sleep(2500); await shot("verify-mismatch-2");
  await go("overview"); await go("verify"); await forge(); await sleep(600); await shot("verify-forged-fresh");
  await clickText("button.recompute", "Recompute"); await sleep(300); await shot("verify-forged-running");
  await idle(); await until(() => document.querySelector(".v-verdict p.bad-ink")); await sleep(2500); await shot("verify-forged");
  // Make markets: backtest, then the rest clock (the sample block lands at a moment nobody can predict)
  await go("makers"); await until(() => document.body.innerText.includes("Spreadbounty bot")); await sleep(1500); await shot("makers");
  await go("makers/rest"); await clickText("button", "Place quote"); await sleep(7800); await shot("makers-rest");
  await go("claim"); await shot("claim");
  // Design: rules only (AI_PROVIDER=off)
  await go("design"); await shot("design-input");
  await clickText("button", "Design campaign"); await sleep(400); await shot("design-running");
  await until(() => document.querySelector(".publish, .note.bad"), 600000); await sleep(2000); await shot("design-result");
}
await browser.close();
