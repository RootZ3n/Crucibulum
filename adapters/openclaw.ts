/**
 * Crucibulum — OpenClaw Adapter
 * Invokes OpenClaw as a subprocess in the workspace.
 * OpenClaw operates autonomously — reads files, runs commands, writes fixes.
 * Crucibulum observes its actions via stdout/file system monitoring.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type {
  CrucibulumAdapter,
  AdapterConfig,
  ExecutionInput,
  ExecutionResult,
} from "./base.js";
import { Observer } from "../core/observer.js";
import { log } from "../utils/logger.js";

interface OpenClawConfig extends AdapterConfig {
  binary_path?: string | undefined;
  config_path?: string | undefined;
  model?: string | undefined;
  provider?: string | undefined;
}

export class OpenClawAdapter implements CrucibulumAdapter {
  id = "openclaw";
  name = "OpenClaw";
  version = "1.0.0";

  private binaryPath: string = process.env["OPENCLAW_BINARY"] ?? "openclaw";
  private configPath: string | null = null;
  private model: string | null = null;
  private provider: string | null = null;
  private binaryHash: string = "";

  supports(_family: "poison" | "spec" | "orchestration"): boolean {
    return true;
  }

  supportsToolCalls(): boolean {
    return true;
  }

  async init(config: AdapterConfig): Promise<void> {
    const c = config as OpenClawConfig;
    if (c.binary_path) this.binaryPath = c.binary_path;
    if (c.config_path) this.configPath = c.config_path;
    if (c.model) this.model = c.model;
    if (c.provider) this.provider = c.provider;

    // Hash binary for adapter identity verification
    try {
      const resolved = this.resolveBinary();
      if (resolved && existsSync(resolved)) {
        const content = readFileSync(resolved);
        this.binaryHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
      }
    } catch { /* best effort */ }
  }

  async healthCheck(): Promise<{ ok: boolean; reason?: string | undefined }> {
    // Check if binary exists and responds to --version
    return new Promise((res) => {
      try {
        const proc = spawn(this.binaryPath, ["--version"], { timeout: 10000 });
        let output = "";
        proc.stdout.on("data", (d: Buffer) => { output += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { output += d.toString(); });
        proc.on("close", (code) => {
          if (code === 0) res({ ok: true });
          else res({ ok: false, reason: `openclaw --version exited ${code}: ${output.slice(0, 100)}` });
        });
        proc.on("error", (err) => {
          res({ ok: false, reason: `Cannot spawn openclaw: ${err.message}` });
        });
      } catch (err) {
        res({ ok: false, reason: `OpenClaw check failed: ${String(err).slice(0, 100)}` });
      }
    });
  }

  async teardown(): Promise<void> { /* nothing */ }

  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const observer = new Observer();
    observer.taskStart();
    const startMs = Date.now();
    let exitReason: ExecutionResult["exit_reason"] = "complete";

    // Snapshot workspace state before execution
    const beforeFiles = snapshotFiles(input.workspace_path);

    // Build the task prompt for OpenClaw
    const taskPrompt = [
      input.task.task.title,
      "",
      input.task.task.description,
      "",
      `Entrypoints: ${input.task.task.entrypoints.join(", ")}`,
      input.task.verification.public_tests_command ? `Run tests: ${input.task.verification.public_tests_command}` : "",
      "Fix the bug. Run tests to verify. Do not modify test files.",
    ].filter(Boolean).join("\n");

    // Build openclaw arguments
    const args: string[] = [
      "--print",  // non-interactive mode
      "--yes",    // auto-accept
    ];
    if (this.model) args.push("--model", this.model);
    if (this.configPath) args.push("--config", this.configPath);
    args.push(taskPrompt);

    log("info", "openclaw", `Executing: ${this.binaryPath} ${args.slice(0, 3).join(" ")}...`);
    log("info", "openclaw", `Workspace: ${input.workspace_path}`);

    // Spawn OpenClaw process
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolveResult) => {
      const proc = spawn(this.binaryPath, args, {
        cwd: input.workspace_path,
        env: {
          ...process.env,
          // Prevent OpenClaw from accessing parent directories
          HOME: input.workspace_path,
        },
        timeout: input.budget.time_limit_sec * 1000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        // Parse actions from stdout for the observer
        parseOpenClawOutput(chunk, observer);
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

    if (result.exitCode !== 0 && Date.now() - startMs > input.budget.time_limit_sec * 1000) {
      exitReason = "timeout";
      observer.recordError("OpenClaw timed out");
    } else if (result.exitCode !== 0) {
      exitReason = "error";
      observer.recordError(`OpenClaw exited with code ${result.exitCode}`);
    }

    // Diff workspace to detect what changed
    const afterFiles = snapshotFiles(input.workspace_path);
    detectFileChanges(beforeFiles, afterFiles, observer);

    observer.taskComplete(exitReason === "complete" ? "OpenClaw finished" : `OpenClaw: ${exitReason}`);

    // Get system version
    let systemVersion = "unknown";
    try {
      const { execSync } = await import("node:child_process");
      systemVersion = execSync(`${this.binaryPath} --version`, { encoding: "utf-8", timeout: 5000 }).trim();
    } catch { /* use default */ }

    log("info", "openclaw", `Completed: ${exitReason} in ${Math.round((Date.now() - startMs) / 1000)}s`);

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
        provider: this.provider ?? "openclaw",
      },
    };
  }

  private resolveBinary(): string | null {
    if (existsSync(this.binaryPath)) return this.binaryPath;
    // Check common locations
    const paths = ["/usr/local/bin/openclaw", join(process.env["HOME"] ?? "", ".local/bin/openclaw")];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }
}

// Parse OpenClaw stdout to detect actions
function parseOpenClawOutput(chunk: string, observer: Observer): void {
  const lines = chunk.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect file reads (OpenClaw typically logs "Reading file: ...")
    const readMatch = trimmed.match(/(?:reading|read|opening|viewing)\s+(?:file:?\s+)?(\S+\.\w+)/i);
    if (readMatch) { observer.fileRead(readMatch[1]!); continue; }

    // Detect file writes
    const writeMatch = trimmed.match(/(?:writing|wrote|updating|creating|editing)\s+(?:file:?\s+)?(\S+\.\w+)/i);
    if (writeMatch) { observer.fileWrite(writeMatch[1]!); continue; }

    // Detect shell commands
    const shellMatch = trimmed.match(/(?:running|executing|command:?)\s+[`"]?(.+?)[`"]?\s*$/i);
    if (shellMatch) {
      const exitMatch = trimmed.match(/exit(?:\s+code)?:?\s*(\d+)/i);
      observer.shell(shellMatch[1]!, exitMatch ? parseInt(exitMatch[1]!, 10) : 0);
      continue;
    }

    // Detect $ command pattern
    if (trimmed.startsWith("$ ")) {
      observer.shell(trimmed.slice(2), 0);
    }
  }
}

// File snapshot for diff detection
function snapshotFiles(dir: string, prefix: string = ""): Map<string, string> {
  const files = new Map<string, string>();
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      if (entry.isDirectory()) {
        for (const [k, v] of snapshotFiles(fullPath, relPath)) {
          files.set(k, v);
        }
      } else if (entry.isFile()) {
        try {
          const hash = createHash("md5").update(readFileSync(fullPath)).digest("hex");
          files.set(relPath, hash);
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* dir might not exist */ }
  return files;
}

function detectFileChanges(before: Map<string, string>, after: Map<string, string>, observer: Observer): void {
  // Files created or modified
  for (const [path, hash] of after) {
    const prevHash = before.get(path);
    if (!prevHash) {
      observer.fileWrite(path); // new file
    } else if (prevHash !== hash) {
      observer.fileWrite(path); // modified
    }
  }
  // Files deleted
  for (const path of before.keys()) {
    if (!after.has(path)) {
      observer.record({ type: "file_write", path, detail: "deleted" });
    }
  }
}
