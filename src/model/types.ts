/**
 * Model-tier abstraction. The VL/markup tier difference lives entirely inside
 * `locate` / `buildContext`; nothing in the executor / action-space / planning
 * loop branches on model type.
 */
import type { PageDriver } from "../driver/types.js";
import type { ActionDef } from "../planner/action-space.js";
import type { PixelBbox, Step } from "../types.js";

export interface ElementNode {
  id: string;
  role: string;
  text: string;
  rect: { left: number; top: number; width: number; height: number };
  center: [number, number];
}

/**
 * A top-layer surface (modal, dialog, popover) currently open over the page.
 * Surfaced so completion detection can recognize that a NEW surface appeared,
 * rather than only asking "is the target still visible?" — overlays that dim
 * but keep the underlying target visible otherwise defeat completion.
 */
export interface OverlaySurface {
  present: boolean;
  /** short, human-readable hint, e.g. 'a modal dialog' */
  description?: string;
}

/**
 * A custom dropdown/combobox currently OPEN, showing its option list. Surfaced
 * so the planner locates `role="option"` items in the open surface instead of
 * re-describing the closed trigger by a value it no longer displays.
 */
export interface OpenListState {
  open: boolean;
  /** number of visible options in the open surface */
  optionCount?: number;
}

export interface UIContext {
  /** 'data:image/jpeg;base64,...' — image px == content px (no padding for Gemini) */
  screenshotDataUrl: string;
  size: { width: number; height: number }; // image px
  dpr: number;
  elements?: ElementNode[]; // markup tier only
  /** a top-layer modal/dialog/popover open over the page, if any */
  overlay?: OverlaySurface;
  /** a dropdown/combobox listbox currently open, if any */
  openList?: OpenListState;
}

export interface LocateModelResult {
  bbox?: PixelBbox; // undefined => not found
  errors?: string[];
  raw: unknown;
}

export interface PlanModelResult {
  thought?: string;
  action?: { type: string; param?: unknown; locatedBbox?: PixelBbox };
  complete?: { success: boolean; message?: string };
  error?: string;
}

export interface ModelTier {
  readonly kind: "grounding" | "markup";
  buildContext(page: PageDriver): Promise<UIContext>;
  /** returns an inclusive pixel bbox in content coordinate space */
  locate(
    ctx: UIContext,
    instruction: string,
    opt?: { searchArea?: string },
  ): Promise<LocateModelResult>;
  plan(
    ctx: UIContext,
    goal: string,
    history: Step[],
    actionSpace: ActionDef[],
    /** errors / no-progress nudges surfaced from the previous step(s) */
    feedback?: string[],
  ): Promise<PlanModelResult>;
}
