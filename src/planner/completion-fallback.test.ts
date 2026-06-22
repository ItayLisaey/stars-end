/**
 * The act() loop's completion fallback: some planners stop emitting a valid
 * <complete> once the goal is met (observed on gemini-3.5-flash — empty/off-task
 * responses), so the loop would throw even though the task is done. When it's
 * about to give up AND progress was made, it asks an independent yes/no `check`
 * whether the goal is satisfied and succeeds if so.
 *
 * `check` is mocked so this is deterministic (no model/browser).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageDriver } from "../driver/types.js";
import { NoProgressError } from "../errors.js";
import type { ModelTier, PlanModelResult, UIContext } from "../model/types.js";
import { act } from "./loop.js";

vi.mock("../insight/assert.js", () => ({ check: vi.fn() }));
import { check } from "../insight/assert.js";

const checkMock = check as unknown as ReturnType<typeof vi.fn>;

// minimal driver — the empty-plan path never taps/locates, only settles.
const driver = { waitForSettle: async () => {} } as unknown as PageDriver;

/**
 * Tier that emits `firstAction` once (so the loop records progress), then empty
 * plans forever (no action, no completion) — the glitch we're rescuing. The
 * screenshot is constant, so the loop reaches its no-progress give-up.
 */
function makeTier(firstAction?: PlanModelResult["action"]): ModelTier {
  let i = 0;
  return {
    kind: "grounding",
    async buildContext(): Promise<UIContext> {
      return { screenshotDataUrl: "STATIC", size: { width: 10, height: 10 }, dpr: 1 };
    },
    async locate() {
      return { bbox: [0, 0, 1, 1] as [number, number, number, number], raw: {} };
    },
    async plan(): Promise<PlanModelResult> {
      if (i++ === 0 && firstAction) return { action: firstAction };
      return {}; // empty: no action, no complete
    },
  };
}

beforeEach(() => checkMock.mockReset());

describe("act() completion fallback", () => {
  it("returns success when, after progress, the independent check says the goal is satisfied", async () => {
    checkMock.mockResolvedValue({ pass: true, thought: "the value is set" });
    const tier = makeTier({ type: "Sleep", param: { ms: 0 } });

    const r = await act(driver, tier, "set the dropdown to March");
    expect(r.success).toBe(true);
    expect(r.message).toMatch(/inferred/i);
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it("still throws NoProgressError when the check says the goal is NOT satisfied", async () => {
    checkMock.mockResolvedValue({ pass: false, thought: "nothing changed" });
    const tier = makeTier({ type: "Sleep", param: { ms: 0 } });

    await expect(act(driver, tier, "set the dropdown to March")).rejects.toBeInstanceOf(
      NoProgressError,
    );
  });

  it("does not run the check (and throws) when no progress was ever made", async () => {
    checkMock.mockResolvedValue({ pass: true, thought: "n/a" });
    const tier = makeTier(undefined); // empty plans from the very first step

    await expect(act(driver, tier, "do something")).rejects.toBeInstanceOf(NoProgressError);
    expect(checkMock).not.toHaveBeenCalled();
  });
});
