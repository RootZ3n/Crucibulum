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
import type {
  CrucibulumAdapter,
  ConversationalManifest,
  ConversationalResult,
  ChatMessage,
  EvidenceBundle,
  TimelineEvent,
  SanitizedChatText,
  ChatOptions,
  ProviderAttemptRecord,
} from "../adapters/base.js";
import { scoreConversationalQuestion, judgeConversational } from "./conversational-judge.js";
import { sha256Object } from "../utils/hashing.js";
import { estimateCost } from "../utils/cost.js";
import { log } from "../utils/logger.js";
import { formatDuration } from "../utils/timing.js";
import { DETERMINISTIC_JUDGE_METADATA } from "./judge.js";
import { canonicalPercent } from "../types/scores.js";
import { runWithProtection } from "./circuit-breaker.js";
import { normalizeVerdict } from "./verdict.js";
import { interpretBundleResult } from "./interpretation.js";
import type { StructuredProviderError } from "../types/provider-error.js";
import { normalizeProviderError } from "./provider-errors.js";
import { runReviewLayer, DISABLED_REVIEW, type RunReviewConfig } from "./review.js";
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
  /**
   * Optional review-layer config. When either secondOpinion or qcReview is
   * enabled, the run invokes the configured judge model on top of
   * deterministic conversational scoring and rolls token + cost usage into
   * `bundle.judge_usage`. Defaults seed from `core/judge-config.ts`.
   */
  reviewConfig?: RunReviewConfig | undefined;
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

export function shouldSuppressVisibleReasoning(manifest: ConversationalManifest): boolean {
  // Manifest can pin policy explicitly. "preserve" keeps the model's
  // reasoning visible (used for the thinking-mode lane); "off"/"minimal"
  // both mean we want no visible chain-of-thought when scoring.
  if (manifest.thinking_mode === "preserve") return false;
  if (manifest.thinking_mode === "off" || manifest.thinking_mode === "minimal") return true;
  // Default: every family except the dedicated thinking-mode lane suppresses
  // visible reasoning. The lane's whole point is to compare reasoning
  // policies, so we never strip its outputs.
  return manifest.family !== "thinking-mode";
}

function benchmarkChatOptions(manifest: ConversationalManifest): ChatOptions {
  const suppress = shouldSuppressVisibleReasoning(manifest);
  // When the manifest explicitly asks for "off" we forward that to the
  // adapter; "minimal" forwards a lighter effort. Otherwise the family
  // default applies (off when sanitizing, default when preserving).
  const explicit = manifest.thinking_mode;
  const reasoningEffort: ChatOptions["reasoningEffort"] =
    explicit === "minimal" ? "minimal"
      : explicit === "off" ? "off"
        : explicit === "preserve" ? "default"
          : suppress ? "off" : "default";
  return {
    benchmarkMode: true,
    suppressVisibleReasoning: suppress,
    reasoningEffort,
  };
}

// Block-shaped thinking/reasoning patterns. Each entry's regex is run
// against the entire response; a match means a model leaked chain-of-thought
// into its visible answer and we strip it before scoring. Code fences are
// excluded by construction — we only match known reasoning markers, never
// generic ``` blocks. The list errs on the side of *known* leak shapes so
// regular prose is never accidentally cut.
const THINKING_BLOCK_PATTERNS: Array<{ tag: string; regex: RegExp }> = [
  // <think>…</think> — DeepSeek, Qwen, MiniMax-M2, …
  { tag: "think", regex: /<think\b[^>]*>[\s\S]*?<\/think\s*>/gi },
  // <thinking>…</thinking>
  { tag: "thinking", regex: /<thinking\b[^>]*>[\s\S]*?<\/thinking\s*>/gi },
  // <reasoning>…</reasoning>
  { tag: "reasoning_tag", regex: /<reasoning\b[^>]*>[\s\S]*?<\/reasoning\s*>/gi },
  // <thought>…</thought>
  { tag: "thought_tag", regex: /<thought\b[^>]*>[\s\S]*?<\/thought\s*>/gi },
  // <reflection>…</reflection>
  { tag: "reflection_tag", regex: /<reflection\b[^>]*>[\s\S]*?<\/reflection\s*>/gi },
  // <analysis>…</analysis>
  { tag: "analysis_tag", regex: /<analysis\b[^>]*>[\s\S]*?<\/analysis\s*>/gi },
  // <scratchpad>…</scratchpad>
  { tag: "scratchpad_tag", regex: /<scratchpad\b[^>]*>[\s\S]*?<\/scratchpad\s*>/gi },
  // [thinking]…[/thinking] / [thought]…[/thought] — alt MiniMax/Qwen style
  { tag: "bracket_thinking", regex: /\[(?:thinking|thought|reasoning)\][\s\S]*?\[\/(?:thinking|thought|reasoning)\]/gi },
  // Channel-tag chain-of-thought (OpenAI o-series style):
  //   <|channel|>analysis<|message|>…<|channel|>final<|message|>RESPONSE
  // Match the analysis channel and drop everything up to the final channel.
  { tag: "channel_analysis", regex: /<\|channel\|>analysis<\|message\|>[\s\S]*?(?=<\|channel\|>final<\|message\|>|$)/gi },
];

// Trailing/dangling thinking-tag fragments that survive the block strip
// (e.g. opening `<think>` with no close, or a stray `</think>`).
const DANGLING_TAG_PATTERNS: Array<{ tag: string; regex: RegExp }> = [
  { tag: "think", regex: /<\/?think\b[^>]*>/gi },
  { tag: "thinking", regex: /<\/?thinking\b[^>]*>/gi },
  { tag: "reasoning_tag", regex: /<\/?reasoning\b[^>]*>/gi },
  { tag: "thought_tag", regex: /<\/?thought\b[^>]*>/gi },
  { tag: "reflection_tag", regex: /<\/?reflection\b[^>]*>/gi },
  { tag: "analysis_tag", regex: /<\/?analysis\b[^>]*>/gi },
  { tag: "scratchpad_tag", regex: /<\/?scratchpad\b[^>]*>/gi },
];

// Markdown-style "Thinking:" preface — only matched at the very start of the
// response (before any other content) so that legitimate paragraphs that
// happen to use the word "thinking" later in the text are never affected.
// Examples it strips:
//   "Thinking: Let me consider the options.\n\nThe answer is 4."
//   "**Thought process:** I need to count the words.\n\nFinal answer: 5"
//   "Reasoning: The user wants a single word.\n\nWord."
const PREAMBLE_HEADER_PATTERN = /^(?:\s*\*{0,2}(?:thinking|thought process|reasoning|analysis|reflection|let me think|let'?s think)\*{0,2}\s*[:：—-]\s*)([\s\S]*?)(?:\n\s*\n|(?=\n\s*(?:final answer|answer|response)\b))/i;

export function sanitizeVisibleReasoning(text: string): SanitizedChatText {
  const tags = new Set<string>();
  let cleaned = text;

  for (const { tag, regex } of THINKING_BLOCK_PATTERNS) {
    if (regex.test(cleaned)) {
      tags.add(tag);
      cleaned = cleaned.replace(regex, " ");
    }
  }
  for (const { tag, regex } of DANGLING_TAG_PATTERNS) {
    if (regex.test(cleaned)) {
      tags.add(tag);
      cleaned = cleaned.replace(regex, " ");
    }
  }

  // Markdown preface like "Thinking: …\n\n<answer>" — only at the very start
  // of the response. We never strip from inside running prose, so a code
  // block that *contains* the word "thinking" later in the answer is safe.
  const preambleMatch = cleaned.match(PREAMBLE_HEADER_PATTERN);
  if (preambleMatch && preambleMatch.index === 0) {
    tags.add("markdown_heading");
    cleaned = cleaned.slice(preambleMatch[0].length);
  }

  // Strip "<|channel|>final<|message|>" wrapper if it survived the block strip
  cleaned = cleaned.replace(/<\|channel\|>final<\|message\|>/gi, "");

  const collapsed = cleaned.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const finalText = collapsed || cleaned.trim();
  return {
    text: finalText,
    strippedVisibleReasoning: tags.size > 0,
    rawText: text,
    tags: Array.from(tags),
  };
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
  const chatOptions = benchmarkChatOptions(manifest);
  const gapFillers = manifest.gap_fillers ?? DEFAULT_GAP_FILLERS;
  const timeline: TimelineEvent[] = [];
  const results: ConversationalResult[] = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const runStartMs = Date.now();
  let terminalChatError: string | null = null;
  let terminalProviderError: StructuredProviderError | null = null;
  const providerAttempts: ProviderAttemptRecord[] = [];

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
  const messages: ChatMessage[] = [];
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
        for (const attempt of setupResult.provider_attempts ?? []) {
          providerAttempts.push(attempt);
          timeline.push({ t: t(), type: "provider_attempt", attempt: attempt.attempt, detail: attempt.error_type ? `${attempt.error_type}: ${attempt.retry_decision}` : "success", provider_error: attempt.provider_error, retry_decision: attempt.retry_decision });
        }
        const sanitizedSetup = shouldSuppressVisibleReasoning(manifest) ? sanitizeVisibleReasoning(setupResult.text) : { text: setupResult.text, strippedVisibleReasoning: false };
        messages.push({ role: "assistant", content: sanitizedSetup.text });
        totalTokensIn += setupResult.tokens_in;
        totalTokensOut += setupResult.tokens_out;
        if (typeof setupResult.cost_usd === "number") { reportedCostUsd += setupResult.cost_usd; reportedCostSeen = true; }
        timeline.push({ t: t(), type: "shell", command: `setup:${question.id}`, detail: question.setup.slice(0, 100) });
      } catch (err) {
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
        messages.push({ role: "user", content: gapFillers[i]! });
        try {
          const gapResult = await adapter.chat(messages, chatOptions);
          for (const attempt of gapResult.provider_attempts ?? []) {
            providerAttempts.push(attempt);
            timeline.push({ t: t(), type: "provider_attempt", attempt: attempt.attempt, detail: attempt.error_type ? `${attempt.error_type}: ${attempt.retry_decision}` : "success", provider_error: attempt.provider_error, retry_decision: attempt.retry_decision });
          }
          const sanitizedGap = shouldSuppressVisibleReasoning(manifest) ? sanitizeVisibleReasoning(gapResult.text) : { text: gapResult.text, strippedVisibleReasoning: false };
          messages.push({ role: "assistant", content: sanitizedGap.text });
          totalTokensIn += gapResult.tokens_in;
          totalTokensOut += gapResult.tokens_out;
          if (typeof gapResult.cost_usd === "number") { reportedCostUsd += gapResult.cost_usd; reportedCostSeen = true; }
        } catch (err) {
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
      if (terminalChatError) break;
    }

    // 3. Send the actual question
    messages.push({ role: "user", content: question.question });

    let response: string;
    let rawResponse: string = "";
    let strippedVisibleReasoning = false;
    let sanitizationTags: string[] = [];
    let qTokensIn = 0;
    let qTokensOut = 0;
    try {
      const chatResult = await runWithProtection(adapter.id, () => adapter.chat!(messages, chatOptions));
      for (const attempt of chatResult.provider_attempts ?? []) {
        providerAttempts.push(attempt);
        timeline.push({ t: t(), type: "provider_attempt", attempt: attempt.attempt, detail: attempt.error_type ? `${attempt.error_type}: ${attempt.retry_decision}` : "success", provider_error: attempt.provider_error, retry_decision: attempt.retry_decision });
      }
      rawResponse = chatResult.text;
      const sanitized = shouldSuppressVisibleReasoning(manifest)
        ? sanitizeVisibleReasoning(chatResult.text)
        : { text: chatResult.text, strippedVisibleReasoning: false, rawText: chatResult.text, tags: [] };
      response = sanitized.text;
      strippedVisibleReasoning = sanitized.strippedVisibleReasoning;
      sanitizationTags = sanitized.tags;
      qTokensIn = chatResult.tokens_in;
      qTokensOut = chatResult.tokens_out;
      totalTokensIn += qTokensIn;
      totalTokensOut += qTokensOut;
      if (typeof chatResult.cost_usd === "number") { reportedCostUsd += chatResult.cost_usd; reportedCostSeen = true; }
      messages.push({ role: "assistant", content: response });
      if (sanitized.strippedVisibleReasoning) {
        timeline.push({ t: t(), type: "task_start", detail: `${question.id}: stripped visible reasoning before scoring (${sanitizationTags.join(",")})` });
      }
    } catch (err) {
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
    const lineCount = response.length === 0 ? 0 : response.split(/\r?\n/).length;
    const result: ConversationalResult = {
      question_id: scored.question_id,
      question: scored.question,
      response: scored.response,
      // Preserve the pre-sanitization output so the receipt/drilldown can
      // show *why* visible answer differs from what the model emitted.
      // Stays unset when sanitization didn't run (saves bundle bytes when
      // it would just duplicate `response`).
      raw_response: rawResponse !== response ? rawResponse : undefined,
      stripped_visible_reasoning: strippedVisibleReasoning,
      sanitization_tags: sanitizationTags.length > 0 ? sanitizationTags : undefined,
      line_count: lineCount,
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
    providerAttempts,
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
    bundle.interpretation = interpretBundleResult(bundle);
    bundle.bundle_hash = sha256Object({ ...bundle, bundle_hash: "" });
  }

  const exitCode = bundle.verdict?.completionState === "PASS" ? 0 : bundle.verdict?.completionState === "FAIL" ? 1 : 3;
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
  /** Provider-reported cost if any adapter call surfaced one; null = unknown (use estimate). */
  reportedCostUsd: number | null;
  terminalChatError: string | null;
  terminalProviderError: StructuredProviderError | null;
  providerAttempts: ProviderAttemptRecord[];
}

function buildConversationalBundle(input: ConversationalBundleInput): EvidenceBundle {
  const { manifest, judgeResult, timeline, adapter, model, startTime, endTime, totalTokensIn, totalTokensOut, totalDurationMs, reportedCostUsd, terminalChatError, terminalProviderError, providerAttempts } = input;

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
    provider_attempts: providerAttempts,
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
  bundle.interpretation = interpretBundleResult(bundle);

  // Per-question conversational evidence — exposes raw vs sanitized
  // responses, sanitization tags, and line counts to receipts so callers
  // can tell adapter/sanitizer issues apart from real capability failures.
  bundle.conversational = { results: judgeResult.results };

  // Sign the bundle
  bundle.bundle_hash = sha256Object({ ...bundle, bundle_hash: "" });

  return bundle;
}
