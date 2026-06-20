/**
 * Tests for `History`, which is intentionally minimal (no sub-goals / memories /
 * image compression), so we test what it actually does: step accumulation +
 * truncated feedback drain.
 */
import { describe, expect, it } from "vitest";
import { History } from "./history.js";

describe("History", () => {
  it("accumulates steps in order", () => {
    const h = new History();
    h.add({ thought: "t1", action: { type: "Tap" } });
    h.add({ thought: "t2", action: { type: "Input", param: { value: "x" } } });
    expect(h.steps).toHaveLength(2);
    expect(h.steps[0].action.type).toBe("Tap");
    expect(h.steps[1].action.param).toEqual({ value: "x" });
  });

  it("starts with no pending feedback", () => {
    expect(new History().pendingFeedback).toHaveLength(0);
  });

  it("queues feedback and drains it exactly once (clears after take)", () => {
    const h = new History();
    h.addFeedback("error A");
    h.addFeedback("error B");
    expect(h.pendingFeedback).toEqual(["error A", "error B"]);
    expect(h.takeFeedback()).toEqual(["error A", "error B"]);
    // drained — a second take is empty
    expect(h.takeFeedback()).toEqual([]);
    expect(h.pendingFeedback).toHaveLength(0);
  });

  it("truncates long feedback to 500 chars to prevent context blowup", () => {
    const h = new History();
    h.addFeedback("x".repeat(2000));
    const [msg] = h.takeFeedback();
    // 500 chars + an ellipsis marker
    expect(msg.length).toBe(501);
    expect(msg.endsWith("…")).toBe(true);
  });

  it("does not truncate short feedback", () => {
    const h = new History();
    h.addFeedback("short");
    expect(h.takeFeedback()).toEqual(["short"]);
  });
});
