#!/usr/bin/env node
/**
 * rescore-conversational.mjs — re-evaluate captured conversational run JSONs
 * with the CURRENT (fixed) judge, and report verdict flips.
 *
 * Why: the Aug 2 2026 benchmark fleet ran against an older judge whose naive
 * substring fail-matching produced false FAILs (op-007 negation trap,
 * op-002 confirmation hedge, roleplay banned-phrase negation). The responses
 * are captured in the run JSONs, so we re-score them locally — no API spend.
 *
 * Usage: node rescore-conversational.mjs <runs-dir> <model-slug> [--date YYYY-MM-DD]
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scoreConversationalQuestion } from "../dist/core/conversational-judge.js";

const dir = process.argv[2];
const modelFilter = process.argv[3];
const dateIdx = process.argv.indexOf("--date");
const dateFilter = dateIdx !== -1 ? process.argv[dateIdx + 1] : null;

if (!dir || !modelFilter) {
  console.error("usage: node rescore-conversational.mjs <runs-dir> <model-slug> [--date YYYY-MM-DD]");
  process.exit(1);
}

const files = readdirSync(dir)
  .filter((f) => f.startsWith("run_") && f.endsWith(".json") && !f.endsWith(".hash"))
  .sort();

let scored = 0;
let flipped = 0;
const flips = [];

for (const f of files) {
  // filename: run_<date>_<task>_<model>_<hash>.json
  const m = f.match(/^run_(\d{4}-\d{2}-\d{2})_([^_]+)_([^_]+)_[0-9a-f]+\.json$/);
  if (!m) continue;
  const [, date, task, model] = m;
  if (model !== modelFilter) continue;
  if (dateFilter && date !== dateFilter) continue;

  const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const conv = d.conversational?.results;
  if (!Array.isArray(conv) || conv.length === 0) continue;

  // Load the manifest for this task to get the question definitions.
  // Manifest paths: tasks/<family>/<task>/manifest.json — family from task id
  // is not always derivable, so locate by searching known family dirs is
  // avoided: instead try the task's own recorded manifest if present, else skip.
  const manifestPath = d.task?.manifestPath || d.task?.manifest;
  const taskMeta = d.task || {};
  const family = taskMeta.family;

  // Find manifest by convention: tasks/<family>/<task>/manifest.json
  // (family in run JSON uses underscores like operational_trust but the
  // directory uses hyphens like operational-trust).
  let manifest = null;
  if (family) {
    const famDir = family.replace(/_/g, "-");
    for (const candidate of [
      join(process.cwd(), "tasks", famDir, task, "manifest.json"),
      join(process.cwd(), "tasks", family, task, "manifest.json"),
      join(process.cwd(), "tasks", task, "manifest.json"),
    ]) {
      try {
        manifest = JSON.parse(readFileSync(candidate, "utf8"));
        break;
      } catch {
        // try next
      }
    }
  }
  if (!manifest) continue;

  const qs = manifest.questions || [];
  const oldState = d.verdict?.completionState;
  if (oldState !== "FAIL" && oldState !== "PASS") continue;

  let anyFlip = false;
  let allPass = true;
  for (const r of conv) {
    const q = qs.find((qq) => qq.id === r.question_id);
    if (!q) continue;
    const scoredQ = scoreConversationalQuestion({ ...q }, r.response);
    scored++;
    if (!scoredQ.passed) allPass = false;
  }

  const newState = allPass ? "PASS" : "FAIL";
  if (newState !== oldState) {
    flipped++;
    flips.push({ task, old: oldState, new: newState, file: f });
  }
}

console.log(`model=${modelFilter} date=${dateFilter ?? "all"} scored=${scored} flipped=${flipped}`);
for (const fl of flips) {
  console.log(`  FLIP ${fl.task}: ${fl.old} -> ${fl.new} (${fl.file})`);
}
