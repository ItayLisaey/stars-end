/**
 * Grounding tier — the default. VL model: screenshot -> bbox.
 */
import { z } from "zod";
import type { PageDriver } from "../driver/types.js";
import { adaptModelCoordinatesToPixelBbox } from "../geometry/coordinates.js";
import { locateSystemPrompt } from "../insight/prompts.js";
import type { ActionDef } from "../planner/action-space.js";
import { parsePlan } from "../planner/parse.js";
import { planningSystemPrompt, planningUserPrompt } from "../planner/prompt.js";
import type { Step } from "../types.js";
import { callObject, callText } from "./call.js";
import { geminiAdapter } from "./gemini.js";
import type { LocateModelResult, ModelTier, PlanModelResult, UIContext } from "./types.js";

const LocateResponseSchema = z.object({
  bbox: z.array(z.number()).describe("bounding box of the element"),
  errors: z.array(z.string()).optional(),
});

export const groundingTier: ModelTier = {
  kind: "grounding",

  async buildContext(page: PageDriver): Promise<UIContext> {
    const shot = await page.screenshot();
    return {
      screenshotDataUrl: shot.base64,
      size: { width: shot.width, height: shot.height },
      dpr: shot.dpr,
    };
  },

  async locate(ctx, instruction): Promise<LocateModelResult> {
    const { object } = await callObject({
      schema: LocateResponseSchema,
      system: locateSystemPrompt(geminiAdapter),
      userText: `Find: ${instruction}`,
      imageDataUrl: ctx.screenshotDataUrl,
    });
    if (!object.bbox?.length) {
      return { bbox: undefined, errors: object.errors, raw: object };
    }
    const bbox = adaptModelCoordinatesToPixelBbox(object.bbox, geminiAdapter, ctx.size);
    return { bbox, raw: object };
  },

  async plan(
    ctx: UIContext,
    goal: string,
    history: Step[],
    actionSpace: ActionDef[],
  ): Promise<PlanModelResult> {
    const { text } = await callText({
      system: planningSystemPrompt(actionSpace),
      userText: planningUserPrompt(goal, history),
      imageDataUrl: ctx.screenshotDataUrl,
    });
    const parsed = parsePlan(text);
    return {
      thought: parsed.thought,
      action: parsed.action,
      complete: parsed.complete,
      error: parsed.error,
    };
  },
};
