/**
 * Crucible — Google AI Direct Adapter
 * Direct Gemini API integration via generativelanguage.googleapis.com.
 * Uses Google's native content format (role: "model", parts: [{text}]).
 * API key passed as URL query parameter, not auth header.
 *
 * Supported: gemini-2.0-flash, gemini-1.5-pro, gemini-3.1-pro
 * CLI: --adapter google --model gemini-2.0-flash
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

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL_TIMEOUT_MS = 300_000;
const HEALTH_TIMEOUT_MS = 10_000;

interface GoogleConfig extends AdapterConfig {
  model?: string | undefined;
}

export class GoogleAdapter implements CrucibulumAdapter {
  id = "google";
  name = "Google AI Direct";
  version = "1.0.0";

  private model: string = "gemini-2.0-flash";
  private apiKey: string = "";

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
    if (!this.apiKey) throw new Error("Google AI: GOOGLE_AI_API_KEY not set");
    const start = Date.now();
    // Gemini keeps system prompts out of the contents array (similar to Anthropic)
    // and uses "model" instead of "assistant" for the model's turn.
    const systemParts: string[] = [];
    const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
    for (const m of messages) {
      if (m.role === "system") {
        systemParts.push(m.content);
      } else {
        contents.push({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        });
      }
    }
    const result = await callGoogle(this.apiKey, this.model, systemParts.join("\n\n"), contents, options);
    return {
      text: result.text,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      duration_ms: Date.now() - start,
    };
  }

  async init(config: AdapterConfig): Promise<void> {
    const c = config as GoogleConfig;
    if (c.model) this.model = c.model;
    this.apiKey = process.env["GOOGLE_AI_API_KEY"] ?? "";
  }

  async healthCheck() {
    if (!this.apiKey) {
      const providerError = makeProviderFailureError({ kind: "AUTH", origin: "ADAPTER", provider: "google", adapter: this.id, rawMessage: "GOOGLE_AI_API_KEY not set" }).structured;
      // Detail (not Summary) so operators see WHICH env var to set.
      return { ok: false, reason: providerErrorDetail(providerError), providerError };
    }
    try {
      const res = await fetch(`${GOOGLE_BASE}/models?key=${this.apiKey}`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const providerError = makeHttpProviderError(res, await res.text().catch(() => ""), { provider: "google", adapter: this.id }).structured;
        return { ok: false, reason: providerErrorSummary(providerError), providerError };
      }
      return { ok: true };
    } catch (err) {
      const providerError = normalizeProviderError(err, { provider: "google", adapter: this.id });
      return { ok: false, reason: providerErrorSummary(providerError), providerError };
    }
  }

  async teardown(): Promise<void> {}

  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const observer = new Observer();
    observer.taskStart();

    const startMs = Date.now();
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let exitReason: ExecutionResult["exit_reason"] = "complete";
    let consecutiveNoCommand = 0;

    const systemPrompt = buildSystemPrompt(input);

    // Google uses "contents" array with role "user" / "model"
    // System instruction is separate
    const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [
      {
        role: "user",
        parts: [{ text: `Your task:\n${input.task.task.title}\n\n${input.task.task.description}\n\nEntrypoints to investigate: ${input.task.task.entrypoints.join(", ")}\n\nStart by reading the entrypoint files to understand the code.` }],
      },
    ];

    const maxSteps = input.budget.max_steps;
    const timeLimitMs = input.budget.time_limit_sec * 1000;

    for (let step = 0; step < maxSteps; step++) {
      if (Date.now() - startMs > timeLimitMs) { observer.recordError("Time budget exceeded"); exitReason = "timeout"; break; }

      log("info", "google", `[step ${step + 1}/${maxSteps}] Calling ${this.model}...`);

      let response: string;
      try {
        const result = await callGoogle(this.apiKey, this.model, systemPrompt, contents);
        response = result.text;
        totalTokensIn += result.tokensIn;
        totalTokensOut += result.tokensOut;
        log("info", "google", `[step ${step + 1}/${maxSteps}] Response (${response.length} chars, ${result.tokensOut} tok)`);
      } catch (err) {
        const providerError = normalizeProviderError(err, { provider: "google", adapter: this.id });
        log("error", "google", `[step ${step + 1}/${maxSteps}] Model call failed: ${providerError.rawMessage.slice(0, 200)}`);
        observer.recordError(`Model call failed: ${providerError.rawMessage.slice(0, 200)}`, providerError);
        exitReason = "error"; break;
      }

      contents.push({ role: "model", parts: [{ text: response }] });

      // Context compression
      if ((totalTokensIn + totalTokensOut) > 40_000 && contents.length > 8) {
        const taskMsg = contents[0]!;
        const recent = contents.slice(-6);
        contents.length = 0;
        contents.push(taskMsg);
        contents.push({ role: "user", parts: [{ text: "Previous steps summarized. Continue fixing the bug." }] });
        contents.push(...recent);
      }

      if ((Date.now() - startMs) > 600_000 && !contents.some(c => c.parts.some(p => p.text.includes("running low on time")))) {
        contents.push({ role: "user", parts: [{ text: "You are running low on time. Make your fix now and signal DONE." }] });
      }

      const toolResult = executeToolCalls(response, input.workspace_path, observer, input.budget.max_file_edits);
      if (toolResult.done) { observer.taskComplete(); break; }
      if (toolResult.commandsFound === 0) { consecutiveNoCommand++; } else { consecutiveNoCommand = 0; }
      if (consecutiveNoCommand >= 3) { contents.push({ role: "user", parts: [{ text: RE_ANCHOR_MESSAGE }] }); consecutiveNoCommand = 0; }
      else if (toolResult.feedback) { contents.push({ role: "user", parts: [{ text: toolResult.feedback }] }); }
      if (step === maxSteps - 1) { observer.recordError("Step budget exceeded"); exitReason = "budget_exceeded"; }
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
        system_version: "google-ai-api",
        model: this.model,
        provider: "google",
      },
    };
  }
}

// ── Google AI API call ─────────────────────────────────────────────────────

async function callGoogle(
  apiKey: string,
  model: string,
  systemInstruction: string,
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>,
  options?: ChatOptions,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const generationConfig = buildGoogleGenerationConfig(options);
  const res = await fetch(
    `${GOOGLE_BASE}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig,
      }),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    },
  );

  if (!res.ok) {
    throw makeHttpProviderError(res, await res.text().catch(() => ""), { provider: "google", adapter: "google" });
  }

  const rawBody = await res.text();
  let data: {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
  try {
    data = JSON.parse(rawBody) as typeof data;
  } catch {
    throw makeInvalidResponseError({ provider: "google", adapter: "google" }, `Google AI returned non-JSON body: ${rawBody.slice(0, 400)}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text.trim()) {
    throw makeEmptyResponseError({ provider: "google", adapter: "google" }, `Google AI returned empty response for model ${model}`);
  }

  return {
    text,
    tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

export function buildGoogleGenerationConfig(options?: ChatOptions): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: 8192,
    temperature: 0.1,
  };
  const requestedReasoning = options?.reasoningEffort;
  const suppressVisibleReasoning = options?.suppressVisibleReasoning === true;
  const wantsReasoningOff = requestedReasoning === "off" || (requestedReasoning == null && suppressVisibleReasoning);
  if (wantsReasoningOff || requestedReasoning === "minimal") {
    generationConfig.thinkingConfig = {
      thinkingBudget: wantsReasoningOff ? 0 : 256,
    };
  }
  return generationConfig;
}

// ── Shared agentic loop infrastructure ─────────────────────────────────────

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
    "Rules:",
    `- You have ${input.budget.time_limit_sec} seconds and ${input.budget.max_steps} steps`,
    `- You can edit up to ${input.budget.max_file_edits} files`,
    `- Allowed tools: ${input.task.constraints.allowed_tools.join(", ")}`,
    input.task.constraints.network_allowed ? "- Network access is allowed" : "- Network access is NOT allowed",
  ];
  if (input.task.verification.public_tests_command) lines.push(`- Run tests with: ${input.task.verification.public_tests_command}`);
  if (input.task.verification.build_command) lines.push(`- Build with: ${input.task.verification.build_command}`);
  lines.push("", "IMPORTANT:", "1. Read files FIRST before making any changes", "2. After fixing, run the tests to verify", "3. When tests pass and you are confident, output DONE", "4. Output commands on their own lines — do not wrap them in markdown code blocks");
  return lines.join("\n");
}

const BLOCKED_SHELL_PATTERNS: RegExp[] = [
  /\bcurl\s+https?:/i, /\bwget\s+https?:/i, /\bnc\s+-e\b/i, /\/dev\/tcp\//i, /\brm\s+-rf\s+\//,
];

interface ToolExecResult { done: boolean; feedback: string; commandsFound: number; }

function executeToolCalls(response: string, workspacePath: string, observer: Observer, maxFileEdits: number): ToolExecResult {
  const feedback: string[] = [];
  let fileEdits = 0, commandsFound = 0;

  const donePatterns = [/^DONE\s*$/m, /\bDONE\b/, /\btask\s+(is\s+)?complete\b/i, /\bthe\s+fix\s+is\s+complete\b/i, /\bfix\s+(has\s+been|is)\s+(applied|complete|done)\b/i];
  const hasWork = observer.getFilesWritten().length > 0;
  if (donePatterns.some(p => p.test(response)) && hasWork) return { done: true, feedback: "", commandsFound: 1 };
  if (donePatterns.some(p => p.test(response)) && !hasWork) return { done: false, feedback: "You have signaled DONE but have not made any changes. Use WRITE_FILE to fix the bug first.", commandsFound: 1 };

  const readPaths = new Set<string>();
  for (const m of response.matchAll(/READ_FILE\s+[`"']?(\S+?)[`"']?\s*$/gm)) {
    const raw = m[1]!.replace(/[`"']/g, "").replace(/,$/, "");
    if (raw && (raw.includes("/") || raw.includes("."))) readPaths.add(raw);
  }
  for (const filePath of readPaths) {
    const absPath = resolve(workspacePath, filePath);
    if (!absPath.startsWith(resolve(workspacePath))) { observer.recordError(`Path escape: ${filePath}`); feedback.push(`ERROR: ${filePath} is outside the workspace`); continue; }
    observer.fileRead(filePath); commandsFound++;
    try {
      if (!existsSync(absPath)) feedback.push(`FILE NOT FOUND: ${filePath}`);
      else feedback.push(`--- ${filePath} ---\n${readFileSync(absPath, "utf-8")}\n--- END ---`);
    } catch (err) { feedback.push(`ERROR reading ${filePath}: ${String(err).slice(0, 100)}`); }
  }

  const writtenPaths = new Set<string>();
  for (const m of response.matchAll(/WRITE_FILE\s+[`"']?(\S+?)[`"']?\s*\n([\s\S]*?)END_FILE/g)) {
    const fp = m[1]!.replace(/[`"']/g, "");
    if (doWrite(fp, m[2]!, workspacePath, observer, feedback, maxFileEdits, fileEdits)) { fileEdits++; commandsFound++; writtenPaths.add(fp); }
  }
  if (writtenPaths.size === 0) {
    for (const m of response.matchAll(/WRITE_FILE\s+[`"']?(\S+?)[`"']?\s*\n([\s\S]*?)(?=\n\s*(?:READ_FILE|WRITE_FILE|SHELL|DONE)\b|$)/g)) {
      const fp = m[1]!.replace(/[`"']/g, ""); const c = m[2]!.trimEnd();
      if (!writtenPaths.has(fp) && c.trim() && doWrite(fp, c, workspacePath, observer, feedback, maxFileEdits, fileEdits)) { fileEdits++; commandsFound++; writtenPaths.add(fp); }
    }
  }
  for (const m of response.matchAll(/```(?:\w+)?\s+(\S+\.\w+)\s*\n([\s\S]*?)```/g)) {
    const fp = m[1]!;
    if (!writtenPaths.has(fp) && fp.includes("/") && doWrite(fp, m[2]!, workspacePath, observer, feedback, maxFileEdits, fileEdits)) { fileEdits++; commandsFound++; writtenPaths.add(fp); }
  }

  const shellCmds = new Set<string>();
  for (const m of response.matchAll(/SHELL\s+(.+)/g)) { const c = m[1]!.trim(); if (c.length > 2 && c.length < 200) shellCmds.add(c); }
  for (const m of response.matchAll(/```(?:bash|sh|shell)\s*\n([\s\S]*?)```/g)) {
    for (const line of m[1]!.split("\n")) { const t = line.trim(); if (t && !t.startsWith("#") && t.length > 2) shellCmds.add(t); }
  }
  for (const cmd of shellCmds) {
    if (BLOCKED_SHELL_PATTERNS.some(p => p.test(cmd))) { observer.recordError(`Blocked: ${cmd}`); feedback.push(`ERROR: Command blocked: ${cmd}`); continue; }
    commandsFound++;
    try {
      const out = execSync(cmd, { cwd: workspacePath, encoding: "utf-8", timeout: 30_000, maxBuffer: 1024 * 1024 });
      observer.shell(cmd, 0);
      feedback.push(`$ ${cmd}\n${out.length > 2000 ? out.slice(0, 2000) + "\n[truncated]" : out}`);
    } catch (err) {
      const ec = (err as { status?: number }).status ?? 1;
      observer.shell(cmd, ec);
      feedback.push(`$ ${cmd}\nExit code: ${ec}\n${((err as { stderr?: string }).stderr || (err as { stdout?: string }).stdout || String(err)).slice(0, 1000)}`);
    }
  }

  if (commandsFound === 0) return { done: false, feedback: "No commands detected. Use: READ_FILE <path> / WRITE_FILE <path>\\n<content>\\nEND_FILE / SHELL <cmd> / DONE", commandsFound: 0 };
  return { done: false, feedback: feedback.join("\n\n"), commandsFound };
}

function stripMarkdownFences(c: string): string {
  const l = c.split("\n"); let s = 0, e = l.length;
  if (l.length > 0 && /^\s*```\w*\s*$/.test(l[0]!)) s = 1;
  if (e > s && /^\s*```\s*$/.test(l[e - 1]!)) e--;
  return l.slice(s, e).join("\n");
}

function doWrite(fp: string, raw: string, ws: string, obs: Observer, fb: string[], max: number, cur: number): boolean {
  const abs = resolve(ws, fp);
  if (!abs.startsWith(resolve(ws))) { obs.recordError(`Path escape: ${fp}`); fb.push(`ERROR: ${fp} outside workspace`); return false; }
  if (cur >= max) { fb.push(`ERROR: Max file edits (${max}) reached`); return false; }
  obs.fileWrite(fp);
  try { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, stripMarkdownFences(raw), "utf-8"); fb.push(`WRITTEN: ${fp}`); return true; }
  catch (err) { fb.push(`ERROR writing ${fp}: ${String(err).slice(0, 150)}`); return false; }
}
