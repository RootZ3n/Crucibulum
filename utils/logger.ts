/**
 * Luak — Structured Logger
 *
 * Every message and data payload is passed through redactSecrets before it
 * reaches the console: provider 401/403/429 bodies routinely echo the
 * Authorization header or key fragments, and those flow through log() into
 * operator terminals and captured logs. (Audit H2.)
 *
 * File transport (Audit C1): the server runs as a background process with no
 * attached terminal, so console-only output vanishes into the void — an
 * operator has no way to diagnose a failed run after the fact. Every log()
 * call now ALSO appends a redacted JSON line to state/server.log (rotated at
 * 10MB), and the recent tail is exposed via GET /api/health/logs.
 */

import { appendFileSync, mkdirSync, renameSync, statSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { redactSecrets } from "../core/redact.js";
import { luakStateRoot } from "./env.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = (process.env["CRUCIBULUM_LOG_LEVEL"] as LogLevel) ?? "info";

export function setLogLevel(level: LogLevel): void { currentLevel = level; }

// ─── File transport ────────────────────────────────────────────────

// Rotate when the active log file reaches this size. One rotated generation
// (server.log.1) is kept; the next rotation overwrites it. Keeping a single
// generation bounds disk use without a full logrotate dependency.
const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Resolve the active log file. Tests point LUAK_LOG_FILE at a temp path so
 * they can read back what they wrote without touching the real state/ file.
 */
export function logFilePath(): string {
  return process.env["LUAK_LOG_FILE"] ?? join(luakStateRoot(), "server.log");
}

function ensureLogDir(file: string): void {
  try { mkdirSync(dirname(file), { recursive: true }); } catch { /* best effort */ }
}

function rotateIfNeeded(file: string): void {
  try {
    const st = statSync(file);
    if (st.size >= MAX_LOG_BYTES) {
      // Single-generation rotation: server.log → server.log.1 (overwriting any
      // prior .1), then a fresh server.log is started by the next append.
      renameSync(file, `${file}.1`);
    }
  } catch { /* file does not exist yet — nothing to rotate */ }
}

/**
 * Append one redacted JSON line to the log file. File-transport failures are
 * swallowed: logging must never crash the process or mask the original event,
 * which is still going to the console.
 */
function writeToFile(entry: Record<string, unknown>): void {
  if (process.env["LUAK_DISABLE_FILE_LOG"] === "1") return;
  try {
    const file = logFilePath();
    ensureLogDir(file);
    rotateIfNeeded(file);
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch { /* never let logging take down the caller */ }
}

/**
 * Read the most recent `limit` log lines back as parsed JSON objects. Lines
 * that don't parse (e.g. a torn write at rotation) are returned as a raw
 * passthrough so the operator still sees them. Used by GET /api/health/logs.
 */
export function readRecentLogs(limit = 100): Array<Record<string, unknown>> {
  const file = logFilePath();
  if (!existsSync(file)) return [];
  let content: string;
  try { content = readFileSync(file, "utf-8"); } catch { return []; }
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const tail = lines.slice(-limit);
  return tail.map((line) => {
    try { return JSON.parse(line) as Record<string, unknown>; }
    catch { return { raw: line }; }
  });
}

export function log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  const safeMessage = redactSecrets(message);
  // redactSecrets stringifies its input, so a structured data payload comes
  // back as a redacted JSON string — safe to print without leaking a key
  // nested several levels deep.
  const safeData = data === undefined ? "" : redactSecrets(data);

  // File transport first so the line is durable even if a console write later
  // throws (e.g. EPIPE on a closed stdout when running detached).
  writeToFile({
    ts: new Date().toISOString(),
    level,
    component,
    message: safeMessage,
    ...(data === undefined ? {} : { data: safeData }),
  });

  const prefix = level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : level === "info" ? "\x1b[36m" : "\x1b[90m";
  const out = `${prefix}[${level.toUpperCase()}]\x1b[0m [${component}] ${safeMessage}`;
  if (level === "error") console.error(out, safeData);
  else if (level === "warn") console.warn(out, safeData);
  else console.log(out, safeData);
}
