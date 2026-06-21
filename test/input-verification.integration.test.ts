/**
 * Reproduces the "input reports success but no text lands" failure mode: a
 * rich/contenteditable composer where focus never reaches the field, so typing
 * goes nowhere yet the action used to return success. The Input action must now
 * read the field back and throw InputVerificationError when it stays empty.
 *
 * Drives the Input action's run() directly with a resolved point (no model).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { PlaywrightDriver } from "../src/driver/playwright-driver.js";
import { InputVerificationError } from "../src/errors.js";
import { findAction } from "../src/planner/action-space.js";
import type { ExecCtx } from "../src/planner/action-space.js";

// #email: normal input. #good: a working contenteditable composer. #bad: a
// contenteditable composer that swallows the focusing click (mousedown
// preventDefault), so typing never lands — exactly the rich-composer trap.
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #fff; font: 16px sans-serif; }
  #email { position: absolute; left: 40px; top: 40px; width: 240px; height: 30px; }
  #good, #bad { position: absolute; left: 40px; width: 240px; height: 40px;
                border: 1px solid #ccc; }
  #good { top: 100px; }
  #bad  { top: 180px; }
</style></head><body>
  <input id="email" placeholder="email" />
  <div id="good" contenteditable="true"></div>
  <div id="bad" contenteditable="true"></div>
  <script>
    // The bad composer manages its own focus and breaks ours: blocking mousedown
    // prevents the click from moving focus into the field.
    document.getElementById('bad').addEventListener('mousedown', (e) => e.preventDefault());
  </script>
</body></html>`;

let browser: Browser;
let page: Page;
let driver: PlaywrightDriver;

const Input = findAction("Input")!;

function ctxAt(x: number, y: number): ExecCtx {
  return { driver, point: { x, y }, viewport: { width: 800, height: 600 } };
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

describe("Input verifies text landed", () => {
  it("types into a normal input and confirms the value", async () => {
    await Input.run(ctxAt(160, 55), { value: "hello@example.com", mode: "replace" });
    expect(await page.locator("#email").inputValue()).toBe("hello@example.com");
  });

  it("types into a working contenteditable composer", async () => {
    await Input.run(ctxAt(160, 120), { value: "ask anything", mode: "replace" });
    expect(await page.locator("#good").textContent()).toBe("ask anything");
  });

  it("throws InputVerificationError when text does not land in a rich composer (A3)", async () => {
    await expect(
      Input.run(ctxAt(160, 200), { value: "this never lands", mode: "replace" }),
    ).rejects.toBeInstanceOf(InputVerificationError);
    // and the field really is still empty — no false success
    expect(await page.locator("#bad").textContent()).toBe("");
  });

  it("does not verify (and does not throw) on a clear", async () => {
    await expect(Input.run(ctxAt(160, 200), { value: "", mode: "clear" })).resolves.toBeUndefined();
  });

  it("driver.readEditableValue reads a focused input back", async () => {
    await driver.tap(160, 55);
    await driver.type("abc");
    expect(await driver.readEditableValue({ x: 160, y: 55 })).toBe("abc");
  });
});
