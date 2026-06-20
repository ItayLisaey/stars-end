/**
 * Coordinate pipeline.
 *
 * All pure functions. Coordinate spaces (keep distinct):
 *   1. Normalized   — model output (Gemini: 0–1000, order yx).
 *   2. Content/image px — screenshot pixels (may be padded -> "prepared px").
 *   3. CSS px        — Playwright click input; cssPx = contentPx / dpr.
 */
import { CoordinateParseError } from "../errors.js";
import type { CoordinateAdapter, PixelBbox, Point, Rect, Size } from "../types.js";

const DEFAULT_BBOX_SIZE = 20; // must be even

// ---- inclusive pixel-index helpers ----

export const maxPixelIndex = (size: number): number => Math.max(size - 1, 0);

export const normalizedToPixelIndex = (value: number, normalizedBy: number, size: number): number =>
  Math.round((value * maxPixelIndex(size)) / normalizedBy);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

// ---- 1. parse / unwrap model coordinate junk ----

type CoordinateListLike = number[] | string[] | string | (number[] | string[])[];

/**
 * Handles `[[...]]` nesting and passes through flat arrays / strings.
 */
export function unwrapCoordinateList(input: CoordinateListLike): number[] | string[] | string {
  if (Array.isArray(input)) {
    if (Array.isArray(input[0])) {
      return input[0] as number[] | string[];
    }
    return input as number[] | string[];
  }
  return input;
}

function parseCoordinateList(input: unknown, label: string): number[] {
  const unwrapped = unwrapCoordinateList(input as CoordinateListLike);
  // strings like "y,x" or "y x" — split on whitespace/commas
  const values =
    typeof unwrapped === "string"
      ? unwrapped
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean)
      : unwrapped;

  if (!Array.isArray(values)) {
    throw new CoordinateParseError(`invalid ${label} data: ${JSON.stringify(input)}`);
  }

  const numeric = values.map((v) => (typeof v === "number" ? v : Number(v)));
  if (!numeric.every((v) => Number.isFinite(v))) {
    throw new CoordinateParseError(`invalid ${label} data: ${JSON.stringify(input)}`);
  }
  return numeric;
}

export type LocateResultValue =
  | { type: "bbox"; coordinates: PixelBbox }
  | {
      type: "point";
      coordinates: [number, number];
    };

/** parseNumericLocateResult: shape-aware parse of the raw model value. */
export function parseNumericLocateResult(
  adapter: CoordinateAdapter,
  input: unknown,
): LocateResultValue {
  if (adapter.shape === "point") {
    const point = parseCoordinateList(input, "point");
    if (point.length < 2) {
      throw new CoordinateParseError(`invalid point data: ${JSON.stringify(input)}`);
    }
    return { type: "point", coordinates: [point[0], point[1]] };
  }

  const bbox = parseCoordinateList(input, "bbox");
  if (bbox.length !== 4) {
    throw new CoordinateParseError(`invalid bbox data: ${JSON.stringify(input)}`);
  }
  return { type: "bbox", coordinates: [bbox[0], bbox[1], bbox[2], bbox[3]] };
}

// ---- 2. reorder yx -> xy ----

function reorderToXy(coords: number[], order: "xy" | "yx"): number[] {
  if (order !== "yx") return coords;
  if (coords.length === 4) {
    const [t, l, b, r] = coords;
    return [l, t, r, b];
  }
  const [y, x] = coords;
  return [x, y];
}

// ---- 3. point -> bbox expansion ----

export function expandPointToBbox(
  x: number,
  y: number,
  maxX: number,
  maxY: number,
  halfSize: number,
): PixelBbox {
  return [
    Math.max(0, x - halfSize),
    Math.max(0, y - halfSize),
    Math.min(maxX, x + halfSize),
    Math.min(maxY, y + halfSize),
  ];
}

// ---- source-range validation BEFORE mapping ----

function resolveCoordinateLimits(
  value: LocateResultValue,
  adapter: CoordinateAdapter,
  width: number,
  height: number,
): number[] {
  if (adapter.normalizedBy !== undefined) {
    return value.coordinates.map(() => adapter.normalizedBy as number);
  }
  if (value.type === "bbox") {
    return adapter.order === "yx" ? [height, width, height, width] : [width, height, width, height];
  }
  return adapter.order === "yx" ? [height, width] : [width, height];
}

function assertInSourceRange(
  value: LocateResultValue,
  adapter: CoordinateAdapter,
  width: number,
  height: number,
): void {
  const limits = resolveCoordinateLimits(value, adapter, width, height);
  const outOfRange = value.coordinates.some((v, i) => {
    const limit = limits[i];
    return typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > limit;
  });
  if (!outOfRange) return;

  const { normalizedBy } = adapter;
  const source =
    normalizedBy !== undefined
      ? `normalized range [0, ${normalizedBy}]`
      : `image size [0, ${width}]x[0, ${height}]`;
  throw new CoordinateParseError(
    `locate result coordinates ${JSON.stringify(value.coordinates)} exceed ${source}. ` +
      `shape=${adapter.shape} order=${adapter.order} limits=${JSON.stringify(limits)}`,
  );
}

// ---- map parsed result -> pixel bbox ----

function mapToPixelBbox(
  value: LocateResultValue,
  adapter: CoordinateAdapter,
  prepared: Size,
): PixelBbox {
  const { width, height } = prepared;
  const { normalizedBy } = adapter;
  assertInSourceRange(value, adapter, width, height);

  const xy = reorderToXy(value.coordinates, adapter.order);

  const xyBbox: PixelBbox =
    xy.length === 4
      ? [xy[0], xy[1], xy[2], xy[3]]
      : expandPointToBbox(
          xy[0],
          xy[1],
          normalizedBy ?? maxPixelIndex(width),
          normalizedBy ?? maxPixelIndex(height),
          normalizedBy === undefined ? DEFAULT_BBOX_SIZE / 2 : normalizedBy / 100,
        );

  if (normalizedBy === undefined) return xyBbox;
  return [
    normalizedToPixelIndex(xyBbox[0], normalizedBy, width),
    normalizedToPixelIndex(xyBbox[1], normalizedBy, height),
    normalizedToPixelIndex(xyBbox[2], normalizedBy, width),
    normalizedToPixelIndex(xyBbox[3], normalizedBy, height),
  ];
}

// ---- finalize: assert + clamp ----

function assertFinite(bbox: readonly number[], raw: unknown): asserts bbox is PixelBbox {
  if (bbox.length !== 4 || !bbox.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new CoordinateParseError(`invalid locate bbox data: ${JSON.stringify(raw)}`);
  }
}

function assertOrder(bbox: PixelBbox, raw: unknown): void {
  const [left, top, right, bottom] = bbox;
  if (right >= left && bottom >= top) return;
  throw new CoordinateParseError(
    `locate pixel bbox has invalid coordinate order: bbox=${JSON.stringify(raw)} ` +
      `pixelBbox=${JSON.stringify(bbox)}`,
  );
}

function assertInsideImage(bbox: PixelBbox, raw: unknown, width: number, height: number): void {
  const [left, top, right, bottom] = bbox;
  const outOfImage =
    left < 0 || top < 0 || right > maxPixelIndex(width) || bottom > maxPixelIndex(height);
  if (!outOfImage) return;
  throw new CoordinateParseError(
    `locate pixel bbox is outside the image size: bbox=${JSON.stringify(raw)} ` +
      `imageSize=${width}x${height}`,
  );
}

export function finalizePixelBbox(
  bbox: PixelBbox,
  raw: unknown,
  prepared: Size,
  content: Size = prepared,
): PixelBbox {
  assertFinite(bbox, raw);
  assertOrder(bbox, raw);
  // assert against PREPARED (padded) size BEFORE clamping to content.
  assertInsideImage(bbox, raw, prepared.width, prepared.height);

  const rx = maxPixelIndex(content.width);
  const ry = maxPixelIndex(content.height);
  const [left, top, right, bottom] = bbox;
  return [clamp(left, 0, rx), clamp(top, 0, ry), clamp(right, 0, rx), clamp(bottom, 0, ry)];
}

/**
 * Full adapter: raw model coords -> finalized inclusive pixel bbox in the
 * content coordinate space.
 *
 * @param size    prepared (padded) image size; coords are parsed against this.
 * @param content clamp target (defaults to `size`); padding pixels are never clickable.
 */
export function adaptModelCoordinatesToPixelBbox(
  raw: number[] | string | unknown,
  adapter: CoordinateAdapter,
  size: Size,
  content: Size = size,
): PixelBbox {
  const parsed = parseNumericLocateResult(adapter, raw);
  const pixel = mapToPixelBbox(parsed, adapter, size);
  return finalizePixelBbox(pixel, raw, size, content);
}

// ---- bbox <-> rect — inclusive: +1 ----

export const pixelBboxToRect = ([left, top, right, bottom]: PixelBbox): Rect => ({
  left,
  top,
  width: right - left + 1,
  height: bottom - top + 1,
});

export const rectToPixelBbox = ({ left, top, width, height }: Rect): PixelBbox => [
  left,
  top,
  left + Math.max(width - 1, 0),
  top + Math.max(height - 1, 0),
];

export const rectCenter = (r: Rect): Point => ({
  x: Math.round(r.left + r.width / 2),
  y: Math.round(r.top + r.height / 2),
});

/** Section-merge: bounding rect of multiple bboxes. */
export function mergePixelBboxesToRect(bboxes: PixelBbox[]): Rect {
  const minLeft = Math.min(...bboxes.map(([l]) => l));
  const minTop = Math.min(...bboxes.map(([, t]) => t));
  const maxRight = Math.max(...bboxes.map(([, , r]) => r));
  const maxBottom = Math.max(...bboxes.map(([, , , b]) => b));
  return pixelBboxToRect([minLeft, minTop, maxRight, maxBottom]);
}

/**
 * Expand a coarse section rect into a search area: extend each side by 100px
 * (clamped), then scale from center up to a 400×400 minimum area. All values in
 * the same coordinate space as `rect`/`screen`.
 */
export function expandSearchArea(rect: Rect, screen: Size): Rect {
  const minArea = 400 * 400;
  const expandSize = 100;

  const expandedLeft = Math.max(rect.left - expandSize, 0);
  const expandedTop = Math.max(rect.top - expandSize, 0);
  const expandRect: Rect = {
    left: expandedLeft,
    top: expandedTop,
    width: Math.min(
      rect.left - expandedLeft + rect.width + expandSize,
      screen.width - expandedLeft,
    ),
    height: Math.min(
      rect.top - expandedTop + rect.height + expandSize,
      screen.height - expandedTop,
    ),
  };

  const currentArea = expandRect.width * expandRect.height;
  if (currentArea >= minArea) return expandRect;

  const centerX = expandRect.left + expandRect.width / 2;
  const centerY = expandRect.top + expandRect.height / 2;
  const scaleFactor = Math.sqrt(minArea / currentArea);
  const newWidth = Math.round(expandRect.width * scaleFactor);
  const newHeight = Math.round(expandRect.height * scaleFactor);
  const left = Math.max(Math.round(centerX - newWidth / 2), 0);
  const top = Math.max(Math.round(centerY - newHeight / 2), 0);

  return {
    left,
    top,
    width: Math.min(newWidth, screen.width - left),
    height: Math.min(newHeight, screen.height - top),
  };
}

// ---- two-stage locate remap ----

export interface SearchAreaMapping {
  offset?: Point;
  scale?: number;
}

export function mapSearchAreaPixelBboxToOriginalPixelBbox(
  [left, top, right, bottom]: PixelBbox,
  mapping?: SearchAreaMapping,
): PixelBbox {
  const offset = mapping?.offset ?? { x: 0, y: 0 };
  const scale = mapping?.scale ?? 1;
  const mapX = (x: number) => (scale !== 1 ? Math.round(x / scale) : x) + offset.x;
  const mapY = (y: number) => (scale !== 1 ? Math.round(y / scale) : y) + offset.y;
  return [mapX(left), mapY(top), mapX(right), mapY(bottom)];
}
