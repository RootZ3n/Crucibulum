/**
 * Crucibulum — SHA256 Hashing
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
export function sha256(data) {
    return createHash("sha256").update(data).digest("hex");
}
export function sha256Hex(data) {
    return `sha256:${sha256(data)}`;
}
export async function sha256File(filePath) {
    const content = await readFile(filePath);
    return sha256Hex(content);
}
export function sha256Object(obj) {
    return sha256Hex(JSON.stringify(obj, null, 0));
}
//# sourceMappingURL=hashing.js.map