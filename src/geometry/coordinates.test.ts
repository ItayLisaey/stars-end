import { describe, expect, it } from "vitest";
import type { CoordinateAdapter } from "../types.js";
import {
  adaptModelCoordinatesToPixelBbox,
  expandPointToBbox,
  expandSearchArea,
  mapSearchAreaPixelBboxToOriginalPixelBbox,
  maxPixelIndex,
  mergePixelBboxesToRect,
  normalizedToPixelIndex,
  parseNumericLocateResult,
  pixelBboxToRect,
  rectCenter,
  rectToPixelBbox,
  unwrapCoordinateList,
} from "./coordinates.js";

const xyBbox: CoordinateAdapter = { shape: "bbox", order: "xy" };
const gemini: CoordinateAdapter = {
  shape: "bbox",
  order: "yx",
  normalizedBy: 1000,
};

function adaptToRect(
  input: unknown,
  prepared: { width: number; height: number },
  content?: { width: number; height: number },
) {
  return pixelBboxToRect(adaptModelCoordinatesToPixelBbox(input, xyBbox, prepared, content));
}

describe("adaptModelCoordinatesToPixelBbox — boundary overflow cases", () => {
  it("throws on x1 overflow (negative left)", () => {
    expect(() =>
      adaptModelCoordinatesToPixelBbox([-100, 200, 300, 400], xyBbox, {
        width: 2000,
        height: 3000,
      }),
    ).toThrow(/exceed image size/);
  });

  it("throws on y1 overflow (negative top)", () => {
    expect(() =>
      adaptModelCoordinatesToPixelBbox([200, -100, 400, 300], xyBbox, {
        width: 2000,
        height: 3000,
      }),
    ).toThrow(/exceed image size/);
  });

  it("throws on x2 overflow (right exceeds width)", () => {
    expect(() =>
      adaptModelCoordinatesToPixelBbox([1600, 200, 2200, 400], xyBbox, {
        width: 2000,
        height: 3000,
      }),
    ).toThrow(/exceed image size/);
  });

  it("throws on y2 overflow (bottom exceeds height)", () => {
    expect(() =>
      adaptModelCoordinatesToPixelBbox([200, 2600, 400, 3200], xyBbox, {
        width: 2000,
        height: 3000,
      }),
    ).toThrow(/exceed image size/);
  });

  it("throws before clamping to content size when bbox exceeds image size", () => {
    expect(() =>
      adaptModelCoordinatesToPixelBbox(
        [25, 154, 153, 186],
        xyBbox,
        { width: 301, height: 164 },
        { width: 140, height: 160 },
      ),
    ).toThrow(/exceed image size/);
  });

  it("clamps bbox fully inside right padding to content size", () => {
    expect(
      adaptToRect(
        [1100, 100, 1190, 200],
        { width: 1200, height: 1000 },
        {
          width: 1000,
          height: 1000,
        },
      ),
    ).toEqual({
      left: 999,
      top: 100,
      width: 1,
      height: 101,
    });
  });

  it("clamps bbox fully inside bottom padding to content size", () => {
    expect(
      adaptToRect(
        [100, 1100, 200, 1190],
        { width: 1000, height: 1200 },
        {
          width: 1000,
          height: 1000,
        },
      ),
    ).toEqual({
      left: 100,
      top: 999,
      width: 101,
      height: 1,
    });
  });
});

describe("mapSearchAreaPixelBboxToOriginalPixelBbox", () => {
  it("works without explicit scale", () => {
    expect(mapSearchAreaPixelBboxToOriginalPixelBbox([100, 200, 300, 400])).toEqual([
      100, 200, 300, 400,
    ]);
  });
  it("works with scale = 1", () => {
    expect(
      mapSearchAreaPixelBboxToOriginalPixelBbox([100, 200, 300, 400], {
        offset: { x: 0, y: 0 },
        scale: 1,
      }),
    ).toEqual([100, 200, 300, 400]);
  });
  it("scales down by 2", () => {
    expect(
      mapSearchAreaPixelBboxToOriginalPixelBbox([200, 400, 600, 800], {
        offset: { x: 0, y: 0 },
        scale: 2,
      }),
    ).toEqual([100, 200, 300, 400]);
  });
  it("scales down by 1.5", () => {
    expect(
      mapSearchAreaPixelBboxToOriginalPixelBbox([150, 300, 450, 600], {
        offset: { x: 0, y: 0 },
        scale: 1.5,
      }),
    ).toEqual([100, 200, 300, 400]);
  });
  it("applies offset after scaling", () => {
    expect(
      mapSearchAreaPixelBboxToOriginalPixelBbox([200, 400, 600, 800], {
        offset: { x: 100, y: 150 },
        scale: 2,
      }),
    ).toEqual([200, 350, 400, 550]);
  });
});

// ---- Gemini-specific rows (order:'yx', normalizedBy:1000) ----

describe("Gemini grounding adapter (yx, normalized 0–1000)", () => {
  it("reorders yx -> xy and denormalizes by size-1", () => {
    // normalized [ymin,xmin,ymax,xmax] = [0, 0, 1000, 1000] over a 100x100 image
    // -> full image inclusive bbox [0,0,99,99]
    const bbox = adaptModelCoordinatesToPixelBbox([0, 0, 1000, 1000], gemini, {
      width: 100,
      height: 100,
    });
    expect(bbox).toEqual([0, 0, 99, 99]);
  });

  it("maps a centered normalized bbox correctly", () => {
    // y=[250,750], x=[250,750] over 1000x1000 px image (max index 999)
    const bbox = adaptModelCoordinatesToPixelBbox([250, 250, 750, 750], gemini, {
      width: 1000,
      height: 1000,
    });
    // round(250 * 999 / 1000) = 250 ; round(750 * 999 / 1000) = 749
    expect(bbox).toEqual([250, 250, 749, 749]);
    const rect = pixelBboxToRect(bbox);
    expect(rectCenter(rect)).toEqual({ x: 500, y: 500 });
  });

  it("rejects normalized coords outside [0,1000]", () => {
    expect(() =>
      adaptModelCoordinatesToPixelBbox([0, 0, 1200, 500], gemini, {
        width: 800,
        height: 600,
      }),
    ).toThrow(/exceed normalized range/);
  });

  it("expands a normalized point to a box (point shape)", () => {
    const pointAdapter: CoordinateAdapter = {
      shape: "point",
      order: "yx",
      normalizedBy: 1000,
    };
    // point [y=500, x=500] -> half size 1000/100=10 -> [490,490,510,510] normalized
    const bbox = adaptModelCoordinatesToPixelBbox([500, 500], pointAdapter, {
      width: 1000,
      height: 1000,
    });
    expect(bbox).toEqual([
      normalizedToPixelIndex(490, 1000, 1000),
      normalizedToPixelIndex(490, 1000, 1000),
      normalizedToPixelIndex(510, 1000, 1000),
      normalizedToPixelIndex(510, 1000, 1000),
    ]);
  });
});

describe("coordinate junk normalization", () => {
  it("unwraps nested [[...]]", () => {
    expect(unwrapCoordinateList([[1, 2, 3, 4]])).toEqual([1, 2, 3, 4]);
  });
  it('parses a "y,x" string for point shape', () => {
    expect(parseNumericLocateResult({ shape: "point", order: "yx" }, "300, 500")).toEqual({
      type: "point",
      coordinates: [300, 500],
    });
  });
  it("parses whitespace-separated bbox string", () => {
    expect(parseNumericLocateResult({ shape: "bbox", order: "xy" }, "10 20 30 40")).toEqual({
      type: "bbox",
      coordinates: [10, 20, 30, 40],
    });
  });
  it("throws on non-numeric junk", () => {
    expect(() => parseNumericLocateResult({ shape: "bbox", order: "xy" }, "a,b,c,d")).toThrow(
      /invalid bbox/,
    );
  });
});

describe("pixel helpers", () => {
  it("maxPixelIndex floors at 0", () => {
    expect(maxPixelIndex(0)).toBe(0);
    expect(maxPixelIndex(1)).toBe(0);
    expect(maxPixelIndex(100)).toBe(99);
  });
  it("expandPointToBbox clamps at edges", () => {
    expect(expandPointToBbox(5, 5, 100, 100, 10)).toEqual([0, 0, 15, 15]);
  });
  it("pixelBboxToRect uses inclusive +1 width/height", () => {
    expect(pixelBboxToRect([10, 20, 19, 29])).toEqual({
      left: 10,
      top: 20,
      width: 10,
      height: 10,
    });
  });
  it("mergePixelBboxesToRect bounds multiple boxes", () => {
    expect(
      mergePixelBboxesToRect([
        [10, 10, 20, 20],
        [30, 5, 40, 50],
      ]),
    ).toEqual({
      left: 10,
      top: 5,
      width: 31,
      height: 46,
    });
  });
});

describe("expandSearchArea", () => {
  it("extends each side by 100px, clamped to screen", () => {
    const area = expandSearchArea(
      { left: 500, top: 500, width: 400, height: 400 },
      { width: 2000, height: 2000 },
    );
    // already >= 400x400 after +100 each side -> returns the expanded rect
    expect(area).toEqual({ left: 400, top: 400, width: 600, height: 600 });
  });

  it("scales a tiny rect up from center to a 400x400 minimum area", () => {
    const area = expandSearchArea(
      { left: 1000, top: 1000, width: 10, height: 10 },
      { width: 4000, height: 4000 },
    );
    // +100 each side -> 210x210 = 44100 < 160000 -> scale up from center
    expect(area.width * area.height).toBeGreaterThanOrEqual(400 * 400 - 2000);
    const cx = area.left + area.width / 2;
    const cy = area.top + area.height / 2;
    expect(Math.round(cx)).toBe(1005);
    expect(Math.round(cy)).toBe(1005);
  });

  it("clamps the expansion to the screen edges", () => {
    const area = expandSearchArea(
      { left: 0, top: 0, width: 50, height: 50 },
      { width: 300, height: 300 },
    );
    expect(area.left).toBe(0);
    expect(area.top).toBe(0);
    expect(area.left + area.width).toBeLessThanOrEqual(300);
    expect(area.top + area.height).toBeLessThanOrEqual(300);
  });
});

describe("deep-locate remap round-trip", () => {
  it("crop->upscale->remap returns the original image-space bbox", () => {
    // a target at original image px [620, 540, 700, 580]
    const original: [number, number, number, number] = [620, 540, 700, 580];
    // suppose the search area cropped at offset (600, 520), upscaled 2x
    const offset = { x: 600, y: 520 };
    const scale = 2;
    // the crop-space bbox the model would return for that target
    const cropBbox: [number, number, number, number] = [
      (original[0] - offset.x) * scale,
      (original[1] - offset.y) * scale,
      (original[2] - offset.x) * scale,
      (original[3] - offset.y) * scale,
    ];
    const mapped = mapSearchAreaPixelBboxToOriginalPixelBbox(cropBbox, { offset, scale });
    expect(mapped).toEqual(original);
  });
});

describe("rectToPixelBbox", () => {
  it("is the inverse of pixelBboxToRect", () => {
    const bbox: [number, number, number, number] = [10, 20, 39, 49];
    expect(rectToPixelBbox(pixelBboxToRect(bbox))).toEqual(bbox);
  });
});

describe("normalized xy adapter (0–1000)", () => {
  const xyNorm: CoordinateAdapter = { shape: "bbox", order: "xy", normalizedBy: 1000 };

  it("adapts a normalized xy bbox to inclusive pixel bbox", () => {
    // [123,123,923,923] over 1000x1000 -> round(v*999/1000)
    expect(
      adaptModelCoordinatesToPixelBbox([123, 123, 923, 923], xyNorm, { width: 1000, height: 1000 }),
    ).toEqual([123, 123, 922, 922]);
  });

  it("clamps a normalized bbox to content size after mapping against prepared size", () => {
    expect(
      adaptModelCoordinatesToPixelBbox(
        [100, 200, 1000, 1000],
        xyNorm,
        { width: 1200, height: 1400 },
        { width: 1000, height: 1000 },
      ),
    ).toEqual([120, 280, 999, 999]);
  });
});
