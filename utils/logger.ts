/**
 * Crucibulum — Structured Logger
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = (process.env["CRUCIBULUM_LOG_LEVEL"] as LogLevel) ?? "info";

export function setLogLevel(level: LogLevel): void { currentLevel = level; }

export function log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...(data ? { data } : {}),
  };
  const prefix = level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : level === "info" ? "\x1b[36m" : "\x1b[90m";
  const out = `${prefix}[${level.toUpperCase()}]\x1b[0m [${component}] ${message}`;
  if (level === "error") console.error(out, data ?? "");
  else if (level === "warn") console.warn(out, data ?? "");
  else console.log(out, data ?? "");
}
