/**
 * Crucibulum CLI — list command
 */
import { listTasks } from "../../core/manifest.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export async function listCommand(args) {
    const subcommand = args[0];
    if (subcommand === "tasks") {
        const familyArg = args.indexOf("--family");
        const family = familyArg >= 0 ? args[familyArg + 1] : undefined;
        const tasks = listTasks(family);
        if (tasks.length === 0) {
            console.log("No tasks found.");
            return;
        }
        console.log("\n  AVAILABLE TASKS");
        console.log("  " + "-".repeat(56));
        for (const t of tasks) {
            const diff = t.difficulty.toUpperCase().padEnd(6);
            console.log(`  ${t.id.padEnd(16)} ${diff} ${t.family.padEnd(22)} ${t.title}`);
        }
        console.log("");
    }
    else if (subcommand === "runs") {
        const runsDir = process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
        try {
            const files = readdirSync(runsDir).filter(f => f.endsWith(".json"));
            if (files.length === 0) {
                console.log("No runs found.");
                return;
            }
            console.log("\n  COMPLETED RUNS");
            console.log("  " + "-".repeat(56));
            for (const f of files) {
                try {
                    const bundle = JSON.parse(readFileSync(join(runsDir, f), "utf-8"));
                    const status = bundle.score.pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
                    console.log(`  ${bundle.bundle_id.padEnd(40)} ${status}  ${(bundle.score.total * 100).toFixed(0)}%  ${bundle.agent.model}`);
                }
                catch { /* skip invalid */ }
            }
            console.log("");
        }
        catch {
            console.log("No runs directory found.");
        }
    }
    else {
        console.log("Usage: crucibulum list tasks [--family <name>] | crucibulum list runs");
    }
}
//# sourceMappingURL=list.js.map