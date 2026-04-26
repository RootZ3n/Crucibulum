/**
 * Crucible CLI — replay command
 * Replays a completed run, showing the full evidence trail.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { verifyBundle } from "../../core/bundle.js";
import type { EvidenceBundle, TimelineEvent } from "../../adapters/base.js";

export async function replayCommand(args: string[]): Promise<void> {
  const bundleId = args[0];
  if (!bundleId) {
    console.error("Usage: crucible replay <run_id>");
    process.exit(3);
  }

  const runsDir = process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
  const filePath = join(runsDir, `${bundleId}.json`);

  if (!existsSync(filePath)) {
    console.error(`Bundle not found: ${filePath}`);
    process.exit(3);
  }

  let bundle: EvidenceBundle;
  try {
    bundle = JSON.parse(readFileSync(filePath, "utf-8")) as EvidenceBundle;
  } catch (err) {
    console.error(`Failed to parse bundle: ${String(err)}`);
    process.exit(3);
  }

  // Verify integrity
  const integrity = verifyBundle(bundle);

  // Colors
  const G = "\x1b[32m";  // green
  const R = "\x1b[31m";  // red
  const Y = "\x1b[33m";  // amber
  const B = "\x1b[34m";  // blue
  const P = "\x1b[35m";  // purple
  const D = "\x1b[90m";  // dim
  const W = "\x1b[97m";  // bright white
  const X = "\x1b[0m";   // reset
  const BOLD = "\x1b[1m";

  const pass = bundle.score.pass;
  const scorePercent = Math.round(bundle.score.total * 100);
  const statusColor = pass ? G : R;
  const statusText = pass ? "PASS" : "FAIL";

  // Header
  console.log("");
  console.log(`${D}${"═".repeat(70)}${X}`);
  console.log(`  ${BOLD}CRUCIBLE REPLAY${X}`);
  console.log(`${D}${"═".repeat(70)}${X}`);
  console.log("");

  // Summary
  console.log(`  ${D}Task${X}      ${W}${bundle.task.id}${X} ${D}(${bundle.task.family} / ${bundle.task.difficulty})${X}`);
  console.log(`  ${D}Model${X}     ${W}${bundle.agent.model}${X} ${D}via ${bundle.agent.adapter}${X}`);
  console.log(`  ${D}Score${X}     ${statusColor}${BOLD}${scorePercent}%${X}  ${statusColor}${statusText}${X}`);

  const startTime = new Date(bundle.environment.timestamp_start);
  const endTime = new Date(bundle.environment.timestamp_end);
  const durationSec = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
  console.log(`  ${D}Time${X}      ${durationSec}s ${D}(${startTime.toLocaleString()})${X}`);
  console.log(`  ${D}Bundle${X}    ${D}${bundle.bundle_id}${X}`);
  console.log("");

  // Trust indicators
  const proofLabel = integrity.valid
    ? "Verified"
    : integrity.signature_status === "forged"
      ? "FORGED"
      : integrity.signature_status === "legacy_unverified"
        ? "Legacy Unverified"
        : integrity.signature_status === "unsigned_key_missing"
          ? "Signature Key Missing"
          : "TAMPERED";
  const proofColor = integrity.valid ? G : (integrity.signature_status === "legacy_unverified" || integrity.signature_status === "unsigned_key_missing" ? Y : R);
  console.log(`  ${D}Trust${X}     ${G}✓${X} Rubric Hidden  ${G}✓${X} Narration Ignored  ${G}✓${X} State-Based  ${proofColor}${integrity.valid ? "✓" : "✗"}${X} Bundle ${proofLabel}`);
  console.log("");

  // Score breakdown
  console.log(`  ${D}── Score Breakdown ──────────────────────────────────${X}`);
  const bd = bundle.score.breakdown;
  const bars = [
    { label: "Correctness", value: bd.correctness, color: G },
    { label: "Regression", value: bd.regression, color: B },
    { label: "Integrity", value: bd.integrity, color: P },
    { label: "Efficiency", value: bd.efficiency, color: Y },
  ];
  for (const bar of bars) {
    const pct = Math.round(bar.value * 100);
    const filled = Math.round(bar.value * 20);
    const empty = 20 - filled;
    const barStr = bar.color + "█".repeat(filled) + X + D + "░".repeat(empty) + X;
    console.log(`  ${bar.label.padEnd(14)} ${barStr} ${pct}%`);
  }
  console.log("");

  // Integrity violations
  if (bundle.score.integrity_violations > 0) {
    console.log(`  ${R}${BOLD}⚠ Integrity Violations: ${bundle.score.integrity_violations}${X}`);
    const v = bundle.verification_results.integrity;
    if (v.violations) {
      for (const violation of v.violations) {
        console.log(`    ${R}• ${violation}${X}`);
      }
    }
    console.log("");
  }

  // Diagnosis
  if (bundle.diagnosis.failure_mode) {
    console.log(`  ${D}── Diagnosis ───────────────────────────────────────${X}`);
    console.log(`  ${D}Failure Mode${X}    ${R}${bundle.diagnosis.failure_mode}${X}`);
    console.log(`  ${D}Localized${X}       ${bundle.diagnosis.localized_correctly ? G + "✓ Yes" : R + "✗ No"}${X}`);
    console.log(`  ${D}Avoided Decoys${X}  ${bundle.diagnosis.avoided_decoys ? G + "✓ Yes" : R + "✗ No"}${X}`);
    console.log(`  ${D}First Fix OK${X}    ${bundle.diagnosis.first_fix_correct ? G + "✓ Yes" : R + "✗ No"}${X}`);
    console.log(`  ${D}Self-Verified${X}   ${bundle.diagnosis.self_verified ? G + "✓ Yes" : R + "✗ No"}${X}`);
    console.log("");
  }

  // Timeline
  console.log(`  ${D}── Timeline ────────────────────────────────────────${X}`);
  for (const event of bundle.timeline) {
    const timeStr = String(event.t).padStart(5) + "s";
    let icon = "  ";
    let color = D;
    let detail = event.detail ?? "";

    switch (event.type) {
      case "task_start":
        icon = "▶"; color = D; detail = "Task started"; break;
      case "task_complete":
        icon = "✓"; color = G; detail = event.detail ?? "Task complete"; break;
      case "file_read":
        icon = "◇"; color = D; detail = `READ ${event.path ?? ""}`; break;
      case "file_write":
        icon = "◆"; color = B; detail = `WRITE ${event.path ?? ""}`; break;
      case "shell":
        if (event.exit_code === 0) { icon = "✓"; color = G; }
        else { icon = "✗"; color = R; }
        detail = `SHELL ${event.command ?? ""} EXIT:${event.exit_code ?? "?"}`;
        break;
      case "error":
        icon = "!"; color = R; detail = `ERROR ${event.detail ?? ""}`; break;
      case "search":
        icon = "⌕"; color = P; detail = `SEARCH ${event.detail ?? ""}`; break;
    }

    console.log(`  ${D}${timeStr}${X}  ${color}${icon}${X}  ${color}${detail}${X}`);
  }
  console.log("");

  // Diff summary
  if (bundle.diff.files_changed.length > 0 || bundle.diff.files_created.length > 0 || bundle.diff.files_deleted.length > 0) {
    console.log(`  ${D}── Changes ─────────────────────────────────────────${X}`);
    for (const f of bundle.diff.files_changed) {
      console.log(`  ${D}M${X} ${f.path} ${G}+${f.lines_added}${X} ${R}-${f.lines_removed}${X}`);
    }
    for (const f of bundle.diff.files_created) {
      console.log(`  ${G}A${X} ${f}`);
    }
    for (const f of bundle.diff.files_deleted) {
      console.log(`  ${R}D${X} ${f}`);
    }
    if (bundle.diff.forbidden_paths_touched.length > 0) {
      console.log(`  ${R}⚠ Forbidden paths touched: ${bundle.diff.forbidden_paths_touched.join(", ")}${X}`);
    }
    console.log("");
  }

  // Security
  console.log(`  ${D}── Security ────────────────────────────────────────${X}`);
  console.log(`  ${D}Injection Scan${X}    ${bundle.security.injection_scan === "clean" ? G + "Clean" : R + "DETECTED"}${X}`);
  console.log(`  ${D}Path Violations${X}   ${bundle.security.forbidden_paths_violations === 0 ? G + "0" : R + String(bundle.security.forbidden_paths_violations)}${X}`);
  console.log(`  ${D}Anti-Cheat${X}        ${bundle.security.anti_cheat_violations === 0 ? G + "0" : R + String(bundle.security.anti_cheat_violations)}${X}`);
  console.log(`  ${D}Escape Attempts${X}   ${bundle.security.workspace_escape_attempts === 0 ? G + "0" : R + String(bundle.security.workspace_escape_attempts)}${X}`);
  console.log("");

  // Usage
  console.log(`  ${D}── Usage ───────────────────────────────────────────${X}`);
  console.log(`  ${D}Tokens${X}     ${bundle.usage.tokens_in} in → ${bundle.usage.tokens_out} out`);
  console.log(`  ${D}Cost${X}       ${bundle.usage.estimated_cost_usd === 0 ? "Free (local)" : "$" + bundle.usage.estimated_cost_usd.toFixed(4)}`);
  console.log(`  ${D}Provider${X}   ${bundle.usage.provider_cost_note}`);
  console.log("");

  // Bundle hash
  console.log(`  ${D}── Bundle Integrity ────────────────────────────────${X}`);
  console.log(`  ${D}Hash${X}       ${bundle.bundle_hash}`);
  console.log(`  ${D}Status${X}     ${integrity.valid ? G + "✓ Verified — bundle has not been tampered" : R + "✗ TAMPERED — hash mismatch"}${X}`);
  console.log("");

  console.log(`${D}${"═".repeat(70)}${X}`);
  console.log("");
}
