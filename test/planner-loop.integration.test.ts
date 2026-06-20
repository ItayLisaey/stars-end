/**
 * Integration test for the planning loop + executor + cache against a real DOM
 * (no model). A scripted fake ModelTier drives the loop so the executor /
 * locate / cache / action-run path is exercised end-to-end deterministically.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { LocateCache } from "../src/cache/locate-cache.js";
import { PlaywrightDriver } from "../src/driver/playwright-driver.js";
import { act } from "../src/planner/loop.js";
import type { ModelTier, PlanModelResult, UIContext } from "../src/model/types.js";
import type { Step } from "../src/types.js";

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 16px sans-serif; }
  #cart { position: absolute; left: 40px; top: 60px; width: 160px; height: 40px; }
  #count { position: absolute; left: 40px; top: 140px; }
</style></head><body>
  <button id="cart" onclick="window.clickCount=(window.clickCount||0)+1">Add to cart</button>
  <div id="count"></div>
</body></html>`;

let browser: Browser;
let page: Page;
let driver: PlaywrightDriver;
let dir: string;

/** Fake tier: locate returns the #cart center as an image-px bbox; plan is scripted. */
function makeTier(script: PlanModelResult[]): { tier: ModelTier; locateCalls: () => number } {
  let locateCalls = 0;
  let planIndex = 0;
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
      locateCalls++;
      // #cart center CSS (120,80) -> image px = *dpr
      const cx = 120 * ctx.dpr;
      const cy = 80 * ctx.dpr;
      return {
        bbox: [cx - 2, cy - 2, cx + 2, cy + 2] as [number, number, number, number],
        raw: {},
      };
    },
    async plan(_ctx: UIContext, _goal: string, _history: Step[]) {
      return script[Math.min(planIndex++, script.length - 1)];
    },
  };
  return { tier, locateCalls: () => locateCalls };
}

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});
beforeEach(async () => {
  page = await browser.newPage({
    deviceScaleFactor: 2,
    viewport: { width: 800, height: 600 },
  });
  await page.setContent(HTML);
  driver = new PlaywrightDriver(page);
  dir = mkdtempSync(join(tmpdir(), "stars-end-loop-"));
});
afterEach(async () => {
  await page.close();
  rmSync(dir, { recursive: true, force: true });
});

const clicks = () => page.evaluate(() => (window as any).clickCount ?? 0);

describe("act() loop against real DOM", () => {
  it("executes a Tap then completes", async () => {
    const { tier } = makeTier([
      {
        thought: "click cart",
        action: {
          type: "Tap",
          param: { locate: { prompt: "the cart button" } },
        },
      },
      { thought: "done", complete: { success: true, message: "added" } },
    ]);

    const result = await act(driver, tier, "add to cart");
    expect(result.success).toBe(true);
    expect(result.message).toBe("added");
    expect(result.steps).toHaveLength(1);
    expect(await clicks()).toBe(1);
  });

  it("writes a locate cache entry on the AI-locate path", async () => {
    const cache = new LocateCache({ id: "loop", dir });
    const { tier } = makeTier([
      {
        action: {
          type: "Tap",
          param: { locate: { prompt: "the cart button" } },
        },
      },
      { complete: { success: true } },
    ]);
    await act(driver, tier, "add to cart", { cache });
    expect(cache.entries).toHaveLength(1);
    expect(cache.entries[0].prompt).toBe("the cart button");
    expect(cache.entries[0].xpaths[0]).toContain("cart");
  });

  it("second run reuses the cache and skips the model locate", async () => {
    // first run populates the cache file
    const writeCache = new LocateCache({ id: "reuse", dir });
    const first = makeTier([
      {
        action: {
          type: "Tap",
          param: { locate: { prompt: "the cart button" } },
        },
      },
      { complete: { success: true } },
    ]);
    await act(driver, first.tier, "add to cart", { cache: writeCache });
    writeCache.flush();
    expect(first.locateCalls()).toBe(1);

    // second run: fresh cache loaded from disk -> xpath resolves, no model locate
    const readCache = new LocateCache({ id: "reuse", dir });
    const second = makeTier([
      {
        action: {
          type: "Tap",
          param: { locate: { prompt: "the cart button" } },
        },
      },
      { complete: { success: true } },
    ]);
    await act(driver, second.tier, "add to cart", { cache: readCache });
    expect(second.locateCalls()).toBe(0); // served from xpath cache
    expect(await clicks()).toBe(2); // both runs tapped the same page
  });

  it('throws ActionFailedError on <complete success="false">', async () => {
    const { tier } = makeTier([{ complete: { success: false, message: "cannot find item" } }]);
    await expect(act(driver, tier, "impossible goal")).rejects.toThrow(/cannot find item/);
  });
});
