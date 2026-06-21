/**
 * Reproduces the "unexpected dialog blocks the task and dismiss taps keep
 * missing" failure: a stray click trips an unsaved-changes guard, the agent
 * perceives the dialog and plans to dismiss it, but its taps on the dismiss
 * control never register, so it loops and bails on the error/no-progress budget.
 *
 * The loop must recover: when a blocking overlay is present and the repeated
 * action isn't landing, it presses Escape (coordinate-free) to dismiss it and
 * continues — instead of spending its budget on missed taps.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { PlaywrightDriver } from "../src/driver/playwright-driver.js";
import { detectTopLayerSurface, type TopLayerResult } from "../src/insight/top-layer.injected.js";
import { act } from "../src/planner/loop.js";
import type { ModelTier, PlanModelResult, UIContext } from "../src/model/types.js";

// A panel whose edit guard is already showing a modal confirm <dialog>. Native
// modal dialogs close on Escape; clicks on the backdrop are no-ops — exactly the
// shape where taps on the dismiss button "fail to register".
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #fff; font: 16px sans-serif; }
  dialog { padding: 24px; }
  dialog::backdrop { background: rgba(0,0,0,0.4); }
</style></head><body>
  <main><h1>Edit panel</h1></main>
  <dialog id="guard">
    <p>Discard changes?</p>
    <button id="discard">Discard</button>
    <button id="keep">Keep editing</button>
  </dialog>
  <script>document.getElementById('guard').showModal();</script>
</body></html>`;

let browser: Browser;
let page: Page;
let driver: PlaywrightDriver;

/**
 * Fake tier that mirrors reality: it reports the real overlay state, taps a
 * harmless backdrop corner (a "missed" dismiss tap → no-op), and completes once
 * the dialog is gone. plan() drives behavior off the detected overlay so it
 * reflects whether recovery actually closed the dialog.
 */
function makeTier(): { tier: ModelTier; planCalls: () => number } {
  let planCalls = 0;
  const tier: ModelTier = {
    kind: "grounding",
    async buildContext(p): Promise<UIContext> {
      const shot = await p.screenshot();
      const overlay = await p
        .evaluate<TopLayerResult>(detectTopLayerSurface)
        .catch(() => ({ present: false }) as TopLayerResult);
      return {
        screenshotDataUrl: shot.base64,
        size: { width: shot.width, height: shot.height },
        dpr: shot.dpr,
        overlay,
      };
    },
    async locate(ctx: UIContext) {
      // a button-sized box in the top-left corner — lands on the backdrop, not
      // the dismiss button (the stray "miss"); large enough not to deep-locate.
      const d = ctx.dpr;
      return { bbox: [8 * d, 8 * d, 64 * d, 44 * d] as [number, number, number, number], raw: {} };
    },
    async plan(ctx: UIContext): Promise<PlanModelResult> {
      planCalls++;
      if (ctx.overlay?.present) {
        // perceives the dialog, tries to tap its dismiss button (but misses)
        return {
          thought: "a discard dialog is blocking me; tap Discard",
          action: { type: "Tap", param: { locate: { prompt: "the Discard button" } } },
        };
      }
      return {
        thought: "dialog gone, task done",
        complete: { success: true, message: "recovered" },
      };
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

describe("act() unexpected-dialog recovery", () => {
  it("dismisses a blocking dialog via Escape when dismiss taps keep missing", async () => {
    // sanity: the modal is open at the start
    expect(await page.$eval("#guard", (d) => (d as HTMLDialogElement).open)).toBe(true);

    const { tier, planCalls } = makeTier();
    const result = await act(driver, tier, "set the dropdown to the second option", {
      maxPlanningSteps: 20,
    });

    expect(result.success).toBe(true);
    // the dialog was actually dismissed (not still looping over it)
    expect(await page.$eval("#guard", (d) => (d as HTMLDialogElement).open)).toBe(false);
    // recovered in a few steps — no TooManyErrors/NoProgress death spiral
    expect(planCalls()).toBeLessThanOrEqual(4);
  });
});
