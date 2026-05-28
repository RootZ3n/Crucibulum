#!/usr/bin/env node
/**
 * Luak — Safety rescore preview.
 *
 * Reads existing Safety bundles in runs/, re-applies the NEW conversational
 * judge + scoring formula to the stored model responses, and prints the
 * before/after delta. Does not modify any bundles on disk — bundles are
 * signed and re-scoring them would invalidate their hash. This script is
 * only here to show that the fix produces the right outcome on the audit
 * dataset; live verification still requires fresh runs.
 *
 * Usage: node scripts/safety-rescore-preview.mjs
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const RUNS_DIR = process.env.CRUCIBULUM_RUNS_DIR ?? join(ROOT, "runs");

// Import compiled judge + score helpers from dist/.
const { scoreConversationalQuestion } = await import(new URL("../dist/core/conversational-judge.js", import.meta.url));
const { combineConversationalScore } = await import(new URL("../dist/core/conversational-runner.js", import.meta.url));

if (!existsSync(RUNS_DIR)) {
  console.error(`runs/ not found at ${RUNS_DIR}`);
  process.exit(2);
}

const TASKS_DIR = process.env.CRUCIBULUM_TASKS_DIR ?? join(ROOT, "tasks", "safety");
const manifestById = new Map();
for (const dir of readdirSync(TASKS_DIR)) {
  try {
    const manifest = JSON.parse(readFileSync(join(TASKS_DIR, dir, "manifest.json"), "utf-8"));
    manifestById.set(manifest.id, manifest);
  } catch {
    /* skip non-manifest entries */
  }
}

const bundles = [];
for (const file of readdirSync(RUNS_DIR)) {
  if (!file.endsWith(".json") || file.endsWith(".crucible.json")) continue;
  try {
    const bundle = JSON.parse(readFileSync(join(RUNS_DIR, file), "utf-8"));
    if (bundle?.task?.family !== "safety") continue;
    bundles.push({ file, bundle });
  } catch {
    /* ignore */
  }
}

if (bundles.length === 0) {
  console.log("No safety bundles found.");
  process.exit(0);
}

console.log(`Re-scoring ${bundles.length} safety bundles under the new judge…`);
console.log("");

let collapsedBefore = new Set();
let collapsedAfter = new Set();
for (const { file, bundle } of bundles) {
  const manifest = manifestById.get(bundle.task.id);
  if (!manifest) {
    console.log(`! ${file}: manifest ${bundle.task.id} not found`);
    continue;
  }
  const questions = manifest.questions;
  const responses = bundle.conversational?.results ?? [];
  let earnedWeight = 0;
  let totalWeight = 0;
  let passes = 0;
  for (const q of questions) {
    const resp = responses.find((r) => r.question_id === q.id);
    if (!resp) continue;
    const scored = scoreConversationalQuestion(q, resp.response ?? "");
    totalWeight += q.weight ?? 1;
    if (scored.passed) {
      earnedWeight += q.weight ?? 1;
      passes += 1;
    }
  }
  const newCorrectness = totalWeight > 0 ? earnedWeight / totalWeight : 0;
  const efficiency = Number(bundle.score?.breakdown?.efficiency ?? 1);
  const newTotal = combineConversationalScore(newCorrectness, efficiency);
  const oldTotal = Number(bundle.score?.total ?? 0);

  collapsedBefore.add(Math.round(oldTotal * 100));
  collapsedAfter.add(Math.round(newTotal * 100));

  console.log(`  ${bundle.task.id} · ${bundle.agent?.model}`);
  console.log(`    before: total=${Math.round(oldTotal * 100)}%  correctness=${Math.round((bundle.score?.breakdown?.correctness ?? 0) * 100)}%  passes=${(bundle.conversational?.results ?? []).filter((r) => r.passed).length}/${responses.length}`);
  console.log(`    after:  total=${Math.round(newTotal * 100)}%  correctness=${Math.round(newCorrectness * 100)}%  passes=${passes}/${questions.length}`);
}

console.log("");
console.log(`Distinct totals (stored, pre-fix):  ${[...collapsedBefore].sort((a, b) => a - b).map((n) => `${n}%`).join(", ")}`);
console.log(`Distinct totals (new judge preview): ${[...collapsedAfter].sort((a, b) => a - b).map((n) => `${n}%`).join(", ")}`);
