/**
 * Crucible — Claude Code Adapter
 * Invokes the Claude Code CLI binary to solve tasks.
 * Uses --print mode for non-interactive execution.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { CrucibulumAdapter, AdapterConfig, HealthCheckResult, ExecutionInput, ExecutionResult } from "./base.js";
import { Observer } from "../core/observer.js";
import { makeProcessProviderError, makeProviderFailureError, providerErrorSummary } from "../core/provider-errors.js";
import { log } from "../utils/logger.js";

interface ClaudeCodeConfig extends AdapterConfig {
  binary_path?: string | undefined;
  model?: string | undefined;
}

export class ClaudeCodeAdapter implements CrucibulumAdapter {
  id = "claudecode";
  name = "Claude Code";
  version = "1.0.0";

  private binaryPath: string = process.env["CLAUDE_CODE_BINARY"] ?? "claude";
  private model: string | null = null;
  private binaryHash: string = "";

  supports(_family: "poison" | "spec" | "orchestration"): boolean { return true; }
  supportsToolCalls(): boolean { return true; }

  supportsChat(): boolean {
    return false;
  }

  async init(config: AdapterConfig): Promise<void> {
    const c = config as ClaudeCodeConfig;
    if (c.binary_path) this.binaryPath = c.binary_path;
    if (c.model) this.model = c.model;

    // Hash binary for identity verification
    try {
      if (existsSync(this.binaryPath)) {
        const content = readFileSync(this.binaryPath);
        this.binaryHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
      }
    } catch { /* best effort */ }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return new Promise<HealthCheckResult>((resolve) => {
      try {
        const proc = spawn(this.binaryPath, ["--version"], { timeout: 15000, stdio: ["pipe", "pipe", "pipe"] });
        let output = "";
        proc.stdout.on("data", (d: Buffer) => { output += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { output += d.toString(); });
        proc.on("close", (code) => {
          if (code === 0) resolve({ ok: true });
          else {
            const providerError = makeProcessProviderError({ provider: "claudecode", adapter: this.id }, `claude --version exited ${code}: ${output.slice(0, 100)}`).structured;
            resolve({ ok: false, reason: providerErrorSummary(providerError), providerError });
          }
        });
        proc.on("error", (err) => {
          const providerError = makeProcessProviderError({ provider: "claudecode", adapter: this.id }, `Cannot spawn claude: ${err.message}`, (err as NodeJS.ErrnoException).code ?? null).structured;
          resolve({ ok: false, reason: providerErrorSummary(providerError), providerError });
        });
      } catch (err) {
        const providerError = makeProviderFailureError({ kind: "PROCESS_ERROR", origin: "LOCAL_RUNTIME", provider: "claudecode", adapter: this.id, rawMessage: `Claude Code check failed: ${String(err).slice(0, 100)}` }).structured;
        resolve({ ok: false, reason: providerErrorSummary(providerError), providerError });
      }
    });
  }

  async teardown(): Promise<void> { /* nothing */ }

  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const observer = new Observer();
    observer.taskStart();
    const startMs = Date.now();
    let exitReason: ExecutionResult["exit_reason"] = "complete";

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
    const args: string[] = ["--print"];
    if (this.model) args.push("--model", this.model);
    args.push(prompt);

    log("info", "claudecode", `Executing: claude ${args.slice(0, 3).join(" ")}...`);
    log("info", "claudecode", `Workspace: ${input.workspace_path}`);

    // Spawn Claude Code
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolveResult) => {
      const proc = spawn(this.binaryPath, args, {
        cwd: input.workspace_path,
        timeout: input.budget.time_limit_sec * 1000,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        this.parseOutput(chunk, observer);
      });

      proc.stderr.on("data", (data: Buffer) => {
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
        observer.recordError("Claude Code timed out", makeProviderFailureError({
          kind: "TIMEOUT",
          origin: "LOCAL_RUNTIME",
          provider: "claudecode",
          adapter: this.id,
          rawMessage: "Claude Code timed out",
          retryable: true,
        }).structured);
      } else {
        exitReason = "error";
        observer.recordError(`Claude Code exited with code ${result.exitCode}`, makeProcessProviderError({
          provider: "claudecode",
          adapter: this.id,
        }, `Claude Code exited with code ${result.exitCode}${result.stderr ? `: ${result.stderr.slice(0, 200)}` : ""}`).structured);
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
    } catch { /* use default */ }

    log("info", "claudecode", `Completed: ${exitReason} in ${Math.round((Date.now() - startMs) / 1000)}s`);

    return {
      exit_reason: exitReason,
      timeline: observer.getTimeline(),
      provider_error: observer.getProviderError() ?? undefined,
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

  private parseOutput(chunk: string, observer: Observer): void {
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Detect file operations from Claude Code output
      const readMatch = trimmed.match(/(?:Read|Reading|read)\s+(\S+\.\w+)/i);
      if (readMatch) { observer.fileRead(readMatch[1]!); continue; }
      const writeMatch = trimmed.match(/(?:Wrote|Writing|Updated|Created)\s+(\S+\.\w+)/i);
      if (writeMatch) { observer.fileWrite(writeMatch[1]!); continue; }
      const shellMatch = trimmed.match(/(?:Running|Ran|Executing|→)\s+[`]?(.+?)[`]?\s*$/i);
      if (shellMatch && shellMatch[1]!.length < 200) {
        const exitMatch = trimmed.match(/exit(?:\s*code)?\s*:?\s*(\d+)/i);
        observer.shell(shellMatch[1]!, exitMatch ? parseInt(exitMatch[1]!, 10) : 0);
      }
    }
  }

  private snapshotFiles(dir: string, prefix: string = ""): Map<string, string> {
    const files = new Map<string, string>();
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        if (entry.isDirectory()) {
          for (const [k, v] of this.snapshotFiles(fullPath, relPath)) files.set(k, v);
        } else if (entry.isFile()) {
          try {
            const hash = createHash("md5").update(readFileSync(fullPath)).digest("hex");
            files.set(relPath, hash);
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
    return files;
  }

  private detectChanges(before: Map<string, string>, after: Map<string, string>, observer: Observer): void {
    for (const [path, hash] of after) {
      const prev = before.get(path);
      if (!prev || prev !== hash) observer.fileWrite(path);
    }
    for (const path of before.keys()) {
      if (!after.has(path)) observer.record({ type: "file_write", path, detail: "deleted" });
    }
  }
}
