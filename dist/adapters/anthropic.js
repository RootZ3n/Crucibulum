/**
 * Crucibulum — Anthropic Direct Adapter
 * Direct Anthropic Messages API integration.
 * Supports: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
 *
 * CLI: --adapter anthropic --model claude-opus-4-6
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Observer } from "../core/observer.js";
import { log } from "../utils/logger.js";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const MODEL_TIMEOUT_MS = 300_000;
const HEALTH_TIMEOUT_MS = 10_000;
export class AnthropicAdapter {
    id = "anthropic";
    name = "Anthropic Direct";
    version = "1.0.0";
    model = "claude-sonnet-4-6";
    apiKey = "";
    supports(_family) {
        return true;
    }
    supportsToolCalls() {
        return true;
    }
    supportsChat() {
        return false;
    }
    async init(config) {
        const c = config;
        if (c.model)
            this.model = c.model;
        this.apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
    }
    async healthCheck() {
        if (!this.apiKey)
            return { ok: false, reason: "ANTHROPIC_API_KEY not set" };
        try {
            const res = await fetch(`${ANTHROPIC_BASE}/models`, {
                headers: {
                    "x-api-key": this.apiKey,
                    "anthropic-version": "2023-06-01",
                },
                signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
            });
            if (res.status === 401)
                return { ok: false, reason: "ANTHROPIC_API_KEY invalid (401)" };
            if (!res.ok)
                return { ok: false, reason: `Anthropic returned ${res.status}` };
            return { ok: true };
        }
        catch (err) {
            return { ok: false, reason: `Anthropic unreachable: ${String(err).slice(0, 100)}` };
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
                log("warn", "anthropic", `[step ${step + 1}/${maxSteps}] Time budget exceeded`);
                observer.recordError("Time budget exceeded");
                exitReason = "timeout";
                break;
            }
            log("info", "anthropic", `[step ${step + 1}/${maxSteps}] Calling ${this.model}...`);
            let response;
            try {
                const result = await callAnthropic(this.apiKey, this.model, systemPrompt, messages);
                response = result.text;
                totalTokensIn += result.tokensIn;
                totalTokensOut += result.tokensOut;
                log("info", "anthropic", `[step ${step + 1}/${maxSteps}] Response (${response.length} chars, ${result.tokensOut} tok)`);
            }
            catch (err) {
                log("error", "anthropic", `[step ${step + 1}/${maxSteps}] Model call failed: ${String(err).slice(0, 200)}`);
                observer.recordError(`Model call failed: ${String(err).slice(0, 200)}`);
                exitReason = "error";
                break;
            }
            messages.push({ role: "assistant", content: response });
            // Context compression
            const totalTokens = totalTokensIn + totalTokensOut;
            if (totalTokens > 80_000 && messages.length > 8) {
                const taskMsg = messages[0];
                const recentMsgs = messages.slice(-6);
                messages.length = 0;
                messages.push(taskMsg);
                messages.push({ role: "user", content: "Previous steps summarized to save context. Continue with the task." });
                messages.push(...recentMsgs);
                log("info", "anthropic", `[step ${step + 1}] Context compressed`);
            }
            // Time pressure
            const elapsedMs = Date.now() - startMs;
            if (elapsedMs > 600_000 && !messages.some(m => m.content.includes("running low on time"))) {
                messages.push({
                    role: "user",
                    content: "You are running low on time. Make your fix now and signal DONE.",
                });
            }
            const toolResult = executeToolCalls(response, input.workspace_path, observer, input.budget.max_file_edits);
            if (toolResult.done) {
                log("info", "anthropic", `[step ${step + 1}/${maxSteps}] Agent signaled DONE`);
                observer.taskComplete();
                break;
            }
            if (toolResult.commandsFound === 0) {
                consecutiveNoCommand++;
            }
            else {
                consecutiveNoCommand = 0;
            }
            if (consecutiveNoCommand >= 3) {
                messages.push({ role: "user", content: RE_ANCHOR_MESSAGE });
                consecutiveNoCommand = 0;
            }
            else if (toolResult.feedback) {
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
            duration_ms: Date.now() - startMs,
            steps_used: observer.getStepCount(),
            files_read: observer.getFilesRead(),
            files_written: observer.getFilesWritten(),
            tokens_in: totalTokensIn,
            tokens_out: totalTokensOut,
            adapter_metadata: {
                adapter_id: this.id,
                adapter_version: this.version,
                system_version: "anthropic-api",
                model: this.model,
                provider: "anthropic",
            },
        };
    }
}
// ── Anthropic API call ─────────────────────────────────────────────────────
async function callAnthropic(apiKey, model, system, messages) {
    const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
        method: "POST",
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        body: JSON.stringify({
            model,
            max_tokens: 8192,
            system,
            messages,
        }),
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    if (!res.ok) {
        throw new Error(`Anthropic returned ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const data = (await res.json());
    const text = data.content?.find(b => b.type === "text")?.text ?? "";
    return {
        text,
        tokensIn: data.usage?.input_tokens ?? 0,
        tokensOut: data.usage?.output_tokens ?? 0,
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
        "Rules:",
        `- You have ${input.budget.time_limit_sec} seconds and ${input.budget.max_steps} steps`,
        `- You can edit up to ${input.budget.max_file_edits} files`,
        `- Allowed tools: ${input.task.constraints.allowed_tools.join(", ")}`,
        input.task.constraints.network_allowed ? "- Network access is allowed" : "- Network access is NOT allowed",
    ];
    if (input.task.verification.public_tests_command)
        lines.push(`- Run tests with: ${input.task.verification.public_tests_command}`);
    if (input.task.verification.build_command)
        lines.push(`- Build with: ${input.task.verification.build_command}`);
    lines.push("", "IMPORTANT:", "1. Read files FIRST before making any changes", "2. After fixing, run the tests to verify", "3. When tests pass and you are confident, output DONE", "4. Output commands on their own lines — do not wrap them in markdown code blocks");
    return lines.join("\n");
}
const BLOCKED_SHELL_PATTERNS = [
    /\bcurl\s+https?:/i, /\bwget\s+https?:/i, /\bnc\s+-e\b/i, /\/dev\/tcp\//i, /\brm\s+-rf\s+\//,
];
function executeToolCalls(response, workspacePath, observer, maxFileEdits) {
    const feedback = [];
    let fileEdits = 0;
    let commandsFound = 0;
    // DONE detection
    const donePatterns = [/^DONE\s*$/m, /\bDONE\b/, /\btask\s+(is\s+)?complete\b/i, /\bthe\s+fix\s+is\s+complete\b/i, /\bfix\s+(has\s+been|is)\s+(applied|complete|done)\b/i];
    const hasWork = observer.getFilesWritten().length > 0;
    const isDone = donePatterns.some(p => p.test(response));
    if (isDone && hasWork)
        return { done: true, feedback: "", commandsFound: 1 };
    if (isDone && !hasWork)
        return { done: false, feedback: "You have signaled DONE but have not made any changes. Use WRITE_FILE to fix the bug first.", commandsFound: 1 };
    // READ_FILE
    const readPaths = new Set();
    for (const m of response.matchAll(/READ_FILE\s+[`"']?(\S+?)[`"']?\s*$/gm)) {
        const raw = m[1].replace(/[`"']/g, "").replace(/,$/, "");
        if (raw && (raw.includes("/") || raw.includes(".")))
            readPaths.add(raw);
    }
    for (const filePath of readPaths) {
        const absPath = resolve(workspacePath, filePath);
        if (!absPath.startsWith(resolve(workspacePath))) {
            observer.recordError(`Path escape: ${filePath}`);
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
                feedback.push(`--- ${filePath} ---\n${readFileSync(absPath, "utf-8")}\n--- END ---`);
            }
        }
        catch (err) {
            feedback.push(`ERROR reading ${filePath}: ${String(err).slice(0, 100)}`);
        }
    }
    // WRITE_FILE
    const writtenPaths = new Set();
    for (const m of response.matchAll(/WRITE_FILE\s+[`"']?(\S+?)[`"']?\s*\n([\s\S]*?)END_FILE/g)) {
        const filePath = m[1].replace(/[`"']/g, "");
        if (writeFile(filePath, m[2], workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
            fileEdits++;
            commandsFound++;
            writtenPaths.add(filePath);
        }
    }
    if (writtenPaths.size === 0) {
        for (const m of response.matchAll(/WRITE_FILE\s+[`"']?(\S+?)[`"']?\s*\n([\s\S]*?)(?=\n\s*(?:READ_FILE|WRITE_FILE|SHELL|DONE)\b|$)/g)) {
            const filePath = m[1].replace(/[`"']/g, "");
            const content = m[2].trimEnd();
            if (!writtenPaths.has(filePath) && content.trim()) {
                if (writeFile(filePath, content, workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
                    fileEdits++;
                    commandsFound++;
                    writtenPaths.add(filePath);
                }
            }
        }
    }
    for (const m of response.matchAll(/```(?:\w+)?\s+(\S+\.\w+)\s*\n([\s\S]*?)```/g)) {
        const filePath = m[1];
        if (!writtenPaths.has(filePath) && filePath.includes("/")) {
            if (writeFile(filePath, m[2], workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
                fileEdits++;
                commandsFound++;
                writtenPaths.add(filePath);
            }
        }
    }
    // SHELL
    const shellCommands = new Set();
    for (const m of response.matchAll(/SHELL\s+(.+)/g)) {
        const cmd = m[1].trim();
        if (cmd.length > 2 && cmd.length < 200)
            shellCommands.add(cmd);
    }
    for (const m of response.matchAll(/```(?:bash|sh|shell)\s*\n([\s\S]*?)```/g)) {
        for (const line of m[1].split("\n")) {
            const t = line.trim();
            if (t && !t.startsWith("#") && t.length > 2)
                shellCommands.add(t);
        }
    }
    for (const command of shellCommands) {
        if (BLOCKED_SHELL_PATTERNS.some(p => p.test(command))) {
            observer.recordError(`Blocked: ${command}`);
            feedback.push(`ERROR: Command blocked: ${command}`);
            continue;
        }
        commandsFound++;
        try {
            const output = execSync(command, { cwd: workspacePath, encoding: "utf-8", timeout: 30_000, maxBuffer: 1024 * 1024 });
            observer.shell(command, 0);
            feedback.push(`$ ${command}\n${output.length > 2000 ? output.slice(0, 2000) + "\n[truncated]" : output}`);
        }
        catch (err) {
            const exitCode = err.status ?? 1;
            const out = (err.stderr || err.stdout || String(err)).slice(0, 1000);
            observer.shell(command, exitCode);
            feedback.push(`$ ${command}\nExit code: ${exitCode}\n${out}`);
        }
    }
    if (commandsFound === 0)
        return { done: false, feedback: "No commands detected. Use: READ_FILE <path> / WRITE_FILE <path>\\n<content>\\nEND_FILE / SHELL <cmd> / DONE", commandsFound: 0 };
    return { done: false, feedback: feedback.join("\n\n"), commandsFound };
}
function stripMarkdownFences(content) {
    const lines = content.split("\n");
    let start = 0, end = lines.length;
    if (lines.length > 0 && /^\s*```\w*\s*$/.test(lines[0]))
        start = 1;
    if (end > start && /^\s*```\s*$/.test(lines[end - 1]))
        end = end - 1;
    return lines.slice(start, end).join("\n");
}
function writeFile(filePath, rawContent, workspacePath, observer, feedback, maxEdits, currentEdits) {
    const absPath = resolve(workspacePath, filePath);
    if (!absPath.startsWith(resolve(workspacePath))) {
        observer.recordError(`Path escape: ${filePath}`);
        feedback.push(`ERROR: ${filePath} outside workspace`);
        return false;
    }
    if (currentEdits >= maxEdits) {
        feedback.push(`ERROR: Max file edits (${maxEdits}) reached`);
        return false;
    }
    const content = stripMarkdownFences(rawContent);
    observer.fileWrite(filePath);
    try {
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, content, "utf-8");
        feedback.push(`WRITTEN: ${filePath}`);
        return true;
    }
    catch (err) {
        feedback.push(`ERROR writing ${filePath}: ${String(err).slice(0, 150)}`);
        return false;
    }
}
//# sourceMappingURL=anthropic.js.map