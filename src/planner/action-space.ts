/**
 * Typed action registry. Consumed by the planner (to build the prompt)
 * and the executor (to run). Schemas are Zod, passed to the AI SDK natively —
 * no `_def` reflection.
 */
import { z } from "zod";
import { clickTarget } from "../driver/click-target.js";
import { verifyInputLanded } from "../driver/input-verify.js";
import type { PageDriver } from "../driver/types.js";
import { parseHotkey } from "../driver/keyboard.js";
import type { Point, Size } from "../types.js";

export interface ExecCtx {
  driver: PageDriver;
  /** resolved click point in CSS px (present when the action located a target) */
  point?: Point;
  viewport: Size;
}

export interface ActionDef<P = any> {
  name: string;
  /** agent method name */
  alias: string;
  description: string;
  paramSchema: z.ZodType<P>;
  sample: P;
  needsLocate: boolean;
  run(ctx: ExecCtx, param: P): Promise<void>;
}

const locateField = z.object({ prompt: z.string() }).describe("the target element");

/** Default single scroll distance = 70% of viewport dimension. */
function deltaFor(
  direction: "down" | "up" | "right" | "left",
  distance: number | null | undefined,
  viewport: Size,
): [number, number] {
  const vertical = direction === "up" || direction === "down";
  const base = distance ?? Math.round((vertical ? viewport.height : viewport.width) * 0.7);
  switch (direction) {
    case "down":
      return [0, base];
    case "up":
      return [0, -base];
    case "right":
      return [base, 0];
    case "left":
      return [-base, 0];
  }
}

function requirePoint(ctx: ExecCtx, action: string): Point {
  if (!ctx.point) throw new Error(`${action} requires a located point but none was resolved`);
  return ctx.point;
}

const TapParam = z.object({ locate: locateField });
const InputParam = z.object({
  value: z
    .union([z.string(), z.number()])
    .transform(String)
    .describe("Final content for replace mode; only inserted chars for typeOnly; empty for clear"),
  locate: locateField.optional().describe("placeholder/text position; center if empty"),
  mode: z.enum(["replace", "clear", "typeOnly"]).default("replace"),
});
const KeyboardPressParam = z.object({
  keyName: z
    .string()
    .describe("Key or combo, e.g. 'Enter', 'Tab', 'Escape', 'Control+A'. Not for typing text."),
});
const ScrollParam = z.object({
  scrollType: z
    .enum(["singleAction", "scrollToBottom", "scrollToTop", "scrollToRight", "scrollToLeft"])
    .default("singleAction"),
  direction: z.enum(["down", "up", "right", "left"]).default("down"),
  distance: z.number().nullable().optional(),
  locate: locateField.optional().describe('the scrollable area; not "scroll to find X"'),
});
const SleepParam = z.object({ ms: z.number() });

export const WEB_ACTIONS: ActionDef[] = [
  {
    name: "Tap",
    alias: "tap",
    description: "Click/tap a single element.",
    needsLocate: true,
    paramSchema: TapParam,
    sample: { locate: { prompt: 'the "Submit" button' } },
    async run(ctx) {
      const p = requirePoint(ctx, "Tap");
      await clickTarget(ctx.driver, p);
      await ctx.driver.waitForSettle();
    },
  },
  {
    name: "RightClick",
    alias: "rightClick",
    description: "Right-click an element to open its context menu.",
    needsLocate: true,
    paramSchema: TapParam,
    sample: { locate: { prompt: "the file row" } },
    async run(ctx) {
      const p = requirePoint(ctx, "RightClick");
      await clickTarget(ctx.driver, p, { button: "right" });
      await ctx.driver.waitForSettle();
    },
  },
  {
    name: "DoubleClick",
    alias: "doubleClick",
    description: "Double-click an element.",
    needsLocate: true,
    paramSchema: TapParam,
    sample: { locate: { prompt: "the editable cell" } },
    async run(ctx) {
      const p = requirePoint(ctx, "DoubleClick");
      await clickTarget(ctx.driver, p, { count: 2 });
      await ctx.driver.waitForSettle();
    },
  },
  {
    name: "Hover",
    alias: "hover",
    description: "Move the pointer over an element.",
    needsLocate: true,
    paramSchema: TapParam,
    sample: { locate: { prompt: "the Products menu" } },
    async run(ctx) {
      const p = requirePoint(ctx, "Hover");
      await ctx.driver.move(p.x, p.y);
    },
  },
  {
    name: "Input",
    alias: "input",
    description: "Type text into a field. Use mode to replace, clear, or append.",
    needsLocate: false,
    paramSchema: InputParam,
    sample: {
      value: "test@example.com",
      locate: { prompt: "the email input field" },
    },
    async run(ctx, param: z.infer<typeof InputParam>) {
      const mode = param.mode ?? "replace";
      if (mode !== "typeOnly") {
        await ctx.driver.clearInput(ctx.point);
        await ctx.driver.waitForDomQuiet(); // frameworks drop keystrokes
      } else if (ctx.point) {
        await ctx.driver.tap(ctx.point.x, ctx.point.y);
      }
      if (mode !== "clear") {
        const value = String(param.value);
        await ctx.driver.type(value);
        await ctx.driver.waitForSettle();
        // verify the text actually landed (focus may never reach a rich/
        // contenteditable composer); throws InputVerificationError if empty.
        await verifyInputLanded(ctx.driver, value, ctx.point);
      } else {
        await ctx.driver.waitForSettle();
      }
    },
  },
  {
    name: "KeyboardPress",
    alias: "keyboardPress",
    description: "Press a key or key combo on the focused element. Not for typing text.",
    needsLocate: false,
    paramSchema: KeyboardPressParam,
    sample: { keyName: "Enter" },
    async run(ctx, param: z.infer<typeof KeyboardPressParam>) {
      await ctx.driver.press(parseHotkey(param.keyName));
    },
  },
  {
    name: "Scroll",
    alias: "scroll",
    description: "Scroll the page or a container. Provide an explicit distance for fine control.",
    needsLocate: false,
    paramSchema: ScrollParam,
    sample: {
      direction: "down",
      scrollType: "singleAction",
      locate: { prompt: "the product list area" },
    },
    async run(ctx, param: z.infer<typeof ScrollParam>) {
      const scrollType = param.scrollType ?? "singleAction";
      if (scrollType !== "singleAction") {
        const edge =
          scrollType === "scrollToTop"
            ? "top"
            : scrollType === "scrollToBottom"
              ? "bottom"
              : scrollType === "scrollToLeft"
                ? "left"
                : "right";
        await ctx.driver.scrollTo(edge, ctx.point);
      } else {
        const [dx, dy] = deltaFor(param.direction ?? "down", param.distance, ctx.viewport);
        await ctx.driver.wheel(dx, dy, ctx.point);
      }
    },
  },
  {
    name: "Sleep",
    alias: "sleep",
    description: "Wait a fixed number of milliseconds.",
    needsLocate: false,
    paramSchema: SleepParam,
    sample: { ms: 1000 },
    async run(_ctx, param: z.infer<typeof SleepParam>) {
      await new Promise((r) => setTimeout(r, param.ms));
    },
  },
];

export function findAction(type: string): ActionDef | undefined {
  const lower = type.toLowerCase();
  return WEB_ACTIONS.find((a) => a.name.toLowerCase() === lower || a.alias.toLowerCase() === lower);
}

/** Normalize a deprecated Input `append` mode to `typeOnly`. */
export function normalizeActionParam(type: string, param: unknown): unknown {
  if (type.toLowerCase() === "input" && param && typeof param === "object") {
    const p = param as Record<string, unknown>;
    if (p.mode === "append") return { ...p, mode: "typeOnly" };
  }
  return param;
}
