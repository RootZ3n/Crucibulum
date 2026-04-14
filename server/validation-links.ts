import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CrucibleLink } from "./contracts.js";

function linksDir(): string {
  return process.env["CRUCIBULUM_LINKS_DIR"] ?? join(process.cwd(), "runs");
}

function linkPath(bundleId: string): string {
  return join(linksDir(), `${bundleId}.crucible.json`);
}

export function readCrucibleLink(bundleId: string): CrucibleLink | null {
  const file = linkPath(bundleId);
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as CrucibleLink;
  } catch {
    // Corrupted link JSON — treat as missing rather than crashing the request.
    return null;
  }
}

export function writeCrucibleLink(bundleId: string, link: CrucibleLink): void {
  mkdirSync(linksDir(), { recursive: true });
  writeFileSync(linkPath(bundleId), JSON.stringify(link, null, 2) + "\n", "utf-8");
}
