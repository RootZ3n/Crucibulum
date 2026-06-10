/**
 * Luak — Structured Logger
 *
 * Every message and data payload is passed through redactSecrets before it
 * reaches the console: provider 401/403/429 bodies routinely echo the
 * Authorization header or key fragments, and those flow through log() into
 * operator terminals and captured logs. (Audit H2.)
 */

import { redactSecrets } from "../core/redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = (process.env["CRUCIBULUM_LOG_LEVEL"] as LogLevel) ?? "info";

export function setLogLevel(level: LogLevel): void { currentLevel = level; }

export function log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  const safeMessage = redactSecrets(message);
  // redactSecrets stringifies its input, so a structured data payload comes
  // back as a redacted JSON string — safe to print without leaking a key
  // nested several levels deep.
  const safeData = data === undefined ? "" : redactSecrets(data);
  const prefix = level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : level === "info" ? "\x1b[36m" : "\x1b[90m";
  const out = `${prefix}[${level.toUpperCase()}]\x1b[0m [${component}] ${safeMessage}`;
  if (level === "error") console.error(out, safeData);
  else if (level === "warn") console.warn(out, safeData);
  else console.log(out, safeData);
}
