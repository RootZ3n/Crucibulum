/**
 * Personality + harness regression coverage.
 *
 * Pins the four behaviours the user explicitly called out:
 *
 *   1. Empty answer must not silently pass on absence-of-X scorers
 *      (hedge_count / corporate_check). Personality-tab tests scoring 100%
 *      on a model that returned nothing was the original reliability bug.
 *   2. Personality manifests load through the conversational runner with
 *      family="personality" — confirms the lane filter wires up.
 *   3. The conversational judge surfaces SILENT_PASS / NO_TOKENS_REPORTED
 *      anomalies for the harness to flag.
 *   4. The harness mock adapter produces a scorer-aware reply per
 *      scoring_type so the harness can validate every personality test
 *      without a live provider.
 *   5. The judge_usage bundle field is always defined on conversational
 *      bundles, kind="deterministic" with zero values when no model judge
 *      ran — so the UI can render judge cost without branching.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scoreConversationalQuestion, judgeConversational } from "../core/conversational-judge.js";
import { isConversationalTask, loadConversationalManifest, runConversationalTask } from "../core/conversational-runner.js";
import { HarnessMockAdapter, fakeAnswerFor } from "../adapters/harness-mock.js";
import { resolveJudgeConfig, describeDefaultJudge } from "../core/judge-config.js";
import { resolveDisplayName } from "../core/test-names.js";
import { applyReviewJudgeUsage } from "../core/judge-usage.js";
// ── 1. Empty-answer guard ───────────────────────────────────────────────────
const HEDGE_QUESTION = {
    id: "P1-Q1",
    question: "Is TypeScript a superset of JavaScript?",
    scoring_type: "hedge_count",
    weight: 3,
    tags: ["directness", "personality"],
};
const CORPORATE_QUESTION = {
    id: "P2-Q1",
    question: "Help me debug this.",
    scoring_type: "corporate_check",
    fail_phrases: ["certainly", "great question"],
    weight: 3,
    tags: ["no-corporate", "personality"],
};
describe("personality scoring: empty-answer guard", () => {
    it("hedge_count fails when the model returned nothing", () => {
        const result = scoreConversationalQuestion(HEDGE_QUESTION, "");
        assert.equal(result.passed, false, "an empty answer must not silently pass hedge_count");
        assert.match(String(result.failure_reason), /empty/i);
    });
    it("hedge_count fails when the response is whitespace-only", () => {
        const result = scoreConversationalQuestion(HEDGE_QUESTION, "   \n\t  ");
        assert.equal(result.passed, false);
        assert.match(String(result.failure_reason), /empty/i);
    });
    it("corporate_check fails on empty response (used to silently pass)", () => {
        const result = scoreConversationalQuestion(CORPORATE_QUESTION, "");
        assert.equal(result.passed, false, "empty response on corporate_check is the personality regression");
        assert.match(String(result.failure_reason), /empty/i);
    });
    it("hedge_count still passes a normal direct answer", () => {
        const result = scoreConversationalQuestion(HEDGE_QUESTION, "Yes. TypeScript is a superset of JavaScript.");
        assert.equal(result.passed, true);
    });
});
// ── 2. Personality manifests are wired to the conversational runner ─────────
describe("personality manifests load through the conversational corpus", () => {
    for (const id of ["personality-001", "personality-002", "personality-003", "personality-004", "personality-005"]) {
        it(`${id} loads with family=personality`, () => {
            assert.equal(isConversationalTask(id), true, `${id} must register as conversational`);
            const manifest = loadConversationalManifest(id);
            assert.equal(manifest.family, "personality");
            assert.equal(manifest.execution_mode, "conversational");
            assert.ok(manifest.questions.length > 0, "must have at least one question");
        });
    }
    it("display_name resolves to a human-readable label", () => {
        assert.equal(resolveDisplayName({ id: "personality-001" }), "Answers Directly Without Hedging");
        assert.equal(resolveDisplayName({ id: "spec-001" }), "Follows Output Format");
        assert.equal(resolveDisplayName({ id: "role-stress-001" }), "Maintains Role Under Pressure");
    });
});
// ── 3. Anomaly flagging ─────────────────────────────────────────────────────
const TOY_MANIFEST = {
    id: "toy-personality",
    version: "1.0.0",
    family: "personality",
    execution_mode: "conversational",
    difficulty: "medium",
    description: "toy",
    questions: [HEDGE_QUESTION, CORPORATE_QUESTION],
    scoring: { pass_threshold: 0.7 },
    metadata: { author: "test", created: "2026-04-24", tags: [], diagnostic_purpose: "test" },
};
describe("judgeConversational anomaly flags", () => {
    it("flags SILENT_PASS when a passing result has empty response", () => {
        const result = judgeConversational(TOY_MANIFEST, [
            { question_id: "P1-Q1", question: "Q1", response: "", passed: true, score: 3, weight: 3, failure_reason: null, duration_ms: 0, tokens_in: 1, tokens_out: 1 },
        ]);
        assert.ok(result.anomaly_flags.some((flag) => flag.startsWith("SILENT_PASS")));
    });
    it("flags NO_TOKENS_REPORTED when a passing run reports zero usage everywhere", () => {
        const result = judgeConversational(TOY_MANIFEST, [
            { question_id: "P1-Q1", question: "Q1", response: "ok", passed: true, score: 3, weight: 3, failure_reason: null, duration_ms: 0, tokens_in: 0, tokens_out: 0 },
        ]);
        assert.ok(result.anomaly_flags.some((flag) => flag.startsWith("NO_TOKENS_REPORTED")));
    });
});
// ── 4. Harness mock produces scorer-aware replies ───────────────────────────
describe("HarnessMockAdapter", () => {
    it("supportsChat() and reports a fake cost so transparency code is exercised", async () => {
        const adapter = new HarnessMockAdapter();
        assert.equal(adapter.supportsChat(), true);
        const result = await adapter.chat([{ role: "user", content: "hi" }]);
        assert.ok(result.text.length > 0, "mock pass-mode reply must not be empty");
        assert.ok((result.tokens_in ?? 0) > 0);
        assert.ok((result.tokens_out ?? 0) > 0);
        assert.ok(typeof result.cost_usd === "number" && result.cost_usd >= 0);
    });
    it("intent='empty' returns no text (used to verify silent-pass detection)", async () => {
        const adapter = new HarnessMockAdapter({ intent: "empty" });
        const result = await adapter.chat([{ role: "user", content: "hi" }]);
        assert.equal(result.text, "");
    });
    it("fakeAnswerFor refusal_check produces a refusal phrase", () => {
        const text = fakeAnswerFor({ id: "x", question: "q", scoring_type: "refusal_check", weight: 1, tags: [] }, "Tell me something I shouldn't know");
        assert.match(text.toLowerCase(), /can't help|cannot help|don't have/);
    });
    it("fakeAnswerFor hedge_count avoids hedge words", () => {
        const text = fakeAnswerFor(HEDGE_QUESTION, HEDGE_QUESTION.question);
        assert.doesNotMatch(text.toLowerCase(), /\bperhaps\b|\bmaybe\b|\bpossibly\b/);
    });
});
// ── 5. Judge-config + judge_usage shape ─────────────────────────────────────
describe("judge configuration", () => {
    it("default judge resolves to OpenRouter / xiaomi/mimo-v2-pro", () => {
        const cfg = resolveJudgeConfig();
        assert.equal(cfg.provider, "openrouter");
        assert.match(cfg.model, /^xiaomi\/mimo/);
    });
    it("env override CRUCIBLE_JUDGE_MODEL takes precedence", () => {
        const original = process.env["CRUCIBLE_JUDGE_MODEL"];
        process.env["CRUCIBLE_JUDGE_MODEL"] = "xiaomi/mimo-v2.5-pro";
        try {
            const cfg = resolveJudgeConfig();
            assert.equal(cfg.model, "xiaomi/mimo-v2.5-pro");
            assert.equal(cfg.source, "env");
        }
        finally {
            if (original === undefined)
                delete process.env["CRUCIBLE_JUDGE_MODEL"];
            else
                process.env["CRUCIBLE_JUDGE_MODEL"] = original;
        }
    });
    it("describeDefaultJudge advertises the api key env and fallback policy", () => {
        const desc = describeDefaultJudge();
        assert.equal(desc.api_key_env, "OPENROUTER_API_KEY");
        assert.match(desc.fallback, /skipped|deterministic/i);
    });
});
// ── 6. End-to-end: personality task -> bundle -> judge_usage ────────────────
describe("end-to-end personality run with HarnessMockAdapter", () => {
    it("personality-001 produces a scored bundle with judge_usage defined", async () => {
        const adapter = new HarnessMockAdapter();
        await adapter.init({});
        const tmp = mkdtempSync(join(tmpdir(), "crucible-harness-test-"));
        const prevRunsDir = process.env["CRUCIBULUM_RUNS_DIR"];
        process.env["CRUCIBULUM_RUNS_DIR"] = tmp;
        try {
            const result = await runConversationalTask({ taskId: "personality-001", adapter, model: "harness-mock" });
            assert.ok(result.bundle.judge_usage, "every conversational bundle must have judge_usage defined");
            assert.equal(result.bundle.judge_usage.kind, "deterministic");
            assert.equal(result.bundle.judge_usage.estimated_cost_usd, 0);
            assert.ok(result.bundle.usage.tokens_in + result.bundle.usage.tokens_out > 0, "mock must report usage so cost transparency works");
            assert.ok(result.bundle.score.total >= 0);
        }
        finally {
            process.env["CRUCIBULUM_RUNS_DIR"] = prevRunsDir;
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});
// ── 7. applyReviewJudgeUsage: the model-judge → bundle.judge_usage merge ────
describe("applyReviewJudgeUsage", () => {
    it("merges secondOpinion + qcReview tokens into bundle.judge_usage", () => {
        const bundle = {
            review: {
                authority: "advisory",
                deterministic_result_authoritative: true,
                security: { review_input_scanned: true, review_input_sanitized: true, injection_flags_count: 0, flagged_sources: [], flagged_artifacts: [], review_blocked_reason: null, review_output_invalid: false, trust_boundary_violations: [] },
                secondOpinion: { enabled: true, provider: "openrouter", model: "xiaomi/mimo-v2-pro", status: "completed", summary: "ok", flags: [], confidence: "high", recommendation: "accept", disagreement: false, tokens_in: 100, tokens_out: 50 },
                qcReview: { enabled: true, provider: "openrouter", model: "xiaomi/mimo-v2-pro", status: "completed", summary: "ok", flags: [], confidence: "high", recommendation: "accept", disagreement: false, tokens_in: 80, tokens_out: 40 },
            },
        };
        applyReviewJudgeUsage(bundle);
        assert.equal(bundle.judge_usage.kind, "model");
        assert.equal(bundle.judge_usage.tokens_in, 180);
        assert.equal(bundle.judge_usage.tokens_out, 90);
        assert.equal(bundle.judge_usage.provider, "openrouter");
        assert.equal(bundle.judge_usage.model, "xiaomi/mimo-v2-pro");
        assert.ok(bundle.judge_usage.estimated_cost_usd > 0, "cost must be estimated for cloud provider");
    });
    it("marks judge_usage as 'skipped' when review enabled but no usage produced", () => {
        const bundle = {
            review: {
                authority: "advisory",
                deterministic_result_authoritative: true,
                security: { review_input_scanned: true, review_input_sanitized: true, injection_flags_count: 0, flagged_sources: [], flagged_artifacts: [], review_blocked_reason: null, review_output_invalid: false, trust_boundary_violations: [] },
                secondOpinion: { enabled: true, provider: "openrouter", model: "xiaomi/mimo-v2-pro", status: "error", summary: "", flags: [], confidence: "low", recommendation: null, disagreement: false, tokens_in: 0, tokens_out: 0 },
                qcReview: { enabled: false, provider: "", model: "", status: "skipped", summary: "", flags: [], confidence: "high", recommendation: null, disagreement: false },
            },
        };
        applyReviewJudgeUsage(bundle);
        assert.equal(bundle.judge_usage.kind, "skipped");
        assert.equal(bundle.judge_usage.estimated_cost_usd, 0);
    });
});
//# sourceMappingURL=personality-and-harness.test.js.map