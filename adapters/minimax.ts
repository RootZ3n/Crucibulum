/**
 * Crucible — MiniMax Direct Adapter
 * Direct MiniMax API integration via OpenAI-compatible endpoint.
 * Supported: MiniMax-M2.7, abab6.5s-chat
 *
 * CLI: --adapter minimax --model MiniMax-M2.7
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

// MiniMax runs two distinct platforms with separate accounts and keys:
//   • International: api.minimax.io — current global API host
//   • Domestic (CN): api.minimax.chat
// We default to the international endpoint for standalone Crucible users.
// Override via MINIMAX_BASE_URL or the Providers tab base URL.
const MINIMAX_BASE_DEFAULT = "https://api.minimax.io/v1";
const MODEL_TIMEOUT_MS = 300_000;
const HEALTH_TIMEOUT_MS = 15_000;

interface MiniMaxConfig extends AdapterConfig {
  model?: string | undefined;
  base_url?: string | undefined;
  api_key?: string | undefined;
}

export class MiniMaxAdapter implements CrucibulumAdapter {
  id = "minimax";
  name = "MiniMax Direct";
  version = "1.0.0";

  // No default model id — the MiniMax catalog is account-scoped and its
  // ids change between platform releases. A stale hardcoded default silently
  // fails every healthCheck with "unknown model" (error code 2013). Force
  // callers to pass a real id so the failure, if any, is about *their* model
  // and not ours.
  private model: string = "";
  private apiKey: string = "";
  private baseUrl: string = MINIMAX_BASE_DEFAULT;

  supports(_family: "poison" | "spec" | "orchestration"): boolean {
    return true;
  }

  supportsToolCalls(): boolean {
    return true;
  }

  supportsChat(): boolean {
    return true;
  }

  async chat(messages: ChatMessage[], _options?: ChatOptions): Promise<ChatResult> {
    if (!this.apiKey) throw new Error("MiniMax: MINIMAX_API_KEY not set");
    const start = Date.now();
    const result = await callMiniMax(this.baseUrl, this.apiKey, this.model, messages);
    return {
      text: result.text,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      duration_ms: Date.now() - start,
    };
  }

  async init(config: AdapterConfig): Promise<void> {
    const c = config as MiniMaxConfig;
    if (c.model) this.model = c.model;
    if (c.api_key) this.apiKey = c.api_key;
    else this.apiKey = process.env["MINIMAX_API_KEY"] ?? "";
    const envBase = process.env["MINIMAX_BASE_URL"];
    this.baseUrl = (c.base_url || envBase || MINIMAX_BASE_DEFAULT).replace(/\/+$/, "");
  }

  async healthCheck() {
    if (!this.apiKey) {
      const providerError = makeProviderFailureError({ kind: "AUTH", origin: "ADAPTER", provider: "minimax", adapter: this.id, rawMessage: "MINIMAX_API_KEY not set" }).structured;
      // Detail (not Summary) so operators see WHICH env var to set.
      return { ok: false, reason: providerErrorDetail(providerError), providerError };
    }
    if (!this.model) {
      // Clean, local rejection rather than calling the API with model="" and
      // getting back the same 2013 "unknown model" error from MiniMax — the
      // message the user sees is now precise and actionable.
      const providerError = makeProviderFailureError({
        kind: "INVALID_RESPONSE",
        origin: "ADAPTER",
        provider: "minimax",
        adapter: this.id,
        rawMessage: "MiniMax model id not configured — register a model via the Providers tab (MiniMax's catalog is account-scoped, so there is no safe default)",
      }).structured;
      return { ok: false, reason: providerErrorSummary(providerError), providerError };
    }
    try {
      // Verify key with a minimal completion. MiniMax embeds per-call errors
      // in base_resp even on HTTP 200 (e.g. 2049 invalid api key, 1004 login
      // fail). We surface those so the user sees the real cause instead of
      // the adapter silently returning ok:true and then producing empty
      // completions at run time.
      const res = await fetch(`${this.baseUrl}/text/chatcompletion_v2`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const providerError = makeHttpProviderError(res, await res.text().catch(() => ""), { provider: "minimax", adapter: this.id }).structured;
        return { ok: false, reason: providerErrorSummary(providerError), providerError };
      }
      const body = await res.text();
      try {
        const parsed = JSON.parse(body) as { base_resp?: { status_code?: number; status_msg?: string } };
        const code = parsed.base_resp?.status_code;
        if (typeof code === "number" && code !== 0) {
          const providerError = makeInvalidResponseError({ provider: "minimax", adapter: this.id }, `MiniMax error ${code}: ${parsed.base_resp?.status_msg || "(no message)"} (base=${this.baseUrl})`).structured;
          return { ok: false, reason: providerErrorSummary(providerError), providerError };
        }
      } catch { /* non-JSON body; treat HTTP 200 as reachable */ }
      return { ok: true };
    } catch (err) {
      const providerError = normalizeProviderError(err, { provider: "minimax", adapter: this.id });
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
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Your task:\n${input.task.task.title}\n\n${input.task.task.description}\n\nEntrypoints to investigate: ${input.task.task.entrypoints.join(", ")}\n\nStart by reading the entrypoint files to understand the code.`,
      },
    ];

    const maxSteps = input.budget.max_steps;
    const timeLimitMs = input.budget.time_limit_sec * 1000;

    for (let step = 0; step < maxSteps; step++) {
      if (Date.now() - startMs > timeLimitMs) { observer.recordError("Time budget exceeded"); exitReason = "timeout"; break; }

      log("info", "minimax", `[step ${step + 1}/${maxSteps}] Calling ${this.model}...`);

      let response: string;
      try {
        const result = await callMiniMax(this.baseUrl, this.apiKey, this.model, messages);
        response = result.text;
        totalTokensIn += result.tokensIn;
        totalTokensOut += result.tokensOut;
        log("info", "minimax", `[step ${step + 1}/${maxSteps}] Response (${response.length} chars, ${result.tokensOut} tok)`);
      } catch (err) {
        const providerError = normalizeProviderError(err, { provider: "minimax", adapter: this.id });
        log("error", "minimax", `[step ${step + 1}/${maxSteps}] Model call failed: ${providerError.rawMessage.slice(0, 200)}`);
        observer.recordError(`Model call failed: ${providerError.rawMessage.slice(0, 200)}`, providerError);
        exitReason = "error"; break;
      }

      messages.push({ role: "assistant", content: response });

      if ((totalTokensIn + totalTokensOut) > 40_000 && messages.length > 8) {
        const sysMsg = messages[0]!; const taskMsg = messages[1]!; const recent = messages.slice(-6);
        messages.length = 0;
        messages.push(sysMsg, taskMsg, { role: "user", content: "Previous steps summarized. Continue fixing the bug." }, ...recent);
      }

      if ((Date.now() - startMs) > 600_000 && !messages.some(m => m.content.includes("running low on time"))) {
        messages.push({ role: "user", content: "You are running low on time. Make your fix now and signal DONE." });
      }

      const toolResult = executeToolCalls(response, input.workspace_path, observer, input.budget.max_file_edits);
      if (toolResult.done) { observer.taskComplete(); break; }
      if (toolResult.commandsFound === 0) { consecutiveNoCommand++; } else { consecutiveNoCommand = 0; }
      if (consecutiveNoCommand >= 3) { messages.push({ role: "user", content: RE_ANCHOR_MESSAGE }); consecutiveNoCommand = 0; }
      else if (toolResult.feedback) { messages.push({ role: "user", content: toolResult.feedback }); }
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
        system_version: "minimax-api",
        model: this.model,
        provider: "minimax",
      },
    };
  }
}

// ── MiniMax API call ───────────────────────────────────────────────────────

async function callMiniMax(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const res = await fetch(`${baseUrl}/text/chatcompletion_v2`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 8192,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    throw makeHttpProviderError(res, rawBody, { provider: "minimax", adapter: "minimax" });
  }
  let data: {
    choices?: Array<{
      message?: { content?: string };
      messages?: Array<{ content?: string; text?: string }>;
      text?: string;
      finish_reason?: string;
    }>;
    reply?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  try { data = JSON.parse(rawBody); }
  catch { throw makeInvalidResponseError({ provider: "minimax", adapter: "minimax" }, `MiniMax returned non-JSON body: ${rawBody.slice(0, 400)}`); }

  // MiniMax embeds per-call errors in `base_resp` even when HTTP is 200
  // (unknown model id, auth issues, content filter, etc.). Surface that
  // instead of silently returning an empty string.
  if (data.base_resp && typeof data.base_resp.status_code === "number" && data.base_resp.status_code !== 0) {
    throw makeInvalidResponseError(
      { provider: "minimax", adapter: "minimax" },
      `MiniMax error ${data.base_resp.status_code}: ${data.base_resp.status_msg || "(no message)"}`,
    );
  }

  // Response shape varies across MiniMax endpoints/models:
  //   • chatcompletion_v2 (OpenAI-ish): choices[0].message.content
  //   • older chatcompletion: choices[0].messages[0].content / text
  //   • some models: top-level reply
  const choice = data.choices?.[0];
  const text =
    choice?.message?.content ??
    choice?.messages?.[0]?.content ??
    choice?.messages?.[0]?.text ??
    choice?.text ??
    data.reply ??
    "";

  if (!text) {
    throw makeEmptyResponseError({ provider: "minimax", adapter: "minimax" }, `MiniMax returned empty content. Raw body: ${rawBody.slice(0, 400)}`);
  }

  return {
    text,
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  };
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
