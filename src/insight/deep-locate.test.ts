import { describe, expect, it, vi } from "vitest";
import type { PageDriver } from "../driver/types.js";
import { expandSearchArea, pixelBboxToRect } from "../geometry/coordinates.js";
import type { LocateModelResult, ModelTier, UIContext } from "../model/types.js";
import type { PixelBbox } from "../types.js";
import { deepLocate } from "./deep-locate.js";

const ctx: UIContext = {
  screenshotDataUrl: "data:image/jpeg;base64,FULL",
  size: { width: 1000, height: 1000 },
  dpr: 1,
};

function stubDriver(cropResult: unknown): PageDriver {
  return {
    evaluate: vi.fn().mockResolvedValue(cropResult),
  } as unknown as PageDriver;
}

describe("deepLocate orchestration", () => {
  it("section -> expand -> crop -> refine -> map back to original image px", async () => {
    const section: PixelBbox = [400, 400, 499, 499];
    const area = expandSearchArea(pixelBboxToRect(section), ctx.size);
    const scale = 2;
    const crop = {
      dataUrl: "data:image/jpeg;base64,CROP",
      width: area.width * scale,
      height: area.height * scale,
    };

    // target sits at original image px [620, 540, 700, 580]; the refined locate
    // returns it in crop-space coords.
    const target: PixelBbox = [620, 540, 700, 580];
    const refinedCrop: PixelBbox = [
      (target[0] - area.left) * scale,
      (target[1] - area.top) * scale,
      (target[2] - area.left) * scale,
      (target[3] - area.top) * scale,
    ];

    const calls: Array<{ size: UIContext["size"]; instruction: string }> = [];
    const tier: ModelTier = {
      kind: "grounding",
      buildContext: vi.fn(),
      plan: vi.fn(),
      async locate(c, instruction): Promise<LocateModelResult> {
        calls.push({ size: c.size, instruction });
        // first call = coarse section on the FULL image
        if (instruction.startsWith("the area containing")) {
          return { bbox: section, raw: {} };
        }
        // second call = refine within the upscaled crop
        return { bbox: refinedCrop, raw: {} };
      },
    };

    const driver = stubDriver(crop);
    const result = await deepLocate(driver, tier, ctx, "the tiny target");

    // mapped back to original image space
    expect(result.bbox).toEqual(target);
    // it asked for the section first (full image), then refined on the crop
    expect(calls[0].instruction).toBe("the area containing the tiny target");
    expect(calls[0].size).toEqual({ width: 1000, height: 1000 });
    expect(calls[1].instruction).toBe("the tiny target");
    expect(calls[1].size).toEqual({ width: crop.width, height: crop.height });
    // the crop was requested from the page with the expanded area + scale 2
    expect(driver.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ left: area.left, top: area.top, scale: 2 }),
    );
  });

  it("returns the section result unchanged when the section locate fails", async () => {
    const tier: ModelTier = {
      kind: "grounding",
      buildContext: vi.fn(),
      plan: vi.fn(),
      locate: vi.fn().mockResolvedValue({ bbox: undefined, errors: ["nope"], raw: {} }),
    };
    const driver = stubDriver(null);
    const result = await deepLocate(driver, tier, ctx, "missing");
    expect(result.bbox).toBeUndefined();
    expect(result.errors).toEqual(["nope"]);
    // never attempted a crop
    expect(driver.evaluate).not.toHaveBeenCalled();
  });

  it("falls back to the section result when the crop step fails", async () => {
    const section: PixelBbox = [10, 10, 50, 50];
    const tier: ModelTier = {
      kind: "grounding",
      buildContext: vi.fn(),
      plan: vi.fn(),
      locate: vi.fn().mockResolvedValue({ bbox: section, raw: {} }),
    };
    const driver = stubDriver(null); // crop returns null -> give up gracefully
    const result = await deepLocate(driver, tier, ctx, "x");
    expect(result.bbox).toEqual(section);
  });
});
