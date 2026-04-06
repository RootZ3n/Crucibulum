/**
 * Crucibulum — Structured Logger
 */
const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel = process.env["CRUCIBULUM_LOG_LEVEL"] ?? "info";
export function setLogLevel(level) { currentLevel = level; }
export function log(level, component, message, data) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel])
        return;
    const entry = {
        ts: new Date().toISOString(),
        level,
        component,
        message,
        ...(data ? { data } : {}),
    };
    const prefix = level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : level === "info" ? "\x1b[36m" : "\x1b[90m";
    const out = `${prefix}[${level.toUpperCase()}]\x1b[0m [${component}] ${message}`;
    if (level === "error")
        console.error(out, data ?? "");
    else if (level === "warn")
        console.warn(out, data ?? "");
    else
        console.log(out, data ?? "");
}
//# sourceMappingURL=logger.js.map