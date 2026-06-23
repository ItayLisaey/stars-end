/**
 * Grounding tier — the default. VL model: screenshot -> bbox.
 */
import { z } from "zod";
import { DEFAULT_MODEL } from "../config.js";
import type { PageDriver } from "../driver/types.js";
import { adaptModelCoordinatesToPixelBbox } from "../geometry/coordinates.js";
import { check } from "../insight/assert.js";
import { locateSystemPrompt } from "../insight/prompts.js";
import { detectOpenListbox, type OpenListResult } from "../insight/open-listbox.injected.js";
import { detectTopLayerSurface, type TopLayerResult } from "../insight/top-layer.injected.js";
import type { ActionDef } from "../planner/action-space.js";
import { parsePlan } from "../planner/parse.js";
import { planningSystemPrompt, planningUserPrompt } from "../planner/prompt.js";
import type { Step } from "../types.js";
import { callObject, callText } from "./call.js";
import { profileFor } from "./profile.js";
import type { LocateModelResult, ModelTier, PlanModelResult, UIContext } from "./types.js";

const LocateResponseSchema = z.object({
  bbox: z.array(z.number()).describe("bounding box of the element"),
  errors: z.array(z.string()).optional(),
});

/**
 * Build a grounding tier bound to a specific model id (undefined => the library
 * default). The model is carried on the tier so every call on it — plan, locate,
 * and the insight calls (check/assert/query) that receive the tier — uses the
 * same model.
 */
export function createGroundingTier(model?: string): ModelTier {
  // the coordinate format is a property of the grounding model — pull it from
  // the model's profile so non-Gemini grounding models work too.
  const adapter = profileFor(model ?? DEFAULT_MODEL).adapter;
  const tier: ModelTier = {
    kind: "grounding",
    model,

    async buildContext(page: PageDriver): Promise<UIContext> {
      const shot = await page.screenshot();
      const overlay = await page
        .evaluate<TopLayerResult>(detectTopLayerSurface)
        .catch(() => ({ present: false }) as TopLayerResult);
      const openList = await page
        .evaluate<OpenListResult>(detectOpenListbox)
        .catch(() => ({ open: false }) as OpenListResult);
      return {
        screenshotDataUrl: shot.base64,
        size: { width: shot.width, height: shot.height },
        dpr: shot.dpr,
        overlay: { present: overlay.present, description: overlay.description },
        openList: { open: openList.open, optionCount: openList.optionCount },
      };
    },

    async locate(ctx, instruction): Promise<LocateModelResult> {
      const { object } = await callObject({
        model,
        schema: LocateResponseSchema,
        system: locateSystemPrompt(adapter),
        userText: `Find: ${instruction}`,
        imageDataUrl: ctx.screenshotDataUrl,
      });
      if (!object.bbox?.length) {
        return { bbox: undefined, errors: object.errors, raw: object };
      }
      const bbox = adaptModelCoordinatesToPixelBbox(object.bbox, adapter, ctx.size);
      return { bbox, raw: object };
    },

    async plan(
      ctx: UIContext,
      goal: string,
      history: Step[],
      actionSpace: ActionDef[],
      feedback?: string[],
    ): Promise<PlanModelResult> {
      const { text } = await callText({
        model,
        system: planningSystemPrompt(actionSpace),
        userText: planningUserPrompt(goal, history, {
          feedback,
          overlay: ctx.overlay,
          openList: ctx.openList,
        }),
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

    async isGoalSatisfied(page: PageDriver, goal: string): Promise<boolean> {
      const r = await check(
        page,
        tier,
        `The user's goal is fully accomplished and the result is visible on the current screen: "${goal}".`,
      );
      return r.pass;
    },
  };
  return tier;
}

/** Default grounding tier on the library default model. */
export const groundingTier: ModelTier = createGroundingTier();
