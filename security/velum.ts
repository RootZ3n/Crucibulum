/**
 * Crucibulum — Security: Injection Scanner + Anti-Cheat
 * Velum-grade prompt injection detection.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger.js";

// ── Injection Patterns ─────────────────────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  // Classic injection
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /forget\s+everything/i,
  /disregard\s+(all\s+)?(prior|previous)/i,
  /new\s+instructions?\s*:/i,
  /override\s+(system|safety)/i,
  // Crucibulum-specific
  /reveal\s+(the\s+)?oracle/i,
  /show\s+(me\s+)?(the\s+)?hidden\s+tests/i,
  /what\s+are\s+the\s+scoring\s+weights/i,
  /show\s+(me\s+)?(the\s+)?rubric/i,
  /display\s+(the\s+)?oracle/i,
  /print\s+(the\s+)?oracle/i,
  /read\s+.*oracle.*\.json/i,
  /cat\s+.*oracle/i,
  // Path traversal
  /\.\.\/oracles?\//i,
  /\/\.crucibulum\//i,
  /\.\.\/\.\.\/oracles/i,
  // Self-modification
  /modify\s+(the\s+)?crucibulum/i,
  /edit\s+(the\s+)?harness/i,
  /change\s+(the\s+)?scoring/i,
];

// ── Anti-Cheat Code Patterns ───────────────────────────────────────────────

const ANTI_CHEAT_CODE_PATTERNS: RegExp[] = [
  /return\s+true\s*[;/]/,
  /\.skip\s*\(/,
  /\bxit\s*\(/,
  /\bxdescribe\s*\(/,
  /process\.exit\s*\(\s*0\s*\)/,
  /\.mockReturnValue\s*\(\s*true\s*\)/,
];

const ANTI_CHEAT_COMMENT_PATTERNS: RegExp[] = [
  /TODO:\s*fix\s+later/i,
  /HACK:/i,
  /disabled\s+for\s+now/i,
  /skip.*test/i,
];

// ── Public API ─────────────────────────────────────────────────────────────

export interface ScanResult {
  clean: boolean;
  violations: Array<{
    type: "injection" | "anti_cheat_code" | "anti_cheat_comment" | "path_traversal";
    pattern: string;
    context: string;
  }>;
}

export function scanForInjection(text: string): ScanResult {
  const violations: ScanResult["violations"] = [];

  for (const pattern of INJECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      violations.push({
        type: "injection",
        pattern: pattern.source,
        context: match[0],
      });
    }
  }

  return { clean: violations.length === 0, violations };
}

export function scanDiffForAntiCheat(patchText: string): ScanResult {
  const violations: ScanResult["violations"] = [];

  // Only scan added lines (lines starting with +)
  const addedLines = patchText.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++"));

  for (const line of addedLines) {
    for (const pattern of ANTI_CHEAT_CODE_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({ type: "anti_cheat_code", pattern: pattern.source, context: line.slice(1).trim() });
      }
    }
    for (const pattern of ANTI_CHEAT_COMMENT_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({ type: "anti_cheat_comment", pattern: pattern.source, context: line.slice(1).trim() });
      }
    }
  }

  return { clean: violations.length === 0, violations };
}

export function isPathForbidden(path: string, forbiddenPaths: string[]): boolean {
  const normalized = path.replace(/\\/g, "/");
  return forbiddenPaths.some(fp => normalized.startsWith(fp) || normalized.includes("/../" + fp));
}
