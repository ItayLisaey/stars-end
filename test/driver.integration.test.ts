/**
 * Integration tests against a local HTML page using headless Chromium (no
 * model). Validates the driver primitives and the injected xpath extractor
 * end-to-end.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { PlaywrightDriver } from "../src/driver/playwright-driver.js";
import { parseHotkey } from "../src/driver/keyboard.js";
import { getXpathsByPoint, resolveXpathToPoint } from "../src/extractor/xpath.injected.js";

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 16px sans-serif; }
  #panel { height: 2000px; }
  button { position: absolute; left: 40px; top: 60px; width: 160px; height: 40px; }
  #email { position: absolute; left: 40px; top: 140px; width: 240px; height: 30px; }
  #log { position: absolute; left: 40px; top: 200px; }
</style></head><body>
  <div id="panel">
    <button id="cart" onclick="document.getElementById('log').textContent='clicked'">Add to cart</button>
    <input id="email" placeholder="email" />
    <div id="log"></div>
  </div>
</body></html>`;

let browser: Browser;
let page: Page;
let driver: PlaywrightDriver;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({
    deviceScaleFactor: 2,
    viewport: { width: 800, height: 600 },
  });
  await page.setContent(HTML);
  driver = new PlaywrightDriver(page);
});

afterAll(async () => {
  await browser?.close();
});

describe("PlaywrightDriver", () => {
  it("screenshot reports image px = CSS px * dpr", async () => {
    const shot = await driver.screenshot();
    expect(shot.dpr).toBe(2);
    expect(shot.width).toBe(1600); // 800 * 2
    expect(shot.height).toBe(1200); // 600 * 2
    expect(shot.base64.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("size() returns CSS px", async () => {
    expect(await driver.size()).toEqual({ width: 800, height: 600 });
  });

  it("tap lands on the right element (CSS px coords)", async () => {
    await driver.tap(120, 80); // center of the button
    expect(await page.locator("#log").textContent()).toBe("clicked");
  });

  it("type + clearInput round-trips a field", async () => {
    await driver.tap(160, 155); // focus the input
    await driver.type("hello@example.com");
    expect(await page.locator("#email").inputValue()).toBe("hello@example.com");
    await driver.clearInput({ x: 160, y: 155 });
    expect(await page.locator("#email").inputValue()).toBe("");
  });

  it("press maps a hotkey and types into the focused field", async () => {
    await driver.tap(160, 155);
    await driver.type("abc");
    await driver.press(parseHotkey("Backspace"));
    expect(await page.locator("#email").inputValue()).toBe("ab");
  });

  it("wheel scrolls the page", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await driver.wheel(0, 500);
    // mouse.wheel dispatches asynchronously — wait for the scroll to apply.
    await page.waitForFunction(() => window.scrollY > 100, undefined, {
      timeout: 2000,
    });
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  });

  it("scrollTo bottom reaches the end", async () => {
    await driver.scrollTo("bottom");
    await page.waitForFunction(
      () => window.scrollY + window.innerHeight >= document.body.scrollHeight - 2,
      undefined,
      { timeout: 2000 },
    );
    expect(true).toBe(true);
  });
});

describe("xpath extractor (injected)", () => {
  beforeAll(async () => {
    // ensure a deterministic, unscrolled viewport for elementFromPoint
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => window.scrollY === 0, undefined, {
      timeout: 2000,
    });
  });

  it("getXpathsByPoint returns an xpath that round-trips via resolveXpathToPoint", async () => {
    // button center in CSS px
    const xpaths = await page.evaluate(getXpathsByPoint, { x: 120, y: 80 });
    expect(xpaths).not.toBeNull();
    const xpath = xpaths![0];
    expect(xpath).toContain("cart"); // anchored on the unique id

    const point = await page.evaluate(resolveXpathToPoint, xpath);
    expect(point).not.toBeNull();
    // resolves back to roughly the button center
    expect(Math.abs(point!.x - 120)).toBeLessThan(5);
    expect(Math.abs(point!.y - 80)).toBeLessThan(5);
  });

  it("resolveXpathToPoint returns null for a non-matching xpath", async () => {
    const point = await page.evaluate(resolveXpathToPoint, '//*[@id="does-not-exist"]');
    expect(point).toBeNull();
  });
});
