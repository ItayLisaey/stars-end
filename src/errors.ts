/**
 * Error types. Each is a distinct class so callers / the planner can branch on
 * failure mode.
 */

export class ElementNotFoundError extends Error {
  readonly errors?: string[];
  constructor(prompt: string, errors?: string[]) {
    super(`could not locate element: ${prompt}${errors?.length ? ` (${errors.join("; ")})` : ""}`);
    this.name = "ElementNotFoundError";
    this.errors = errors;
  }
}

export class AssertionError extends Error {
  readonly thought?: string;
  constructor(assertion: string, thought?: string) {
    super(`assertion failed: ${assertion}${thought ? ` — ${thought}` : ""}`);
    this.name = "AssertionError";
    this.thought = thought;
  }
}

export class ExtractError extends Error {
  constructor(errors: string[]) {
    super(`extract failed: ${errors.join("; ")}`);
    this.name = "ExtractError";
  }
}

export class WaitForTimeoutError extends Error {
  constructor(assertion: string) {
    super(`waitFor timed out: ${assertion}`);
    this.name = "WaitForTimeoutError";
  }
}

export class ActionFailedError extends Error {
  constructor(message?: string) {
    super(`action failed${message ? `: ${message}` : ""}`);
    this.name = "ActionFailedError";
  }
}

export class TooManyErrorsError extends Error {
  constructor() {
    super("too many consecutive errors while executing actions");
    this.name = "TooManyErrorsError";
  }
}

export class ReplanLimitError extends Error {
  constructor() {
    super("replan limit exceeded");
    this.name = "ReplanLimitError";
  }
}

export class MaxStepsError extends Error {
  constructor() {
    super("max planning steps exceeded");
    this.name = "MaxStepsError";
  }
}

export class UnknownActionError extends Error {
  constructor(type: string) {
    super(`unknown action type: ${type}`);
    this.name = "UnknownActionError";
  }
}

export class CoordinateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoordinateParseError";
  }
}

/** Safely extract a message from an unknown thrown value. */
export function getSafeErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
