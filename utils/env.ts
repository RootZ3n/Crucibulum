import { join, resolve } from "node:path";

export function envValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value.trim().length > 0) return value;
  }
  return undefined;
}

export function luakStateRoot(): string {
  return resolve(envValue("LUAK_STATE_ROOT", "CRUCIBLE_STATE_ROOT", "CRUCIBULUM_STATE_DIR") ?? join(process.cwd(), "state"));
}

export const crucibleStateRoot = luakStateRoot;

