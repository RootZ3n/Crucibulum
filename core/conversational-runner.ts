/**
 * Crucibulum — Conversational Runner
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
import type {
  CrucibulumAdapter,
  ConversationalManifest,
  ConversationalResult,
  ChatMessage,
  EvidenceBundle,
  TimelineEvent,
} from "../adapters/base.js";
import { scoreConversationalQuestion, judgeConversational } from "./conversational-judge.js";
import { sha256Object } from "../utils/hashing.js";
import { estimateCost } from "../utils/cost.js";
import { log } from "../utils/logger.js";
import { formatDuration } from "../utils/timing.js";
import { DETERMINISTIC_JUDGE_METADATA } from "./judge.js";
import { canonicalPercent } from "../types/scores.js";

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

function sessionPath(sessionId: string): string {
  return join(MEMORY_DIR, `${sessionId}.json`);
}

export function loadPersistedConversation(sessionId: string): ChatMessage[] {
  const path = sessionPath(sessionId);
  if (!existsSync(path)) {
    return [];
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as { messages?: ChatMessage[] };
  return Array.isArray(raw.messages) ? raw.messages : [];
}

export function persistConversation(sessionId: string, messages: ChatMessage[]): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(sessionPath(sessionId), JSON.stringify({ session_id: sessionId, messages }, null, 2));
}

export function loadConversationalManifest(taskId: string): ConversationalManifest {
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
      const manifest = JSON.parse(raw) as ConversationalManifest;
      if (manifest.execution_mode !== "conversational") {
        throw new Error(`Task ${taskId} is not a conversational task (mode: ${manifest.execution_mode})`);
      }
      return manifest;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  throw new Error(`Conversational task not found: ${taskId}. Searched in: ${families.map(f => join(TASKS_DIR, f, taskId)).join(", ")}`);
}

export function isConversationalTask(taskId: string): boolean {
  try {
    loadConversationalManifest(taskId);
    return true;
  } catch {
    return false;
  }
}

// ── Runner ───────────────────────────────────────────────────────────────

export interface ConversationalRunOptions {
  taskId: string;
  adapter: CrucibulumAdapter;
  model: string;
  /** Override system prompt (optional) */
  systemPrompt?: string | undefined;
}

export interface ConversationalRunResult {
  bundle: EvidenceBundle;
  passed: boolean;
  score: number;
  exitCode: number;
}

export interface ConversationalEfficiencyResult {
  time_sec: number;
  time_limit_sec: number;
  steps_used: number;
  steps_limit: number;
  score: number;
}

function conversationalTimeBudgetSec(manifest: ConversationalManifest): number {
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

function conversationalTokenBudget(manifest: ConversationalManifest): number {
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

export function computeConversationalEfficiency(
  manifest: ConversationalManifest,
  totalDurationMs: number,
  totalTokensIn: number,
  totalTokensOut: number,
): ConversationalEfficiencyResult {
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

export async function runConversationalTask(options: ConversationalRunOptions): Promise<ConversationalRunResult> {
  const { taskId, adapter, model } = options;
  const startTime = new Date().toISOString();

  log("info", "conv-runner", `Starting conversational run: ${taskId} with ${adapter.name}/${model}`);

  if (!adapter.chat) {
    throw new Error(`Adapter ${adapter.id} does not support chat(). Cannot run conversational tasks.`);
  }

  const manifest = loadConversationalManifest(taskId);
  const gapFillers = manifest.gap_fillers ?? DEFAULT_GAP_FILLERS;
  const timeline: TimelineEvent[] = [];
  const results: ConversationalResult[] = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const runStartMs = Date.now();

  timeline.push({ t: 0, type: "task_start", detail: `conversational: ${manifest.questions.length} questions` });

  // Conversation history — maintained across questions for recall tests,
  // and optionally resumed from persisted prior transcripts for memory tasks.
  const messages: ChatMessage[] = [];
  const systemPrompt = options.systemPrompt || manifest.system_prompt;
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
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
        const setupResult = await adapter.chat(messages);
        messages.push({ role: "assistant", content: setupResult.text });
        totalTokensIn += setupResult.tokens_in;
        totalTokensOut += setupResult.tokens_out;
        timeline.push({ t: t(), type: "shell", command: `setup:${question.id}`, detail: question.setup.slice(0, 100) });
      } catch (err) {
        log("warn", "conv-runner", `[${question.id}] Setup message failed: ${String(err).slice(0, 100)}`);
      }

      // 2. Send gap filler messages (to test recall across conversation turns)
      const gapCount = question.setup_gap ?? 0;
      for (let i = 0; i < gapCount && i < gapFillers.length; i++) {
        messages.push({ role: "user", content: gapFillers[i]! });
        try {
          const gapResult = await adapter.chat(messages);
          messages.push({ role: "assistant", content: gapResult.text });
          totalTokensIn += gapResult.tokens_in;
          totalTokensOut += gapResult.tokens_out;
        } catch {
          // Gap fillers are best-effort
        }
      }
    }

    // 3. Send the actual question
    messages.push({ role: "user", content: question.question });

    let response: string;
    let qTokensIn = 0;
    let qTokensOut = 0;
    try {
      const chatResult = await adapter.chat(messages);
      response = chatResult.text;
      qTokensIn = chatResult.tokens_in;
      qTokensOut = chatResult.tokens_out;
      totalTokensIn += qTokensIn;
      totalTokensOut += qTokensOut;
      messages.push({ role: "assistant", content: response });
    } catch (err) {
      response = "";
      log("error", "conv-runner", `[${question.id}] Chat failed: ${String(err).slice(0, 200)}`);
      timeline.push({ t: t(), type: "error", detail: `chat failed: ${String(err).slice(0, 100)}` });
    }

    // 4. Score the response
    const scored = scoreConversationalQuestion(question, response);
    const result: ConversationalResult = {
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
  });

  const exitCode = judgeResult.pass ? 0 : 1;
  if (manifest.session?.session_id) {
    persistConversation(manifest.session.session_id, messages);
  }
  return { bundle, passed: judgeResult.pass, score: judgeResult.score, exitCode };
}

// ── Bundle builder ──────────────────────────────────────────────────────

interface ConversationalBundleInput {
  manifest: ConversationalManifest;
  results: ConversationalResult[];
  judgeResult: ReturnType<typeof judgeConversational>;
  timeline: TimelineEvent[];
  adapter: CrucibulumAdapter;
  model: string;
  startTime: string;
  endTime: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationMs: number;
}

function buildConversationalBundle(input: ConversationalBundleInput): EvidenceBundle {
  const { manifest, judgeResult, timeline, adapter, model, startTime, endTime, totalTokensIn, totalTokensOut, totalDurationMs } = input;

  const bundleId = `run_${new Date().toISOString().slice(0, 10)}_${manifest.id}_${model.replace(/[/:]/g, "-")}`;

  // Build per-question verification details
  const correctnessDetails: Record<string, "pass" | "fail"> = {};
  for (const r of judgeResult.results) {
    correctnessDetails[r.question_id] = r.passed ? "pass" : "fail";
  }

  const efficiency = computeConversationalEfficiency(manifest, totalDurationMs, totalTokensIn, totalTokensOut);
  const totalScore = Math.round(((judgeResult.score * 0.85) + (efficiency.score * 0.15)) * 100) / 100;
  const passed = totalScore >= manifest.scoring.pass_threshold;

  const bundle: EvidenceBundle = {
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
      estimated_cost_usd: estimateCost(adapter.id, totalTokensIn, totalTokensOut),
      provider_cost_note: `${adapter.id}:${model}`,
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

  // Sign the bundle
  bundle.bundle_hash = sha256Object({ ...bundle, bundle_hash: "" });

  return bundle;
}
