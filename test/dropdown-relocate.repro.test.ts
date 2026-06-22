/**
 * End-to-end reproduction of the "re-locating an OPEN combobox" failure against
 * a real custom dropdown.
 *
 * Two planners drive the SAME fixture + machinery:
 *  - "stale": once the dropdown is open it keeps re-locating the CLOSED trigger
 *    by its old value ("the month dropdown currently showing Nov") — that
 *    description isn't on screen, so the locate misses and the loop bails. This
 *    reproduces the reported symptom.
 *  - "signal": it reads the open-list signal this change adds (ctx.openList) and
 *    instead locates the OPTION in the open list — and completes.
 *
 * Flip PLANNER to "stale" to watch the repro fail (red); "signal" is the kept
 * regression test (green), proving the open-list signal is sufficient to
 * recover. NOTE: the real fix steers the *model* via the planning prompt rule;
 * a fake tier can't be prompt-steered, so this proves the signal + machinery,
 * not the model's wording.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { PlaywrightDriver } from "../src/driver/playwright-driver.js";
import { detectOpenListbox, type OpenListResult } from "../src/insight/open-listbox.injected.js";
import { act } from "../src/planner/loop.js";
import type {
  LocateModelResult,
  ModelTier,
  PlanModelResult,
  UIContext,
} from "../src/model/types.js";

const PLANNER: "stale" | "signal" = "signal";

// Real custom combobox: button trigger ("Nov") + listbox of 12 months. Opening
// toggles the list; clicking an option sets the trigger value and closes.
const COMBO = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #fff; font: 16px sans-serif; }
  #trigger { display: block; margin: 20px; padding: 10px 16px; }
  [role="listbox"][hidden] { display: none; }
  [role="listbox"] { margin: 0 20px; border: 1px solid #ccc; width: 200px; }
  [role="option"] { padding: 10px 12px; }
</style></head><body>
  <button id="trigger" role="combobox" aria-expanded="false" aria-controls="lb">Nov</button>
  <div id="lb" role="listbox" hidden></div>
  <script>
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const lb = document.getElementById('lb');
    const trigger = document.getElementById('trigger');
    lb.innerHTML = months.map((m) => '<div role="option">' + m + '</div>').join('');
    trigger.addEventListener('click', () => {
      const open = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', String(!open));
      lb.hidden = open;
    });
    lb.addEventListener('click', (e) => {
      const opt = e.target.closest('[role="option"]');
      if (!opt) return;
      trigger.textContent = opt.textContent;
      trigger.setAttribute('aria-expanded', 'false');
      lb.hidden = true;
    });
  </script>
</body></html>`;

let browser: Browser;
let page: Page;
let driver: PlaywrightDriver;

/** Locate a real element's center as an image-px bbox (or "not found"). */
async function bboxOf(selectorFindsText: { sel: string; text?: string }, dpr: number) {
  const rect = await page.evaluate(({ sel, text }) => {
    const els = Array.from(document.querySelectorAll(sel));
    const el = text ? els.find((e) => e.textContent?.trim() === text) : els[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  }, selectorFindsText);
  if (!rect) return undefined;
  return [rect.l * dpr, rect.t * dpr, (rect.l + rect.w) * dpr, (rect.t + rect.h) * dpr] as [
    number,
    number,
    number,
    number,
  ];
}

const triggerText = (): Promise<string> => page.$eval("#trigger", (t) => t.textContent ?? "");

function makeTier(targetMonth: string): ModelTier {
  return {
    kind: "grounding",
    async buildContext(p): Promise<UIContext> {
      const shot = await p.screenshot();
      const openList = await p
        .evaluate<OpenListResult>(detectOpenListbox)
        .catch(() => ({ open: false }) as OpenListResult);
      return {
        screenshotDataUrl: shot.base64,
        size: { width: shot.width, height: shot.height },
        dpr: shot.dpr,
        overlay: { present: false },
        openList,
      };
    },
    async locate(ctx, instruction): Promise<LocateModelResult> {
      // option-by-label → the real option element
      const m = instruction.match(/labelled (\w+)/i);
      if (m) {
        const bbox = await bboxOf({ sel: '[role="option"]', text: m[1] }, ctx.dpr);
        return bbox
          ? { bbox, raw: {} }
          : { bbox: undefined, errors: ["option not found"], raw: {} };
      }
      // the trigger, only when described in its CURRENT (no stale value) form
      if (
        /dropdown|combobox|select/i.test(instruction) &&
        !/showing|currently/i.test(instruction)
      ) {
        const bbox = await bboxOf({ sel: "#trigger" }, ctx.dpr);
        return bbox ? { bbox, raw: {} } : { bbox: undefined, raw: {} };
      }
      // a stale closed-trigger description ("... currently showing Nov") is not
      // on screen while the list is open → miss.
      return { bbox: undefined, errors: ["no such control on screen"], raw: {} };
    },
    async plan(ctx): Promise<PlanModelResult> {
      if ((await triggerText()) === targetMonth) {
        return { complete: { success: true, message: `selected ${targetMonth}` } };
      }
      if (!ctx.openList?.open) {
        return { action: { type: "Tap", param: { locate: { prompt: "the month dropdown" } } } };
      }
      // OPEN: the two planners diverge here.
      const prompt =
        PLANNER === "signal"
          ? `the option labelled ${targetMonth} in the open list`
          : "the month dropdown currently showing Nov";
      return { action: { type: "Tap", param: { locate: { prompt } } } };
    },
  };
}

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});
beforeEach(async () => {
  page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 800, height: 600 } });
  await page.setContent(COMBO);
  driver = new PlaywrightDriver(page);
});
afterEach(async () => {
  await page?.close();
});

describe("act() selects an option from an OPEN dropdown", () => {
  it("opens the dropdown and picks the option from the open list", async () => {
    const result = await act(driver, makeTier("Mar"), "set the month dropdown to Mar", {
      maxPlanningSteps: 15,
    });
    expect(result.success).toBe(true);
    expect(await triggerText()).toBe("Mar");
  });
});
