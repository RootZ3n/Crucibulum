/**
 * Luak — Roleplay routes
 *
 * Surface the latest roleplay smoke report (path-proven, experimental).
 * Backed by reports/capability-expansion/roleplay-smoke/latest.json,
 * which `scripts/roleplay-smoke.mjs --write-report` writes/rotates.
 *
 * Roleplay remains experimental and is excluded from leaderboard +
 * certification. This endpoint is read-only and reports that posture
 * explicitly on every payload via the underlying JSON's
 * `affectsLeaderboard:false` / `affectsCertification:false` fields.
 *
 * Mirrors server/routes/vision.ts so the UI uses the same load pattern.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sendJSON } from "./shared.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const LATEST = join(
  REPO_ROOT,
  "reports",
  "capability-expansion",
  "roleplay-smoke",
  "latest.json",
);

export async function handleLatestSmoke(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!existsSync(LATEST)) {
    sendJSON(res, 200, {
      available: false,
      reason: "no roleplay-smoke report on disk yet — run scripts/roleplay-smoke.mjs --write-report",
      experimental: true,
      affectsLeaderboard: false,
      affectsCertification: false,
    });
    return;
  }
  try {
    const raw = readFileSync(LATEST, "utf-8");
    const parsed = JSON.parse(raw);
    // Defensive: always re-assert the experimental posture on the wire,
    // even if a future report omits the field.
    sendJSON(res, 200, {
      available: true,
      experimental: parsed.experimental !== false,
      affectsLeaderboard: parsed.affectsLeaderboard === true,
      affectsCertification: parsed.affectsCertification === true,
      report: parsed,
      reportPath: "reports/capability-expansion/roleplay-smoke/latest.json",
    });
  } catch (err) {
    sendJSON(res, 500, {
      available: false,
      reason: `could not read latest roleplay-smoke report: ${String((err as Error)?.message ?? err)}`,
      experimental: true,
      affectsLeaderboard: false,
      affectsCertification: false,
    });
  }
}
