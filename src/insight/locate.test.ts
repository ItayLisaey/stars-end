/**
 * locate() auto-engages the two-stage deep-locate pass when the coarse hit is a
 * SMALL / icon-only target, not only when the coarse locate returns nothing.
 * Reproduces the "TooManyErrors on tiny icon-only controls" failure mode, where
 * a low-precision coarse box should be refined before it is trusted.
 *
 * Fully mocked tier + driver — no browser, no model.
 */
import { describe, expect, it, vi } from "vitest";
import type { PageDriver } from "../driver/types.js";
import { expandSearchArea, pixelBboxToRect } from "../geometry/coordinates.js";
import type { LocateModelResult, ModelTier, UIContext } from "../model/types.js";
import type { PixelBbox } from "../types.js";
import { locate } from "./locate.js";

const ctx: UIContext = {
  screenshotDataUrl: "data:image/jpeg;base64,FULL",
  size: { width: 1000, height: 1000 },
  dpr: 1,
};

const UPSCALE = 2;
const section: PixelBbox = [400, 400, 700, 700];
const area = expandSearchArea(pixelBboxToRect(section), ctx.size);

/** A driver whose evaluate serves the crop request and a null xpath. */
function driverFor(crop: unknown): PageDriver {
  return {
    evaluate: vi.fn(async (_fn: unknown, arg: unknown) => {
      if (arg && typeof arg === "object" && "dataUrl" in (arg as object)) return crop;
      return null; // getXpathsByPoint
    }),
  } as unknown as PageDriver;
}

/**
 * Tier where the coarse hit is `coarse`, the deep-locate section is `section`,
 * and the refined crop maps back to `refinedTarget` (original image px).
 */
function tierFor(
  coarse: LocateModelResult,
  refinedTarget?: PixelBbox,
): {
  tier: ModelTier;
  instructions: string[];
} {
  const instructions: string[] = [];
  const refinedCrop: PixelBbox | undefined = refinedTarget && [
    (refinedTarget[0] - area.left) * UPSCALE,
    (refinedTarget[1] - area.top) * UPSCALE,
    (refinedTarget[2] - area.left) * UPSCALE,
    (refinedTarget[3] - area.top) * UPSCALE,
  ];
  const tier: ModelTier = {
    kind: "grounding",
    buildContext: vi.fn(),
    plan: vi.fn(),
    async locate(c, instruction): Promise<LocateModelResult> {
      instructions.push(instruction);
      if (instruction.startsWith("the area containing")) return { bbox: section, raw: {} };
      if (c.size.width === ctx.size.width) return coarse; // coarse pass on full image
      return refinedCrop ? { bbox: refinedCrop, raw: {} } : { bbox: undefined, raw: {} };
    },
  };
  return { tier, instructions };
}

const crop = {
  dataUrl: "data:image/jpeg;base64,CROP",
  width: area.width * UPSCALE,
  height: area.height * UPSCALE,
};

describe("locate auto deep-locate on small targets", () => {
  it("refines a small (icon-sized) coarse hit via deep-locate and returns the refined point", async () => {
    // coarse hit is a ~10px icon -> small -> should re-resolve.
    const coarse: LocateModelResult = { bbox: [500, 500, 510, 510], raw: {} };
    const refinedTarget: PixelBbox = [600, 600, 620, 620]; // inclusive center (611,611)
    const { tier, instructions } = tierFor(coarse, refinedTarget);

    const r = await locate(driverFor(crop), tier, "the send icon button", { context: ctx });

    // returned the refined center, not the coarse one (would be ~506)
    expect(r.x).toBe(611);
    expect(r.y).toBe(611);
    // engaged the second pass: coarse + section + refine
    expect(instructions[0]).toBe("the send icon button");
    expect(instructions).toContain("the area containing the send icon button");
  });

  it("does NOT deep-locate a comfortably large coarse hit", async () => {
    const coarse: LocateModelResult = { bbox: [100, 100, 400, 200], raw: {} }; // 300x100
    const { tier, instructions } = tierFor(coarse);

    const r = await locate(driverFor(crop), tier, "the big primary button", { context: ctx });

    expect(r.x).toBe(251); // coarse center (inclusive bbox)
    expect(r.y).toBe(151);
    expect(instructions).toEqual(["the big primary button"]); // single pass only
  });

  it("falls back to the coarse hit when the refine pass finds nothing", async () => {
    const coarse: LocateModelResult = { bbox: [500, 500, 512, 512], raw: {} }; // small
    const { tier } = tierFor(coarse, undefined); // refine returns no bbox

    const r = await locate(driverFor(crop), tier, "the tiny toggle", { context: ctx });

    // keeps the coarse center (507,507) rather than throwing
    expect(r.x).toBe(507);
    expect(r.y).toBe(507);
  });
});
