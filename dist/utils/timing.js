/**
 * Crucibulum — Timing Utilities
 */
export class StepTimer {
    start;
    steps = 0;
    constructor() { this.start = Date.now(); }
    step() { return ++this.steps; }
    elapsed() { return Date.now() - this.start; }
    elapsedSec() { return Math.round(this.elapsed() / 1000); }
    currentStep() { return this.steps; }
    budget(limitSec, maxSteps) {
        const timeRemaining = limitSec - this.elapsedSec();
        const stepsRemaining = maxSteps - this.steps;
        return { timeRemaining, stepsRemaining, expired: timeRemaining <= 0 || stepsRemaining <= 0 };
    }
}
export function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
//# sourceMappingURL=timing.js.map