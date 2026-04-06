/**
 * Crucibulum — OpenAI-compatible Adapter
 * Agentic loop over any OpenAI chat-completions-compatible API.
 * Used for OpenRouter, OpenAI, and any compatible endpoint.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Observer } from "../core/observer.js";
import { log } from "../utils/logger.js";
const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MODEL_TIMEOUT_MS = 120_000; // 2 min for cloud models (faster than local)
export class OpenRouterAdapter {
    id;
    name;
    version = "1.0.0";
    baseUrl;
    apiKeyEnv;
    apiKey;
    model;
    constructor(opts) {
        this.id = opts?.id ?? "openrouter";
        this.name = opts?.name ?? "OpenRouter";
        this.baseUrl = opts?.baseUrl ?? DEFAULT_OPENROUTER_BASE;
        this.apiKeyEnv = opts?.apiKeyEnv ?? "OPENROUTER_API_KEY";
        this.apiKey = process.env[this.apiKeyEnv] ?? "";
        this.model = opts?.defaultModel ?? "arcee-ai/trinity-large-thinking";
    }
    supports(_family) {
        return true;
    }
    supportsToolCalls() {
        return true;
    }
    async init(config) {
        const c = config;
        if (c.api_key)
            this.apiKey = c.api_key;
        if (c.model)
            this.model = c.model;
        if (c.base_url)
            this.baseUrl = c.base_url;
        if (!this.apiKey) {
            log("warn", this.id, `No API key set — set ${this.apiKeyEnv}`);
        }
    }
    async healthCheck() {
        if (!this.apiKey)
            return { ok: false, reason: `${this.apiKeyEnv} not configured` };
        try {
            const res = await fetch(`${this.baseUrl}/models`, {
                headers: { "Authorization": `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(10000),
            });
            return res.ok ? { ok: true } : { ok: false, reason: `${this.name} returned ${res.status}` };
        }
        catch (err) {
            return { ok: false, reason: `${this.name} unreachable: ${String(err).slice(0, 100)}` };
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
            let response;
            try {
                const result = await this.callAPI(messages);
                response = stripModelArtifacts(result.text);
                totalTokensIn += result.tokensIn;
                totalTokensOut += result.tokensOut;
                log("info", this.id, `[step ${step + 1}] Response (${response.length} chars): ${response.slice(0, 300).replace(/\n/g, "\\n")}${response.length > 300 ? "..." : ""}`);
            }
            catch (err) {
                log("error", this.id, `Model call failed: ${String(err).slice(0, 200)}`);
                observer.recordError(`Model call failed: ${String(err).slice(0, 200)}`);
                exitReason = "error";
                break;
            }
            messages.push({ role: "assistant", content: response });
            // Context compression after 20k tokens
            if (totalTokensIn + totalTokensOut > 20000 && messages.length > 8) {
                const sys = messages[0];
                const task = messages[1];
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
                system_version: `${this.id}-v1`,
                model: this.model,
                provider: this.id,
            },
        };
    }
    async callAPI(messages) {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://crucibulum.local",
                "X-Title": "Crucibulum",
            },
            body: JSON.stringify({
                model: this.model,
                messages,
                max_tokens: 8192,
                temperature: 0.1,
                stream: false,
            }),
            signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        });
        if (!res.ok)
            throw new Error(`${this.name} ${res.status}: ${await res.text().catch(() => "")}`);
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content ?? "";
        // Retry once on empty
        if (!text.trim()) {
            log("warn", this.id, "Empty response, retrying...");
            await new Promise(r => setTimeout(r, 1500));
            const retry = await fetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://crucibulum.local",
                    "X-Title": "Crucibulum",
                },
                body: JSON.stringify({ model: this.model, messages, max_tokens: 8192, temperature: 0.2, stream: false }),
                signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
            });
            if (retry.ok) {
                const retryData = await retry.json();
                const retryText = retryData.choices?.[0]?.message?.content ?? "";
                if (retryText.trim()) {
                    return {
                        text: retryText,
                        tokensIn: (data.usage?.prompt_tokens ?? 0) + (retryData.usage?.prompt_tokens ?? 0),
                        tokensOut: (data.usage?.completion_tokens ?? 0) + (retryData.usage?.completion_tokens ?? 0),
                    };
                }
            }
        }
        return {
            text,
            tokensIn: data.usage?.prompt_tokens ?? 0,
            tokensOut: data.usage?.completion_tokens ?? 0,
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
// ── System prompt builder ────────────────────────────────────────────────────
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
// Blocked shell patterns — network exfiltration and destructive ops
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
    const readPaths = new Set();
    for (const pattern of readPatterns) {
        for (const match of response.matchAll(pattern)) {
            const raw = match[1].replace(/[`"']/g, "").replace(/,$/, "");
            if (raw && raw.includes("/") || raw.includes("."))
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
                log("debug", "chatloop", `READ_FILE ${filePath}: not found`);
            }
            else {
                const content = readFileSync(absPath, "utf-8");
                feedback.push(`--- ${filePath} ---\n${content}\n--- END ---`);
                log("debug", "chatloop", `READ_FILE ${filePath}: ${content.length} chars`);
            }
        }
        catch (err) {
            feedback.push(`ERROR reading ${filePath}: ${String(err).slice(0, 100)}`);
        }
    }
    // ── WRITE_FILE parsing (multi-pattern, most specific first) ────────────────
    const writtenPaths = new Set();
    // Pattern A: WRITE_FILE path\ncontent\nEND_FILE (strict — try first)
    const writeRegexA = /WRITE_FILE\s+[`"']?(\S+?)[`"']?\s*\n([\s\S]*?)END_FILE/g;
    let writeMatchA;
    while ((writeMatchA = writeRegexA.exec(response)) !== null) {
        const filePath = writeMatchA[1].replace(/[`"']/g, "");
        const content = writeMatchA[2];
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
            const filePath = writeMatchB[1].replace(/[`"']/g, "");
            const content = writeMatchB[2].trimEnd();
            if (writtenPaths.has(filePath))
                continue;
            // Skip if content is empty or just whitespace
            if (!content.trim())
                continue;
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
        const filePath = cbMatch[1];
        const content = cbMatch[2];
        if (writtenPaths.has(filePath))
            continue;
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
            const filePath = upMatch[1].replace(/[`"':]/g, "");
            const content = upMatch[2];
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
    const shellCommands = new Set();
    for (const pattern of shellPatterns) {
        for (const match of response.matchAll(pattern)) {
            const cmd = match[1].trim();
            // Filter out non-command strings (too short, markdown artifacts)
            if (cmd.length > 2 && cmd.length < 200 && !cmd.startsWith("#") && !cmd.startsWith("//")) {
                // For multi-line bash blocks, take each line
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
        }
        catch (err) {
            const exitCode = err.status ?? 1;
            const stderr = err.stderr ?? "";
            const stdout = err.stdout ?? "";
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
const ARTIFACT_PATTERNS = [
    /<\|[^|]*\|>/g, // <|endoftext|>, <|im_end|>, <|eot_id|>, etc.
    /<channel[^>]*>/g, // <channel|>, <channel>, etc.
];
function stripModelArtifacts(text) {
    let cleaned = text;
    let found = false;
    for (const pattern of ARTIFACT_PATTERNS) {
        if (pattern.test(cleaned))
            found = true;
        cleaned = cleaned.replace(pattern, "");
    }
    if (found) {
        log("debug", "chatloop", "Stripped model artifacts from response");
    }
    return cleaned;
}
// ── Markdown fence stripping ───────────────────────────────────────────────
function stripMarkdownFences(content) {
    const lines = content.split("\n");
    let start = 0;
    let end = lines.length;
    // Strip leading fence: ```lang or ```
    if (lines.length > 0 && /^\s*```\w*\s*$/.test(lines[0])) {
        start = 1;
    }
    // Strip trailing fence: ```
    if (end > start && /^\s*```\s*$/.test(lines[end - 1])) {
        end = end - 1;
    }
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
    }
    catch (err) {
        const reason = String(err).slice(0, 150);
        feedback.push(`ERROR writing ${filePath}: ${reason}`);
        log("error", "chatloop", `WRITE_FILE ${filePath}: FAILED — ${reason}`);
        return false;
    }
}
//# sourceMappingURL=openrouter.js.map