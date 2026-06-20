import { describe, expect, it } from "vitest";
import { findAction, normalizeActionParam, WEB_ACTIONS } from "./action-space.js";

describe("action space registry", () => {
  it("exposes the web subset, with Android/touch actions dropped", () => {
    const names = WEB_ACTIONS.map((a) => a.name);
    expect(names).toEqual([
      "Tap",
      "RightClick",
      "DoubleClick",
      "Hover",
      "Input",
      "KeyboardPress",
      "Scroll",
      "Sleep",
    ]);
    expect(names).not.toContain("Swipe");
    expect(names).not.toContain("RunAdbShell");
  });

  it("finds actions by name or alias, case-insensitively", () => {
    expect(findAction("Tap")?.name).toBe("Tap");
    expect(findAction("tap")?.name).toBe("Tap");
    expect(findAction("keyboardPress")?.name).toBe("KeyboardPress");
    expect(findAction("nope")).toBeUndefined();
  });
});

describe("action param validation", () => {
  it("Tap requires a locate prompt", () => {
    const tap = findAction("Tap")!;
    expect(tap.paramSchema.safeParse({ locate: { prompt: "x" } }).success).toBe(true);
    expect(tap.paramSchema.safeParse({}).success).toBe(false);
  });

  it("Input coerces numeric value to string and defaults mode to replace", () => {
    const input = findAction("Input")!;
    const parsed = input.paramSchema.parse({ value: 42 });
    expect(parsed).toEqual({ value: "42", mode: "replace" });
  });

  it("Input accepts replace/clear/typeOnly modes", () => {
    const input = findAction("Input")!;
    for (const mode of ["replace", "clear", "typeOnly"] as const) {
      expect(input.paramSchema.safeParse({ value: "x", mode }).success).toBe(true);
    }
    expect(input.paramSchema.safeParse({ value: "x", mode: "bogus" }).success).toBe(false);
  });

  it("normalizes deprecated Input append -> typeOnly", () => {
    expect(normalizeActionParam("Input", { value: "x", mode: "append" })).toEqual({
      value: "x",
      mode: "typeOnly",
    });
    // non-input untouched
    expect(normalizeActionParam("Tap", { mode: "append" })).toEqual({
      mode: "append",
    });
  });

  it("KeyboardPress requires keyName", () => {
    const kp = findAction("KeyboardPress")!;
    expect(kp.paramSchema.safeParse({ keyName: "Enter" }).success).toBe(true);
    expect(kp.paramSchema.safeParse({}).success).toBe(false);
  });

  it("Scroll defaults scrollType + direction", () => {
    const scroll = findAction("Scroll")!;
    expect(scroll.paramSchema.parse({})).toEqual({
      scrollType: "singleAction",
      direction: "down",
    });
  });

  it("Sleep requires ms number", () => {
    const sleep = findAction("Sleep")!;
    expect(sleep.paramSchema.safeParse({ ms: 500 }).success).toBe(true);
    expect(sleep.paramSchema.safeParse({ ms: "x" }).success).toBe(false);
  });
});
