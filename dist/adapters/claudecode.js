/**
 * Crucibulum — Claude Code Adapter
 * Invokes the Claude Code CLI binary to solve tasks.
 * Uses --print mode for non-interactive execution.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Observer } from "../core/observer.js";
import { log } from "../utils/logger.js";
export class ClaudeCodeAdapter {
    id = "claudecode";
    name = "Claude Code";
    version = "1.0.0";
    binaryPath = process.env["CLAUDE_CODE_BINARY"] ?? "claude";
    model = null;
    binaryHash = "";
    supports(_family) { return true; }
    supportsToolCalls() { return true; }
    supportsChat() {
        return false;
    }
    async init(config) {
        const c = config;
        if (c.binary_path)
            this.binaryPath = c.binary_path;
        if (c.model)
            this.model = c.model;
        // Hash binary for identity verification
        try {
            if (existsSync(this.binaryPath)) {
                const content = readFileSync(this.binaryPath);
                this.binaryHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
            }
        }
        catch { /* best effort */ }
    }
    async healthCheck() {
        return new Promise((resolve) => {
            try {
                const proc = spawn(this.binaryPath, ["--version"], { timeout: 15000, stdio: ["pipe", "pipe", "pipe"] });
                let output = "";
                proc.stdout.on("data", (d) => { output += d.toString(); });
                proc.stderr.on("data", (d) => { output += d.toString(); });
                proc.on("close", (code) => {
                    if (code === 0)
                        resolve({ ok: true });
                    else
                        resolve({ ok: false, reason: `claude --version exited ${code}: ${output.slice(0, 100)}` });
                });
                proc.on("error", (err) => {
                    resolve({ ok: false, reason: `Cannot spawn claude: ${err.message}` });
                });
            }
            catch (err) {
                resolve({ ok: false, reason: `Claude Code check failed: ${String(err).slice(0, 100)}` });
            }
        });
    }
    async teardown() { }
    async execute(input) {
        const observer = new Observer();
        observer.taskStart();
        const startMs = Date.now();
        let exitReason = "complete";
        // Snapshot workspace before
        const beforeFiles = this.snapshotFiles(input.workspace_path);
        // Build the prompt
        const prompt = [
            input.task.task.title,
            "",
            input.task.task.description,
            "",
            `Files to investigate: ${input.task.task.entrypoints.join(", ")}`,
            input.task.verification.public_tests_command ? `Run tests with: ${input.task.verification.public_tests_command}` : "",
            "",
            "Fix the bug. Run tests to verify your fix. Do not modify test files.",
        ].filter(Boolean).join("\n");
        // Build claude args
        const args = ["--print"];
        if (this.model)
            args.push("--model", this.model);
        args.push(prompt);
        log("info", "claudecode", `Executing: claude ${args.slice(0, 3).join(" ")}...`);
        log("info", "claudecode", `Workspace: ${input.workspace_path}`);
        // Spawn Claude Code
        const result = await new Promise((resolveResult) => {
            const proc = spawn(this.binaryPath, args, {
                cwd: input.workspace_path,
                timeout: input.budget.time_limit_sec * 1000,
                stdio: ["pipe", "pipe", "pipe"],
                env: { ...process.env },
            });
            let stdout = "";
            let stderr = "";
            proc.stdout.on("data", (data) => {
                const chunk = data.toString();
                stdout += chunk;
                this.parseOutput(chunk, observer);
            });
            proc.stderr.on("data", (data) => {
                stderr += data.toString();
            });
            proc.on("close", (code) => {
                resolveResult({ stdout, stderr, exitCode: code ?? 1 });
            });
            proc.on("error", (err) => {
                resolveResult({ stdout, stderr: stderr + "\n" + err.message, exitCode: 1 });
            });
        });
        if (result.exitCode !== 0) {
            if (Date.now() - startMs > input.budget.time_limit_sec * 1000) {
                exitReason = "timeout";
                observer.recordError("Claude Code timed out");
            }
            else {
                exitReason = "error";
                observer.recordError(`Claude Code exited with code ${result.exitCode}`);
            }
        }
        // Detect file changes
        const afterFiles = this.snapshotFiles(input.workspace_path);
        this.detectChanges(beforeFiles, afterFiles, observer);
        observer.taskComplete(exitReason === "complete" ? "Claude Code finished" : `Claude Code: ${exitReason}`);
        // Get version
        let systemVersion = "unknown";
        try {
            const { execSync } = await import("node:child_process");
            systemVersion = execSync(`${this.binaryPath} --version`, { encoding: "utf-8", timeout: 5000 }).trim().split("\n")[0] ?? "unknown";
        }
        catch { /* use default */ }
        log("info", "claudecode", `Completed: ${exitReason} in ${Math.round((Date.now() - startMs) / 1000)}s`);
        return {
            exit_reason: exitReason,
            timeline: observer.getTimeline(),
            duration_ms: Date.now() - startMs,
            steps_used: observer.getStepCount(),
            files_read: observer.getFilesRead(),
            files_written: observer.getFilesWritten(),
            adapter_metadata: {
                adapter_id: this.id,
                adapter_version: this.version,
                system_version: systemVersion,
                model: this.model ?? "default",
                provider: "claudecode",
            },
        };
    }
    parseOutput(chunk, observer) {
        for (const line of chunk.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            // Detect file operations from Claude Code output
            const readMatch = trimmed.match(/(?:Read|Reading|read)\s+(\S+\.\w+)/i);
            if (readMatch) {
                observer.fileRead(readMatch[1]);
                continue;
            }
            const writeMatch = trimmed.match(/(?:Wrote|Writing|Updated|Created)\s+(\S+\.\w+)/i);
            if (writeMatch) {
                observer.fileWrite(writeMatch[1]);
                continue;
            }
            const shellMatch = trimmed.match(/(?:Running|Ran|Executing|→)\s+[`]?(.+?)[`]?\s*$/i);
            if (shellMatch && shellMatch[1].length < 200) {
                const exitMatch = trimmed.match(/exit(?:\s*code)?\s*:?\s*(\d+)/i);
                observer.shell(shellMatch[1], exitMatch ? parseInt(exitMatch[1], 10) : 0);
            }
        }
    }
    snapshotFiles(dir, prefix = "") {
        const files = new Map();
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const fullPath = join(dir, entry.name);
                const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.name === ".git" || entry.name === "node_modules")
                    continue;
                if (entry.isDirectory()) {
                    for (const [k, v] of this.snapshotFiles(fullPath, relPath))
                        files.set(k, v);
                }
                else if (entry.isFile()) {
                    try {
                        const hash = createHash("md5").update(readFileSync(fullPath)).digest("hex");
                        files.set(relPath, hash);
                    }
                    catch { /* skip */ }
                }
            }
        }
        catch { /* skip */ }
        return files;
    }
    detectChanges(before, after, observer) {
        for (const [path, hash] of after) {
            const prev = before.get(path);
            if (!prev || prev !== hash)
                observer.fileWrite(path);
        }
        for (const path of before.keys()) {
            if (!after.has(path))
                observer.record({ type: "file_write", path, detail: "deleted" });
        }
    }
}
//# sourceMappingURL=claudecode.js.map