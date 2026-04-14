import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
function linksDir() {
    return process.env["CRUCIBULUM_LINKS_DIR"] ?? join(process.cwd(), "runs");
}
function linkPath(bundleId) {
    return join(linksDir(), `${bundleId}.crucible.json`);
}
export function readCrucibleLink(bundleId) {
    const file = linkPath(bundleId);
    if (!existsSync(file)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(file, "utf-8"));
    }
    catch {
        // Corrupted link JSON — treat as missing rather than crashing the request.
        return null;
    }
}
export function writeCrucibleLink(bundleId, link) {
    mkdirSync(linksDir(), { recursive: true });
    writeFileSync(linkPath(bundleId), JSON.stringify(link, null, 2) + "\n", "utf-8");
}
//# sourceMappingURL=validation-links.js.map