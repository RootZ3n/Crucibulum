/**
 * Crucibulum — Timing Utilities
 */

export class StepTimer {
  private start: number;
  private steps: number = 0;

  constructor() { this.start = Date.now(); }

  step(): number { return ++this.steps; }
  elapsed(): number { return Date.now() - this.start; }
  elapsedSec(): number { return Math.round(this.elapsed() / 1000); }
  currentStep(): number { return this.steps; }

  budget(limitSec: number, maxSteps: number): { timeRemaining: number; stepsRemaining: number; expired: boolean } {
    const timeRemaining = limitSec - this.elapsedSec();
    const stepsRemaining = maxSteps - this.steps;
    return { timeRemaining, stepsRemaining, expired: timeRemaining <= 0 || stepsRemaining <= 0 };
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
