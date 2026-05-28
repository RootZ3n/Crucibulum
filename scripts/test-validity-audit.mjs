#!/usr/bin/env node
/**
 * Luak test-validity audit
 * =============================
 *
 * Scans run bundles + task manifests and produces a "suspect failures"
 * report so the operator can audit whether each model failure is a
 * genuine product fail, a malformed test, or a UI/hydration confusion.
 *
 * For each failed/needs-review bundle, we extract per-question:
 *   - test id, family, manifest path
 *   - scorer type (regex_match, exact, judge, …)
 *   - prompt
 *   - expected pattern/answer
 *   - what the model actually said
 *   - whether the manifest's expected answer is mathematically defensible
 *
 * Usage
 *   node scripts/test-validity-audit.mjs --recent-failures --write-report
 *   node scripts/test-validity-audit.mjs --all-strict --write-report
 *   node scripts/test-validity-audit.mjs --task token-efficiency-001 --write-report
 *   node scripts/test-validity-audit.mjs --model deepseek/deepseek-v4-flash --write-report
 *
 * Reports
 *   reports/test-validity/suspect-failures/<ts>.{json,md}
 *   reports/test-validity/suspect-failures/latest.{json,md}
 *   reports/test-validity/latest.{json,md}
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS_DIR = join(ROOT, "runs");
const TASKS_DIR = join(ROOT, "tasks");
const OUT_DIR = join(ROOT, "reports", "test-validity");
const SUSPECT_DIR = join(OUT_DIR, "suspect-failures");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const arg = (name, def = null) => {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return def;
  return argv[i + 1];
};

const HELP = `
test-validity-audit — Luak suspect-failure extractor

  --recent-failures        Scan the most recent failed/needs-review bundles.
  --all-strict             Scan every bundle whose scorer is regex/numeric/exact.
  --task <id>              Restrict scan to one task id.
  --model <id>             Restrict scan to one model id.
  --limit <n>              Max bundles to report (default 200).
  --since-days <n>         Only bundles modified within N days (default 14).
  --write-report           Persist JSON + Markdown reports.
  -h, --help               Show this help.
`;

if (flag("-h") || flag("--help")) {
  console.log(HELP);
  process.exit(0);
}

function nowStamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/[:.]/g, "-");
}

function safeJson(path) {
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

function loadManifests() {
  // Walk tasks/<family>/<id>/manifest.json
  const manifests = {};
  if (!existsSync(TASKS_DIR)) return manifests;
  for (const family of readdirSync(TASKS_DIR)) {
    const famDir = join(TASKS_DIR, family);
    if (!statSync(famDir).isDirectory()) continue;
    for (const tid of readdirSync(famDir)) {
      const mpath = join(famDir, tid, "manifest.json");
      if (existsSync(mpath)) {
        const data = safeJson(mpath);
        if (data) manifests[data.id || tid] = { manifest: data, path: mpath, family };
      }
    }
  }
  return manifests;
}

function bundleIsRecent(file, sinceDays) {
  try {
    const st = statSync(file);
    return (Date.now() - st.mtimeMs) <= sinceDays * 86_400_000;
  } catch { return false; }
}

function scanBundles({ recentOnly, taskFilter, modelFilter, sinceDays, limit }) {
  if (!existsSync(RUNS_DIR)) return [];
  const files = readdirSync(RUNS_DIR)
    .filter((f) => f.startsWith("run_") && f.endsWith(".json"))
    .map((f) => join(RUNS_DIR, f));
  const bundles = [];
  for (const f of files) {
    if (recentOnly && !bundleIsRecent(f, sinceDays)) continue;
    if (taskFilter && !f.includes(taskFilter)) continue;
    if (modelFilter) {
      const slug = modelFilter.replace(/[/:]/g, "-");
      if (!f.includes(slug) && !f.includes(modelFilter)) continue;
    }
    const data = safeJson(f);
    if (!data) continue;
    bundles.push({ path: f, data });
  }
  // Sort by mtime desc
  bundles.sort((a, b) => {
    try { return statSync(b.path).mtimeMs - statSync(a.path).mtimeMs; } catch { return 0; }
  });
  return bundles.slice(0, limit);
}

function extractSuspectFailures(bundle, manifests) {
  // Bundles store per-question outcomes inside timeline entries
  // (type=error and type=task_complete). Pair them with the manifest's
  // question definition for prompt + expected.
  const d = bundle.data;
  const taskId = d.task?.id || d.task?.task_id || d.task;
  const m = manifests[taskId];
  if (!m) return [];  // can't audit without manifest
  const questions = m.manifest.questions || [];
  const qById = Object.fromEntries(questions.map((q) => [q.id, q]));

  const findings = [];
  const score = d.score || {};
  const overallPct = Math.round((score.total_percent ?? (score.total * 100)) || 0);
  const passed = score.pass === true;

  for (const entry of d.timeline || []) {
    if (entry.type !== "error") continue;
    const detail = String(entry.detail || "");
    // detail format: "TE1-Q1: FAIL — Response did not match pattern /^\\s*16\\s*$/. Got: 6"
    const qMatch = detail.match(/^([A-Z]+\d+-Q\d+|[A-Za-z0-9_-]+):/);
    const qId = qMatch ? qMatch[1] : null;
    const patternMatch = detail.match(/pattern (\/[^/]+\/[a-z]*)/);
    const gotMatch = detail.match(/Got:\s*(.+?)\s*$/);
    const reasonMatch = detail.match(/FAIL\s+—\s+(.+?)(?:\.\s*Got:|$)/);

    const q = qId ? qById[qId] : null;
    findings.push({
      qId,
      family: m.family,
      taskId,
      manifestPath: m.path.replace(ROOT + "/", ""),
      scorerType: q?.scoring_type || (patternMatch ? "regex_match" : "unknown"),
      prompt: q?.question || null,
      expectedPattern: q?.pattern || patternMatch?.[1] || null,
      maxLength: q?.maxLength || null,
      weight: q?.weight || null,
      modelAnswer: gotMatch?.[1] || null,
      failureReason: reasonMatch?.[1] || detail,
      rawDetail: detail,
      overallScorePct: overallPct,
      bundlePassed: passed,
      verdict: d.verdict?.label || null,
      runId: d.run_id || null,
      bundleId: d.bundle_id || null,
      model: d.agent?.model || d.agent?.id || null,
      provider: d.agent?.provider || null,
      timestamp: d.environment?.run_started_at || d.environment?.timestamp || null,
      bundlePath: bundle.path.replace(ROOT + "/", ""),
    });
  }
  return findings;
}

function suspectScore(finding) {
  // Score how "suspect" the failure looks — higher = more worth a human look.
  // - regex_match with very tight pattern + numeric answer → low suspect
  // - judge/rubric → higher suspect (subjective)
  // - prompt missing → high suspect (can't validate)
  // - model gave answer matching a digit-prefix of expected → high (truncation?)
  let s = 0;
  if (!finding.prompt) s += 30;
  if (finding.scorerType === "judge" || finding.scorerType === "rubric") s += 20;
  if (finding.scorerType === "regex_match" && finding.expectedPattern && finding.modelAnswer) {
    const expectedNumMatch = String(finding.expectedPattern).match(/(\d+)/);
    const expectedNum = expectedNumMatch ? expectedNumMatch[1] : "";
    const got = String(finding.modelAnswer);
    if (expectedNum && got && expectedNum.startsWith(got) && got.length < expectedNum.length) {
      s += 50;  // possible truncation — flag for inspection
    }
  }
  if (finding.bundlePassed === false && finding.overallScorePct >= 90) s += 10;
  return s;
}

function classifyTest({ finding, _manifest }) {
  // Heuristic classification; the operator still has the final call.
  if (!finding.prompt) return "MANIFEST_MISSING_PROMPT";
  if (finding.scorerType === "regex_match" && /^\^\\s\*\d+\\s\*\$$/.test(String(finding.expectedPattern || ""))) {
    return "VALID_STRICT_NUMERIC";
  }
  if (finding.scorerType === "judge" || finding.scorerType === "rubric") return "RUBRIC_NEEDS_REVIEW";
  return "VALID_OTHER";
}

function writeReports(findings, sourceLabel) {
  if (!flag("--write-report")) {
    console.log(`(skip write — pass --write-report to persist)`);
    return;
  }
  mkdirSync(SUSPECT_DIR, { recursive: true });
  const ts = nowStamp();
  const head = (spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf-8" }).stdout || "").trim();
  const dirty = (spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf-8" }).stdout || "").trim().length > 0;

  // Sort by suspect score descending
  findings.sort((a, b) => (b.suspectScore || 0) - (a.suspectScore || 0));

  const json = {
    schema: "crucible.test-validity.v1",
    timestamp: ts,
    commit: head,
    dirtyTree: dirty,
    source: sourceLabel,
    findingsCount: findings.length,
    findings,
  };
  const jsonPath = join(SUSPECT_DIR, `${ts}.json`);
  writeFileSync(jsonPath, JSON.stringify(json, null, 2) + "\n");
  writeFileSync(join(SUSPECT_DIR, "latest.json"), JSON.stringify(json, null, 2) + "\n");
  writeFileSync(join(OUT_DIR, "latest.json"), JSON.stringify(json, null, 2) + "\n");

  const md = `# Test-validity suspect failures

- **Timestamp (UTC):** ${ts}
- **Commit:** ${head}${dirty ? " (dirty tree)" : ""}
- **Source:** ${sourceLabel}
- **Findings:** ${findings.length}

| Suspect | Family | Task | Q | Model | Scorer | Expected | Got | Class |
|---|---|---|---|---|---|---|---|---|
${findings.slice(0, 50).map((f) => `| ${f.suspectScore || 0} | ${f.family || "?"} | ${f.taskId || "?"} | ${f.qId || "?"} | ${f.model || "?"} | ${f.scorerType || "?"} | ${(f.expectedPattern || "").slice(0, 24)} | ${(f.modelAnswer || "").slice(0, 32)} | ${f.classification || "?"} |`).join("\n")}

## Top suspects (full detail)

${findings.slice(0, 20).map((f, i) => `
### #${i + 1} · ${f.family}/${f.taskId} ${f.qId ? "Q=" + f.qId : ""}  (suspect=${f.suspectScore})
- **Classification:** ${f.classification}
- **Model:** ${f.provider || ""}/${f.model || ""}
- **Bundle:** ${f.bundlePath}
- **Run id:** ${f.runId || "—"}
- **Overall score:** ${f.overallScorePct}% · passed=${f.bundlePassed}
- **Scorer:** ${f.scorerType}
- **Expected:** \`${f.expectedPattern || "—"}\`
- **Model answer:** \`${(f.modelAnswer || "").slice(0, 200)}\`
- **Prompt:** ${f.prompt ? `\n  > ${f.prompt.replace(/\n/g, "\n  > ")}` : "(manifest missing prompt)"}
- **Raw detail:** ${f.rawDetail}
`).join("\n")}
`;
  const mdPath = join(SUSPECT_DIR, `${ts}.md`);
  writeFileSync(mdPath, md);
  writeFileSync(join(SUSPECT_DIR, "latest.md"), md);
  writeFileSync(join(OUT_DIR, "latest.md"), md);

  console.log(`reports:`);
  console.log(`  ${jsonPath.replace(ROOT + "/", "")}`);
  console.log(`  ${mdPath.replace(ROOT + "/", "")}`);
  console.log(`  reports/test-validity/suspect-failures/latest.{json,md}`);
  console.log(`  reports/test-validity/latest.{json,md}`);
}

async function main() {
  const recentOnly = flag("--recent-failures") || !flag("--all-strict");
  const taskFilter = arg("--task");
  const modelFilter = arg("--model");
  const sinceDays = Number(arg("--since-days", "14"));
  const limit = Number(arg("--limit", "200"));

  console.log(`Scanning runs/ (recent=${recentOnly}, task=${taskFilter || "*"}, model=${modelFilter || "*"}, sinceDays=${sinceDays}, limit=${limit})…`);
  const manifests = loadManifests();
  console.log(`Loaded ${Object.keys(manifests).length} task manifests.`);
  const bundles = scanBundles({ recentOnly, taskFilter, modelFilter, sinceDays, limit });
  console.log(`Scanned ${bundles.length} bundles.`);

  const findings = [];
  for (const b of bundles) {
    const fs = extractSuspectFailures(b, manifests);
    for (const f of fs) {
      f.suspectScore = suspectScore(f);
      f.classification = classifyTest({ finding: f });
      findings.push(f);
    }
  }
  console.log(`Extracted ${findings.length} failed-question records.`);

  const sourceLabel = `recent=${recentOnly},task=${taskFilter || "*"},model=${modelFilter || "*"},sinceDays=${sinceDays},limit=${limit}`;
  writeReports(findings, sourceLabel);

  // Print top-5 summary to terminal
  findings.sort((a, b) => (b.suspectScore || 0) - (a.suspectScore || 0));
  console.log("\nTop 5 suspect:");
  for (const f of findings.slice(0, 5)) {
    console.log(`  [${f.suspectScore}] ${f.family}/${f.taskId} ${f.qId || ""} ${f.model || ""} expected=${(f.expectedPattern || "").slice(0, 20)} got=${(f.modelAnswer || "").slice(0, 20)} class=${f.classification}`);
  }
}

main().catch((err) => { console.error("fatal:", err); process.exit(1); });
