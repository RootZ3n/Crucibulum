/**
 * Crucible — Conversational Runner
 * Executes chat-based tests: sends questions via adapter.chat(),
 * scores responses deterministically, produces evidence bundles.
 *
 * Flow:
 *   1. Load conversational manifest
 *   2. For each question:
 *      a. Send optional setup messages (with gap fillers for recall)
 *      b. Send question
 *      c. Score response
 *   3. Aggregate scores via conversational judge
 *   4. Build evidence bundle
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { platform, arch } from "node:os";
import { scoreConversationalQuestion, judgeConversational } from "./conversational-judge.js";
import { sha256Object } from "../utils/hashing.js";
import { estimateCost } from "../utils/cost.js";
import { log } from "../utils/logger.js";
import { formatDuration } from "../utils/timing.js";
import { DETERMINISTIC_JUDGE_METADATA } from "./judge.js";
import { canonicalPercent } from "../types/scores.js";
import { runWithProtection } from "./circuit-breaker.js";
import { normalizeVerdict } from "./verdict.js";
import { normalizeProviderError } from "./provider-errors.js";
import { runReviewLayer } from "./review.js";
import { applyReviewJudgeUsage } from "./judge-usage.js";
// ── Default gap fillers for recall tests ──────────────────────────────────
const DEFAULT_GAP_FILLERS = [
    "What's the weather like today?",
    "Tell me a fun fact about space.",
    "What's 15 times 23?",
    "Name three types of clouds.",
    "What year did the internet become publicly available?",
    "What's the difference between a tornado and a hurricane?",
    "How many continents are there?",
    "What's the capital of New Zealand?",
];
// ── Manifest loading ─────────────────────────────────────────────────────
const TASKS_DIR = resolve(process.env["CRUCIBULUM_TASKS_DIR"] ?? join(process.cwd(), "tasks"));
const MEMORY_DIR = resolve(process.env["CRUCIBULUM_MEMORY_DIR"] ?? join(process.cwd(), "state", "memory-sessions"));
const NO_VISIBLE_REASONING_INSTRUCTION = "Benchmark rule: do not output chain-of-thought, hidden reasoning, or <think> blocks. Return only the final answer required by the prompt. If the prompt asks for a single word, line, or concise answer, output only that.";
function sessionPath(sessionId) {
    return join(MEMORY_DIR, `${sessionId}.json`);
}
export function loadPersistedConversation(sessionId) {
    const path = sessionPath(sessionId);
    if (!existsSync(path)) {
        return [];
    }
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(raw.messages) ? raw.messages : [];
}
export function persistConversation(sessionId, messages) {
    mkdirSync(MEMORY_DIR, { recursive: true });
    writeFileSync(sessionPath(sessionId), JSON.stringify({ session_id: sessionId, messages }, null, 2));
}
export function loadConversationalManifest(taskId) {
    // Search through task family directories
    const families = [
        "identity", "truthfulness", "safety", "memory", "proactive", "personality", "adversarial_chat", "cost_efficiency",
        "classification", "code", "workflow", "instruction-obedience", "prompt-sensitivity",
        "role-stress", "context-degradation", "reasoning", "summarization", "token-efficiency", "thinking-mode",
    ];
    for (const family of families) {
        try {
            const manifestPath = join(TASKS_DIR, family, taskId, "manifest.json");
            const raw = readFileSync(manifestPath, "utf-8");
            const manifest = JSON.parse(raw);
            if (manifest.execution_mode !== "conversational") {
                throw new Error(`Task ${taskId} is not a conversational task (mode: ${manifest.execution_mode})`);
            }
            return manifest;
        }
        catch (err) {
            if (err.code === "ENOENT")
                continue;
            throw err;
        }
    }
    throw new Error(`Conversational task not found: ${taskId}. Searched in: ${families.map(f => join(TASKS_DIR, f, taskId)).join(", ")}`);
}
export function isConversationalTask(taskId) {
    try {
        loadConversationalManifest(taskId);
        return true;
    }
    catch {
        return false;
    }
}
export function shouldSuppressVisibleReasoning(manifest) {
    return manifest.family !== "thinking-mode";
}
function benchmarkChatOptions(manifest) {
    return {
        benchmarkMode: true,
        suppressVisibleReasoning: shouldSuppressVisibleReasoning(manifest),
        reasoningEffort: shouldSuppressVisibleReasoning(manifest) ? "off" : "default",
    };
}
export function sanitizeVisibleReasoning(text) {
    const withoutClosedBlocks = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, " ");
    const withoutTags = withoutClosedBlocks.replace(/<\/?think\b[^>]*>/gi, " ");
    const collapsed = withoutTags.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const stripped = collapsed !== text.trim() && (/<\/?think\b/i.test(text) || /<think\b[\s\S]*<\/think>/i.test(text));
    return {
        text: collapsed || text.trim(),
        strippedVisibleReasoning: stripped,
    };
}
function conversationalTimeBudgetSec(manifest) {
    if (manifest.constraints?.time_limit_sec != null) {
        return manifest.constraints.time_limit_sec;
    }
    if (manifest.family === "cost_efficiency") {
        return Math.max(90, manifest.questions.length * 18);
    }
    if (manifest.metadata.tags.includes("reasoning") || manifest.metadata.tags.includes("architecture")) {
        return Math.max(300, manifest.questions.length * 75);
    }
    return Math.max(120, manifest.questions.length * 45);
}
function conversationalTokenBudget(manifest) {
    if (manifest.constraints?.max_total_tokens != null) {
        return manifest.constraints.max_total_tokens;
    }
    if (manifest.family === "cost_efficiency") {
        return Math.max(1500, manifest.questions.length * 300);
    }
    if (manifest.metadata.tags.includes("reasoning") || manifest.metadata.tags.includes("long-context")) {
        return Math.max(8000, manifest.questions.length * 1500);
    }
    return Math.max(3000, manifest.questions.length * 700);
}
export function computeConversationalEfficiency(manifest, totalDurationMs, totalTokensIn, totalTokensOut) {
    const timeLimitSec = conversationalTimeBudgetSec(manifest);
    const tokenLimit = conversationalTokenBudget(manifest);
    const totalTokens = totalTokensIn + totalTokensOut;
    const timeRatio = timeLimitSec > 0 ? (totalDurationMs / 1000) / timeLimitSec : 1;
    const tokenRatio = tokenLimit > 0 ? totalTokens / tokenLimit : 1;
    const tokenWeight = manifest.family === "cost_efficiency" ? 0.5 : 0.25;
    const timeWeight = 1 - tokenWeight;
    const weightedPressure = (timeRatio * timeWeight) + (tokenRatio * tokenWeight);
    const score = Math.max(0, Math.min(1, 1 - Math.max(0, weightedPressure - 0.35)));
    return {
        time_sec: Math.round((totalDurationMs / 1000) * 100) / 100,
        time_limit_sec: timeLimitSec,
        steps_used: manifest.questions.length,
        steps_limit: manifest.questions.length,
        score: Math.round(score * 100) / 100,
    };
}
export async function runConversationalTask(options) {
    const { taskId, adapter, model } = options;
    const startTime = new Date().toISOString();
    log("info", "conv-runner", `Starting conversational run: ${taskId} with ${adapter.name}/${model}`);
    if (!adapter.chat) {
        throw new Error(`Adapter ${adapter.id} does not support chat(). Cannot run conversational tasks.`);
    }
    const manifest = loadConversationalManifest(taskId);
    const chatOptions = benchmarkChatOptions(manifest);
    const gapFillers = manifest.gap_fillers ?? DEFAULT_GAP_FILLERS;
    const timeline = [];
    const results = [];
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    const runStartMs = Date.now();
    let terminalChatError = null;
    let terminalProviderError = null;
    timeline.push({ t: 0, type: "task_start", detail: `conversational: ${manifest.questions.length} questions` });
    // Provider-reported spend accumulates here when the adapter surfaces
    // `cost_usd` (OpenRouter does once the registry plumbs `usage.include=true`).
    // If *any* reply reports a cost we trust the sum and skip the static
    // estimate; if no reply reports cost we fall back to the estimate so old
    // providers don't show blank spend.
    let reportedCostUsd = 0;
    let reportedCostSeen = false;
    // Conversation history — maintained across questions for recall tests,
    // and optionally resumed from persisted prior transcripts for memory tasks.
    const messages = [];
    const systemPrompt = options.systemPrompt || manifest.system_prompt;
    if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
    }
    if (shouldSuppressVisibleReasoning(manifest)) {
        messages.push({ role: "system", content: NO_VISIBLE_REASONING_INSTRUCTION });
    }
    if (manifest.session?.resume) {
        const persistedMessages = loadPersistedConversation(manifest.session.session_id);
        for (const message of persistedMessages) {
            if (message.role === "system" && systemPrompt) {
                continue;
            }
            messages.push(message);
        }
        timeline.push({
            t: 0,
            type: "task_start",
            detail: `session_resume:${manifest.session.session_id}:${persistedMessages.length} messages`,
        });
    }
    for (const question of manifest.questions) {
        const questionStartMs = Date.now();
        const t = () => Math.round((Date.now() - runStartMs) / 1000);
        log("info", "conv-runner", `[${question.id}] Sending question: ${question.question.slice(0, 80)}...`);
        // 1. Send setup message if present (e.g., "Remember this codeword: THUNDERBIRD")
        if (question.setup) {
            messages.push({ role: "user", content: question.setup });
            try {
                const setupResult = await adapter.chat(messages, chatOptions);
                const sanitizedSetup = shouldSuppressVisibleReasoning(manifest) ? sanitizeVisibleReasoning(setupResult.text) : { text: setupResult.text, strippedVisibleReasoning: false };
                messages.push({ role: "assistant", content: sanitizedSetup.text });
                totalTokensIn += setupResult.tokens_in;
                totalTokensOut += setupResult.tokens_out;
                if (typeof setupResult.cost_usd === "number") {
                    reportedCostUsd += setupResult.cost_usd;
                    reportedCostSeen = true;
                }
                timeline.push({ t: t(), type: "shell", command: `setup:${question.id}`, detail: question.setup.slice(0, 100) });
            }
            catch (err) {
                const structured = normalizeProviderError(err, {
                    provider: adapter.id,
                    adapter: adapter.id,
                    durationMs: Date.now() - questionStartMs,
                });
                const errorText = structured.rawMessage.slice(0, 200);
                terminalChatError = structured.rawMessage;
                terminalProviderError = structured;
                log("warn", "conv-runner", `[${question.id}] Setup message failed: ${errorText}`);
                timeline.push({ t: t(), type: "error", detail: `setup failed: ${errorText}`, provider_error: structured });
                break;
            }
            // 2. Send gap filler messages (to test recall across conversation turns)
            const gapCount = question.setup_gap ?? 0;
            for (let i = 0; i < gapCount && i < gapFillers.length; i++) {
                messages.push({ role: "user", content: gapFillers[i] });
                try {
                    const gapResult = await adapter.chat(messages, chatOptions);
                    const sanitizedGap = shouldSuppressVisibleReasoning(manifest) ? sanitizeVisibleReasoning(gapResult.text) : { text: gapResult.text, strippedVisibleReasoning: false };
                    messages.push({ role: "assistant", content: sanitizedGap.text });
                    totalTokensIn += gapResult.tokens_in;
                    totalTokensOut += gapResult.tokens_out;
                    if (typeof gapResult.cost_usd === "number") {
                        reportedCostUsd += gapResult.cost_usd;
                        reportedCostSeen = true;
                    }
                }
                catch (err) {
                    const structured = normalizeProviderError(err, {
                        provider: adapter.id,
                        adapter: adapter.id,
                        durationMs: Date.now() - questionStartMs,
                    });
                    terminalChatError = structured.rawMessage;
                    terminalProviderError = structured;
                    timeline.push({ t: t(), type: "error", detail: structured.rawMessage, provider_error: structured });
                    break;
                }
            }
            if (terminalChatError)
                break;
        }
        // 3. Send the actual question
        messages.push({ role: "user", content: question.question });
        let response;
        let qTokensIn = 0;
        let qTokensOut = 0;
        try {
            const chatResult = await runWithProtection(adapter.id, () => adapter.chat(messages, chatOptions));
            const sanitized = shouldSuppressVisibleReasoning(manifest) ? sanitizeVisibleReasoning(chatResult.text) : { text: chatResult.text, strippedVisibleReasoning: false };
            response = sanitized.text;
            qTokensIn = chatResult.tokens_in;
            qTokensOut = chatResult.tokens_out;
            totalTokensIn += qTokensIn;
            totalTokensOut += qTokensOut;
            if (typeof chatResult.cost_usd === "number") {
                reportedCostUsd += chatResult.cost_usd;
                reportedCostSeen = true;
            }
            messages.push({ role: "assistant", content: response });
            if (sanitized.strippedVisibleReasoning) {
                timeline.push({ t: t(), type: "task_start", detail: `${question.id}: stripped visible reasoning before scoring` });
            }
        }
        catch (err) {
            response = "";
            const structured = normalizeProviderError(err, {
                provider: adapter.id,
                adapter: adapter.id,
                durationMs: Date.now() - questionStartMs,
            });
            terminalChatError = structured.rawMessage;
            terminalProviderError = structured;
            log("error", "conv-runner", `[${question.id}] Chat failed: ${structured.rawMessage.slice(0, 200)}`);
            timeline.push({ t: t(), type: "error", detail: `chat failed: ${structured.rawMessage.slice(0, 200)}`, provider_error: structured });
            break;
        }
        // 4. Score the response
        const scored = scoreConversationalQuestion(question, response);
        const result = {
            question_id: scored.question_id,
            question: scored.question,
            response: scored.response,
            passed: scored.passed,
            score: scored.score,
            weight: scored.weight,
            failure_reason: scored.failure_reason,
            duration_ms: Date.now() - questionStartMs,
            tokens_in: qTokensIn,
            tokens_out: qTokensOut,
        };
        results.push(result);
        timeline.push({
            t: t(),
            type: result.passed ? "task_complete" : "error",
            detail: `${question.id}: ${result.passed ? "PASS" : "FAIL"}${result.failure_reason ? ` — ${result.failure_reason.slice(0, 80)}` : ""}`,
        });
        log("info", "conv-runner", `[${question.id}] ${result.passed ? "PASS" : "FAIL"} (${result.duration_ms}ms)`);
    }
    // 5. Aggregate
    const judgeResult = judgeConversational(manifest, results);
    const endTime = new Date().toISOString();
    const totalDurationMs = Date.now() - runStartMs;
    log("info", "conv-runner", `Run complete: ${(judgeResult.score * 100).toFixed(0)}% in ${formatDuration(totalDurationMs)}`);
    // 6. Build evidence bundle
    const bundle = buildConversationalBundle({
        manifest,
        results,
        judgeResult,
        timeline,
        adapter,
        model,
        startTime,
        endTime,
        totalTokensIn,
        totalTokensOut,
        totalDurationMs,
        reportedCostUsd: reportedCostSeen ? reportedCostUsd : null,
        terminalChatError,
        terminalProviderError,
    });
    // 7. Optional review/judge model layer. Only runs when explicitly enabled
    // (avoids surprise spend on harnesses that just want deterministic scoring).
    const reviewCfg = options.reviewConfig;
    if (reviewCfg && (reviewCfg.secondOpinion.enabled || reviewCfg.qcReview.enabled)) {
        bundle.review = await runReviewLayer(reviewCfg, bundle, {
            taskTitle: manifest.description,
            taskDescription: manifest.description,
        });
        applyReviewJudgeUsage(bundle);
        bundle.bundle_hash = sha256Object({ ...bundle, bundle_hash: "" });
    }
    const exitCode = bundle.verdict?.completionState === "PASS" ? 0 : bundle.verdict?.completionState === "FAIL" ? 1 : 3;
    if (manifest.session?.session_id) {
        persistConversation(manifest.session.session_id, messages);
    }
    return { bundle, passed: judgeResult.pass, score: judgeResult.score, exitCode };
}
function buildConversationalBundle(input) {
    const { manifest, judgeResult, timeline, adapter, model, startTime, endTime, totalTokensIn, totalTokensOut, totalDurationMs, reportedCostUsd, terminalChatError, terminalProviderError } = input;
    const bundleId = `run_${new Date().toISOString().slice(0, 10)}_${manifest.id}_${model.replace(/[/:]/g, "-")}`;
    // Build per-question verification details
    const correctnessDetails = {};
    for (const r of judgeResult.results) {
        correctnessDetails[r.question_id] = r.passed ? "pass" : "fail";
    }
    const efficiency = computeConversationalEfficiency(manifest, totalDurationMs, totalTokensIn, totalTokensOut);
    const totalScore = Math.round(((judgeResult.score * 0.85) + (efficiency.score * 0.15)) * 100) / 100;
    const passed = totalScore >= manifest.scoring.pass_threshold;
    const bundle = {
        bundle_id: bundleId,
        bundle_hash: "", // computed below
        bundle_version: "2.0.0",
        task: {
            id: manifest.id,
            manifest_hash: sha256Object(manifest),
            family: manifest.family,
            difficulty: manifest.difficulty,
        },
        agent: {
            adapter: adapter.id,
            adapter_version: adapter.version,
            system: adapter.name,
            system_version: "unknown",
            model,
            model_version: "latest",
            provider: adapter.id,
        },
        environment: {
            os: `${platform()}-${arch()}`,
            arch: arch(),
            repo_commit: "none",
            crucibulum_version: "2.0.0",
            timestamp_start: startTime,
            timestamp_end: endTime,
        },
        timeline,
        diff: {
            files_changed: [],
            files_created: [],
            files_deleted: [],
            forbidden_paths_touched: [],
        },
        security: {
            injection_scan: "clean",
            forbidden_paths_violations: 0,
            anti_cheat_violations: 0,
            workspace_escape_attempts: 0,
        },
        verification_results: {
            correctness: { score: judgeResult.score, details: correctnessDetails },
            regression: { score: 1, details: {} }, // N/A for conversational
            integrity: { score: 1, details: {}, violations: [] },
            efficiency,
        },
        score: {
            scale: "fraction_0_1",
            total: totalScore,
            total_percent: canonicalPercent(totalScore),
            breakdown: {
                correctness: judgeResult.score,
                regression: 1,
                integrity: 1,
                efficiency: efficiency.score,
            },
            breakdown_percent: {
                correctness: canonicalPercent(judgeResult.score),
                regression: 100,
                integrity: 100,
                efficiency: canonicalPercent(efficiency.score),
            },
            pass: passed,
            pass_threshold: manifest.scoring.pass_threshold,
            pass_threshold_percent: canonicalPercent(manifest.scoring.pass_threshold),
            integrity_violations: 0,
        },
        usage: {
            tokens_in: totalTokensIn,
            tokens_out: totalTokensOut,
            // Provider-reported cost (OpenRouter `usage.cost`) wins over the static
            // per-adapter estimate; the note distinguishes the two so downstream
            // spend inspection knows which figure is authoritative.
            estimated_cost_usd: reportedCostUsd != null
                ? Math.round(reportedCostUsd * 1_000_000) / 1_000_000
                : estimateCost(adapter.id, totalTokensIn, totalTokensOut),
            provider_cost_note: reportedCostUsd != null
                ? `${adapter.id}:${model} (provider-reported)`
                : `${adapter.id}:${model} (estimated)`,
        },
        // Conversational scoring runs in-process with text matching — no judge
        // model is called per question, so the judge's spend is zero. We still
        // record the field so model+judge totals always have a defined "judge
        // side" for the UI to display.
        judge_usage: {
            provider: "",
            model: "",
            tokens_in: 0,
            tokens_out: 0,
            estimated_cost_usd: 0,
            kind: "deterministic",
            note: "deterministic conversational scoring — no model judge cost",
        },
        judge: {
            ...DETERMINISTIC_JUDGE_METADATA,
            components: ["conversational-judge"],
        },
        trust: {
            rubric_hidden: false, // conversational tasks have visible pass criteria
            narration_ignored: false,
            state_based_scoring: true,
            bundle_verified: false,
            deterministic_judge_authoritative: true,
            review_layer_advisory: true,
        },
        diagnosis: {
            localized_correctly: passed,
            avoided_decoys: true,
            first_fix_correct: passed,
            self_verified: false,
            failure_mode: passed ? null : `${judgeResult.failed}/${judgeResult.total_questions} questions failed`,
        },
        integrations: {
            veritor: { contract_version: "2.0.0", consumable: true },
            paedagogus: {
                contract_version: "1.0.0",
                consumable: true,
                routing_signals: {
                    task_family: manifest.family,
                    difficulty: manifest.difficulty,
                    provider: adapter.id,
                    adapter: adapter.id,
                    score: totalScore,
                    pass: passed,
                    failure_mode: passed ? null : "conversational_failure",
                },
            },
            crucible: {
                profile_id: null,
                benchmark_score: totalScore,
                benchmark_label: `${manifest.family}:${Math.round(totalScore * 100)}%`,
                execution_score: totalScore,
                divergence_note: null,
            },
        },
    };
    bundle.verdict = normalizeVerdict({
        bundle,
        executionMode: "conversational",
        exitReason: terminalChatError ? "error" : "complete",
        rawError: terminalChatError,
        providerError: terminalProviderError,
        attemptCount: manifest.questions.length,
    });
    // Sign the bundle
    bundle.bundle_hash = sha256Object({ ...bundle, bundle_hash: "" });
    return bundle;
}
//# sourceMappingURL=conversational-runner.js.map