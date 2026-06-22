/**
 * PageDriver interface. The single platform seam: only
 * `playwright-driver.ts` imports `playwright`.
 */
import type { Size } from "../types.js";
import type { KeySpec } from "./keyboard.js";

export interface Screenshot {
  /** 'data:image/jpeg;base64,...' */
  base64: string;
  /** image pixels (CSS px * dpr) */
  width: number;
  height: number;
  dpr: number;
}

export type ScrollEdge = "top" | "bottom" | "left" | "right";

export interface PageDriver {
  screenshot(): Promise<Screenshot>;
  size(): Promise<Size>; // CSS px
  url(): Promise<string>;

  // all click coords are CSS px; Playwright converts to device px internally
  tap(
    x: number,
    y: number,
    opt?: { button?: "left" | "right" | "middle"; count?: number },
  ): Promise<void>;
  /**
   * Click an element by xpath via Playwright's actionability-checked click
   * (auto-wait, scroll-into-view, hit-test). Returns false if it could not click
   * (not found / obscured / timed out) so the caller can fall back to `tap`.
   */
  clickXpath(
    xpath: string,
    opt?: { button?: "left" | "right" | "middle"; count?: number },
  ): Promise<boolean>;
  move(x: number, y: number): Promise<void>;
  wheel(deltaX: number, deltaY: number, from?: { x: number; y: number }): Promise<void>;
  scrollTo(edge: ScrollEdge, from?: { x: number; y: number }): Promise<void>;

  type(text: string): Promise<void>;
  press(keys: KeySpec[]): Promise<void>;
  clearInput(center?: { x: number; y: number }): Promise<void>;
  /**
   * Current text of the editable field at `center` (or the focused element).
   * `null` when no editable field could be resolved — used to verify that an
   * `input` action actually landed.
   */
  readEditableValue(center?: { x: number; y: number }): Promise<string | null>;

  waitForSettle(): Promise<void>;
  waitForDomQuiet(opt?: { quietMs?: number; timeoutMs?: number }): Promise<void>;

  evaluate<T>(fn: string | ((arg: any) => T | Promise<T>), arg?: unknown): Promise<T>;
}
