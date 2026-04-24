/**
 * Crucible — SHA256 Hashing
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256Hex(data: string | Buffer): string {
  return `sha256:${sha256(data)}`;
}

export async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return sha256Hex(content);
}

export function sha256Object(obj: unknown): string {
  return sha256Hex(JSON.stringify(obj, null, 0));
}
