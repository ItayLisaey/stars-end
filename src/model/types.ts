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

export interface UIContext {
  /** 'data:image/jpeg;base64,...' — image px == content px (no padding for Gemini) */
  screenshotDataUrl: string;
  size: { width: number; height: number }; // image px
  dpr: number;
  elements?: ElementNode[]; // markup tier only
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
  ): Promise<PlanModelResult>;
}
