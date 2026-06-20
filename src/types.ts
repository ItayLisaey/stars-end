/**
 * Core geometry & result types for the library's public surface.
 * Self-contained — no dependency on any app package.
 */

/** Inclusive pixel bbox: [left, top, right, bottom]. */
export type PixelBbox = [left: number, top: number, right: number, bottom: number];

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Describes how a model emits coordinates so the pipeline can normalize them.
 * Gemini grounding: `{ shape: 'bbox', order: 'yx', normalizedBy: 1000 }`.
 */
export interface CoordinateAdapter {
  shape: "bbox" | "point";
  order: "xy" | "yx";
  /** e.g. 1000 for Gemini; undefined => coordinates are already in pixels. */
  normalizedBy?: number;
}

export interface LocateResult {
  x: number;
  y: number;
  rect: Rect;
  xpath?: string;
}

/** A single executed planning step. */
export interface Step {
  thought?: string;
  action: { type: string; param?: unknown };
}

export interface ActionResult {
  success: boolean;
  message?: string;
  steps: Step[];
}
