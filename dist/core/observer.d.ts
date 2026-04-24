/**
 * Crucible — Observer (Flight Recorder)
 * Records every action during agent execution for the Judge.
 * The Observer is the source of truth — not the agent's narration.
 */
import type { TimelineEvent } from "../adapters/base.js";
import type { StructuredProviderError } from "../types/provider-error.js";
export declare class Observer {
    private timeline;
    private startTime;
    private filesRead;
    private filesWritten;
    private stepCount;
    private terminalProviderError;
    constructor();
    /** Record a timeline event */
    record(event: Omit<TimelineEvent, "t">): void;
    /** Record task start */
    taskStart(): void;
    /** Record task completion */
    taskComplete(detail?: string): void;
    /** Record an error */
    recordError(detail: string, providerError?: StructuredProviderError): void;
    /** Record a file read */
    fileRead(path: string): void;
    /** Record a file write */
    fileWrite(path: string): void;
    /** Record a shell command */
    shell(command: string, exitCode: number): void;
    /** Get the full timeline */
    getTimeline(): TimelineEvent[];
    /** Get all files read */
    getFilesRead(): string[];
    /** Get all files written */
    getFilesWritten(): string[];
    /** Get step count */
    getStepCount(): number;
    /** Get elapsed time in ms */
    getElapsedMs(): number;
    getProviderError(): StructuredProviderError | null;
}
//# sourceMappingURL=observer.d.ts.map