/**
 * Crucibulum — Review Layer
 *
 * Optional model-assisted review that sits ON TOP of deterministic judging.
 * Never overrides pass/fail. Annotates, flags, and recommends.
 *
 * Two review types:
 *   1. Second Opinion — interprets result, surfaces suspicious patterns
 *   2. QC Review     — challenges outcome, identifies false pass/fail risk
 */
import { log } from "../utils/logger.js";
export const DISABLED_REVIEW = {
    enabled: false,
    provider: "",
    model: "",
    status: "skipped",
    summary: "",
    flags: [],
    confidence: "high",
    recommendation: null,
    disagreement: false,
};
export const DEFAULT_REVIEW_CONFIG = {
    secondOpinion: { enabled: false, provider: "", model: "" },
    qcReview: { enabled: false, provider: "", model: "" },
};
// ── Evidence Summary Builder ──────────────────────────────────────────────
function buildEvidenceSummary(bundle) {
    const sc = bundle.score;
    const bd = sc.breakdown;
    const diag = bundle.diagnosis;
    const diff = bundle.diff;
    const sec = bundle.security;
    const diffSummary = [
        `Files changed: ${diff.files_changed.length}`,
        `Files created: ${diff.files_created.length}`,
        `Files deleted: ${diff.files_deleted.length}`,
        diff.forbidden_paths_touched.length > 0
            ? `FORBIDDEN PATHS TOUCHED: ${diff.forbidden_paths_touched.join(", ")}`
            : null,
    ].filter(Boolean).join("\n");
    const patchSummary = diff.files_changed.slice(0, 5).map((f) => `--- ${f.path} (+${f.lines_added}/-${f.lines_removed})\n${f.patch.slice(0, 500)}${f.patch.length > 500 ? "\n[truncated]" : ""}`).join("\n\n");
    const timelineSummary = bundle.timeline.slice(0, 20).map((e) => `[${e.t.toFixed(1)}s] ${e.type}${e.path ? ` ${e.path}` : ""}${e.command ? ` ${e.command}` : ""}${e.exit_code != null ? ` exit=${e.exit_code}` : ""}${e.detail ? ` — ${e.detail.slice(0, 100)}` : ""}`).join("\n");
    return [
        `=== TASK ===`,
        `ID: ${bundle.task.id}`,
        `Family: ${bundle.task.family}`,
        `Difficulty: ${bundle.task.difficulty}`,
        ``,
        `=== TARGET ===`,
        `Provider: ${bundle.agent.provider}`,
        `Model: ${bundle.agent.model}`,
        `Adapter: ${bundle.agent.adapter}`,
        ``,
        `=== DETERMINISTIC RESULT ===`,
        `Outcome: ${sc.pass ? "PASS" : "FAIL"}`,
        `Score: ${(sc.total * 100).toFixed(0)}%`,
        `Correctness: ${(bd.correctness * 100).toFixed(0)}%`,
        `Regression: ${(bd.regression * 100).toFixed(0)}%`,
        `Integrity: ${(bd.integrity * 100).toFixed(0)}%`,
        `Efficiency: ${(bd.efficiency * 100).toFixed(0)}%`,
        `Integrity violations: ${sc.integrity_violations}`,
        ``,
        `=== DIAGNOSIS ===`,
        `Localized correctly: ${diag.localized_correctly}`,
        `Avoided decoys: ${diag.avoided_decoys}`,
        `First fix correct: ${diag.first_fix_correct}`,
        `Self-verified: ${diag.self_verified}`,
        `Failure mode: ${diag.failure_mode || "none"}`,
        ``,
        `=== SECURITY ===`,
        `Injection scan: ${sec.injection_scan}`,
        `Forbidden path violations: ${sec.forbidden_paths_violations}`,
        `Anti-cheat violations: ${sec.anti_cheat_violations}`,
        `Workspace escape attempts: ${sec.workspace_escape_attempts}`,
        ``,
        `=== DIFF SUMMARY ===`,
        diffSummary,
        ``,
        `=== PATCHES (first 5 files) ===`,
        patchSummary || "(no patches)",
        ``,
        `=== TIMELINE (first 20 events) ===`,
        timelineSummary || "(no events)",
    ].join("\n");
}
// ── Review Prompts ────────────────────────────────────────────────────────
function buildSecondOpinionPrompt(evidence) {
    return `You are a second-opinion reviewer for an AI agent evaluation system called Crucibulum.

A deterministic judge has already scored this run. Your job is to interpret the results and flag anything suspicious or noteworthy. You do NOT override the deterministic result.

Review the evidence below and respond with EXACTLY this JSON structure (no markdown, no extra text):

{
  "summary": "2-3 sentence interpretation of what happened",
  "flags": ["array of specific concerns, if any — empty array if clean"],
  "confidence": "high or medium or low — your confidence in the deterministic result being correct",
  "recommendation": "accept or rerun or challenge"
}

Rules:
- "accept" if the result looks trustworthy
- "rerun" if you see flaky signals that might resolve on retry
- "challenge" if you see strong evidence the result may be wrong
- Keep flags specific and actionable, not vague
- An empty flags array with "accept" recommendation is perfectly valid

=== EVIDENCE ===

${evidence}`;
}
function buildQCReviewPrompt(evidence) {
    return `You are a quality control challenger for an AI agent evaluation system called Crucibulum.

A deterministic judge scored this run. Your job is to CHALLENGE the outcome — look for reasons the pass might be false or the fail might be unfair. Think adversarially.

Review the evidence below and respond with EXACTLY this JSON structure (no markdown, no extra text):

{
  "summary": "2-3 sentence challenge assessment",
  "flags": ["array of specific risks found — empty if the result withstands challenge"],
  "confidence": "high or medium or low — your confidence the deterministic result is trustworthy",
  "recommendation": "accept or rerun or challenge"
}

Rules:
- "accept" only if the result withstands your challenge
- "rerun" if the test conditions seem unreliable
- "challenge" if you find concrete evidence the result is wrong
- For PASS results: look for signs of lucky/incomplete fixes, undetected regressions, gaming
- For FAIL results: look for signs the agent was unfairly penalized, test flakiness, harsh scoring
- Be specific — "something seems off" is not useful

=== EVIDENCE ===

${evidence}`;
}
// ── Review Execution ──────────────────────────────────────────────────────
async function callReviewModel(provider, model, prompt) {
    // Resolve provider to base URL and API key
    const providerConfig = {
        ollama: { baseUrl: (process.env["OLLAMA_URL"] ?? "http://localhost:11434") + "/api/chat", keyEnv: "" },
        openai: { baseUrl: "https://api.openai.com/v1/chat/completions", keyEnv: "OPENAI_API_KEY" },
        openrouter: { baseUrl: "https://openrouter.ai/api/v1/chat/completions", keyEnv: "OPENROUTER_API_KEY" },
        claudecode: { baseUrl: "", keyEnv: "" },
        openclaw: { baseUrl: "", keyEnv: "" },
    };
    const config = providerConfig[provider];
    if (!config || !config.baseUrl) {
        throw new Error(`Provider "${provider}" does not support review calls`);
    }
    const apiKey = config.keyEnv ? (process.env[config.keyEnv] ?? "") : "";
    if (config.keyEnv && !apiKey) {
        throw new Error(`${config.keyEnv} not configured for review`);
    }
    // Ollama uses a different API format
    if (provider === "ollama") {
        const res = await fetch(config.baseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: prompt }],
                stream: false,
            }),
            signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok)
            throw new Error(`Ollama ${res.status}`);
        const data = await res.json();
        return {
            text: data.message?.content ?? "",
            tokensIn: data.prompt_eval_count ?? 0,
            tokensOut: data.eval_count ?? 0,
        };
    }
    // OpenAI-compatible API (OpenAI, OpenRouter)
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
    };
    const res = await fetch(config.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1024,
            temperature: 0.1,
            stream: false,
        }),
        signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok)
        throw new Error(`${provider} review call returned ${res.status}`);
    const data = await res.json();
    return {
        text: data.choices?.[0]?.message?.content ?? "",
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
    };
}
function parseReviewResponse(text, pass) {
    try {
        // Strip markdown code fences if present
        const cleaned = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
        const parsed = JSON.parse(cleaned);
        const confidence = (parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low")
            ? parsed.confidence : "medium";
        const recommendation = (parsed.recommendation === "accept" || parsed.recommendation === "rerun" || parsed.recommendation === "challenge")
            ? parsed.recommendation : null;
        const flags = Array.isArray(parsed.flags) ? parsed.flags.filter((f) => typeof f === "string") : [];
        // Detect disagreement: review recommends "challenge" on a pass, or "accept" on a fail with no flags
        const disagreement = (pass && recommendation === "challenge") ||
            (!pass && recommendation === "accept" && confidence === "high" && flags.length === 0);
        return {
            summary: typeof parsed.summary === "string" ? parsed.summary : "Review completed but summary was not structured.",
            flags,
            confidence,
            recommendation,
            disagreement,
        };
    }
    catch {
        return {
            summary: text.slice(0, 500),
            flags: [],
            confidence: "low",
            recommendation: null,
            disagreement: false,
        };
    }
}
async function executeReview(type, config, bundle) {
    if (!config.enabled)
        return { ...DISABLED_REVIEW };
    const tag = type === "secondOpinion" ? "second-opinion" : "qc-review";
    log("info", "review", `Running ${tag}: ${config.provider}/${config.model}`);
    const startMs = Date.now();
    try {
        const evidence = buildEvidenceSummary(bundle);
        const prompt = type === "secondOpinion"
            ? buildSecondOpinionPrompt(evidence)
            : buildQCReviewPrompt(evidence);
        const result = await callReviewModel(config.provider, config.model, prompt);
        const parsed = parseReviewResponse(result.text, bundle.score.pass);
        const durationMs = Date.now() - startMs;
        log("info", "review", `${tag} complete: confidence=${parsed.confidence}, recommendation=${parsed.recommendation}, flags=${parsed.flags.length}`);
        return {
            enabled: true,
            provider: config.provider,
            model: config.model,
            status: "completed",
            ...parsed,
            tokens_in: result.tokensIn,
            tokens_out: result.tokensOut,
            duration_ms: durationMs,
        };
    }
    catch (err) {
        log("error", "review", `${tag} failed: ${String(err).slice(0, 200)}`);
        return {
            enabled: true,
            provider: config.provider,
            model: config.model,
            status: "error",
            summary: "",
            flags: [],
            confidence: "low",
            recommendation: null,
            disagreement: false,
            error: String(err).slice(0, 300),
            duration_ms: Date.now() - startMs,
        };
    }
}
// ── Public API ────────────────────────────────────────────────────────────
export async function runReviewLayer(config, bundle) {
    const [secondOpinion, qcReview] = await Promise.all([
        executeReview("secondOpinion", config.secondOpinion, bundle),
        executeReview("qcReview", config.qcReview, bundle),
    ]);
    return { secondOpinion, qcReview };
}
//# sourceMappingURL=review.js.map