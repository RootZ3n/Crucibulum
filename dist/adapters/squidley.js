/**
 * Crucible — Squidley Gateway Adapter
 * Routes all model calls through the Squidley API, giving Crucible access
 * to every model Squidley knows: ModelStudio (qwen3.5-plus, qwen3.6-plus),
 * OpenRouter (MiMo, Trinity), Anthropic (Opus, Sonnet), MiniMax, Ollama, etc.
 *
 * Implements the same agentic loop as ollama.ts:
 *   send task prompt → parse READ_FILE/WRITE_FILE/SHELL/DONE → execute tools → loop
 *
 * CLI usage:
 *   --model squidley:qwen3.6-plus
 *   --model squidley:claude-opus-4-6
 *   --model squidley:mimo-v2-pro
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Observer } from "../core/observer.js";
import { makeEmptyResponseError, makeHttpProviderError, makeInvalidResponseError, normalizeProviderError, providerErrorSummary } from "../core/provider-errors.js";
import { log } from "../utils/logger.js";
const DEFAULT_SQUIDLEY_URL = process.env["SQUIDLEY_URL"] ?? "http://localhost:18791";
const MODEL_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 10_000;
export class SquidleyAdapter {
    id = "squidley";
    name = "Squidley Gateway";
    version = "1.0.0";
    url = DEFAULT_SQUIDLEY_URL;
    model = "qwen3.6-plus";
    provider;
    supports(_family) {
        return true;
    }
    supportsToolCalls() {
        return true;
    }
    supportsChat() {
        return true;
    }
    async chat(messages, _options) {
        const start = Date.now();
        const result = await callSquidley(this.url, this.model, this.provider, messages);
        return {
            text: result.text,
            tokens_in: result.tokensIn,
            tokens_out: result.tokensOut,
            duration_ms: Date.now() - start,
        };
    }
    async init(config) {
        const c = config;
        if (c.squidley_url)
            this.url = c.squidley_url;
        if (c.model)
            this.model = c.model;
        if (c.provider)
            this.provider = c.provider;
    }
    async healthCheck() {
        try {
            const res = await fetch(`${this.url}/health`, {
                signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
            });
            if (!res.ok) {
                const providerError = makeHttpProviderError(res, await res.text().catch(() => ""), { provider: this.provider ?? "squidley-routed", adapter: this.id }).structured;
                return { ok: false, reason: providerErrorSummary(providerError), providerError };
            }
            return { ok: true };
        }
        catch (err) {
            const providerError = normalizeProviderError(err, { provider: this.provider ?? "squidley-routed", adapter: this.id });
            return { ok: false, reason: providerErrorSummary(providerError), providerError };
        }
    }
    async teardown() { }
    async execute(input) {
        const observer = new Observer();
        observer.taskStart();
        const startMs = Date.now();
        let totalTokensIn = 0;
        let totalTokensOut = 0;
        let exitReason = "complete";
        let consecutiveNoCommand = 0;
        const systemPrompt = buildSystemPrompt(input);
        const messages = [
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
            if (Date.now() - startMs > timeLimitMs) {
                log("warn", "squidley", `[step ${step + 1}/${maxSteps}] Time budget exceeded (${Math.round((Date.now() - startMs) / 1000)}s)`);
                observer.recordError("Time budget exceeded");
                exitReason = "timeout";
                break;
            }
            log("info", "squidley", `[step ${step + 1}/${maxSteps}] Calling ${this.model} via Squidley...`);
            let response;
            try {
                const result = await callSquidley(this.url, this.model, this.provider, messages);
                response = stripModelArtifacts(result.text);
                totalTokensIn += result.tokensIn;
                totalTokensOut += result.tokensOut;
                log("info", "squidley", `[step ${step + 1}/${maxSteps}] Response (${response.length} chars, ${result.tokensOut} tok): ${response.slice(0, 300).replace(/\n/g, "\\n")}${response.length > 300 ? "..." : ""}`);
            }
            catch (err) {
                const providerError = normalizeProviderError(err, { provider: this.provider ?? "squidley-routed", adapter: this.id });
                log("error", "squidley", `[step ${step + 1}/${maxSteps}] Model call failed: ${providerError.rawMessage.slice(0, 200)}`);
                observer.recordError(`Model call failed: ${providerError.rawMessage.slice(0, 200)}`, providerError);
                exitReason = "error";
                break;
            }
            messages.push({ role: "assistant", content: response });
            // Context compression — keep conversation manageable
            const totalTokens = totalTokensIn + totalTokensOut;
            if (totalTokens > 40_000 && messages.length > 8) {
                const systemMsg = messages[0];
                const taskMsg = messages[1];
                const recentMsgs = messages.slice(-6);
                messages.length = 0;
                messages.push(systemMsg, taskMsg);
                messages.push({ role: "user", content: "Previous steps summarized to save context. Continue with the task. You were investigating and fixing a bug." });
                messages.push(...recentMsgs);
                log("info", "squidley", `[step ${step + 1}] Context compressed: ${totalTokens} tokens, kept ${messages.length} messages`);
            }
            // Time pressure warning
            const elapsedMs = Date.now() - startMs;
            if (elapsedMs > 600_000 && !messages.some(m => m.content.includes("running low on time"))) {
                messages.push({
                    role: "user",
                    content: "You are running low on time. Make your fix now and signal DONE. Do not investigate further — apply your best fix, run the tests, and complete.",
                });
                log("warn", "squidley", `[step ${step + 1}] Time pressure warning injected at ${Math.round(elapsedMs / 1000)}s`);
            }
            // Parse and execute tool calls
            const toolResult = executeToolCalls(response, input.workspace_path, observer, input.budget.max_file_edits);
            if (toolResult.done) {
                log("info", "squidley", `[step ${step + 1}/${maxSteps}] Agent signaled DONE`);
                observer.taskComplete();
                break;
            }
            if (toolResult.commandsFound === 0) {
                consecutiveNoCommand++;
                log("warn", "squidley", `[step ${step + 1}/${maxSteps}] No commands parsed (${consecutiveNoCommand} consecutive)`);
            }
            else {
                consecutiveNoCommand = 0;
                log("info", "squidley", `[step ${step + 1}/${maxSteps}] Executed ${toolResult.commandsFound} commands`);
            }
            if (consecutiveNoCommand >= 3) {
                log("warn", "squidley", `[step ${step + 1}/${maxSteps}] Re-anchoring — model not following protocol`);
                messages.push({ role: "user", content: RE_ANCHOR_MESSAGE });
                consecutiveNoCommand = 0;
            }
            else if (toolResult.feedback) {
                messages.push({ role: "user", content: toolResult.feedback });
            }
            if (step === maxSteps - 1) {
                log("warn", "squidley", `Step budget exhausted (${maxSteps} steps)`);
                observer.recordError("Step budget exceeded");
                exitReason = "budget_exceeded";
            }
        }
        const totalDuration = Date.now() - startMs;
        log("info", "squidley", `Run complete: ${exitReason} in ${Math.round(totalDuration / 1000)}s, ${observer.getStepCount()} steps, ${totalTokensIn}→${totalTokensOut} tokens`);
        return {
            exit_reason: exitReason,
            timeline: observer.getTimeline(),
            provider_error: observer.getProviderError() ?? undefined,
            duration_ms: totalDuration,
            steps_used: observer.getStepCount(),
            files_read: observer.getFilesRead(),
            files_written: observer.getFilesWritten(),
            tokens_in: totalTokensIn,
            tokens_out: totalTokensOut,
            adapter_metadata: {
                adapter_id: this.id,
                adapter_version: this.version,
                system_version: "squidley-v2",
                model: this.model,
                provider: this.provider ?? "squidley-routed",
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
// ── Squidley API call ──────────────────────────────────────────────────────
async function callSquidley(url, model, provider, messages) {
    const body = {
        messages,
        model,
        stream: false,
    };
    if (provider)
        body.provider = provider;
    const res = await fetch(`${url}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    if (!res.ok) {
        throw makeHttpProviderError(res, await res.text().catch(() => ""), { provider: provider ?? "squidley-routed", adapter: "squidley" });
    }
    const rawBody = await res.text();
    let data;
    try {
        data = JSON.parse(rawBody);
    }
    catch {
        throw makeInvalidResponseError({ provider: provider ?? "squidley-routed", adapter: "squidley" }, `Squidley returned non-JSON body: ${rawBody.slice(0, 400)}`);
    }
    // Squidley may return { text } or OpenAI-shaped { choices }
    const text = data.text ?? data.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
        throw makeEmptyResponseError({ provider: provider ?? "squidley-routed", adapter: "squidley" }, `Squidley returned empty response for model ${model}`);
    }
    return {
        text,
        tokensIn: data.tokensIn ?? 0,
        tokensOut: data.tokensOut ?? 0,
        costUsd: data.estimatedCostUsd ?? 0,
    };
}
// ── System prompt builder ──────────────────────────────────────────────────
function buildSystemPrompt(input) {
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
    lines.push("", "IMPORTANT:", "1. Read files FIRST before making any changes", "2. After fixing, run the tests to verify", "3. When tests pass and you are confident, output DONE", "4. Output commands on their own lines — do not wrap them in markdown code blocks");
    return lines.join("\n");
}
const BLOCKED_SHELL_PATTERNS = [
    /\bcurl\s+https?:/i,
    /\bwget\s+https?:/i,
    /\bnc\s+-e\b/i,
    /\/dev\/tcp\//i,
    /\brm\s+-rf\s+\//,
];
function isShellBlocked(command) {
    return BLOCKED_SHELL_PATTERNS.some(p => p.test(command));
}
function executeToolCalls(response, workspacePath, observer, maxFileEdits) {
    const feedback = [];
    let done = false;
    let fileEdits = 0;
    let commandsFound = 0;
    // ── DONE detection ───────────────────────────────────────────────────────
    const donePatterns = [
        /^DONE\s*$/m,
        /\bDONE\b/,
        /\btask\s+(is\s+)?complete\b/i,
        /\bthe\s+fix\s+is\s+complete\b/i,
        /\bi\s+have\s+(now\s+)?fixed\b/i,
        /\bfix\s+(has\s+been|is)\s+(applied|complete|done)\b/i,
        /\bfinished\b.*\btask\b/i,
    ];
    const hasWork = observer.getFilesWritten().length > 0;
    const isDone = donePatterns.some(p => p.test(response));
    if (isDone && hasWork) {
        return { done: true, feedback: "", commandsFound: 1 };
    }
    if (isDone && !hasWork) {
        log("warn", "squidley", "DONE rejected — no file changes made yet");
        return {
            done: false,
            feedback: "You have signaled DONE but have not made any changes to the codebase. You must write a fix before completing. Use WRITE_FILE to modify the file containing the bug with your fix, then run the tests to verify.",
            commandsFound: 1,
        };
    }
    // ── READ_FILE parsing ────────────────────────────────────────────────────
    const readPatterns = [
        /READ_FILE\s+[`"']?(\S+?)[`"']?\s*$/gm,
        /(?:read|cat|view|show|look at)\s+(?:the\s+)?(?:file\s+)?[`"']?(\S+\.\w+)[`"']?/gi,
        /```\s*\n\s*READ_FILE\s+(\S+)/g,
    ];
    const readPaths = new Set();
    for (const pattern of readPatterns) {
        for (const match of response.matchAll(pattern)) {
            const raw = match[1].replace(/[`"']/g, "").replace(/,$/, "");
            if (raw && (raw.includes("/") || raw.includes(".")))
                readPaths.add(raw);
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
            }
            else {
                const content = readFileSync(absPath, "utf-8");
                feedback.push(`--- ${filePath} ---\n${content}\n--- END ---`);
            }
        }
        catch (err) {
            feedback.push(`ERROR reading ${filePath}: ${String(err).slice(0, 100)}`);
        }
    }
    // ── WRITE_FILE parsing ───────────────────────────────────────────────────
    const writtenPaths = new Set();
    // Pattern A: WRITE_FILE path\ncontent\nEND_FILE
    const writeRegexA = /WRITE_FILE\s+[`"']?(\S+?)[`"']?\s*\n([\s\S]*?)END_FILE/g;
    let writeMatchA;
    while ((writeMatchA = writeRegexA.exec(response)) !== null) {
        const filePath = writeMatchA[1].replace(/[`"']/g, "");
        const content = writeMatchA[2];
        if (doWriteFile(filePath, content, workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
            fileEdits++;
            commandsFound++;
            writtenPaths.add(filePath);
        }
    }
    // Pattern B: WRITE_FILE path\ncontent (no END_FILE)
    if (writtenPaths.size === 0) {
        const writeBlockRegex = /WRITE_FILE\s+[`"']?(\S+?)[`"']?\s*\n([\s\S]*?)(?=\n\s*(?:READ_FILE|WRITE_FILE|SHELL|DONE)\b|$)/g;
        let writeMatchB;
        while ((writeMatchB = writeBlockRegex.exec(response)) !== null) {
            const filePath = writeMatchB[1].replace(/[`"']/g, "");
            const content = writeMatchB[2].trimEnd();
            if (writtenPaths.has(filePath))
                continue;
            if (!content.trim())
                continue;
            if (doWriteFile(filePath, content, workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
                fileEdits++;
                commandsFound++;
                writtenPaths.add(filePath);
            }
        }
    }
    // Pattern C: markdown code block with filename
    const codeBlockRegex = /```(?:\w+)?\s+(\S+\.\w+)\s*\n([\s\S]*?)```/g;
    let cbMatch;
    while ((cbMatch = codeBlockRegex.exec(response)) !== null) {
        const filePath = cbMatch[1];
        const content = cbMatch[2];
        if (writtenPaths.has(filePath))
            continue;
        if (!observer.getFilesWritten().includes(filePath) && filePath.includes("/")) {
            if (doWriteFile(filePath, content, workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
                fileEdits++;
                commandsFound++;
                writtenPaths.add(filePath);
            }
        }
    }
    // Pattern D: natural language + code block
    if (writtenPaths.size === 0) {
        const updatePatternRegex = /(?:updated?|fixed|corrected|modified|new)\s+(?:version\s+of\s+)?[`"']?(\S+\.\w+)[`"']?\s*:?\s*\n\s*```\w*\s*\n([\s\S]*?)```/gi;
        let upMatch;
        while ((upMatch = updatePatternRegex.exec(response)) !== null) {
            const filePath = upMatch[1].replace(/[`"':]/g, "");
            const content = upMatch[2];
            if (filePath.includes("/") && !writtenPaths.has(filePath)) {
                if (doWriteFile(filePath, content, workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
                    fileEdits++;
                    commandsFound++;
                    writtenPaths.add(filePath);
                }
            }
        }
    }
    // ── SHELL parsing ────────────────────────────────────────────────────────
    const shellPatterns = [
        /SHELL\s+(.+)/g,
        /^(?:run|execute):\s*(.+)$/gim,
        /^\$\s+(.+)$/gm,
        /```(?:bash|sh|shell)\s*\n([\s\S]*?)```/g,
    ];
    const shellCommands = new Set();
    for (const pattern of shellPatterns) {
        for (const match of response.matchAll(pattern)) {
            const cmd = match[1].trim();
            if (cmd.length > 2 && cmd.length < 200 && !cmd.startsWith("#") && !cmd.startsWith("//")) {
                if (cmd.includes("\n")) {
                    for (const line of cmd.split("\n")) {
                        const trimmed = line.trim();
                        if (trimmed && !trimmed.startsWith("#"))
                            shellCommands.add(trimmed);
                    }
                }
                else {
                    shellCommands.add(cmd);
                }
            }
        }
    }
    for (const command of shellCommands) {
        if (isShellBlocked(command)) {
            observer.recordError(`Blocked command: ${command}`);
            feedback.push(`ERROR: Command blocked for security: ${command}`);
            continue;
        }
        commandsFound++;
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
        }
        catch (err) {
            const exitCode = err.status ?? 1;
            const stderr = err.stderr ?? "";
            const stdout = err.stdout ?? "";
            const output = (stderr || stdout || String(err)).slice(0, 1000);
            observer.shell(command, exitCode);
            feedback.push(`$ ${command}\nExit code: ${exitCode}\n${output}`);
        }
    }
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
const ARTIFACT_PATTERNS = [
    /<\|[^|]*\|>/g,
    /<channel[^>]*>/g,
];
function stripModelArtifacts(text) {
    let cleaned = text;
    for (const pattern of ARTIFACT_PATTERNS) {
        cleaned = cleaned.replace(pattern, "");
    }
    return cleaned;
}
// ── Markdown fence stripping ───────────────────────────────────────────────
function stripMarkdownFences(content) {
    const lines = content.split("\n");
    let start = 0;
    let end = lines.length;
    if (lines.length > 0 && /^\s*```\w*\s*$/.test(lines[0]))
        start = 1;
    if (end > start && /^\s*```\s*$/.test(lines[end - 1]))
        end = end - 1;
    return lines.slice(start, end).join("\n");
}
// ── File write helper ──────────────────────────────────────────────────────
function doWriteFile(filePath, rawContent, workspacePath, observer, feedback, maxFileEdits, currentEdits) {
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
    const content = stripMarkdownFences(rawContent);
    observer.fileWrite(filePath);
    try {
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, content, "utf-8");
        feedback.push(`WRITTEN: ${filePath}`);
        log("info", "squidley", `WRITE_FILE ${filePath}: SUCCESS (${Buffer.byteLength(content, "utf-8")} bytes)`);
        return true;
    }
    catch (err) {
        feedback.push(`ERROR writing ${filePath}: ${String(err).slice(0, 150)}`);
        return false;
    }
}
//# sourceMappingURL=squidley.js.map