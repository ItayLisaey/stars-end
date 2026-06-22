/**
 * Covers the "re-locating an OPEN combobox" flake: after a dropdown opens, the
 * screen shows the option LIST, not the closed trigger — but the planner tends
 * to keep re-locating the trigger by its old value and loops.
 *
 * Two parts:
 *  1. detectOpenListbox recognizes the open-list state against real custom
 *     comboboxes (inline + portalled + menu), so the planner can be told.
 *  2. the act() loop's Escape recovery does NOT fire while a dropdown is open
 *     (Escape would close the very list the agent is operating).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { PlaywrightDriver } from "../src/driver/playwright-driver.js";
import { NoProgressError } from "../src/errors.js";
import { detectOpenListbox, type OpenListResult } from "../src/insight/open-listbox.injected.js";
import { act } from "../src/planner/loop.js";
import type { ModelTier, PlanModelResult, UIContext } from "../src/model/types.js";

// A custom combobox (Radix-style): button trigger + role=listbox of options that
// toggles on click. The trigger shows a closed value ("Nov"); opening it reveals
// 12 month options.
const COMBO = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #fff; font: 16px sans-serif; }
  [role="listbox"][hidden] { display: none; }
  [role="listbox"] { border: 1px solid #ccc; }
  [role="option"] { padding: 6px 10px; }
</style></head><body>
  <button id="trigger" role="combobox" aria-expanded="false" aria-controls="lb">Nov</button>
  <div id="lb" role="listbox" hidden></div>
  <script>
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const lb = document.getElementById('lb');
    lb.innerHTML = months.map((m) => '<div role="option">' + m + '</div>').join('');
    const trigger = document.getElementById('trigger');
    trigger.addEventListener('click', () => {
      const open = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', String(!open));
      lb.hidden = open;
    });
  </script>
</body></html>`;

let browser: Browser;
let page: Page;
let driver: PlaywrightDriver;

const detect = (): Promise<OpenListResult> => page.evaluate(detectOpenListbox);

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});
beforeEach(async () => {
  page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 800, height: 600 } });
  driver = new PlaywrightDriver(page);
});
afterEach(async () => {
  await page?.close();
});

describe("detectOpenListbox", () => {
  it("reports closed while the dropdown trigger is collapsed", async () => {
    await page.setContent(COMBO);
    expect(await detect()).toEqual({ open: false });
  });

  it("reports open with the option count once the dropdown is opened", async () => {
    await page.setContent(COMBO);
    await page.click("#trigger");
    const r = await detect();
    expect(r.open).toBe(true);
    expect(r.optionCount).toBe(12);
  });

  it("detects an expanded combobox whose option list is portalled elsewhere", async () => {
    // Radix portals the listbox to the end of <body>, detached from the trigger.
    await page.setContent(`<body style="margin:0">
      <button role="combobox" aria-expanded="true" aria-controls="p">Nov</button>
      <div id="p" role="listbox">
        <div role="option">Oct</div><div role="option">Nov</div><div role="option">Dec</div>
      </div>
    </body>`);
    const r = await detect();
    expect(r.open).toBe(true);
    expect(r.optionCount).toBe(3);
  });

  it("detects an open role=menu of menuitems", async () => {
    await page.setContent(`<body style="margin:0">
      <div role="menu"><div role="menuitem">A</div><div role="menuitem">B</div></div>
    </body>`);
    expect((await detect()).open).toBe(true);
  });

  it("ignores a hidden listbox", async () => {
    await page.setContent(`<body>
      <div role="listbox" style="display:none"><div role="option">x</div></div>
    </body>`);
    expect(await detect()).toEqual({ open: false });
  });
});

/** Fake tier with caller-controlled overlay/openList signals; taps are no-ops. */
function makeTier(signals: { overlayPresent: boolean; listOpen: boolean }): ModelTier {
  return {
    kind: "grounding",
    async buildContext(p): Promise<UIContext> {
      const shot = await p.screenshot();
      return {
        screenshotDataUrl: shot.base64,
        size: { width: shot.width, height: shot.height },
        dpr: shot.dpr,
        overlay: { present: signals.overlayPresent },
        openList: { open: signals.listOpen },
      };
    },
    async locate(ctx: UIContext) {
      const d = ctx.dpr;
      return { bbox: [8 * d, 8 * d, 64 * d, 44 * d] as [number, number, number, number], raw: {} };
    },
    async plan(): Promise<PlanModelResult> {
      return { action: { type: "Tap", param: { locate: { prompt: "the option" } } } };
    },
  };
}

describe("act() Escape recovery composes with open dropdowns", () => {
  beforeEach(async () => {
    await page.setContent(`<body style="margin:0"><div id="x">static</div></body>`);
  });

  it("does NOT Escape while a dropdown is open (would close the list)", async () => {
    const pressSpy = vi.spyOn(driver, "press");
    const tier = makeTier({ overlayPresent: true, listOpen: true });

    await expect(
      act(driver, tier, "pick an option", { maxPlanningSteps: 12 }),
    ).rejects.toBeInstanceOf(NoProgressError);
    const escaped = pressSpy.mock.calls.some(
      (c) => (c[0] as { key: string }[])[0]?.key === "Escape",
    );
    expect(escaped).toBe(false);
  });

  it("DOES Escape for a blocking overlay when no dropdown is open", async () => {
    const pressSpy = vi.spyOn(driver, "press");
    const tier = makeTier({ overlayPresent: true, listOpen: false });

    await act(driver, tier, "dismiss the guard", { maxPlanningSteps: 12 }).catch(() => {});
    const escaped = pressSpy.mock.calls.some(
      (c) => (c[0] as { key: string }[])[0]?.key === "Escape",
    );
    expect(escaped).toBe(true);
  });
});
