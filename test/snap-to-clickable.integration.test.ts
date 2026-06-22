/**
 * Snap-to-clickable: a vision point that's a few px off a button should still
 * click the button, because we resolve the point to the interactive element and
 * click THAT (Playwright actionability) instead of the raw coordinate.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { clickTarget } from "../src/driver/click-target.js";
import { PlaywrightDriver } from "../src/driver/playwright-driver.js";
import { snapToClickableXpath } from "../src/extractor/snap-to-clickable.injected.js";

// A real <button>, a role=button div, an icon button wrapping a <span>, and an
// inert div that only has a JS click listener (not a semantic control).
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 16px sans-serif; }
  #btn  { position: absolute; left: 100px; top: 100px; width: 120px; height: 36px; }
  #rolebtn { position: absolute; left: 100px; top: 200px; width: 120px; height: 36px; border: 1px solid #999; }
  #icon { position: absolute; left: 100px; top: 300px; width: 40px; height: 40px; }
  #inert { position: absolute; left: 400px; top: 100px; width: 120px; height: 36px; background: #eee; }
</style></head><body>
  <button id="btn">Click me</button>
  <div id="rolebtn" role="button" tabindex="0">Role</div>
  <button id="icon"><span id="ic">★</span></button>
  <div id="inert">inert</div>
  <div id="log"></div>
  <script>
    btn.onclick = () => log.textContent = 'btn';
    rolebtn.onclick = () => log.textContent = 'rolebtn';
    document.getElementById('icon').onclick = () => log.textContent = 'icon';
    inert.addEventListener('click', () => log.textContent = 'inert-raw');
  </script>
</body></html>`;

let browser: Browser;
let page: Page;
let driver: PlaywrightDriver;

const snap = (x: number, y: number, radius = 24): Promise<string | null> =>
  page.evaluate(snapToClickableXpath, { x, y, radius });
const log = (): Promise<string> => page.$eval("#log", (d) => d.textContent ?? "");

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

describe("snapToClickableXpath", () => {
  it("snaps an off-center point inside a button to the button", async () => {
    // #btn spans (100,100)-(220,136); a point near its edge still resolves to it
    expect(await snap(106, 103)).toContain("btn");
  });

  it("snaps a point in the margin just outside a button (within radius)", async () => {
    // 8px above the top edge → within the 24px radius
    expect(await snap(160, 92)).toContain("btn");
  });

  it("climbs from an inner span to the enclosing icon button", async () => {
    expect(await snap(120, 320)).toContain("icon");
  });

  it("resolves a role=button element", async () => {
    expect(await snap(160, 218)).toContain("rolebtn");
  });

  it("returns null when the point is far from any interactive element", async () => {
    expect(await snap(460, 118)).toBeNull(); // on the inert div, no control within radius
  });
});

describe("clickTarget (snap + element click, raw fallback)", () => {
  it("clicks a button from an off-center point", async () => {
    await clickTarget(driver, { x: 106, y: 103 });
    expect(await log()).toBe("btn");
  });

  it("clicks the button from a point in its margin", async () => {
    await clickTarget(driver, { x: 160, y: 92 });
    expect(await log()).toBe("btn");
  });

  it("clicks an icon button via its inner span", async () => {
    await clickTarget(driver, { x: 120, y: 320 });
    expect(await log()).toBe("icon");
  });

  it("falls back to a raw click (firing JS listeners) on a non-semantic target", async () => {
    // #inert has only addEventListener — snap returns null, raw click still fires it
    await clickTarget(driver, { x: 460, y: 118 });
    expect(await log()).toBe("inert-raw");
  });
});
