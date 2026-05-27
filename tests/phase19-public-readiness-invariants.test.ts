/**
 * Crucible — Phase 19: public/portfolio readiness invariants.
 *
 * Lightweight document/UI invariants that protect the trust posture
 * Phase 19's audit established. These tests will fail loudly if a
 * future edit:
 *
 *   - reintroduces "Vision is model-certified" / "release-certified"
 *     style overclaims in the README
 *   - drops the README's "Vision capability cert is separate from
 *     leaderboard and from general model cert" disclaimer
 *   - drops the README's pointer at operator-owned local state
 *   - drops the UI's NOT IN LEADERBOARD / general-cert chips
 *   - accidentally commits data/capability-certifications.json
 *   - removes the new SCORING_FIELDS / VISION_CAPABILITY_CERTIFICATION_SUMMARY docs
 *   - makes scripts/crux-restart.sh non-executable
 *
 * 12 deterministic offline assertions. No provider calls. No
 * mutation of capability state, certified-models.json, leaderboard,
 * or historical evidence.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const README = readFileSync(join(ROOT, "README.md"), "utf-8");
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");

describe("Crucible Phase 19 · public/portfolio readiness invariants (offline)", () => {
  // -------- README content invariants --------

  it("P1 · README does not claim Vision is 'model-certified' or 'release-certified'", () => {
    // The two specific overclaim phrasings that the audit blocks.
    assert.doesNotMatch(README, /Vision[^.]{0,40}(?:model|release)-certified/i);
    assert.doesNotMatch(README, /Vision[^.]{0,40}is\s+(?:model|release)\s+certified/i);
  });

  it("P2 · README explicitly states Vision capability certification does NOT affect the leaderboard composite", () => {
    // The disclaimer pattern Phase 19 added. Look for "does not
    // affect the leaderboard" near a Vision mention.
    const visionScopeStart = README.indexOf("Vision Capability-Certified");
    assert.ok(visionScopeStart > 0, "README must have a Vision Capability-Certified section");
    const visionSection = README.slice(visionScopeStart, visionScopeStart + 4000);
    assert.match(visionSection, /does \*?\*?not\*?\*? affect the leaderboard|never enter the leaderboard/i);
  });

  it("P3 · README explicitly states Vision capability certification does NOT mutate general model certification", () => {
    const visionScopeStart = README.indexOf("Vision Capability-Certified");
    const visionSection = README.slice(visionScopeStart, visionScopeStart + 4000);
    assert.match(visionSection, /does \*?\*?not\*?\*? mutate.*certified-models\.json|certified-models\.json[^.]*byte-identical|MODEL_CERTIFICATION\.models\[\]\.tier/i);
  });

  it("P4 · README mentions operator-owned local state (data/capability-certifications.json is gitignored)", () => {
    assert.match(README, /data\/capability-certifications\.json/);
    assert.match(README, /gitignored|gitignore/i);
  });

  it("P5 · README links the Vision capability summary + scoring-fields docs in the Methodology section", () => {
    assert.match(README, /docs\/VISION_CAPABILITY_CERTIFICATION_SUMMARY\.md/);
    assert.match(README, /docs\/SCORING_FIELDS\.md/);
    assert.match(README, /docs\/CAPABILITY_CERTIFICATION_DOCTRINE\.md/);
  });

  // -------- UI invariants --------

  it("P6 · Vision UI keeps the NOT IN LEADERBOARD chip", () => {
    assert.match(HTML, /NOT IN LEADERBOARD/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
  });

  it("P7 · Vision UI distinguishes general model certification from capability certification (NOT CERTIFIED chip tooltip)", () => {
    // The NOT CERTIFIED chip's tooltip must explicitly point at
    // certified-models.json + MODEL_CERTIFICATION.tier so readers
    // can't confuse it with capability certification.
    assert.match(HTML, /Vision does not affect model certification \(certified-models\.json \+ MODEL_CERTIFICATION\.models\[\]\.tier\)\. Capability-Certified is a separate, capability-only state\./);
  });

  // -------- Doc presence invariants --------

  it("P8 · docs/SCORING_FIELDS.md exists with composite-vs-correctness content", () => {
    const p = join(ROOT, "docs", "SCORING_FIELDS.md");
    assert.ok(existsSync(p));
    const body = readFileSync(p, "utf-8");
    assert.match(body, /Composite/);
    assert.match(body, /Correctness/);
    assert.match(body, /combineConversationalScore/);
  });

  it("P9 · docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md exists with audit-trail content", () => {
    const p = join(ROOT, "docs", "VISION_CAPABILITY_CERTIFICATION_SUMMARY.md");
    assert.ok(existsSync(p));
    const body = readFileSync(p, "utf-8");
    assert.match(body, /Vision Capability-Certified/);
    assert.match(body, /What it does \*?\*?not\*?\*? mean|what it does not mean/i);
    assert.match(body, /reports\/capability-promotions\/vision\//);
  });

  // -------- Repo hygiene invariants --------

  it("P10 · data/capability-certifications.json is NOT tracked in git (operator-owned)", () => {
    const tracked = execFileSync("git", ["ls-files", "--", "data/capability-certifications.json"], { cwd: ROOT, encoding: "utf-8" }).trim();
    assert.equal(tracked, "", "data/capability-certifications.json must not be tracked — it is operator-owned local state");
  });

  it("P11 · .gitignore covers data/capability-certifications.json explicitly", () => {
    const gi = readFileSync(join(ROOT, ".gitignore"), "utf-8");
    assert.match(gi, /^data\/capability-certifications\.json$/m);
  });

  it("P12 · scripts/crux-restart.sh exists and is executable", () => {
    const p = join(ROOT, "scripts", "crux-restart.sh");
    assert.ok(existsSync(p), "crux-restart.sh must exist");
    const st = statSync(p);
    // Owner-execute bit (0o100); shorthand for "is owner-executable".
    assert.ok((st.mode & 0o100) !== 0, `crux-restart.sh must be owner-executable (mode is ${st.mode.toString(8)})`);
  });
});
