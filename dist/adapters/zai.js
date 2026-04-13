/**
 * Crucibulum — Z.AI Direct Adapter (GLM / Zhipu)
 * Direct BigModel API integration (OpenAI-compatible).
 * Supported: glm-4-plus, glm-5.1, glm-z1-flash, glm-4-air
 *
 * CLI: --adapter zai --model glm-4-plus
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Observer } from "../core/observer.js";
import { log } from "../utils/logger.js";
const ZAI_BASE = "https://open.bigmodel.cn/api/paas/v4";
const MODEL_TIMEOUT_MS = 300_000;
const HEALTH_TIMEOUT_MS = 10_000;
export class ZAIAdapter {
    id = "zai";
    name = "Z.AI Direct (GLM)";
    version = "1.0.0";
    model = "glm-4-plus";
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
        this.apiKey = process.env["ZAI_API_KEY"] ?? "";
    }
    async healthCheck() {
        if (!this.apiKey)
            return { ok: false, reason: "ZAI_API_KEY not set" };
        try {
            const res = await fetch(`${ZAI_BASE}/models`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
            });
            if (res.status === 401)
                return { ok: false, reason: "ZAI_API_KEY invalid (401)" };
            if (!res.ok)
                return { ok: false, reason: `Z.AI returned ${res.status}` };
            return { ok: true };
        }
        catch (err) {
            return { ok: false, reason: `Z.AI unreachable: ${String(err).slice(0, 100)}` };
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
                content: `Your task:\n${input.task.task.title}\n\n${input.task.task.description}\n\nEntrypoints to investigate: ${input.task.task.entrypoints.join(", ")}\n\nStart by reading the entrypoint files to understand the code.`,
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
            log("info", "zai", `[step ${step + 1}/${maxSteps}] Calling ${this.model}...`);
            let response;
            try {
                const result = await callZAI(this.apiKey, this.model, messages);
                response = result.text;
                totalTokensIn += result.tokensIn;
                totalTokensOut += result.tokensOut;
                log("info", "zai", `[step ${step + 1}/${maxSteps}] Response (${response.length} chars, ${result.tokensOut} tok)`);
            }
            catch (err) {
                log("error", "zai", `[step ${step + 1}/${maxSteps}] Model call failed: ${String(err).slice(0, 200)}`);
                observer.recordError(`Model call failed: ${String(err).slice(0, 200)}`);
                exitReason = "error";
                break;
            }
            messages.push({ role: "assistant", content: response });
            if ((totalTokensIn + totalTokensOut) > 40_000 && messages.length > 8) {
                const sysMsg = messages[0];
                const taskMsg = messages[1];
                const recent = messages.slice(-6);
                messages.length = 0;
                messages.push(sysMsg, taskMsg, { role: "user", content: "Previous steps summarized. Continue fixing the bug." }, ...recent);
            }
            if ((Date.now() - startMs) > 600_000 && !messages.some(m => m.content.includes("running low on time"))) {
                messages.push({ role: "user", content: "You are running low on time. Make your fix now and signal DONE." });
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
                system_version: "zai-api",
                model: this.model,
                provider: "zai",
            },
        };
    }
}
// ── Z.AI API call ──────────────────────────────────────────────────────────
const ZAI_MAX_RETRIES = 2;
async function callZAI(apiKey, model, messages) {
    let lastError = null;
    for (let attempt = 0; attempt <= ZAI_MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            log("warn", "zai", `Z.AI empty/failed response on attempt ${attempt}, retrying (${attempt}/${ZAI_MAX_RETRIES})…`);
            await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
        const res = await fetch(`${ZAI_BASE}/chat/completions`, {
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
        if (!res.ok) {
            lastError = new Error(`Z.AI returned ${res.status}: ${await res.text().catch(() => "")}`);
            continue;
        }
        const data = (await res.json());
        const text = data.choices?.[0]?.message?.content ?? "";
        if (!text && attempt < ZAI_MAX_RETRIES) {
            log("warn", "zai", `Z.AI returned empty content for model ${model}, will retry`);
            lastError = new Error(`Z.AI returned empty response for model ${model}`);
            continue;
        }
        if (!text) {
            log("warn", "zai", `Z.AI returned empty content for model ${model} after ${ZAI_MAX_RETRIES + 1} attempts`);
        }
        return {
            text,
            tokensIn: data.usage?.prompt_tokens ?? 0,
            tokensOut: data.usage?.completion_tokens ?? 0,
        };
    }
    throw lastError ?? new Error(`Z.AI call failed after ${ZAI_MAX_RETRIES + 1} attempts`);
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
    let fileEdits = 0, commandsFound = 0;
    const donePatterns = [/^DONE\s*$/m, /\bDONE\b/, /\btask\s+(is\s+)?complete\b/i, /\bthe\s+fix\s+is\s+complete\b/i, /\bfix\s+(has\s+been|is)\s+(applied|complete|done)\b/i];
    const hasWork = observer.getFilesWritten().length > 0;
    if (donePatterns.some(p => p.test(response)) && hasWork)
        return { done: true, feedback: "", commandsFound: 1 };
    if (donePatterns.some(p => p.test(response)) && !hasWork)
        return { done: false, feedback: "You have signaled DONE but have not made any changes. Use WRITE_FILE to fix the bug first.", commandsFound: 1 };
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
            if (!existsSync(absPath))
                feedback.push(`FILE NOT FOUND: ${filePath}`);
            else
                feedback.push(`--- ${filePath} ---\n${readFileSync(absPath, "utf-8")}\n--- END ---`);
        }
        catch (err) {
            feedback.push(`ERROR reading ${filePath}: ${String(err).slice(0, 100)}`);
        }
    }
    const writtenPaths = new Set();
    for (const m of response.matchAll(/WRITE_FILE\s+[`"']?(\S+?)[`"']?\s*\n([\s\S]*?)END_FILE/g)) {
        const fp = m[1].replace(/[`"']/g, "");
        if (doWrite(fp, m[2], workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
            fileEdits++;
            commandsFound++;
            writtenPaths.add(fp);
        }
    }
    if (writtenPaths.size === 0) {
        for (const m of response.matchAll(/WRITE_FILE\s+[`"']?(\S+?)[`"']?\s*\n([\s\S]*?)(?=\n\s*(?:READ_FILE|WRITE_FILE|SHELL|DONE)\b|$)/g)) {
            const fp = m[1].replace(/[`"']/g, "");
            const c = m[2].trimEnd();
            if (!writtenPaths.has(fp) && c.trim() && doWrite(fp, c, workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
                fileEdits++;
                commandsFound++;
                writtenPaths.add(fp);
            }
        }
    }
    for (const m of response.matchAll(/```(?:\w+)?\s+(\S+\.\w+)\s*\n([\s\S]*?)```/g)) {
        const fp = m[1];
        if (!writtenPaths.has(fp) && fp.includes("/") && doWrite(fp, m[2], workspacePath, observer, feedback, maxFileEdits, fileEdits)) {
            fileEdits++;
            commandsFound++;
            writtenPaths.add(fp);
        }
    }
    const shellCmds = new Set();
    for (const m of response.matchAll(/SHELL\s+(.+)/g)) {
        const c = m[1].trim();
        if (c.length > 2 && c.length < 200)
            shellCmds.add(c);
    }
    for (const m of response.matchAll(/```(?:bash|sh|shell)\s*\n([\s\S]*?)```/g)) {
        for (const line of m[1].split("\n")) {
            const t = line.trim();
            if (t && !t.startsWith("#") && t.length > 2)
                shellCmds.add(t);
        }
    }
    for (const cmd of shellCmds) {
        if (BLOCKED_SHELL_PATTERNS.some(p => p.test(cmd))) {
            observer.recordError(`Blocked: ${cmd}`);
            feedback.push(`ERROR: Command blocked: ${cmd}`);
            continue;
        }
        commandsFound++;
        try {
            const out = execSync(cmd, { cwd: workspacePath, encoding: "utf-8", timeout: 30_000, maxBuffer: 1024 * 1024 });
            observer.shell(cmd, 0);
            feedback.push(`$ ${cmd}\n${out.length > 2000 ? out.slice(0, 2000) + "\n[truncated]" : out}`);
        }
        catch (err) {
            const ec = err.status ?? 1;
            observer.shell(cmd, ec);
            feedback.push(`$ ${cmd}\nExit code: ${ec}\n${(err.stderr || err.stdout || String(err)).slice(0, 1000)}`);
        }
    }
    if (commandsFound === 0)
        return { done: false, feedback: "No commands detected. Use: READ_FILE <path> / WRITE_FILE <path>\\n<content>\\nEND_FILE / SHELL <cmd> / DONE", commandsFound: 0 };
    return { done: false, feedback: feedback.join("\n\n"), commandsFound };
}
function stripMarkdownFences(c) {
    const l = c.split("\n");
    let s = 0, e = l.length;
    if (l.length > 0 && /^\s*```\w*\s*$/.test(l[0]))
        s = 1;
    if (e > s && /^\s*```\s*$/.test(l[e - 1]))
        e--;
    return l.slice(s, e).join("\n");
}
function doWrite(fp, raw, ws, obs, fb, max, cur) {
    const abs = resolve(ws, fp);
    if (!abs.startsWith(resolve(ws))) {
        obs.recordError(`Path escape: ${fp}`);
        fb.push(`ERROR: ${fp} outside workspace`);
        return false;
    }
    if (cur >= max) {
        fb.push(`ERROR: Max file edits (${max}) reached`);
        return false;
    }
    obs.fileWrite(fp);
    try {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, stripMarkdownFences(raw), "utf-8");
        fb.push(`WRITTEN: ${fp}`);
        return true;
    }
    catch (err) {
        fb.push(`ERROR writing ${fp}: ${String(err).slice(0, 150)}`);
        return false;
    }
}
//# sourceMappingURL=zai.js.map