/**
 * Reproduces the "livelock until the host runner's timeout" failure mode:
 * an action that "succeeds" at coordinates but produces NO state change (the
 * target is a no-op / obscured) is not an error, so consecutive-error counting
 * never fires and the loop would run until the external test timeout.
 *
 * A scripted fake ModelTier drives act() against a real-but-static DOM where the
 * located target does nothing when tapped. The loop must bail fast with a
 * descriptive NoProgressError — not hang and not run to maxSteps.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { PlaywrightDriver } from "../src/driver/playwright-driver.js";
import { NoProgressError } from "../src/errors.js";
import { act } from "../src/planner/loop.js";
import type { ModelTier, PlanModelResult, UIContext } from "../src/model/types.js";

// A fully static page. #card is a plain, non-interactive tile: tapping it
// focuses nothing and runs no handler, so the screenshot never changes.
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #fff; font: 16px sans-serif; }
  #card { position: absolute; left: 40px; top: 60px; width: 200px; height: 120px;
          background: #e8e8e8; border: 1px solid #ccc; }
</style></head><body>
  <div id="card">a card that does nothing when clicked</div>
</body></html>`;

let browser: Browser;
let page: Page;
let driver: PlaywrightDriver;

/**
 * Fake tier: locate always returns #card's (button-sized) bbox; plan is driven
 * by `nextPlan(step)`. We count plan() calls to assert the loop bailed quickly.
 */
function makeTier(nextPlan: (step: number) => PlanModelResult): {
  tier: ModelTier;
  planCalls: () => number;
} {
  let planCalls = 0;
  const tier: ModelTier = {
    kind: "grounding",
    async buildContext(p): Promise<UIContext> {
      const shot = await p.screenshot();
      return {
        screenshotDataUrl: shot.base64,
        size: { width: shot.width, height: shot.height },
        dpr: shot.dpr,
      };
    },
    async locate(ctx: UIContext) {
      // #card CSS rect (40,60)-(240,180) -> image px
      const d = ctx.dpr;
      return {
        bbox: [40 * d, 60 * d, 240 * d, 180 * d] as [number, number, number, number],
        raw: {},
      };
    },
    async plan(): Promise<PlanModelResult> {
      return nextPlan(planCalls++);
    },
  };
  return { tier, planCalls: () => planCalls };
}

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});
beforeEach(async () => {
  page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 800, height: 600 } });
  await page.setContent(HTML);
  driver = new PlaywrightDriver(page);
});
afterEach(async () => {
  await page?.close();
});

describe("act() no-progress guard", () => {
  it("bails fast when the same action repeatedly produces no state change (A1)", async () => {
    // always plan the same Tap on the inert card
    const { tier, planCalls } = makeTier(() => ({
      thought: "click the card",
      action: { type: "Tap", param: { locate: { prompt: "the card" } } },
    }));

    await expect(
      act(driver, tier, "open the card", { maxPlanningSteps: 40 }),
    ).rejects.toBeInstanceOf(NoProgressError);
    // caught within a handful of steps — nowhere near maxSteps (would be a hang)
    expect(planCalls()).toBeLessThanOrEqual(5);
  });

  it("surfaces a descriptive message naming the stuck action", async () => {
    const { tier } = makeTier(() => ({
      action: { type: "Tap", param: { locate: { prompt: "the overview card" } } },
    }));
    await expect(act(driver, tier, "open it")).rejects.toThrow(/no progress/i);
    await expect(act(driver, tier, "open it")).rejects.toThrow(/Tap:the overview card/);
  });

  it("bails when the agent hallucinates forward through steps with no screen change (A4)", async () => {
    // each step targets a DIFFERENT (made-up) control, all of which resolve but
    // change nothing — the planner believes it is advancing a wizard that isn't
    // actually on screen. The staleness backstop must still terminate it.
    const { tier, planCalls } = makeTier((step) => ({
      thought: `advancing to step ${step + 1}`,
      action: { type: "Tap", param: { locate: { prompt: `wizard step ${step + 1}` } } },
    }));

    await expect(
      act(driver, tier, "complete the wizard", { maxPlanningSteps: 40 }),
    ).rejects.toBeInstanceOf(NoProgressError);
    // terminates well before maxSteps even though every action differs
    expect(planCalls()).toBeLessThan(10);
  });

  it("does not false-trigger while the screen keeps changing", async () => {
    // each Tap mutates the DOM, so the screenshot changes every step; the guard
    // must not fire. Completes via an explicit <complete> after a few steps.
    await page.evaluate(() => {
      const card = document.getElementById("card")!;
      card.addEventListener("click", () => {
        const n = document.createElement("div");
        n.textContent = `row ${Date.now()}`;
        card.appendChild(n);
      });
    });
    let i = 0;
    const { tier } = makeTier(() =>
      i++ < 4
        ? { action: { type: "Tap", param: { locate: { prompt: "the card" } } } }
        : { complete: { success: true, message: "done" } },
    );

    const result = await act(driver, tier, "click a few times");
    expect(result.success).toBe(true);
  });
});

describe("act() per-step outcome trace", () => {
  it("reports stateChanged=false for a no-op action", async () => {
    const steps: Array<{ ok: boolean; stateChanged: boolean }> = [];
    const { tier } = makeTier(() => ({
      action: { type: "Tap", param: { locate: { prompt: "the card" } } },
    }));
    await act(driver, tier, "open the card", {
      onStep: (i) => steps.push({ ok: i.ok, stateChanged: i.stateChanged }),
    }).catch(() => {});
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.ok && !s.stateChanged)).toBe(true);
  });

  it("reports stateChanged=true when the action mutates the DOM", async () => {
    await page.evaluate(() => {
      const card = document.getElementById("card")!;
      card.addEventListener("click", () => card.appendChild(document.createElement("hr")));
    });
    const steps: Array<{ ok: boolean; stateChanged: boolean }> = [];
    let i = 0;
    const { tier } = makeTier(() =>
      i++ < 2
        ? { action: { type: "Tap", param: { locate: { prompt: "the card" } } } }
        : { complete: { success: true, message: "done" } },
    );
    await act(driver, tier, "click twice", {
      onStep: (s) => steps.push({ ok: s.ok, stateChanged: s.stateChanged }),
    });
    expect(steps.length).toBe(2);
    expect(steps.every((s) => s.ok && s.stateChanged)).toBe(true);
  });
});
