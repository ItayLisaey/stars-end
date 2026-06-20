/**
 * Integration test for the deep-locate crop+upscale helper against a real
 * browser canvas (no model). Verifies the injected `cropAndScaleDataUrl`
 * produces a correctly sized JPEG from a source data URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { cropAndScaleDataUrl } from "../src/insight/image-crop.injected.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
});
afterAll(async () => {
  await browser?.close();
});

describe("cropAndScaleDataUrl", () => {
  it("crops a sub-rect and upscales it 2x", async () => {
    // build a known 100x100 source image in the page
    const source = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 100;
      c.height = 100;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#3366cc";
      ctx.fillRect(0, 0, 100, 100);
      return c.toDataURL("image/png");
    });

    const result = await page.evaluate(cropAndScaleDataUrl, {
      dataUrl: source,
      left: 10,
      top: 20,
      width: 40,
      height: 30,
      scale: 2,
    });

    expect(result.width).toBe(80); // 40 * 2
    expect(result.height).toBe(60); // 30 * 2
    expect(result.dataUrl.startsWith("data:image/jpeg")).toBe(true);

    // the produced data URL decodes to an image of the reported size
    const decoded = await page.evaluate(
      (url) =>
        new Promise<{ w: number; h: number }>((resolve, reject) => {
          const img = new Image();
          img.addEventListener("load", () =>
            resolve({ w: img.naturalWidth, h: img.naturalHeight }),
          );
          img.addEventListener("error", () => reject(new Error("decode failed")));
          img.src = url;
        }),
      result.dataUrl,
    );
    expect(decoded).toEqual({ w: 80, h: 60 });
  });
});
