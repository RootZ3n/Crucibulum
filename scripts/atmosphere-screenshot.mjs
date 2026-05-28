#!/usr/bin/env node
/**
 * Luak — Atmosphere pass screenshot helper.
 *
 * Captures Dashboard-tab full-page screenshots at three viewports
 * (desktop 1920×1080, desktop 1440×900, mobile 390×844). Used for
 * before/after visual comparison of the atmosphere CSS layers.
 *
 *   node scripts/atmosphere-screenshot.mjs --base http://127.0.0.1:14758 --label before
 *   # apply CSS …
 *   node scripts/atmosphere-screenshot.mjs --base http://127.0.0.1:14758 --label after
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  if (i < 0 || i + 1 >= argv.length) return d;
  return argv[i + 1];
};
const BASE = arg("--base", "http://127.0.0.1:14758");
const LABEL = arg("--label", "shot");
const TAB = arg("--tab", "dashboard");

const OUT = join(ROOT, "reports", "ui-polish", "atmosphere-pass", "screenshots");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
  { name: "desktop-1440x900",  width: 1440, height:  900 },
  { name: "mobile-390x844",    width:  390, height:  844 },
];

const profile = `/tmp/luak-atmo-chrome-${Date.now()}`;
mkdirSync(profile, { recursive: true });

async function fetchJSON(url, retries = 30) {
  for (let i = 0; i < retries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`fetch ${url} never succeeded`);
}

async function withWS(wsUrl, fn) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: r, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else r(msg.result);
    }
  });
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  function send(method, params = {}) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((rs, rj) => pending.set(id, { resolve: rs, reject: rj }));
  }
  try { return await fn({ send }); } finally { ws.close(); }
}

async function main() {
  const port = 9333 + Math.floor(Math.random() * 200);
  const child = spawn("/usr/bin/chromium", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    "--disable-extensions", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  try {
    const list = await fetchJSON(`http://127.0.0.1:${port}/json`);
    const target = list.find((t) => t.type === "page") || list[0];
    if (!target) throw new Error("no devtools target");
    for (const vp of VIEWPORTS) {
      await withWS(target.webSocketDebuggerUrl, async ({ send }) => {
        await send("Page.enable");
        await send("Runtime.enable");
        await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false });
        await send("Page.navigate", { url: BASE + "/" });
        await new Promise((r) => setTimeout(r, 1200));
        await send("Runtime.evaluate", { expression: `try{localStorage.setItem('crucibulum-active-tab', ${JSON.stringify(TAB)})}catch(e){};true`, returnByValue: true });
        await send("Page.reload");
        // Wait for the app shell to actually render (boot() is async and
        // fixed timeouts can race it on cold load).
        await send("Runtime.evaluate", {
          expression: `new Promise((resolve)=>{const start=Date.now();const check=()=>{const ok=document.querySelectorAll('.app-shell .panel').length>0;if(ok)return resolve('ready');if(Date.now()-start>15000)return resolve('timeout');setTimeout(check,200)};check();})`,
          returnByValue: true,
          awaitPromise: true,
        });
        // Settle: let any post-boot async render flush.
        await new Promise((r) => setTimeout(r, 1500));
        const probe = await send("Runtime.evaluate", {
          expression: `JSON.stringify({docW:document.documentElement.scrollWidth,docH:document.documentElement.scrollHeight,shellCount:document.querySelectorAll('.app-shell').length,panelCount:document.querySelectorAll('.panel').length})`,
          returnByValue: true,
        });
        console.log(`     probe ${vp.name}:`, probe.result.value);
        const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        const file = join(OUT, `${LABEL}__${vp.name}__${TAB}.png`);
        writeFileSync(file, Buffer.from(shot.data, "base64"));
        console.log(`  ✓ ${vp.name} → ${file}`);
      });
    }
  } finally {
    child.kill("SIGTERM");
    setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1500);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => { console.error("fatal:", err); process.exit(1); });
