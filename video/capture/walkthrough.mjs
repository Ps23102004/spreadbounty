// A REAL interactive walkthrough of the running app, recorded with Playwright's recordVideo (one continuous take).
// A fake cursor and a click ripple are injected so viewers can follow the mouse; every action is a real mouse event.
// Servers (from spreadbounty/, after `npm run build:web && npm run demo:gen`):
//   env -u TYPESAFE_API_KEY -u ANTHROPIC_API_KEY -u OPENAI_API_KEY AI_PROVIDER=off PORT=18951 npm run serve                                  (demo)
//   env -u TYPESAFE_API_KEY -u ANTHROPIC_API_KEY -u OPENAI_API_KEY DATA_SOURCE=live DATA_DIR=data/shadow AI_PROVIDER=off PORT=18952 npm run serve (shadow)
// Usage: node video/capture/walkthrough.mjs   -> spreadbounty/docs/media/walkthrough.{mp4,gif} and walkthrough-poster.png
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { chromium } = createRequire(import.meta.url)("/Users/parthsingh/.local/lib/node_modules/@playwright/cli/node_modules/playwright-core");

const SHADOW = "http://localhost:18952", DEMO = "http://localhost:18951";
const W = 1440, H = 900;
const media = new URL("../../spreadbounty/docs/media/", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "sb-walk-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...a) => execFileSync("/opt/homebrew/bin/ffmpeg", ["-v", "error", "-y", ...a], { stdio: "inherit" });

// cursor + ripple, re-installed on every document (it survives the switch from the shadow to the demo instance)
const overlay = () => {
  const arrow = `<svg viewBox="0 0 44 56" width="24" height="31" style="display:block"><path d="M3 3 L3 44 L13 34 L20 52 L28 48 L21 31 L36 31 Z" fill="#1b1813" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>`;
  const install = () => {
    const c = document.createElement("div");
    c.id = "wt-cursor"; c.innerHTML = arrow;
    c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:0;will-change:transform;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))";
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.opacity = "1"; c.style.transform = `translate(${e.clientX - 2}px,${e.clientY - 2}px)`; }, true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;border:3px solid #c93a24;z-index:2147483646;pointer-events:none`;
      document.documentElement.appendChild(r);
      r.animate([{ transform: "scale(.3)", opacity: 1 }, { transform: "scale(1.5)", opacity: 0 }], { duration: 480, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => r.remove();
    }, true);
  };
  if (document.documentElement) install(); else addEventListener("DOMContentLoaded", install);
};

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--hide-scrollbars"] });

// warm the shadow server's book cache (60 s) off camera, so the take doesn't open on a 6 s spinner
{
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  await p.goto(`${SHADOW}/#start`); await p.locator(".probe input[type=range]").waitFor({ timeout: 90000 }); await p.close();
}

const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: "light", recordVideo: { dir: tmp, size: { width: W, height: H } } });
await ctx.addInitScript(overlay);
const page = await ctx.newPage();
const t0 = Date.now();
const at = () => (Date.now() - t0) / 1000;

let cx = 400, cy = 760; // starts in empty space, off the book (no hover tooltip)
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const glide = async (x, y, ms = 520) => {
  const n = Math.max(10, Math.round(ms / 16)), x0 = cx, y0 = cy;
  for (let i = 1; i <= n; i++) { const e = ease(i / n); await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e); await sleep(ms / n); }
  cx = x; cy = y;
};
const press = async () => { await page.mouse.down(); await sleep(90); await page.mouse.up(); };
const click = async (loc, { dx = 0.5, dy = 0.5, ms = 520 } = {}) => {
  await loc.waitFor({ state: "visible", timeout: 30000 });
  const b = await loc.boundingBox();
  await glide(b.x + b.width * dx, b.y + b.height * dy, ms); await sleep(120); await press();
};
// smooth scroll so the top edge of `sel` sits just under the sticky top bar (nothing half-hidden behind it)
const scrollTo = async (sel, gap = 12) => { await page.evaluate(([sel, gap]) => { const top = document.querySelector(sel).getBoundingClientRect().top + scrollY - document.querySelector(".topbar").offsetHeight - gap; scrollTo({ top, behavior: "smooth" }); }, [sel, gap]); await sleep(800); };
const tab = (name) => page.locator("nav.itabs a.itab", { hasText: name });
const sub = (name) => page.locator(`a[href^="#"]`, { hasText: new RegExp(`^${name}$`) });

// 1. Start, shadow instance: the real MON/USDC book, then the quote probe across the band
await page.goto(`${SHADOW}/#start`);
const range = page.locator(".probe input[type=range]");
await range.waitFor({ timeout: 90000 });
const trimFrom = Math.max(0, at() - 0.2);
await page.mouse.move(cx, cy); // shows the cursor
await sleep(1100);
const rb = await range.boundingBox();
const { v, min, max } = await range.evaluate((el) => ({ v: +el.value, min: +el.min, max: +el.max }));
const xOf = (k) => rb.x + 10 + ((k - min) / (max - min)) * (rb.width - 20);
await glide(xOf(v), rb.y + rb.height / 2, 650); await sleep(200);
await page.mouse.down();
await glide(xOf(min * 0.77), cy, 850); await sleep(350);   // just inside the lower band edge
await glide(xOf(max * 0.77), cy, 1150); await sleep(350);   // across to the upper edge
await glide(xOf(max * 0.15), cy, 550);
await page.mouse.up(); await sleep(900);

// 2. Recompute from logs fetched straight from the Monad RPC: VERIFIED. Then forge one payout: EXCEPTION.
await click(page.locator("button.recompute"));
await glide(622, 560, 500);                                  // off the button, into the gutter beside the tape
await page.locator("p.verdict.ok, p.verdict.bad").waitFor({ timeout: 120000 });
const tVerified = at();
await sleep(800);
await page.screenshot({ path: join(media, "walkthrough-poster.png") });
await sleep(900);
await click(page.locator(".start-actions label.switch"), { dx: 0.08 }); await sleep(900);
await click(page.locator("button.recompute"));
await glide(622, 560, 450);
await page.locator("p.verdict.bad").waitFor({ timeout: 120000 });
await sleep(2000);
const tShadowEnd = at();

// 3. Demo instance, same take: Make markets -> Rest clock -> Backtest
await page.goto(`${DEMO}/#start`);
await page.locator(".start-tape").waitFor(); await page.mouse.move(cx, cy); await sleep(700);
await click(tab("Make markets")); await sleep(800);
await click(sub("Rest clock")); await sleep(700);
await click(page.getByRole("button", { name: /^Place (a new )?quote$/ })); await sleep(2700);
await click(sub("Backtest")); await sleep(600);
await click(page.getByRole("button", { name: "Backtest", exact: true }));
await page.locator("tr.highlight").waitFor({ timeout: 60000 }); await sleep(1600);

// 4. Verify: recompute in this browser, then forge and recompute: the mismatch
await click(tab("Verify")); await sleep(800);
await click(page.locator("button.recompute"));
await glide(1380, 600, 450);                                 // off the button, into the right gutter
await page.locator(".v-verdict p.ok").waitFor({ timeout: 60000 }); await sleep(1500);
await click(page.locator("label.switch"), { dx: 0.08 }); await sleep(600);
await click(page.locator("button.recompute"));
await page.locator(".v-verdict p.bad-ink").waitFor({ timeout: 60000 }); await sleep(600);
await glide(1380, 640, 450); await scrollTo(`section[aria-labelledby="sch-V-1"]`); await sleep(1500);

// 5. Claim on demo data: pick a maker, read the proof
await click(tab("Make markets")); await sleep(700);
await click(sub("Claim")); await sleep(700);
await click(page.locator(".examples button", { hasText: "Maker B2" })); await sleep(1000);
await glide(1380, 700, 450); await scrollTo("#addr", 8); await sleep(2000);
const tEnd = at();

const raw = await page.video().path();
await ctx.close(); await browser.close();
const webm = join(tmp, "take.webm"); renameSync(raw, webm);
const len = (tEnd - trimFrom).toFixed(2);
ffmpeg("-ss", trimFrom.toFixed(2), "-t", len, "-i", webm, "-an", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart", join(media, "walkthrough.mp4"));
// GIF: the best 30 s, the shadow segment (real mainnet logs: probe, VERIFIED, forged EXCEPTION); flat UI needs no dither
const gifLen = Math.min(30, tShadowEnd - trimFrom).toFixed(2), pal = join(tmp, "pal.png");
ffmpeg("-t", gifLen, "-i", join(media, "walkthrough.mp4"), "-vf", "fps=12,scale=800:-1:flags=lanczos,palettegen=max_colors=96:stats_mode=diff", pal);
ffmpeg("-t", gifLen, "-i", join(media, "walkthrough.mp4"), "-i", pal, "-lavfi", "fps=12,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle", join(media, "walkthrough.gif"));
rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ trimFrom, seconds: +len, verifiedAt: +(tVerified - trimFrom).toFixed(2), gifSeconds: +gifLen }));
