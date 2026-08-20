#!/usr/bin/env node
/**
 * Materialise the authored local fixtures and record their hashes.
 *
 * The fixtures live in TypeScript so they are type-checked against the scorers
 * that consume them.
 *
 * They are materialised under `docs/local/fixtures/`, deliberately **not** under
 * `tasks/`. That tree is owned by `core/fixture-validation.ts`, which requires a
 * `manifest.json` in every second-level directory, and by several tests that pin
 * the task inventory by counting families. These fixtures are local-lane
 * artefacts rather than Luak tasks in that sense, and putting them in `tasks/`
 * broke eleven existing tests before this was corrected. This script writes the frozen JSON an auditor can read and
 * a manifest of content hashes, so a fixture cannot change without the change
 * being visible in a diff. Run with --check in CI to prove nothing drifted.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;

const {
  TEST_LOG_TRIAGE_FIXTURES, TEST_LOG_TRIAGE_EVALUATION_IDS,
  TEST_LOG_TRIAGE_SUITE_ID, TEST_LOG_TRIAGE_SUITE_VERSION,
  REPO_RECON_FIXTURES, REPO_RECON_EVALUATION_IDS,
  REPO_RECON_SUITE_ID, REPO_RECON_SUITE_VERSION,
} = await import(join(ROOT, "dist/core/local/fixtures/index.js"));
const { LOCAL_REGIME_VERSION: REGIME } = await import(join(ROOT, "dist/core/local/regime.js"));
const { LOCAL_SCORER_VERSION: SCORERS } = await import(join(ROOT, "dist/core/local/scorers.js"));
const { CONTEXT_GENERATOR_VERSION: GENERATOR } = await import(join(ROOT, "dist/core/local/context-generator.js"));

const suites = [
  {
    id: TEST_LOG_TRIAGE_SUITE_ID, version: TEST_LOG_TRIAGE_SUITE_VERSION,
    dir: "docs/local/fixtures/test-log-triage", fixtures: TEST_LOG_TRIAGE_FIXTURES,
    evaluationIds: TEST_LOG_TRIAGE_EVALUATION_IDS,
  },
  {
    id: REPO_RECON_SUITE_ID, version: REPO_RECON_SUITE_VERSION,
    dir: "docs/local/fixtures/repo-reconnaissance", fixtures: REPO_RECON_FIXTURES,
    evaluationIds: REPO_RECON_EVALUATION_IDS,
  },
];

const check = process.argv.includes("--check");
let drift = false;

for (const s of suites) {
  const outDir = join(ROOT, s.dir, `v${s.version}`);
  const perFixture = s.fixtures.map((f) => ({
    id: f.id, kind: f.kind, title: f.title,
    split: s.evaluationIds.includes(f.id) ? "evaluation" : "development",
    contentHash: sha(JSON.stringify(f)),
  }));
  const manifest = {
    suiteId: s.id,
    suiteVersion: s.version,
    // Scoring behaviour is part of fixture identity. A prompt is only half of
    // what determines a result; changing a scorer changes what the same prompt
    // measures, so evidence is bound to both.
    boundVersions: { regime: REGIME, scorers: SCORERS, generator: GENERATOR },
    splitPolicy:
      "Evaluation-split fixtures are committed to a public repository and are NOT secret. " +
      "They are excluded from development tuning by policy only. Genuinely hidden fixtures " +
      "require an external private fixture pack with separately pinned identity.",
    fixtureCount: s.fixtures.length,
    developmentCount: perFixture.filter((f) => f.split === "development").length,
    evaluationCount: perFixture.filter((f) => f.split === "evaluation").length,
    kinds: [...new Set(s.fixtures.map((f) => f.kind))].sort(),
    fixtures: perFixture,
    // Hash of the whole suite: any fixture edit changes it, so evidence bound to
    // a suite version can be checked against the fixtures that produced it.
    suiteHash: sha(JSON.stringify({ fixtures: perFixture, regime: REGIME, scorers: SCORERS, generator: GENERATOR })),
  };
  const fixturesJson = `${JSON.stringify(s.fixtures, null, 2)}\n`;
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  if (check) {
    for (const [p, want] of [["fixtures.json", fixturesJson], ["MANIFEST.json", manifestJson]]) {
      const full = join(outDir, p);
      const have = existsSync(full) ? readFileSync(full, "utf-8") : "";
      if (have !== want) { console.error(`drift: ${relative(ROOT, full)}`); drift = true; }
    }
    continue;
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "fixtures.json"), fixturesJson);
  writeFileSync(join(outDir, "MANIFEST.json"), manifestJson);
  console.log(`${s.id}@${s.version}: ${manifest.fixtureCount} fixtures ` +
    `(${manifest.evaluationCount} evaluation split) ${manifest.suiteHash.slice(0, 23)}…`);
}
process.exit(drift ? 1 : 0);
