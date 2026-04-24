/**
 * Crucible — Observer (Flight Recorder)
 * Records every action during agent execution for the Judge.
 * The Observer is the source of truth — not the agent's narration.
 */
import { log } from "../utils/logger.js";
export class Observer {
    timeline = [];
    startTime;
    filesRead = new Set();
    filesWritten = new Set();
    stepCount = 0;
    terminalProviderError = null;
    constructor() {
        this.startTime = Date.now();
    }
    /** Record a timeline event */
    record(event) {
        const t = Math.round((Date.now() - this.startTime) / 1000);
        const full = { t, ...event };
        this.timeline.push(full);
        this.stepCount++;
        if (event.type === "file_read" && event.path)
            this.filesRead.add(event.path);
        if (event.type === "file_write" && event.path)
            this.filesWritten.add(event.path);
        log("debug", "observer", `[t=${t}] ${event.type}`, {
            path: event.path,
            command: event.command,
            exit_code: event.exit_code,
        });
    }
    /** Record task start */
    taskStart() {
        this.record({ type: "task_start", detail: "workspace initialized" });
    }
    /** Record task completion */
    taskComplete(detail) {
        this.record({ type: "task_complete", detail: detail ?? "agent signaled completion" });
    }
    /** Record an error */
    recordError(detail, providerError) {
        if (providerError) {
            this.terminalProviderError = providerError;
        }
        this.record({ type: "error", detail, provider_error: providerError });
    }
    /** Record a file read */
    fileRead(path) {
        this.record({ type: "file_read", path });
    }
    /** Record a file write */
    fileWrite(path) {
        this.record({ type: "file_write", path });
    }
    /** Record a shell command */
    shell(command, exitCode) {
        this.record({ type: "shell", command, exit_code: exitCode });
    }
    /** Get the full timeline */
    getTimeline() {
        return [...this.timeline];
    }
    /** Get all files read */
    getFilesRead() {
        return [...this.filesRead];
    }
    /** Get all files written */
    getFilesWritten() {
        return [...this.filesWritten];
    }
    /** Get step count */
    getStepCount() {
        return this.stepCount;
    }
    /** Get elapsed time in ms */
    getElapsedMs() {
        return Date.now() - this.startTime;
    }
    getProviderError() {
        return this.terminalProviderError;
    }
}
//# sourceMappingURL=observer.js.map