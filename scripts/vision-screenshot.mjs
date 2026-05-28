#!/usr/bin/env node
/**
 * Luak — Vision Phase 8 browser screenshot driver
 *
 * Boots a headless Chromium with the DevTools Protocol exposed,
 * seeds localStorage so the Vision tab is the active room, and
 * captures full-page screenshots at four viewports for the
 * Phase 8 readability check.
 *
 * Optional capability variants:
 *   --variant default               (no seeded selectedModels — "no model selected")
 *   --variant vision-capable        (seeds preferred candidate xiaomi/mimo-v2.5 — Phase 13-B)
 *   --variant vision-capable-legacy (seeds legacy/proven fallback xiaomi/mimo-v2-omni)
 *   --variant text-only             (seeds a known text-only certified model)
 *
 * Output: PNGs under reports/capability-expansion/vision-phase8-browser-validation/screenshots/.
 *
 * Usage:
 *   node scripts/vision-screenshot.mjs --base http://127.0.0.1:14758
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "reports", "capability-expansion", "vision-phase8-browser-validation", "screenshots");
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  if (i < 0 || i + 1 >= argv.length) return d;
  return argv[i + 1];
};
const BASE = arg("--base", "http://127.0.0.1:14758");

const VIEWPORTS = [
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
  { name: "desktop-1440x900",  width: 1440, height:  900 },
  { name: "tablet-1024x768",   width: 1024, height:  768 },
  { name: "mobile-390x844",    width:  390, height:  844 },
];

const VARIANTS = [
  {
    name: "no-model",
    desc: "Vision tab, no model selected",
    seed: () => ({ activeTab: "vision", selectedModels: [] }),
  },
  {
    name: "vision-capable",
    desc: "Vision tab, preferred daily-driver candidate selected (Phase 13-B: xiaomi/mimo-v2.5)",
    seed: () => ({ activeTab: "vision", selectedModels: ["xiaomi/mimo-v2.5"] }),
  },
  {
    name: "vision-capable-legacy",
    desc: "Vision tab, legacy/proven fallback selected (xiaomi/mimo-v2-omni)",
    seed: () => ({ activeTab: "vision", selectedModels: ["xiaomi/mimo-v2-omni"] }),
  },
  {
    name: "text-only",
    desc: "Vision tab, a known text-only model selected (qwen3.5:9b)",
    seed: () => ({ activeTab: "vision", selectedModels: ["qwen3.5:9b"] }),
  },
];

const profile = `/tmp/luak-phase8-chrome-${Date.now()}`;
mkdirSync(profile, { recursive: true });

function debugPort() {
  // Pick a port unlikely to collide with the Luak API.
  return 9333 + Math.floor(Math.random() * 200);
}

async function fetchJSON(url, retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`fetch ${url} never succeeded`);
}

async function withWS(wsUrl, fn) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: r, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else r(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  function send(method, params = {}) {
    const id = nextId++;
    const payload = JSON.stringify({ id, method, params });
    ws.send(payload);
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  try {
    return await fn({ send, events });
  } finally {
    ws.close();
  }
}

async function captureForViewport(target, viewport, variant) {
  return withWS(target.webSocketDebuggerUrl, async ({ send }) => {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // First navigation: about:blank to install storage seeder.
    await send("Page.navigate", { url: BASE + "/" });
    // Wait for page load (Page.loadEventFired event). Poll DOM readiness as fallback.
    await new Promise((r) => setTimeout(r, 1200));
    // Seed localStorage with the variant's state, then reload.
    const seed = variant.seed();
    const seedScript = `
      try {
        localStorage.setItem('crucibulum-active-tab', ${JSON.stringify(seed.activeTab)});
      } catch (e) {}
      true;
    `;
    await send("Runtime.evaluate", { expression: seedScript, returnByValue: true });
    await send("Page.reload");
    // Wait longer than refreshTabData / reconcileTabSelection take, so when
    // we later force selectedModels via updateSelectedModels it doesn't
    // race with the post-boot auto-default a few hundred ms behind the
    // first render.
    await new Promise((r) => setTimeout(r, 4500));
    // If the variant seeds selectedModels, push them in via the global helper
    // exposed for tests/debug (window.updateSelectedModels). Build a fake
    // <select> with the right options checked.
    if (seed.selectedModels.length) {
      // Wait until the registry has populated. reconcileTabSelection
      // strips selectedModels values that aren't in validModelIds, then
      // backfills with preferredDefaultModelId() — so injecting before
      // the registry loads silently swaps qwen3.5:9b for the default.
      const waitForRegistry = `
        new Promise((resolve) => {
          const start = Date.now();
          const check = () => {
            try {
              const hasModels = state && state.registry && Array.isArray(state.registry.catalog) && state.registry.catalog.length > 0;
              if (hasModels) return resolve('ready:' + state.registry.catalog.length);
            } catch (e) {}
            if (Date.now() - start > 8000) return resolve('timeout');
            setTimeout(check, 150);
          };
          check();
        })
      `;
      await send("Runtime.evaluate", { expression: waitForRegistry, returnByValue: true, awaitPromise: true });
      const ids = JSON.stringify(seed.selectedModels);
      // Seed selectedModels directly into state so a late refreshTabData
      // (which can overwrite tabData with reconciled defaults) doesn't
      // race the seeding. Re-apply twice with a render in between to
      // win against any post-boot auto-default; the production UI is
      // unaffected because real users select via the dropdown.
      // `state` is declared as `const` in a classic <script>, so it's
      // accessible by bare name (not via window.state). Poll-and-reseed:
      // reconcileTabSelection may overwrite our seeding with the
      // preferredDefaultModelId backfill several times during cold boot.
      // We re-seed every 200ms for up to 4 seconds, then verify the
      // rendered hint matches the expected first id before screenshotting.
      const inject = `
        (async () => {
          const ids = ${ids};
          const targetId = ids[0];
          const start = Date.now();
          for (;;) {
            try {
              const cur = state.tabData.vision || {};
              state.tabData.vision = Object.assign({}, cur, { selectedModels: ids.slice() });
            } catch (e) {}
            if (typeof render === 'function') { try { render(); } catch (e) {} }
            await new Promise((r) => setTimeout(r, 200));
            // Inspect the rendered headline. If it mentions our target id
            // we are stable; otherwise re-seed.
            try {
              const headline = (document.querySelector('.vs-value.vc-cap-pass,.vs-value.vc-cap-skip,.vs-value.vc-cap-idle') || {}).textContent || '';
              if (headline.indexOf(targetId) >= 0) return 'stable:' + headline.slice(0, 80);
            } catch (e) {}
            if (Date.now() - start > 8000) return 'gaveup';
          }
        })()
      `;
      await send("Runtime.evaluate", { expression: inject, returnByValue: true, awaitPromise: true });
      // Give the render a beat to flush.
      await new Promise((r) => setTimeout(r, 400));
    }
    // Also call window.fetchVisionSmoke if available so the panel is populated
    // (it's called automatically by setActiveTab, but a forced fetch is a
    // belt-and-braces guarantee for the screenshot).
    await send("Runtime.evaluate", {
      expression: "typeof window.fetchVisionSmoke==='function'?window.fetchVisionSmoke(true).then(()=>true):false",
      returnByValue: true,
      awaitPromise: true,
    });
    await new Promise((r) => setTimeout(r, 1500));
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const file = join(OUT, `${viewport.name}__${variant.name}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    // Also dump body innerText length + a quick overflow probe for the
    // text report — caller can grep these from stdout.
    const probe = await send("Runtime.evaluate", {
      expression: `JSON.stringify({
        docW: document.documentElement.scrollWidth,
        docH: document.documentElement.scrollHeight,
        winW: window.innerWidth,
        hasVisionPanel: !!document.querySelector('[data-vision-panel="1"]'),
        cardCount: document.querySelectorAll('[data-vision-test]').length,
        expChip: !!Array.from(document.querySelectorAll('.chip')).find(c=>/EXPERIMENTAL/i.test(c.textContent)),
        leaderChip: !!Array.from(document.querySelectorAll('.chip')).find(c=>/NOT IN LEADERBOARD/i.test(c.textContent)),
        certChip: !!Array.from(document.querySelectorAll('.chip')).find(c=>/NOT CERTIFIED/i.test(c.textContent)),
        capHeadline: (document.querySelector('.vs-value.vc-cap-pass,.vs-value.vc-cap-skip,.vs-value.vc-cap-idle')||{}).textContent||null,
        proven: (document.querySelector('.vs-value.mono')||{}).textContent||null,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
      })`,
      returnByValue: true,
    });
    return { file, probe: JSON.parse(probe.result.value) };
  });
}

async function launchChromium() {
  const port = debugPort();
  const sessionProfile = `${profile}-${Math.random().toString(36).slice(2, 8)}`;
  mkdirSync(sessionProfile, { recursive: true });
  const child = spawn("/usr/bin/chromium", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-extensions",
    "--no-first-run",
    `--user-data-dir=${sessionProfile}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  const list = await fetchJSON(`http://127.0.0.1:${port}/json`);
  const target = list.find((t) => t.type === "page") || list[0];
  if (!target) throw new Error("no devtools target found");
  return { child, sessionProfile, target };
}

async function main() {
  console.log(`Capturing ${VARIANTS.length} variant(s) × ${VIEWPORTS.length} viewport(s) with a fresh chromium session per variant (avoids state pollution)`);
  const captures = [];
  for (const variant of VARIANTS) {
    const { child, sessionProfile, target } = await launchChromium();
    try {
      for (const vp of VIEWPORTS) {
        try {
          const result = await captureForViewport(target, vp, variant);
          console.log(`  ✓ ${vp.name} · ${variant.name} → ${result.file}`);
          console.log(`     probe: ${JSON.stringify(result.probe)}`);
          captures.push({ variant: variant.name, variantDesc: variant.desc, viewport: vp.name, ...result });
        } catch (err) {
          console.log(`  ✗ ${vp.name} · ${variant.name} — ${String(err).slice(0, 200)}`);
          captures.push({ variant: variant.name, viewport: vp.name, error: String(err).slice(0, 400) });
        }
      }
    } finally {
      child.kill("SIGTERM");
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1500);
      try { rmSync(sessionProfile, { recursive: true, force: true }); } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const summaryPath = join(OUT, "_probe-summary.json");
  writeFileSync(summaryPath, JSON.stringify(captures, null, 2) + "\n");
  console.log(`\nProbe summary: ${summaryPath.replace(ROOT + "/", "")}`);
}

main().catch((err) => { console.error("fatal:", err); process.exit(1); });
