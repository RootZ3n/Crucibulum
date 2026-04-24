/**
 * Crucible — Judge
 * Scores based on observable state transitions. Never trusts narration.
 * Scoring order: Integrity → Correctness → Regression → Efficiency
 */
import { execSync } from "node:child_process";
import { log } from "../utils/logger.js";
export const DETERMINISTIC_JUDGE_METADATA = {
    kind: "deterministic",
    label: "Judge: deterministic",
    description: "oracle + hidden/public tests + integrity checks",
    verifier_model: null,
    components: ["oracle", "hidden tests", "public tests", "diff rules", "integrity checks"],
};
export function judge(manifest, oracle, diff, execution, workspacePath) {
    log("info", "judge", `Judging ${manifest.id}: ${diff.files_changed.length} files changed, ${execution.steps_used} steps`);
    // -- 1. INTEGRITY (check first — hard fails) -------------------------------
    const integrity = judgeIntegrity(oracle, diff, execution);
    const hasHardFail = integrity.violations.some(v => v.startsWith("HARD_FAIL"));
    // -- 2. CORRECTNESS (hidden tests + checks) --------------------------------
    const correctness = hasHardFail
        ? { score: 0, details: { "skipped-hard-fail": "fail" } }
        : judgeCorrectness(oracle, workspacePath);
    // -- 3. REGRESSION (public tests + build) -----------------------------------
    const regression = hasHardFail
        ? { score: 0, details: { "skipped-hard-fail": "fail" } }
        : judgeRegression(oracle, workspacePath);
    // -- 4. EFFICIENCY ----------------------------------------------------------
    const efficiency = judgeEfficiency(execution, manifest);
    // -- 5. DIAGNOSIS (agent trace — for audit, NOT scoring) --------------------
    const diagnosis = buildDiagnosis(oracle, diff, execution);
    return {
        verification: { correctness, regression, integrity, efficiency },
        diagnosis,
    };
}
// -- Integrity Judge ----------------------------------------------------------
function judgeIntegrity(oracle, diff, _execution) {
    const details = {};
    const violations = [];
    // Check forbidden paths
    if (diff.forbidden_paths_touched.length > 0) {
        details["forbidden_paths"] = "fail";
        violations.push(`HARD_FAIL: forbidden paths touched: ${diff.forbidden_paths_touched.join(", ")}`);
    }
    else {
        details["forbidden_paths"] = "pass";
    }
    // Check integrity rules from oracle
    for (const check of oracle.checks.integrity) {
        if (check.type === "forbidden_edit" && check.paths) {
            const touched = diff.files_changed
                .filter(f => check.paths.some(p => f.path.startsWith(p)))
                .map(f => f.path);
            if (touched.length > 0) {
                details[check.id] = "fail";
                if (check.severity === "hard_fail") {
                    violations.push(`HARD_FAIL: ${check.id}: ${touched.join(", ")}`);
                }
                else {
                    violations.push(`PENALTY: ${check.id}: ${touched.join(", ")}`);
                }
            }
            else {
                details[check.id] = "pass";
            }
        }
        if (check.type === "diff_rule") {
            if (check.rule === "no_file_deletion" && check.target_pattern) {
                const pattern = new RegExp(check.target_pattern.replace(/\*/g, ".*"));
                const deleted = diff.files_deleted.filter(f => pattern.test(f));
                if (deleted.length > 0) {
                    details[check.id] = "fail";
                    violations.push(`${check.severity === "hard_fail" ? "HARD_FAIL" : "PENALTY"}: ${check.id}: deleted ${deleted.join(", ")}`);
                }
                else {
                    details[check.id] = "pass";
                }
            }
            if (check.rule === "max_lines_changed" && check.value != null) {
                const totalChanged = diff.files_changed.reduce((sum, f) => sum + f.lines_added + f.lines_removed, 0);
                if (totalChanged > check.value) {
                    details[check.id] = "fail";
                    violations.push(`${check.severity === "hard_fail" ? "HARD_FAIL" : "PENALTY"}: ${check.id}: ${totalChanged} lines changed (max ${check.value})`);
                }
                else {
                    details[check.id] = "pass";
                }
            }
        }
    }
    // Check anti-cheat patterns in diff
    const allPatches = diff.files_changed.map(f => f.patch).join("\n");
    for (const pattern of oracle.checks.anti_cheat.forbidden_code_patterns) {
        if (allPatches.includes(pattern)) {
            details[`anti_cheat_code_${pattern.slice(0, 20)}`] = "fail";
            violations.push(`HARD_FAIL: anti-cheat code pattern detected: ${pattern}`);
        }
    }
    const totalChecks = Object.keys(details).length;
    const passed = Object.values(details).filter(v => v === "pass").length;
    const score = totalChecks > 0 ? passed / totalChecks : 1;
    return { score: violations.some(v => v.startsWith("HARD_FAIL")) ? 0 : score, details, violations };
}
// -- Correctness Judge --------------------------------------------------------
function judgeCorrectness(oracle, workspacePath) {
    const details = {};
    const commandResults = [];
    let totalWeight = 0;
    let passedWeight = 0;
    for (const check of oracle.checks.correctness) {
        const weight = check.weight ?? 1;
        if (check.type === "hidden_test" && check.command) {
            totalWeight += weight;
            const commandResult = runCommand(check.id, "correctness", check.command, workspacePath);
            commandResults.push(commandResult);
            details[check.id] = commandResult.status === "pass" ? "pass" : commandResult.status === "fail" ? "fail" : "unsupported";
            if (commandResult.status === "pass")
                passedWeight += weight;
        }
        else if (check.type === "api_check") {
            // API checks are not implemented — mark as unsupported, do NOT count toward score
            // This prevents fake passes from inflating correctness scores
            details[check.id] = "unsupported";
            commandResults.push({
                id: check.id,
                scope: "correctness",
                command: check.endpoint ?? "api_check",
                status: "unsupported",
                summary: "API correctness checks are not implemented in the deterministic judge",
                errorKind: "unevaluable",
            });
        }
        else if (check.type === "hidden_test" && !check.command) {
            // Hidden test with no command — also unsupported
            details[check.id] = "unsupported";
            commandResults.push({
                id: check.id,
                scope: "correctness",
                command: "",
                status: "unsupported",
                summary: "Correctness check has no command and is not evaluable",
                errorKind: "unevaluable",
            });
        }
    }
    // If every correctness check was unsupported (or the oracle had none at all),
    // we have no evaluable signal. Return score=0 but flag not_evaluable so
    // consumers can distinguish "nothing to grade" from "graded and got zero".
    if (totalWeight === 0) {
        const hasChecks = oracle.checks.correctness.length > 0;
        if (hasChecks) {
            log("warn", "judge", `Correctness: all ${oracle.checks.correctness.length} check(s) unsupported — score is not evaluable`);
        }
        return { score: 0, details, not_evaluable: true, command_results: commandResults };
    }
    return { score: totalWeight > 0 ? passedWeight / totalWeight : 0, details, command_results: commandResults };
}
// -- Regression Judge ---------------------------------------------------------
function judgeRegression(oracle, workspacePath) {
    const details = {};
    const commandResults = [];
    let total = 0;
    let passed = 0;
    for (const check of oracle.checks.regression) {
        total++;
        if (check.command) {
            const commandResult = runCommand(check.id, "regression", check.command, workspacePath);
            commandResults.push(commandResult);
            details[check.id] = commandResult.status === "pass" ? "pass" : "fail";
            if (commandResult.status === "pass")
                passed++;
        }
        else {
            details[check.id] = "pass";
            passed++;
            commandResults.push({
                id: check.id,
                scope: "regression",
                command: "",
                status: "pass",
                summary: "Regression check had no command and was treated as pass",
                exitCode: 0,
            });
        }
    }
    return { score: total > 0 ? passed / total : 1, details, command_results: commandResults };
}
// -- Efficiency Judge ---------------------------------------------------------
function judgeEfficiency(execution, manifest) {
    const timeSec = Math.round(execution.duration_ms / 1000);
    const timeRatio = timeSec / manifest.constraints.time_limit_sec;
    const stepRatio = execution.steps_used / manifest.constraints.max_steps;
    // Score inversely proportional to resource usage — lower = better
    const score = Math.max(0, 1 - (timeRatio * 0.6 + stepRatio * 0.4));
    return {
        time_sec: timeSec,
        time_limit_sec: manifest.constraints.time_limit_sec,
        steps_used: execution.steps_used,
        steps_limit: manifest.constraints.max_steps,
        score: Math.round(score * 100) / 100,
    };
}
// -- Diagnosis Builder (for audit, NOT scoring) -------------------------------
function buildDiagnosis(oracle, diff, execution) {
    const bugFile = oracle.ground_truth.bug_location;
    const changedPaths = diff.files_changed.map(f => f.path);
    const localizedCorrectly = changedPaths.includes(bugFile);
    const decoyPaths = oracle.checks.decoys.map(d => d.path);
    const touchedDecoys = changedPaths.filter(p => decoyPaths.includes(p));
    const avoidedDecoys = touchedDecoys.length === 0;
    // Check if fix matches expected pattern
    const bugFileDiff = diff.files_changed.find(f => f.path === bugFile);
    const firstFixCorrect = bugFileDiff
        ? bugFileDiff.patch.includes(oracle.ground_truth.correct_fix_pattern)
        : false;
    // Check if agent ran tests after fixing (self-verification)
    const timeline = execution.timeline;
    let lastWrite = -1;
    for (let i = timeline.length - 1; i >= 0; i--) {
        if (timeline[i].type === "file_write") {
            lastWrite = i;
            break;
        }
    }
    const testAfterWrite = timeline.slice(lastWrite + 1).some(e => e.type === "shell" && (e.command?.includes("test") || e.command?.includes("jest") || e.command?.includes("npm test")));
    let failureMode = null;
    if (!localizedCorrectly)
        failureMode = "localization_failure";
    else if (!avoidedDecoys)
        failureMode = "decoy_distraction";
    else if (!firstFixCorrect)
        failureMode = "wrong_fix";
    return {
        localized_correctly: localizedCorrectly,
        avoided_decoys: avoidedDecoys,
        first_fix_correct: firstFixCorrect,
        self_verified: testAfterWrite,
        failure_mode: failureMode,
    };
}
// -- Command runner -----------------------------------------------------------
function runCommand(id, scope, command, cwd) {
    try {
        const stdout = execSync(command, { cwd, stdio: "pipe", timeout: 60_000, maxBuffer: 5 * 1024 * 1024, encoding: "utf-8" });
        return {
            id,
            scope,
            command,
            status: "pass",
            summary: "Command completed successfully",
            exitCode: 0,
            stdout: String(stdout),
        };
    }
    catch (err) {
        const error = err;
        const stdout = typeof error.stdout === "string" ? error.stdout : error.stdout?.toString("utf-8");
        const stderr = typeof error.stderr === "string" ? error.stderr : error.stderr?.toString("utf-8");
        const timedOut = error.signal === "SIGTERM" || error.killed === true;
        const spawnFailure = typeof error.code === "string" && ["ENOENT", "EACCES"].includes(error.code);
        const status = timedOut || spawnFailure ? "error" : "fail";
        const summary = timedOut
            ? `Command timed out: ${command}`
            : spawnFailure
                ? `Command could not start (${error.code}): ${command}`
                : `Command exited non-zero${error.status != null ? ` (${error.status})` : ""}: ${command}`;
        return {
            id,
            scope,
            command,
            status,
            summary,
            exitCode: error.status ?? null,
            timedOut,
            stdout,
            stderr,
            errorKind: timedOut ? "timeout" : spawnFailure ? "spawn_error" : status === "error" ? "runtime_error" : undefined,
        };
    }
}
//# sourceMappingURL=judge.js.map