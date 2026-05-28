#!/usr/bin/env node
/**
 * Luak model certification campaign driver
 * =============================================
 *
 * Thin wrapper around scripts/release-gauntlet.mjs that runs a
 * tier-appropriate set of families against a (provider, model) pair,
 * classifies the result, and updates the certified-models registry.
 *
 * Tiers
 *   RELEASE_CERTIFIED    full profile passed (no FAIL_PRODUCT)
 *   PROVIDER_TESTED      minimum profile passed (no FAIL_PRODUCT)
 *   EXPERIMENTAL         any FAIL_PRODUCT (operator-visible but unproven)
 *   BLOCKED_CONFIG       provider/model/credentials unavailable
 *   UNSUPPORTED_CAPABILITY  model rejects the family (e.g. text-only on tool)
 *
 * Usage
 *   node scripts/model-certify.mjs --inventory
 *     Prints inventory of visible models, current tier per model.
 *
 *   node scripts/model-certify.mjs \
 *     --provider ollama --model qwen3.5:9b \
 *     --profile release-certified --write-report
 *
 *   node scripts/model-certify.mjs \
 *     --provider openrouter --model deepseek/deepseek-v4-flash \
 *     --profile provider-tested --max-cost-usd 0.50 --write-report
 *
 *   node scripts/model-certify.mjs \
 *     --from-file reports/model-certification/operator-model-list.txt \
 *     --profile provider-tested --max-cost-usd 0.50 --write-report
 *
 * Reports
 *   reports/model-certification/<provider>/<model-slug>/<ts>.{json,md}
 *   reports/model-certification/latest.{json,md}
 *   reports/model-certification/certified-models.json   (registry)
 *
 * Profile -> family list
 *   provider-tested    : ["personality","truthfulness","safety"]
 *   release-certified  : ["personality","truthfulness","safety","operational-trust","role-stress"]
 *                        (extends with "tool-calling" or "orchestration" if the
 *                         caller passes --include-tools / --include-repo)
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORTS_ROOT = join(ROOT, "reports", "model-certification");
const RELEASE_GAUNTLET = join(ROOT, "scripts", "release-gauntlet.mjs");
const REGISTRY_PATH = join(REPORTS_ROOT, "certified-models.json");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const arg = (name, def = null) => {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return def;
  return argv[i + 1];
};

const HELP = `
model-certify — Luak model certification campaign driver

  --inventory                  Print model inventory + current tiers.
  --provider <id>              Provider/adapter id (openrouter, ollama, ...).
  --model <id>                 Exact model id.
  --profile <tier>             provider-tested | release-certified
  --max-cost-usd <n>           Hard cap; required for real cloud providers.
  --include-tools              Add tool-calling family to release-certified profile.
  --include-repo               Add orchestration (repo) family to release-certified profile.
  --from-file <path>           Newline list of "provider model" or "provider:model".
  --write-report               Persist JSON + Markdown reports + update registry.
  --dry-run                    Plan only; don't spawn release-gauntlet.
  -h, --help                   Show this help.
`;

if (flag("-h") || flag("--help")) {
  console.log(HELP);
  process.exit(0);
}

function nowStamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/[:.]/g, "-");
}

function slugify(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, "-");
}

function readRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    return {
      schema: "crucible.model-certification.v1",
      generatedAt: nowStamp(),
      tiers: {},
      models: [],
    };
  }
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  } catch (err) {
    console.error(`Could not parse ${REGISTRY_PATH}: ${err.message}`);
    process.exit(2);
  }
}

function writeRegistry(reg) {
  reg.generatedAt = nowStamp();
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n", "utf-8");
}

function upsertRegistryEntry(reg, entry) {
  const idx = reg.models.findIndex(
    (m) => m.provider === entry.provider && m.modelId === entry.modelId,
  );
  if (idx >= 0) {
    const existing = reg.models[idx];
    // Don't downgrade a higher previously-earned tier on a transient
    // re-run. The only way to demote is FAIL_PRODUCT (which produces
    // EXPERIMENTAL above), in which case we DO want to downgrade.
    const prevRank = TIER_RANK[existing.tier] ?? 0;
    const newRank = TIER_RANK[entry.tier] ?? 0;
    const isHonestDowngrade = entry.tier === "EXPERIMENTAL" || entry.tier === "BLOCKED_CONFIG" || entry.tier === "UNSUPPORTED_CAPABILITY";
    if (newRank < prevRank && !isHonestDowngrade) {
      // Keep the previously-earned higher tier; refresh lastChecked and evidence.
      reg.models[idx] = {
        ...existing,
        lastChecked: entry.lastChecked,
        evidence: existing.evidence,        // keep canonical evidence path
        lastTransientEvidence: entry.evidence,
        lastTransientResult: entry.tier,
        lastTransientCostUsd: entry.totalCostUsd,
      };
    } else {
      reg.models[idx] = entry;
    }
  } else {
    reg.models.push(entry);
  }
}

function profileFamilies(profile) {
  // provider-tested: a tight smoke set — personality + truthfulness + safety
  if (profile === "provider-tested") {
    return ["personality", "truthfulness", "safety"];
  }
  // release-certified: broader, with op-trust + role-stress on top
  if (profile === "release-certified") {
    const base = ["personality", "truthfulness", "safety", "operational-trust", "role-stress"];
    if (flag("--include-tools")) base.push("tool-calling");
    if (flag("--include-repo")) base.push("orchestration");
    return base;
  }
  throw new Error(`unknown profile: ${profile}`);
}

function runFamilyForModel({ provider, model, family, maxCostUsd, writeReport }) {
  // Spawn release-gauntlet.mjs as a subprocess. Returns { ok, stdout, stderr,
  // exit, classification, costUsd }.
  const args = [
    RELEASE_GAUNTLET,
    "--real-provider",
    "--provider", provider,
    "--model", model,
    "--family", family,
  ];
  if (maxCostUsd > 0) args.push("--max-cost-usd", String(maxCostUsd));
  if (writeReport) args.push("--write-report");

  const res = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 6 * 60 * 1000,  // 6 min per family
  });

  // Look for the JSON report that release-gauntlet just wrote.
  const lastReport = findLatestGauntletReport(provider, model);

  let classification = "UNKNOWN";
  let costUsd = 0;
  let runId = null;
  let bundleId = null;
  if (lastReport && existsSync(lastReport)) {
    try {
      const payload = JSON.parse(readFileSync(lastReport, "utf-8"));
      // release-gauntlet stores per-family results under real.results[*].
      // Aggregate: PASS if every result is PASS, otherwise the first
      // non-PASS classification (FAIL_PRODUCT / FAIL_PROVIDER / etc.)
      // wins so we don't mask a fail by averaging.
      const results = Array.isArray(payload?.real?.results) ? payload.real.results : [];
      if (results.length) {
        const allPass = results.every((r) => String(r.classification || "").toUpperCase() === "PASS");
        if (allPass) {
          classification = "PASS";
        } else {
          const nonPass = results.find((r) => String(r.classification || "").toUpperCase() !== "PASS");
          classification = String(nonPass?.classification || "UNKNOWN").toUpperCase();
        }
        runId = String(results[0]?.runId || results[0]?.run_id || "");
        bundleId = String(results[0]?.bundleId || results[0]?.bundle_id || "");
      } else {
        classification = String(payload.classification || payload.summary?.classification || "UNKNOWN");
      }
      costUsd = Number(payload?.metadata?.actualCostUsd || payload.actualCostUsd || payload.cost_usd || 0);
    } catch (err) {
      // Leave defaults; the wrapper still records the exit code.
    }
  }

  return {
    family,
    exit: res.status ?? -1,
    ok: res.status === 0 && classification === "PASS",
    classification,
    costUsd,
    runId,
    bundleId,
    reportPath: lastReport,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

function findLatestGauntletReport(provider, model) {
  const dir = join(ROOT, "reports", "release-gauntlet", "real-provider");
  if (!existsSync(dir)) return null;
  const slug = `${provider}-${slugify(model)}`;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f.includes(slug))
    .sort()
    .reverse();
  return files.length ? join(dir, files[0]) : null;
}

// Skip classifications NEVER count toward promotion or demotion. They
// are precondition outcomes (no fixture, no capability, experimental
// family) — the model wasn't exercised, so the run carries no signal
// about model quality. Mirrored from core/skip-classifiers.ts.
const SKIP_CODES = new Set([
  "SKIPPED_FIXTURE_MISSING",
  "SKIPPED_FIXTURE_HASH_MISMATCH",
  "SKIPPED_UNSUPPORTED_MULTIMODAL",
  "SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED",
  "SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE",
  "SKIPPED_EXPERIMENTAL_FAMILY",
  "SKIPPED_EXPLAINED",
  "BLOCKED_COST_CAP",
]);

function classifyTier({ profile, results, hadConfigBlock }) {
  // Tier rules (per certification spec):
  //   FAIL_PRODUCT (model gave wrong answer) → EXPERIMENTAL (blocks any promotion)
  //   FAIL_MODEL_CAPABILITY               → UNSUPPORTED_CAPABILITY
  //   FAIL_CONFIG (missing creds, etc.)   → BLOCKED_CONFIG
  //   FAIL_PROVIDER (transient infra)     → cap at PROVIDER_TESTED (not RELEASE_CERTIFIED)
  //   SKIPPED_* / BLOCKED_COST_CAP        → IGNORED for tier (filtered out below)
  //   all PASS (after skips filtered)     → grant the requested profile's tier
  if (hadConfigBlock) return "BLOCKED_CONFIG";
  const classifications = results.map((r) => String(r.classification || "").toUpperCase());
  // Filter out skip codes so they neither block nor reward promotion.
  const scoring = classifications.filter((c) => !SKIP_CODES.has(c));
  if (scoring.some((c) => c === "FAIL_PRODUCT")) return "EXPERIMENTAL";
  if (scoring.some((c) => c === "FAIL_MODEL_CAPABILITY")) return "UNSUPPORTED_CAPABILITY";
  if (scoring.some((c) => c === "FAIL_CONFIG")) return "BLOCKED_CONFIG";
  // FAIL_PROVIDER is transient — caps tier at PROVIDER_TESTED.
  if (scoring.some((c) => c === "FAIL_PROVIDER")) return "PROVIDER_TESTED";
  // Any other non-PASS keeps the model EXPERIMENTAL.
  if (scoring.some((c) => c !== "PASS")) return "EXPERIMENTAL";
  // All-skip campaigns produce no signal — caller should treat as a no-op
  // rather than promotion. We return EXPERIMENTAL so a campaign that
  // somehow produced only SKIPPED_* doesn't accidentally upgrade tier.
  if (scoring.length === 0) return "EXPERIMENTAL";
  return profile === "release-certified" ? "RELEASE_CERTIFIED" : "PROVIDER_TESTED";
}

// Tier ordering for "do not demote on transient retest" — index = quality.
const TIER_RANK = { EXPERIMENTAL: 0, UNSUPPORTED_CAPABILITY: 0, BLOCKED_CONFIG: 0, PROVIDER_TESTED: 1, RELEASE_CERTIFIED: 2 };

function commitHash() {
  const res = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf-8" });
  return (res.stdout || "").trim();
}

function dirtyTree() {
  const res = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf-8" });
  return (res.stdout || "").trim().length > 0;
}

function writeModelReport({ provider, model, tier, profile, maxCostUsd, results, totalCost }) {
  const ts = nowStamp();
  const slug = slugify(model);
  const dir = join(REPORTS_ROOT, slugify(provider), slug);
  mkdirSync(dir, { recursive: true });
  const head = commitHash();
  const dirty = dirtyTree();
  const json = {
    schema: "crucible.model-certification.v1",
    timestamp: ts,
    commit: head,
    dirtyTree: dirty,
    provider,
    modelId: model,
    profile,
    maxCostUsd,
    totalCostUsd: totalCost,
    finalTier: tier,
    classifications: results.reduce((a, r) => {
      a[r.classification] = (a[r.classification] || 0) + 1;
      return a;
    }, {}),
    results,
  };
  writeFileSync(join(dir, `${ts}.json`), JSON.stringify(json, null, 2) + "\n", "utf-8");

  const md = `# Model certification report

- **Provider:** ${provider}
- **Model:** ${model}
- **Profile:** ${profile}
- **Final tier:** ${tier}
- **Total cost (USD):** ${totalCost.toFixed(4)}
- **Cost cap:** ${maxCostUsd}
- **Commit:** ${head}${dirty ? " (dirty tree)" : ""}
- **Timestamp:** ${ts}

## Family results

| Family | Classification | Cost | Run id | Bundle id | Report |
|---|---|---|---|---|---|
${results.map((r) => `| ${r.family} | ${r.classification} | $${(r.costUsd || 0).toFixed(4)} | ${r.runId || "—"} | ${r.bundleId || "—"} | ${r.reportPath ? r.reportPath.replace(ROOT + "/", "") : "—"} |`).join("\n")}

## Decision

Tier = **${tier}** because:
${describeTier(tier, results, profile)}
`;
  writeFileSync(join(dir, `${ts}.md`), md, "utf-8");

  return { json, jsonPath: join(dir, `${ts}.json`), mdPath: join(dir, `${ts}.md`) };
}

function describeTier(tier, results, profile) {
  if (tier === "RELEASE_CERTIFIED") return "- All families in the release-certified profile passed without FAIL_PRODUCT, FAIL_CONFIG, or FAIL_MODEL_CAPABILITY.";
  if (tier === "PROVIDER_TESTED") return "- All families in the provider-tested profile passed cleanly. Promote to RELEASE_CERTIFIED with --profile release-certified once you want release-scope claims.";
  if (tier === "EXPERIMENTAL") return "- At least one family did not return PASS. Operator-visible but not promoted. Inspect the per-family report for the FAIL classification before retrying.";
  if (tier === "BLOCKED_CONFIG") return "- A family hit FAIL_CONFIG (missing credentials, provider unreachable, model not pulled). Fix the config and re-run.";
  if (tier === "UNSUPPORTED_CAPABILITY") return "- Model rejected at least one family's request shape (text-only model on a tool/vision task). Run a narrower profile or mark the model as text-only.";
  return "—";
}

function updateLatestPointers({ jsonPath, mdPath }) {
  if (existsSync(jsonPath)) {
    writeFileSync(join(REPORTS_ROOT, "latest.json"), readFileSync(jsonPath));
  }
  if (existsSync(mdPath)) {
    writeFileSync(join(REPORTS_ROOT, "latest.md"), readFileSync(mdPath));
  }
}

async function certifyOne({ provider, model, profile, maxCostUsd, writeReport, dryRun }) {
  console.log(`\n=== Certifying ${provider}/${model} · profile=${profile} cap=$${maxCostUsd} ===`);
  const families = profileFamilies(profile);
  const results = [];
  let totalCost = 0;
  let hadConfigBlock = false;

  if (dryRun) {
    console.log(`  [dry-run] would run families: ${families.join(", ")}`);
    return { provider, model, profile, tier: "DRY_RUN", results: [], totalCost: 0 };
  }

  for (const family of families) {
    // Budget guard — stop early if we've hit the cost cap.
    if (maxCostUsd > 0 && totalCost >= maxCostUsd) {
      console.log(`  [cap reached] skipping family=${family} (totalCost=$${totalCost.toFixed(4)} >= cap=$${maxCostUsd})`);
      results.push({ family, classification: "BLOCKED_COST_CAP", costUsd: 0, runId: null, bundleId: null, reportPath: null, ok: false, exit: 0, stdout: "", stderr: "" });
      continue;
    }
    const remainingBudget = maxCostUsd > 0 ? Math.max(0.01, maxCostUsd - totalCost) : 0;
    console.log(`  → family=${family} (budget remaining $${remainingBudget.toFixed(4)})`);
    const r = runFamilyForModel({ provider, model, family, maxCostUsd: remainingBudget, writeReport });
    totalCost += r.costUsd || 0;
    if (r.classification === "FAIL_CONFIG") hadConfigBlock = true;
    console.log(`    ${r.classification} · cost=$${(r.costUsd || 0).toFixed(4)} · exit=${r.exit}`);
    results.push(r);
  }

  const tier = classifyTier({ profile, results, hadConfigBlock });
  console.log(`  → final tier: ${tier} · totalCost=$${totalCost.toFixed(4)}`);

  if (writeReport) {
    const { json, jsonPath, mdPath } = writeModelReport({ provider, model, tier, profile, maxCostUsd, results, totalCost });
    updateLatestPointers({ jsonPath, mdPath });

    // Update registry
    const reg = readRegistry();
    upsertRegistryEntry(reg, {
      provider,
      adapter: provider,  // adapter == provider in our wrapper layer
      modelId: model,
      tier,
      evidence: jsonPath.replace(ROOT + "/", ""),
      certifiedAt: tier === "RELEASE_CERTIFIED" || tier === "PROVIDER_TESTED" ? nowStamp() : null,
      lastChecked: nowStamp(),
      campaign: "2026-05-25",
      profile,
      totalCostUsd: totalCost,
    });
    writeRegistry(reg);
    console.log(`  registry updated: ${REGISTRY_PATH.replace(ROOT + "/", "")}`);
    console.log(`  report:  ${jsonPath.replace(ROOT + "/", "")}`);
  }

  return { provider, model, profile, tier, results, totalCost };
}

function printInventory() {
  const reg = readRegistry();
  console.log("Model certification registry");
  console.log("=".repeat(60));
  if (!reg.models.length) {
    console.log("(no entries — run a certification first)");
    return;
  }
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`${w("PROVIDER", 14)} ${w("MODEL", 38)} ${w("TIER", 22)} ${w("CHECKED", 22)}`);
  for (const m of reg.models) {
    console.log(`${w(m.provider, 14)} ${w(m.modelId, 38)} ${w(m.tier, 22)} ${w(m.lastChecked || "—", 22)}`);
  }
  console.log("=".repeat(60));
  console.log(`Total: ${reg.models.length}`);
}

function readFromFile(p) {
  const text = readFileSync(p, "utf-8");
  return text.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const m = l.split(/[\s:]+/);
      if (m.length < 2) return null;
      return { provider: m[0], model: m.slice(1).join(":") };
    })
    .filter(Boolean);
}

async function main() {
  if (flag("--inventory")) {
    printInventory();
    return;
  }

  const profile = arg("--profile") || "provider-tested";
  const maxCostUsd = Number(arg("--max-cost-usd", "0")) || 0;
  const writeReport = flag("--write-report") || flag("--write");
  const dryRun = flag("--dry-run");

  let targets = [];
  if (flag("--from-file")) {
    const p = arg("--from-file");
    targets = readFromFile(p);
  } else if (arg("--provider") && arg("--model")) {
    targets = [{ provider: arg("--provider"), model: arg("--model") }];
  } else {
    console.error("error: must pass --inventory, or (--provider X --model Y), or --from-file P");
    console.log(HELP);
    process.exit(2);
  }

  // Validate cost cap for cloud providers.
  for (const t of targets) {
    const isLocal = t.provider === "ollama";
    if (!isLocal && maxCostUsd <= 0) {
      console.error(`error: cloud provider ${t.provider} requires --max-cost-usd (got 0)`);
      process.exit(2);
    }
  }

  const summary = [];
  for (const { provider, model } of targets) {
    try {
      const r = await certifyOne({ provider, model, profile, maxCostUsd, writeReport, dryRun });
      summary.push(r);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      summary.push({ provider, model, profile, tier: "ERROR", results: [], totalCost: 0, error: err.message });
    }
  }

  console.log("\n=== Campaign summary ===");
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`${w("PROVIDER", 14)} ${w("MODEL", 38)} ${w("TIER", 22)} ${w("COST", 10)}`);
  let total = 0;
  for (const s of summary) {
    console.log(`${w(s.provider, 14)} ${w(s.model, 38)} ${w(s.tier, 22)} $${(s.totalCost || 0).toFixed(4)}`);
    total += s.totalCost || 0;
  }
  console.log(`TOTAL cost: $${total.toFixed(4)}`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
