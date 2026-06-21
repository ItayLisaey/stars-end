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

/**
 * Raised when the agent keeps planning the same action but the screen never
 * changes — a tap that "succeeds" at coordinates yet is a no-op (obscured by an
 * overlay, already actioned, etc.). Distinct from {@link TooManyErrorsError},
 * which only counts thrown errors; a no-op action throws nothing, so without
 * this guard the loop would livelock until the host runner's timeout.
 */
export class NoProgressError extends Error {
  readonly signature: string;
  readonly repeats: number;
  constructor(signature: string, repeats: number) {
    super(
      `no progress: repeated "${signature}" ${repeats} times without changing the screen — the target is likely obscured, a no-op, or already actioned`,
    );
    this.name = "NoProgressError";
    this.signature = signature;
    this.repeats = repeats;
  }
}

/**
 * Raised when an `input` action ran but no text landed in the field (e.g. focus
 * never reached a rich/contenteditable composer). The driver reports the field
 * still empty after typing, so we surface the failure instead of letting the
 * planner believe the text was entered.
 */
export class InputVerificationError extends Error {
  constructor(value: string) {
    super(
      `input did not land: the field is still empty after typing ${JSON.stringify(
        value.length > 40 ? `${value.slice(0, 40)}…` : value,
      )} — focus may not have reached an editable field`,
    );
    this.name = "InputVerificationError";
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
