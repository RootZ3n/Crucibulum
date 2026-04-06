/**
 * Crucibulum — Observer (Flight Recorder)
 * Records every action during agent execution for the Judge.
 * The Observer is the source of truth — not the agent's narration.
 */

import type { TimelineEvent } from "../adapters/base.js";
import { log } from "../utils/logger.js";

export class Observer {
  private timeline: TimelineEvent[] = [];
  private startTime: number;
  private filesRead: Set<string> = new Set();
  private filesWritten: Set<string> = new Set();
  private stepCount: number = 0;

  constructor() {
    this.startTime = Date.now();
  }

  /** Record a timeline event */
  record(event: Omit<TimelineEvent, "t">): void {
    const t = Math.round((Date.now() - this.startTime) / 1000);
    const full: TimelineEvent = { t, ...event };
    this.timeline.push(full);
    this.stepCount++;

    if (event.type === "file_read" && event.path) this.filesRead.add(event.path);
    if (event.type === "file_write" && event.path) this.filesWritten.add(event.path);

    log("debug", "observer", `[t=${t}] ${event.type}`, {
      path: event.path,
      command: event.command,
      exit_code: event.exit_code,
    });
  }

  /** Record task start */
  taskStart(): void {
    this.record({ type: "task_start", detail: "workspace initialized" });
  }

  /** Record task completion */
  taskComplete(detail?: string): void {
    this.record({ type: "task_complete", detail: detail ?? "agent signaled completion" });
  }

  /** Record an error */
  recordError(detail: string): void {
    this.record({ type: "error", detail });
  }

  /** Record a file read */
  fileRead(path: string): void {
    this.record({ type: "file_read", path });
  }

  /** Record a file write */
  fileWrite(path: string): void {
    this.record({ type: "file_write", path });
  }

  /** Record a shell command */
  shell(command: string, exitCode: number): void {
    this.record({ type: "shell", command, exit_code: exitCode });
  }

  /** Get the full timeline */
  getTimeline(): TimelineEvent[] {
    return [...this.timeline];
  }

  /** Get all files read */
  getFilesRead(): string[] {
    return [...this.filesRead];
  }

  /** Get all files written */
  getFilesWritten(): string[] {
    return [...this.filesWritten];
  }

  /** Get step count */
  getStepCount(): number {
    return this.stepCount;
  }

  /** Get elapsed time in ms */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
}
