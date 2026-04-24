/**
 * Crucible — Timing Utilities
 */
export declare class StepTimer {
    private start;
    private steps;
    constructor();
    step(): number;
    elapsed(): number;
    elapsedSec(): number;
    currentStep(): number;
    budget(limitSec: number, maxSteps: number): {
        timeRemaining: number;
        stepsRemaining: number;
        expired: boolean;
    };
}
export declare function formatDuration(ms: number): string;
//# sourceMappingURL=timing.d.ts.map