/**
 * Crucible — OpenAI-compatible Adapter
 * Agentic loop over any OpenAI chat-completions-compatible API.
 * Used for OpenRouter, OpenAI, and any compatible endpoint.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  CrucibulumAdapter,
  AdapterConfig,
  ExecutionInput,
  ExecutionResult,
  ChatMessage,
  ChatResult,
  ChatOptions,
} from "./base.js";
import { Observer } from "../core/observer.js";
import { makeEmptyResponseError, makeHttpProviderError, makeInvalidResponseError, makeProviderFailureError, normalizeProviderError, providerErrorSummary, providerErrorDetail } from "../core/provider-errors.js";
import { log } from "../utils/logger.js";

const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MODEL_TIMEOUT_MS = 120_000; // 2 min for cloud models (faster than local)

export interface OpenAICompatibleAdapterOpts {
  id?: string;
  name?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  defaultModel?: string;
}

interface OpenRouterConfig extends AdapterConfig {
  api_key?: string | undefined;
  model?: string | undefined;
  base_url?: string | undefined;
}

export class OpenRouterAdapter implements CrucibulumAdapter {
  id: string;
  name: string;
  version = "1.0.0";

  private baseUrl: string;
  private apiKeyEnv: string;
  private apiKey: string;
  private model: string;

  constructor(opts?: OpenAICompatibleAdapterOpts) {
    this.id = opts?.id ?? "openrouter";
    this.name = opts?.name ?? "OpenRouter";
    this.baseUrl = opts?.baseUrl ?? DEFAULT_OPENROUTER_BASE;
    this.apiKeyEnv = opts?.apiKeyEnv ?? "OPENROUTER_API_KEY";
    this.apiKey = process.env[this.apiKeyEnv] ?? "";
    this.model = opts?.defaultModel ?? "arcee-ai/trinity-large-thinking";
  }

  supports(_family: "poison" | "spec" | "orchestration"): boolean {
    return true;
  }

  supportsToolCalls(): boolean {
    return true;
  }

  supportsChat(): boolean {
    return true;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    if (!this.apiKey) throw new Error(`${this.name}: ${this.apiKeyEnv} not configured`);
    const start = Date.now();
    const result = await this.callAPI(messages, options);
    return {
      text: result.text,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      duration_ms: Date.now() - start,
      ...(result.costUsd !== undefined ? { cost_usd: result.costUsd } : {}),
    };
  }

  async init(config: AdapterConfig): Promise<void> {
    const c = config as OpenRouterConfig;
    if (c.api_key) this.apiKey = c.api_key;
    if (c.model) this.model = c.model;
    if (c.base_url) this.baseUrl = c.base_url;
    if (!this.apiKey) {
      log("debug", this.id, `No API key set — set ${this.apiKeyEnv}`);
    }
  }

  async healthCheck() {
    if (!this.apiKey) {
      const providerError = makeProviderFailureError({ kind: "AUTH", origin: "ADAPTER", provider: this.id, adapter: this.id, rawMessage: `${this.apiKeyEnv} not configured` }).structured;
      // Use providerErrorDetail so the operator-facing reason names the
      // exact env var to set ("Authentication failed — OPENROUTER_API_KEY
      // not configured") instead of the bucket-only "Authentication
      // failed" — which left operators with no actionable next step.
      return { ok: false, reason: providerErrorDetail(providerError), providerError };
    }
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { "Authorization": `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return { ok: true };
      const providerError = makeHttpProviderError(res, await res.text().catch(() => ""), { provider: this.id, adapter: this.id }).structured;
      return { ok: false, reason: providerErrorSummary(providerError), providerError };
    } catch (err) {
      const providerError = normalizeProviderError(err, { provider: this.id, adapter: this.id });
      return { ok: false, reason: providerErrorSummary(providerError), providerError };
    }
  }

  async teardown(): Promise<void> { /* nothing */ }

  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const observer = new Observer();
    observer.taskStart();

    const startMs = Date.now();
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let exitReason: ExecutionResult["exit_reason"] = "complete";
    let consecutiveNoCommand = 0;

    const systemPrompt = buildSystemPrompt(input);
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          `Your task:`,
          `${input.task.task.title}`,
          ``,
          `${input.task.task.description}`,
          ``,
          `Entrypoints: ${input.task.task.entrypoints.join(", ")}`,
          ``,
          `Start by reading the entrypoint files.`,
        ].join("\n"),
      },
    ];

    const maxSteps = input.budget.max_steps;
    const timeLimitMs = input.budget.time_limit_sec * 1000;

    for (let step = 0; step < maxSteps; step++) {
      if (Date.now() - startMs > timeLimitMs) {
        observer.recordError("Time budget exceeded");
        exitReason = "timeout";
        break;
      }

      log("info", this.id, `[step ${step + 1}/${maxSteps}] Calling ${this.model}...`);

      let response: string;
      try {
        const result = await this.callAPI(messages);
        response = stripModelArtifacts(result.text);
        totalTokensIn += result.tokensIn;
        totalTokensOut += result.tokensOut;
        log("info", this.id, `[step ${step + 1}] Response (${response.length} chars): ${response.slice(0, 300).replace(/\n/g, "\\n")}${response.length > 300 ? "..." : ""}`);
      } catch (err) {
        const providerError = normalizeProviderError(err, { provider: this.id, adapter: this.id });
        log("error", this.id, `Model call failed: ${providerError.rawMessage.slice(0, 200)}`);
        observer.recordError(`Model call failed: ${providerError.rawMessage.slice(0, 200)}`, providerError);
        exitReason = "error";
        break;
      }

      messages.push({ role: "assistant", content: response });

      // Context compression after 20k tokens
      if (totalTokensIn + totalTokensOut > 20000 && messages.length > 8) {
        const sys = messages[0]!;
        const task = messages[1]!;
        const recent = messages.slice(-6);
        messages.length = 0;
        messages.push(sys, task, { role: "user", content: "Previous steps summarized. Continue the task." }, ...recent);
        log("info", this.id, "Context compressed");
      }

      // Time pressure warning
      if (Date.now() - startMs > 600000 && !messages.some(m => m.content.includes("running low on time"))) {
        messages.push({ role: "user", content: "Running low on time. Make your fix now and signal DONE." });
      }

      const toolResult = executeToolCalls(response, input.workspace_path, observer, input.budget.max_file_edits);

      if (toolResult.done) {
        observer.taskComplete();
        break;
      }

      if (toolResult.commandsFound === 0) {
        consecutiveNoCommand++;
      } else {
        consecutiveNoCommand = 0;
      }

      if (consecutiveNoCommand >= 3) {
        messages.push({ role: "user", content: RE_ANCHOR_MESSAGE });
        consecutiveNoCommand = 0;
      } else if (toolResult.feedback) {
        messages.push({ role: "user", content: toolResult.feedback });
      }

      if (step === maxSteps - 1) {
        observer.recordError("Step budget exceeded");
        exitReason = "budget_exceeded";
      }
    }

    return {
      exit_reason: exitReason,
      timeline: observer.getTimeline(),
      provider_error: observer.getProviderError() ?? undefined,
      duration_ms: Date.now() - startMs,
      steps_used: observer.getStepCount(),
      files_read: observer.getFilesRead(),
      files_written: observer.getFilesWritten(),
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
      adapter_metadata: {
        adapter_id: this.id,
        adapter_version: this.version,
        system_version: `${this.id}-v1`,
        model: this.model,
        provider: this.id,
      },
    };
  }

  private async callAPI(messages: Array<{ role: string; content: string }>, options?: ChatOptions): Promise<{ text: string; tokensIn: number; tokensOut: number; costUsd?: number }> {
    const body = buildOpenRouterChatBody(this.id, this.baseUrl, this.model, messages, options);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://crucibulum.local",
        "X-Title": "Crucibulum",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });

    if (!res.ok) {
      const rawBody = await res.text().catch(() => "");
      throw makeHttpProviderError(res, rawBody, { provider: this.id, adapter: this.id }, `${this.name} ${res.status}: ${rawBody}`);
    }

    const rawBody = await res.text();
    let data: {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; total_cost?: number };
    };
    try {
      data = JSON.parse(rawBody) as typeof data;
    } catch {
      throw makeInvalidResponseError({ provider: this.id, adapter: this.id }, `${this.name} returned non-JSON body: ${rawBody.slice(0, 400)}`);
    }

    const text = data.choices?.[0]?.message?.content ?? "";
    // OpenRouter names the field `cost` post-2025; older payloads used
    // `total_cost`. Accept both; surface nothing when neither is present
    // so callers can tell "unknown" apart from "$0.00 confirmed".
    const costOf = (u?: { cost?: number; total_cost?: number }): number | undefined => {
      if (!u) return undefined;
      if (typeof u.cost === "number" && Number.isFinite(u.cost)) return u.cost;
      if (typeof u.total_cost === "number" && Number.isFinite(u.total_cost)) return u.total_cost;
      return undefined;
    };

    // Retry once on empty
    if (!text.trim()) {
      log("warn", this.id, "Empty response, retrying...");
      await new Promise(r => setTimeout(r, 1500));
      const retryBody = { ...body, temperature: 0.2 };
      const retry = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://crucibulum.local",
          "X-Title": "Crucibulum",
        },
        body: JSON.stringify(retryBody),
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
      if (retry.ok) {
        const retryRawBody = await retry.text();
        let retryData: typeof data;
        try {
          retryData = JSON.parse(retryRawBody) as typeof data;
        } catch {
          throw makeInvalidResponseError({ provider: this.id, adapter: this.id, attempt: 2 }, `${this.name} returned non-JSON retry body: ${retryRawBody.slice(0, 400)}`);
        }
        const retryText = retryData.choices?.[0]?.message?.content ?? "";
        if (retryText.trim()) {
          const firstCost = costOf(data.usage);
          const retryCost = costOf(retryData.usage);
          const combined = firstCost != null || retryCost != null ? (firstCost ?? 0) + (retryCost ?? 0) : undefined;
          return {
            text: retryText,
            tokensIn: (data.usage?.prompt_tokens ?? 0) + (retryData.usage?.prompt_tokens ?? 0),
            tokensOut: (data.usage?.completion_tokens ?? 0) + (retryData.usage?.completion_tokens ?? 0),
            ...(combined !== undefined ? { costUsd: combined } : {}),
          };
        }
      }
      if (!retry.ok) {
        throw makeHttpProviderError(retry, await retry.text().catch(() => ""), { provider: this.id, adapter: this.id, attempt: 2 });
      }
      throw makeEmptyResponseError({ provider: this.id, adapter: this.id, attempt: 2 }, `${this.name} returned empty response after retry`);
    }

    const cost = costOf(data.usage);
    return {
      text,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      ...(cost !== undefined ? { costUsd: cost } : {}),
    };
  }
}

export function buildOpenRouterChatBody(
  adapterId: string,
  baseUrl: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: ChatOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 8192,
    temperature: 0.1,
    stream: false,
    usage: { include: true },
  };
  const isNativeOpenRouter = /openrouter\.ai/i.test(baseUrl);
  const requestedReasoning = options?.reasoningEffort;
  const suppressVisibleReasoning = options?.suppressVisibleReasoning === true;
  const wantsReasoningOff = requestedReasoning === "off" || (requestedReasoning == null && suppressVisibleReasoning);
  if (isNativeOpenRouter && (wantsReasoningOff || requestedReasoning === "minimal")) {
    body.reasoning = wantsReasoningOff
      ? { exclude: true, effort: "none" }
      : { effort: "minimal" };
  }
  return body;
}

// ── Re-anchor message ──────────────────────────────────────────────────────

const RE_ANCHOR_MESSAGE = `You must use one of these exact commands on its own line to interact with the codebase. Do not explain — just issue the command.

To read a file:
READ_FILE src/auth/login.js

To write a file:
WRITE_FILE src/auth/login.js
(file content here)
END_FILE

To run a shell command:
SHELL npm test

To signal completion:
DONE

Issue one of these commands now.`;

// ── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(input: ExecutionInput): string {
  const lines = [
    "You are a software engineer. You have been given a task to fix a bug in a codebase.",
    "",
    "You interact with the codebase using these commands. Each command must appear on its own line:",
    "",
    "  READ_FILE <path>         — read a file and see its contents",
    "  WRITE_FILE <path>        — start writing a file (end with END_FILE on its own line)",
    "  END_FILE                 — marks the end of file content",
    "  SHELL <command>          — run a shell command",
    "  DONE                     — signal that you have completed the task",
    "",
    "Example workflow:",
    "  READ_FILE src/auth/login.js",
    "  (you see the file, find the bug)",
    "  WRITE_FILE src/auth/login.js",
    "  (corrected file content)",
    "  END_FILE",
    "  SHELL npm test",
    "  (tests pass)",
    "  DONE",
    "",
    "Rules:",
    `- You have ${input.budget.time_limit_sec} seconds and ${input.budget.max_steps} steps`,
    `- You can edit up to ${input.budget.max_file_edits} files`,
    `- Allowed tools: ${input.task.constraints.allowed_tools.join(", ")}`,
    input.task.constraints.network_allowed
      ? "- Network access is allowed"
      : "- Network access is NOT allowed",
  ];

  if (input.task.verification.public_tests_command) {
    lines.push(`- Run tests with: ${input.task.verification.public_tests_command}`);
  }
  if (input.task.verification.build_command) {
    lines.push(`- Build with: ${input.task.verification.build_command}`);
  }

  lines.push(
    "",
    "IMPORTANT:",
    "1. Read files FIRST before making any changes",
    "2. After fixing, run the tests to verify",
    "3. When tests pass and you are confident, output DONE",
    "4. Output commands on their own lines — do not wrap them in markdown code blocks",
  );

  return lines.join("\n");
}

// ── Lenient command parser + executor ────────────────────────────────────────

interface ToolExecResult {
  done: boolean;
  feedback: string;
  commandsFound: number;
}

// Blocked shell patterns — network exfiltration and destructive ops
const BLOCKED_SHELL_PATTERNS: RegExp[] = [
  /\bcurl\s+https?:/i,
  /\bwget\s+https?:/i,
  /\bnc\s+-e\b/i,
  /\/dev\/tcp\//i,
  /\brm\s+-rf\s+\//,
];

function isShellBlocked(command: string): boolean {
  return BLOCKED_SHELL_PATTERNS.some(p => p.test(command));
}

function executeToolCalls(
  response: string,
  workspacePath: string,
  observer: Observer,
  maxFileEdits: number,
): ToolExecResult {
  const feedback: string[] = [];
  let done = false;
  let fileEdits = 0;
  let commandsFound = 0;

  // ── DONE detection (lenient) ──────────────────────────────────────────────
  const donePatterns = [
    /^DONE\s*$/m,
    /\bDONE\b/,
    /\btask\s+(is\s+)?complete\b/i,
    /\bthe\s+fix\s+is\s+complete\b/i,
    /\bi\s+have\s+(now\s+)?fixed\b/i,
    /\bfix\s+(has\s+been|is)\s+(applied|complete|done)\b/i,
    /\bfinished\b.*\btask\b/i,
  ];

  // DONE requires actual file changes — a model that does nothing cannot claim completion
  const hasWork = observer.getFilesWritten().length > 0;
  const isDone = donePatterns.some(p => p.test(response));

  if (isDone && hasWork) {
    done = true;
    return { done, feedback: "", commandsFound: 1 };
  }
  if (isDone && !hasWork) {
    // Reject DONE — model hasn't made any changes yet
    log("warn", "chatloop", "DONE rejected — no file changes made yet");
    return {
      done: false,
      feedback: "You have signaled DONE but have not made any changes to the codebase. You must write a fix before completing. Use WRITE_FILE to modify the file containing the bug with your fix, then run the tests to verify.",
      commandsFound: 1,
    };
  }

  // ── READ_FILE parsing (lenient) ───────────────────────────────────────────
  const readPatterns = [
    /READ_FILE\s+[`"']?(\S+?)[`"']?\s*$/gm,
    /(?:read|cat|view|show|look at)\s+(?:the\s+)?(?:file\s+)?[`"']?(\S+\.\w+)[`"']?/gi,
    /```\s*\n\s*READ_FILE\s+(\S+)/g,
  ];

  const readPaths = new Set<string>();
  for (const pattern of readPatterns) {
    for (const match of response.matchAll(pattern)) {
      const raw = match[1]!.replace(/[`"']/g, "").replace(/,$/, "");
      if (raw && raw.includes("/") || raw.includes(".")) readPaths.add(raw);
    }
  }

  for (const filePath of readPaths) {
    const absPath = resolve(workspacePath, filePath);
    if (!absPath.startsWith(resolve(workspacePath))) {
      observer.recordError(`Path escape attempt: ${filePath}`);
      feedback.push(`ERROR: ${filePath} is outside the workspace`);
      continue;
    }
    observer.fileRead(filePath);
    commandsFound++;
    try {
      if (!existsSync(absPath)) {
        feedback.push(`FILE NOT FOUND: ${filePath}`);
        log("debug", "chatloop", `READ_FILE ${filePath}: not found`);
      } else {
        const content = readFileSync(absPath, "utf-8");
        feedback.push(`--- ${filePath} ---\n${content}\n--- END ---`);
        log("debug", "chatloop", `READ_FILE ${filePath}: ${content.length} chars`);
      }
    } catch (err) {
      feedback.push(`ERROR reading ${filePath}: ${String(err).slice(0, 100)}`);
    }
  }

  // ── WRITE_FILE parsing (multi-pattern, most specific first) ────────────────
  const writtenPaths = new Set<string>();

  // Pattern A: WRITE_FILE path\ncontent\nEND_FILE (strict — try first)
  const writeRegexA = /WRITE_FILE\s+[`"']?(\S+?)[`"']?\s*\n([\s\S]*?)END_FILE/g;
  let writeMatchA;
  while ((writeMatchA = writeRegexA.exec(response)) !== null) {
    const filePath = writeMatchA[1]!.replace(/[`"']/g, "");
    const content = writeMatchA[2]!;
    log("info", "chatloop", `WRITE pattern A matched: ${filePath} (${content.length} chars)`);
    if (doWriteFile(filePath, content, workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
      fileEdits++;
      commandsFound++;
      writtenPaths.add(filePath);
    }
  }

  // Pattern B: WRITE_FILE path\ncontent (no END_FILE — content until next command or end)
  if (writtenPaths.size === 0) {
    const writeBlockRegex = /WRITE_FILE\s+[`"']?(\S+?)[`"']?\s*\n([\s\S]*?)(?=\n\s*(?:READ_FILE|WRITE_FILE|SHELL|DONE)\b|$)/g;
    let writeMatchB;
    while ((writeMatchB = writeBlockRegex.exec(response)) !== null) {
      const filePath = writeMatchB[1]!.replace(/[`"']/g, "");
      const content = writeMatchB[2]!.trimEnd();
      if (writtenPaths.has(filePath)) continue;
      // Skip if content is empty or just whitespace
      if (!content.trim()) continue;
      log("info", "chatloop", `WRITE pattern B matched (no END_FILE): ${filePath} (${content.length} chars)`);
      if (doWriteFile(filePath, content, workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
        fileEdits++;
        commandsFound++;
        writtenPaths.add(filePath);
      }
    }
  }

  // Pattern C: markdown code block with filename — ```lang filename.ext\ncontent\n```
  const codeBlockRegex = /```(?:\w+)?\s+(\S+\.\w+)\s*\n([\s\S]*?)```/g;
  let cbMatch;
  while ((cbMatch = codeBlockRegex.exec(response)) !== null) {
    const filePath = cbMatch[1]!;
    const content = cbMatch[2]!;
    if (writtenPaths.has(filePath)) continue;
    if (!observer.getFilesWritten().includes(filePath) && filePath.includes("/")) {
      log("info", "chatloop", `WRITE pattern C matched (code block): ${filePath} (${content.length} chars)`);
      if (doWriteFile(filePath, content, workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
        fileEdits++;
        commandsFound++;
        writtenPaths.add(filePath);
      }
    }
  }

  // Pattern D: model says "here is the updated/fixed file" with a code block after mentioning path
  if (writtenPaths.size === 0) {
    const updatePatternRegex = /(?:updated?|fixed|corrected|modified|new)\s+(?:version\s+of\s+)?[`"']?(\S+\.\w+)[`"']?\s*:?\s*\n\s*```\w*\s*\n([\s\S]*?)```/gi;
    let upMatch;
    while ((upMatch = updatePatternRegex.exec(response)) !== null) {
      const filePath = upMatch[1]!.replace(/[`"':]/g, "");
      const content = upMatch[2]!;
      if (filePath.includes("/") && !writtenPaths.has(filePath)) {
        log("info", "chatloop", `WRITE pattern D matched (natural language + code block): ${filePath}`);
        if (doWriteFile(filePath, content, workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
          fileEdits++;
          commandsFound++;
          writtenPaths.add(filePath);
        }
      }
    }
  }

  // ── SHELL parsing (lenient) ───────────────────────────────────────────────
  const shellPatterns = [
    /SHELL\s+(.+)/g,
    /^(?:run|execute):\s*(.+)$/gim,
    /^\$\s+(.+)$/gm,
    /```(?:bash|sh|shell)\s*\n([\s\S]*?)```/g,
  ];

  const shellCommands = new Set<string>();
  for (const pattern of shellPatterns) {
    for (const match of response.matchAll(pattern)) {
      const cmd = match[1]!.trim();
      // Filter out non-command strings (too short, markdown artifacts)
      if (cmd.length > 2 && cmd.length < 200 && !cmd.startsWith("#") && !cmd.startsWith("//")) {
        // For multi-line bash blocks, take each line
        if (cmd.includes("\n")) {
          for (const line of cmd.split("\n")) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#")) shellCommands.add(trimmed);
          }
        } else {
          shellCommands.add(cmd);
        }
      }
    }
  }

  for (const command of shellCommands) {
    if (isShellBlocked(command)) {
      observer.recordError(`Blocked command: ${command}`);
      feedback.push(`ERROR: Command blocked for security: ${command}`);
      log("warn", "chatloop", `SHELL blocked: ${command}`);
      continue;
    }

    commandsFound++;
    log("info", "chatloop", `SHELL: ${command}`);
    try {
      const output = execSync(command, {
        cwd: workspacePath,
        encoding: "utf-8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      observer.shell(command, 0);
      const truncated = output.length > 2000 ? output.slice(0, 2000) + "\n[truncated]" : output;
      feedback.push(`$ ${command}\n${truncated}`);
      log("debug", "chatloop", `SHELL exit 0: ${output.slice(0, 200).replace(/\n/g, "\\n")}`);
    } catch (err) {
      const exitCode = (err as { status?: number }).status ?? 1;
      const stderr = (err as { stderr?: string }).stderr ?? "";
      const stdout = (err as { stdout?: string }).stdout ?? "";
      const output = (stderr || stdout || String(err)).slice(0, 1000);
      observer.shell(command, exitCode);
      feedback.push(`$ ${command}\nExit code: ${exitCode}\n${output}`);
      log("debug", "chatloop", `SHELL exit ${exitCode}: ${output.slice(0, 200).replace(/\n/g, "\\n")}`);
    }
  }

  // ── Build feedback ────────────────────────────────────────────────────────
  if (commandsFound === 0) {
    return {
      done: false,
      feedback: "I could not detect any commands in your response. Please use one of these commands on its own line:\n\nREAD_FILE <path>\nSHELL <command>\nWRITE_FILE <path>\\n<content>\\nEND_FILE\nDONE",
      commandsFound: 0,
    };
  }

  return { done, feedback: feedback.join("\n\n"), commandsFound };
}

// ── Model artifact stripping ───────────────────────────────────────────────

const ARTIFACT_PATTERNS: RegExp[] = [
  /<\|[^|]*\|>/g,       // <|endoftext|>, <|im_end|>, <|eot_id|>, etc.
  /<channel[^>]*>/g,     // <channel|>, <channel>, etc.
];

function stripModelArtifacts(text: string): string {
  let cleaned = text;
  let found = false;
  for (const pattern of ARTIFACT_PATTERNS) {
    if (pattern.test(cleaned)) found = true;
    cleaned = cleaned.replace(pattern, "");
  }
  if (found) {
    log("debug", "chatloop", "Stripped model artifacts from response");
  }
  return cleaned;
}

// ── Markdown fence stripping ───────────────────────────────────────────────

function stripMarkdownFences(content: string): string {
  const lines = content.split("\n");
  let start = 0;
  let end = lines.length;

  // Strip leading fence: ```lang or ```
  if (lines.length > 0 && /^\s*```\w*\s*$/.test(lines[0]!)) {
    start = 1;
  }

  // Strip trailing fence: ```
  if (end > start && /^\s*```\s*$/.test(lines[end - 1]!)) {
    end = end - 1;
  }

  return lines.slice(start, end).join("\n");
}

// ── File write helper ──────────────────────────────────────────────────────

function doWriteFile(
  filePath: string,
  rawContent: string,
  workspacePath: string,
  observer: Observer,
  feedback: string[],
  maxFileEdits: number,
  currentEdits: number,
): boolean {
  const absPath = resolve(workspacePath, filePath);

  if (!absPath.startsWith(resolve(workspacePath))) {
    observer.recordError(`Path escape attempt: ${filePath}`);
    feedback.push(`ERROR: ${filePath} is outside the workspace`);
    return false;
  }

  if (currentEdits >= maxFileEdits) {
    observer.recordError(`File edit limit reached: ${maxFileEdits}`);
    feedback.push(`ERROR: Maximum file edits (${maxFileEdits}) reached`);
    return false;
  }

  // Strip markdown fences that models often wrap code in
  const content = stripMarkdownFences(rawContent);

  observer.fileWrite(filePath);
  try {
    mkdirSync(dirname(absPath), { recursive: true });
    const bytes = Buffer.byteLength(content, "utf-8");
    writeFileSync(absPath, content, "utf-8");
    feedback.push(`WRITTEN: ${filePath}`);
    log("info", "chatloop", `WRITE_FILE ${filePath}: SUCCESS (${bytes} bytes written)`);
    return true;
  } catch (err) {
    const reason = String(err).slice(0, 150);
    feedback.push(`ERROR writing ${filePath}: ${reason}`);
    log("error", "chatloop", `WRITE_FILE ${filePath}: FAILED — ${reason}`);
    return false;
  }
}
