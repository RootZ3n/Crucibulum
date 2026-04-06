/**
 * Crucibulum — Manifest Loader
 * Loads full manifest for judge, filters for agent-visible version.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { sha256Hex } from "../utils/hashing.js";
import { log } from "../utils/logger.js";
const TASKS_DIR = join(process.cwd(), "tasks");
/**
 * Load a task manifest by task ID.
 * Looks in tasks/{family}/{taskId}/manifest.json
 */
export function loadManifest(taskId) {
    // Search all family directories
    const families = ["poison", "spec", "orchestration"];
    for (const family of families) {
        const manifestPath = join(TASKS_DIR, family, taskId, "manifest.json");
        try {
            const raw = readFileSync(manifestPath, "utf-8");
            const manifest = JSON.parse(raw);
            if (manifest.id !== taskId) {
                throw new Error(`Manifest ID mismatch: expected ${taskId}, got ${manifest.id}`);
            }
            log("info", "manifest", `Loaded manifest: ${taskId} (${manifest.family})`);
            return manifest;
        }
        catch (err) {
            if (err.code === "ENOENT")
                continue;
            throw err;
        }
    }
    throw new Error(`Task manifest not found: ${taskId}`);
}
/**
 * Resolve the repo path for a manifest.
 */
export function resolveRepoPath(manifest) {
    const families = ["poison", "spec", "orchestration"];
    for (const family of families) {
        const taskDir = join(TASKS_DIR, family, manifest.id);
        const repoPath = join(taskDir, "repo");
        try {
            readFileSync(join(taskDir, "manifest.json"));
            return resolve(repoPath);
        }
        catch {
            continue;
        }
    }
    return resolve(manifest.repo.path);
}
/**
 * Filter manifest to agent-visible version.
 * Strips: oracle_ref, scoring, metadata, forbidden_paths, max_file_edits, max_files_read
 */
export function filterForAgent(manifest) {
    return {
        task: {
            title: manifest.task.title,
            description: manifest.task.description,
            entrypoints: manifest.task.entrypoints,
        },
        constraints: {
            time_limit_sec: manifest.constraints.time_limit_sec,
            max_steps: manifest.constraints.max_steps,
            allowed_tools: manifest.constraints.allowed_tools,
            network_allowed: manifest.constraints.network_allowed,
        },
        verification: {
            public_tests_command: manifest.verification.public_tests_command,
            build_command: manifest.verification.build_command,
        },
    };
}
/**
 * List all available task IDs.
 */
export function listTasks(family) {
    const results = [];
    const families = family ? [family] : ["poison", "spec", "orchestration"];
    for (const f of families) {
        const familyDir = join(TASKS_DIR, f);
        try {
            for (const entry of readdirSync(familyDir, { withFileTypes: true })) {
                if (!entry.isDirectory())
                    continue;
                try {
                    const manifest = loadManifest(entry.name);
                    results.push({
                        id: manifest.id,
                        family: manifest.family,
                        title: manifest.task.title,
                        difficulty: manifest.difficulty,
                    });
                }
                catch {
                    /* skip invalid */
                }
            }
        }
        catch {
            /* family dir doesn't exist */
        }
    }
    return results;
}
/**
 * Compute manifest hash for evidence bundle.
 */
export function hashManifest(manifest) {
    return sha256Hex(JSON.stringify(manifest));
}
//# sourceMappingURL=manifest.js.map