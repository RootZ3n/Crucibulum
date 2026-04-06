/**
 * Crucibulum CLI — leaderboard command
 * crucibulum leaderboard show
 * crucibulum leaderboard submit [bundle_id]
 */
import { loadBundles, aggregateByModel, buildLeaderboardEntry, saveSubmission, loadSubmissions } from "../../leaderboard/aggregator.js";
export async function leaderboardCommand(args) {
    const sub = args[0];
    if (sub === "submit") {
        const bundles = loadBundles();
        if (bundles.length === 0) {
            console.log("No runs to submit.");
            return;
        }
        const grouped = aggregateByModel(bundles);
        let submitted = 0;
        for (const [modelKey, modelBundles] of grouped) {
            const entry = buildLeaderboardEntry(modelKey, modelBundles);
            const path = saveSubmission(entry);
            console.log(`Submitted: ${modelKey} → ${path}`);
            submitted++;
        }
        console.log(`\n${submitted} submission(s) saved.`);
        return;
    }
    if (sub === "show" || !sub) {
        const submissions = loadSubmissions();
        if (submissions.length === 0) {
            // Try building from runs
            const bundles = loadBundles();
            if (bundles.length === 0) {
                console.log("No data. Run some tasks first.");
                return;
            }
            const grouped = aggregateByModel(bundles);
            const entries = [];
            for (const [key, modelBundles] of grouped) {
                entries.push(buildLeaderboardEntry(key, modelBundles));
            }
            printLeaderboard(entries);
            return;
        }
        printLeaderboard(submissions);
        return;
    }
    console.log("Usage: crucibulum leaderboard show | crucibulum leaderboard submit");
}
function printLeaderboard(entries) {
    const sorted = [...entries].sort((a, b) => b.scores.total - a.scores.total);
    console.log("\n" + "═".repeat(80));
    console.log("  CRUCIBULUM LEADERBOARD");
    console.log("═".repeat(80));
    console.log("");
    console.log("  Rank  Model".padEnd(40) + "Score".padEnd(10) + "Pass".padEnd(10) + "Time".padEnd(10) + "Cost");
    console.log("  " + "─".repeat(76));
    sorted.forEach((e, i) => {
        const rank = String(i + 1).padStart(2, " ");
        const model = `${e.agent.adapter}:${e.agent.model}`.slice(0, 28).padEnd(30);
        const score = `${(e.scores.total * 100).toFixed(0)}%`.padEnd(10);
        const pass = `${e.tasks_passed}/${e.tasks_attempted}`.padEnd(10);
        const time = `${e.performance.median_time_sec}s`.padEnd(10);
        const cost = e.performance.total_cost_usd === 0 ? "free" : `$${e.performance.total_cost_usd.toFixed(4)}`;
        const scoreColor = e.scores.total >= 0.7 ? "\x1b[32m" : e.scores.total >= 0.5 ? "\x1b[33m" : "\x1b[31m";
        console.log(`  ${rank}.  ${model}${scoreColor}${score}\x1b[0m${pass}${time}${cost}`);
    });
    console.log("");
    console.log("═".repeat(80));
    console.log("");
}
//# sourceMappingURL=leaderboard.js.map