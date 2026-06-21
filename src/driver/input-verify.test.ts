/**
 * Unit coverage for verifyInputLanded: the read-back + single focus-retry logic
 * that turns a silently-dropped input into a thrown InputVerificationError,
 * without false-positiving on fields it cannot read.
 */
import { describe, expect, it, vi } from "vitest";
import type { PageDriver } from "./types.js";
import { InputVerificationError } from "../errors.js";
import { verifyInputLanded } from "./input-verify.js";

/** Driver stub where readEditableValue returns the queued values in order. */
function stubDriver(reads: Array<string | null>): PageDriver {
  let i = 0;
  return {
    tap: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    waitForSettle: vi.fn(async () => {}),
    readEditableValue: vi.fn(async () => reads[Math.min(i++, reads.length - 1)]),
  } as unknown as PageDriver;
}

describe("verifyInputLanded", () => {
  it("passes immediately for an empty value (nothing to verify)", async () => {
    const d = stubDriver([]);
    await expect(verifyInputLanded(d, "   ")).resolves.toBeUndefined();
    expect(d.readEditableValue).not.toHaveBeenCalled();
  });

  it("passes when the field reads back non-empty", async () => {
    const d = stubDriver(["hello"]);
    await verifyInputLanded(d, "hello", { x: 1, y: 1 });
    expect(d.readEditableValue).toHaveBeenCalledTimes(1);
    expect(d.tap).not.toHaveBeenCalled(); // no retry needed
  });

  it("passes (unverifiable) when no editable field can be read", async () => {
    const d = stubDriver([null]);
    await expect(verifyInputLanded(d, "hello", { x: 1, y: 1 })).resolves.toBeUndefined();
  });

  it("retries once with a focus tap, then succeeds", async () => {
    const d = stubDriver(["", "hello"]);
    await verifyInputLanded(d, "hello", { x: 5, y: 5 });
    expect(d.tap).toHaveBeenCalledTimes(1); // re-focus
    expect(d.type).toHaveBeenCalledTimes(1); // re-type
    expect(d.readEditableValue).toHaveBeenCalledTimes(2);
  });

  it("throws InputVerificationError when still empty after the retry", async () => {
    const d = stubDriver(["", ""]);
    await expect(verifyInputLanded(d, "nope", { x: 5, y: 5 })).rejects.toBeInstanceOf(
      InputVerificationError,
    );
  });

  it("throws without retrying when no point is available to re-focus", async () => {
    const d = stubDriver([""]);
    await expect(verifyInputLanded(d, "nope")).rejects.toBeInstanceOf(InputVerificationError);
    expect(d.tap).not.toHaveBeenCalled();
  });
});
