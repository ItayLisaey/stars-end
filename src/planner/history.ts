/**
 * Step history + feedback truncation. `addFeedback` errors/results are
 * fed to the next plan, truncated to 500 chars to prevent context blowup.
 */
import type { Step } from "../types.js";

const FEEDBACK_MAX = 500;

export class History {
  readonly steps: Step[] = [];
  private feedback: string[] = [];

  add(step: Step): void {
    this.steps.push(step);
  }

  /** Feedback (errors / results) surfaced to the next planning call. */
  addFeedback(message: string): void {
    this.feedback.push(
      message.length > FEEDBACK_MAX ? `${message.slice(0, FEEDBACK_MAX)}…` : message,
    );
  }

  takeFeedback(): string[] {
    const f = this.feedback;
    this.feedback = [];
    return f;
  }

  get pendingFeedback(): readonly string[] {
    return this.feedback;
  }
}
