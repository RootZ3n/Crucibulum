/**
 * Crucible — Structured Logger
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export declare function setLogLevel(level: LogLevel): void;
export declare function log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void;
//# sourceMappingURL=logger.d.ts.map