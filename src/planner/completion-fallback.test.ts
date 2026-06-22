/**
 * The act() loop's completion logic, both directions, driven through the tier's
 * `isGoalSatisfied` capability (no real model — a fake tier supplies the yes/no):
 *
 *  - INFER: some planners stop emitting <complete> once the goal is met (observed
 *    on gemini-3.5-flash — empty/off-task text). When about to give up after
 *    progress, the loop asks isGoalSatisfied and succeeds if yes.
 *  - VERIFY: some planners declare <complete success="true"> prematurely. The
 *    loop confirms with isGoalSatisfied and, if not satisfied, rejects the claim
 *    and continues.
 *
 * A tier WITHOUT isGoalSatisfied makes the loop skip the check (covered by the
 * other integration tests, which use such tiers and still pass).
 */
import { describe, expect, it, vi } from "vitest";
import type { PageDriver } from "../driver/types.js";
import { NoProgressError, ReplanLimitError } from "../errors.js";
import type { ModelTier, PlanModelResult, UIContext } from "../model/types.js";
import { act } from "./loop.js";

// driver that can run a Tap (locate -> tap) and settle, all no-ops on a static screen.
const driver = {
  waitForSettle: async () => {},
  tap: async () => {},
  evaluate: async () => null,
} as unknown as PageDriver;

function makeTier(planFn: (i: number) => PlanModelResult, satisfied: boolean) {
  let i = 0;
  const isGoalSatisfied = vi.fn(async () => satisfied);
  const tier: ModelTier = {
    kind: "grounding",
    isGoalSatisfied,
    async buildContext(): Promise<UIContext> {
      return { screenshotDataUrl: "STATIC", size: { width: 200, height: 200 }, dpr: 1 };
    },
    async locate() {
      return { bbox: [10, 10, 110, 110] as [number, number, number, number], raw: {} };
    },
    async plan(): Promise<PlanModelResult> {
      return planFn(i++);
    },
  };
  return { tier, isGoalSatisfied };
}

const SLEEP: PlanModelResult = { action: { type: "Sleep", param: { ms: 0 } } };
const TAP: PlanModelResult = { action: { type: "Tap", param: { locate: { prompt: "the item" } } } };
const EMPTY: PlanModelResult = {};
const DONE: PlanModelResult = { complete: { success: true, message: "done" } };

describe("act() completion — infer (planner won't say done)", () => {
  it("succeeds when, after progress, the goal IS satisfied", async () => {
    const { tier, isGoalSatisfied } = makeTier((i) => (i === 0 ? SLEEP : EMPTY), true);
    const r = await act(driver, tier, "do the thing");
    expect(r.success).toBe(true);
    expect(r.message).toMatch(/inferred/i);
    expect(isGoalSatisfied).toHaveBeenCalled();
  });

  it("throws NoProgressError when the goal is NOT satisfied", async () => {
    const { tier } = makeTier((i) => (i === 0 ? SLEEP : EMPTY), false);
    await expect(act(driver, tier, "do the thing")).rejects.toBeInstanceOf(NoProgressError);
  });

  it("rescues a planner that keeps re-tapping an already-actioned target", async () => {
    const { tier } = makeTier(() => TAP, true);
    const r = await act(driver, tier, "select the item");
    expect(r.success).toBe(true);
    expect(r.message).toMatch(/inferred/i);
  });

  it("does not check (and throws) when no progress was ever made", async () => {
    const { tier, isGoalSatisfied } = makeTier(() => EMPTY, true);
    await expect(act(driver, tier, "do the thing")).rejects.toBeInstanceOf(NoProgressError);
    expect(isGoalSatisfied).not.toHaveBeenCalled();
  });
});

describe("act() completion — verify (planner claims done)", () => {
  it("accepts a claimed completion when the goal IS satisfied", async () => {
    const { tier, isGoalSatisfied } = makeTier((i) => (i === 0 ? SLEEP : DONE), true);
    const r = await act(driver, tier, "do the thing");
    expect(r.success).toBe(true);
    expect(r.message).toBe("done");
    expect(isGoalSatisfied).toHaveBeenCalled();
  });

  it("rejects a premature completion when the goal is NOT satisfied, then bounds out", async () => {
    const { tier, isGoalSatisfied } = makeTier((i) => (i === 0 ? SLEEP : DONE), false);
    // every re-claimed completion is rejected -> eventually the replan budget trips
    await expect(act(driver, tier, "do the thing", { replanLimit: 3 })).rejects.toBeInstanceOf(
      ReplanLimitError,
    );
    expect(isGoalSatisfied.mock.calls.length).toBeGreaterThan(1);
  });

  it("trusts an immediate completion (no steps yet) without checking", async () => {
    const { tier, isGoalSatisfied } = makeTier(() => DONE, false);
    const r = await act(driver, tier, "already done");
    expect(r.success).toBe(true);
    expect(isGoalSatisfied).not.toHaveBeenCalled();
  });
});
