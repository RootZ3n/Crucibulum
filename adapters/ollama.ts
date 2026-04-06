/**
 * Crucibulum — Ollama Adapter
 * Direct Ollama API integration for local model evaluation.
 * Implements an agentic loop with lenient command parsing and structured logging.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  CrucibulumAdapter,
  AdapterConfig,
  ExecutionInput,
  ExecutionResult,
} from "./base.js";
import { Observer } from "../core/observer.js";
import { log } from "../utils/logger.js";

const DEFAULT_OLLAMA_URL = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
const MODEL_TIMEOUT_MS = 600_000;   // 10 minutes — large models need time for first token
const HEALTH_TIMEOUT_MS = 15_000;   // 15 seconds — loaded system may be slow

interface OllamaConfig extends AdapterConfig {
  ollama_url?: string | undefined;
  model?: string | undefined;
}

export class OllamaAdapter implements CrucibulumAdapter {
  id = "ollama";
  name = "Ollama";
  version = "1.0.0";

  private url: string = DEFAULT_OLLAMA_URL;
  private model: string = "gemma3:27b";

  supports(_family: "poison" | "spec" | "orchestration"): boolean {
    return true;
  }

  supportsToolCalls(): boolean {
    return true;
  }

  async init(config: AdapterConfig): Promise<void> {
    const c = config as OllamaConfig;
    if (c.ollama_url) this.url = c.ollama_url;
    if (c.model) this.model = c.model;
  }

  async healthCheck(): Promise<{ ok: boolean; reason?: string | undefined }> {
    try {
      const res = await fetch(`${this.url}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, reason: `Ollama returned ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: `Ollama unreachable: ${String(err).slice(0, 100)}` };
    }
  }

  async teardown(): Promise<void> { /* nothing to clean up */ }

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
          `Entrypoints to investigate: ${input.task.task.entrypoints.join(", ")}`,
          ``,
          `Start by reading the entrypoint files to understand the code.`,
        ].join("\n"),
      },
    ];

    const maxSteps = input.budget.max_steps;
    const timeLimitMs = input.budget.time_limit_sec * 1000;

    for (let step = 0; step < maxSteps; step++) {
      // Check time budget
      if (Date.now() - startMs > timeLimitMs) {
        log("warn", "ollama", `[step ${step + 1}/${maxSteps}] Time budget exceeded (${Math.round((Date.now() - startMs) / 1000)}s)`);
        observer.recordError("Time budget exceeded");
        exitReason = "timeout";
        break;
      }

      log("info", "ollama", `[step ${step + 1}/${maxSteps}] Calling ${this.model}...`);

      // Call model
      let response: string;
      try {
        const result = await callOllama(this.url, this.model, messages);
        response = stripModelArtifacts(result.text);
        totalTokensIn += result.tokensIn;
        totalTokensOut += result.tokensOut;
        log("info", "ollama", `[step ${step + 1}/${maxSteps}] Response (${response.length} chars, ${result.tokensOut} tok): ${response.slice(0, 300).replace(/\n/g, "\\n")}${response.length > 300 ? "..." : ""}`);
      } catch (err) {
        log("error", "ollama", `[step ${step + 1}/${maxSteps}] Model call failed: ${String(err).slice(0, 200)}`);
        observer.recordError(`Model call failed: ${String(err).slice(0, 200)}`);
        exitReason = "error";
        break;
      }

      messages.push({ role: "assistant", content: response });

      // Context compression — keep conversation manageable for local models
      const totalTokens = totalTokensIn + totalTokensOut;
      if (totalTokens > 20_000 && messages.length > 8) {
        const systemMsg = messages[0]!;   // system prompt
        const taskMsg = messages[1]!;     // original task
        const recentMsgs = messages.slice(-6); // last 3 exchanges
        messages.length = 0;
        messages.push(systemMsg, taskMsg);
        messages.push({ role: "user", content: "Previous steps summarized to save context. Continue with the task. You were investigating and fixing a bug." });
        messages.push(...recentMsgs);
        log("info", "ollama", `[step ${step + 1}] Context compressed: ${totalTokens} tokens, kept ${messages.length} messages`);
      }

      // Time pressure warning — prevent 19-minute runs that end in timeout
      const elapsedMs = Date.now() - startMs;
      if (elapsedMs > 600_000 && !messages.some(m => m.content.includes("running low on time"))) {
        messages.push({
          role: "user",
          content: "You are running low on time. Make your fix now and signal DONE. Do not investigate further — apply your best fix, run the tests, and complete.",
        });
        log("warn", "ollama", `[step ${step + 1}] Time pressure warning injected at ${Math.round(elapsedMs / 1000)}s`);
      }

      // Parse and execute tool calls
      const toolResult = executeToolCalls(response, input.workspace_path, observer, input.budget.max_file_edits);

      if (toolResult.done) {
        log("info", "ollama", `[step ${step + 1}/${maxSteps}] Agent signaled DONE`);
        observer.taskComplete();
        break;
      }

      if (toolResult.commandsFound === 0) {
        consecutiveNoCommand++;
        log("warn", "ollama", `[step ${step + 1}/${maxSteps}] No commands parsed (${consecutiveNoCommand} consecutive)`);
      } else {
        consecutiveNoCommand = 0;
        log("info", "ollama", `[step ${step + 1}/${maxSteps}] Executed ${toolResult.commandsFound} commands`);
      }

      // After 3 consecutive no-command steps, inject strong re-anchor
      if (consecutiveNoCommand >= 3) {
        log("warn", "ollama", `[step ${step + 1}/${maxSteps}] Re-anchoring — model not following protocol`);
        messages.push({
          role: "user",
          content: RE_ANCHOR_MESSAGE,
        });
        consecutiveNoCommand = 0;
      } else if (toolResult.feedback) {
        messages.push({ role: "user", content: toolResult.feedback });
      }

      // Check step budget on last iteration
      if (step === maxSteps - 1) {
        log("warn", "ollama", `Step budget exhausted (${maxSteps} steps)`);
        observer.recordError("Step budget exceeded");
        exitReason = "budget_exceeded";
      }
    }

    const ollamaVersion = await getOllamaVersion(this.url);
    const totalDuration = Date.now() - startMs;
    log("info", "ollama", `Run complete: ${exitReason} in ${Math.round(totalDuration / 1000)}s, ${observer.getStepCount()} steps, ${totalTokensIn}→${totalTokensOut} tokens`);

    return {
      exit_reason: exitReason,
      timeline: observer.getTimeline(),
      duration_ms: totalDuration,
      steps_used: observer.getStepCount(),
      files_read: observer.getFilesRead(),
      files_written: observer.getFilesWritten(),
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
      adapter_metadata: {
        adapter_id: this.id,
        adapter_version: this.version,
        system_version: ollamaVersion,
        model: this.model,
        provider: "ollama",
      },
    };
  }
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

// ── Ollama API call ──────────────────────────────────────────────────────────

async function callOllama(
  url: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature: 0.1, num_predict: 8192 },
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    eval_count?: number;
    prompt_eval_count?: number;
  };

  return {
    text: data.message?.content ?? "",
    tokensIn: data.prompt_eval_count ?? 0,
    tokensOut: data.eval_count ?? 0,
  };
}

async function getOllamaVersion(url: string): Promise<string> {
  try {
    const res = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { version?: string };
    return data.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

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
    log("warn", "ollama", "DONE rejected — no file changes made yet");
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
      const raw = match[1]!.replace(/[`"']/g, "").replace(/,$/,"");
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
        log("debug", "ollama", `READ_FILE ${filePath}: not found`);
      } else {
        const content = readFileSync(absPath, "utf-8");
        feedback.push(`--- ${filePath} ---\n${content}\n--- END ---`);
        log("debug", "ollama", `READ_FILE ${filePath}: ${content.length} chars`);
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
    log("info", "ollama", `WRITE pattern A matched: ${filePath} (${content.length} chars)`);
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
      let content = writeMatchB[2]!.trimEnd();
      if (writtenPaths.has(filePath)) continue;
      // Skip if content is empty or just whitespace
      if (!content.trim()) continue;
      log("info", "ollama", `WRITE pattern B matched (no END_FILE): ${filePath} (${content.length} chars)`);
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
      log("info", "ollama", `WRITE pattern C matched (code block): ${filePath} (${content.length} chars)`);
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
        log("info", "ollama", `WRITE pattern D matched (natural language + code block): ${filePath}`);
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
      log("warn", "ollama", `SHELL blocked: ${command}`);
      continue;
    }

    commandsFound++;
    log("info", "ollama", `SHELL: ${command}`);
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
      log("debug", "ollama", `SHELL exit 0: ${output.slice(0, 200).replace(/\n/g, "\\n")}`);
    } catch (err) {
      const exitCode = (err as { status?: number }).status ?? 1;
      const stderr = (err as { stderr?: string }).stderr ?? "";
      const stdout = (err as { stdout?: string }).stdout ?? "";
      const output = (stderr || stdout || String(err)).slice(0, 1000);
      observer.shell(command, exitCode);
      feedback.push(`$ ${command}\nExit code: ${exitCode}\n${output}`);
      log("debug", "ollama", `SHELL exit ${exitCode}: ${output.slice(0, 200).replace(/\n/g, "\\n")}`);
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
    log("debug", "ollama", "Stripped model artifacts from response");
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
    log("info", "ollama", `WRITE_FILE ${filePath}: SUCCESS (${bytes} bytes written)`);
    return true;
  } catch (err) {
    const reason = String(err).slice(0, 150);
    feedback.push(`ERROR writing ${filePath}: ${reason}`);
    log("error", "ollama", `WRITE_FILE ${filePath}: FAILED — ${reason}`);
    return false;
  }
}
