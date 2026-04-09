/**
 * Crucibulum CLI — list command
 */
import { listTasks } from "../../core/manifest.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
function listConversationalTasks() {
    const tasksDir = resolve(process.env["CRUCIBULUM_TASKS_DIR"] ?? join(process.cwd(), "tasks"));
    const convFamilies = [
        "identity", "truthfulness", "proactive", "personality", "adversarial_chat", "cost_efficiency",
        "classification", "code", "workflow", "instruction-obedience", "prompt-sensitivity",
        "role-stress", "context-degradation", "reasoning", "summarization", "token-efficiency", "thinking-mode",
    ];
    const results = [];
    for (const family of convFamilies) {
        const familyDir = join(tasksDir, family);
        if (!existsSync(familyDir))
            continue;
        try {
            const dirs = readdirSync(familyDir, { withFileTypes: true }).filter(d => d.isDirectory());
            for (const dir of dirs) {
                const manifestPath = join(familyDir, dir.name, "manifest.json");
                if (!existsSync(manifestPath))
                    continue;
                try {
                    const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
                    if (raw.execution_mode === "conversational") {
                        results.push({
                            id: raw.id,
                            difficulty: raw.difficulty,
                            family: raw.family,
                            description: raw.description.slice(0, 60),
                        });
                    }
                }
                catch { /* skip invalid */ }
            }
        }
        catch { /* skip missing dirs */ }
    }
    return results;
}
export async function listCommand(args) {
    const subcommand = args[0];
    if (subcommand === "tasks") {
        const familyArg = args.indexOf("--family");
        const family = familyArg >= 0 ? args[familyArg + 1] : undefined;
        const tasks = listTasks(family);
        const convTasks = listConversationalTasks();
        if (tasks.length === 0 && convTasks.length === 0) {
            console.log("No tasks found.");
            return;
        }
        if (tasks.length > 0) {
            console.log("\n  CODE TASKS");
            console.log("  " + "-".repeat(56));
            for (const t of tasks) {
                const diff = t.difficulty.toUpperCase().padEnd(6);
                console.log(`  ${t.id.padEnd(16)} ${diff} ${t.family.padEnd(22)} ${t.title}`);
            }
        }
        if (convTasks.length > 0) {
            console.log("\n  CONVERSATIONAL TASKS");
            console.log("  " + "-".repeat(56));
            for (const t of convTasks) {
                const diff = t.difficulty.toUpperCase().padEnd(6);
                console.log(`  ${t.id.padEnd(28)} ${diff} ${t.family.padEnd(16)} ${t.description}`);
            }
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