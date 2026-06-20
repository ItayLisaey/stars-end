/**
 * act() planning loop.
 */
import type { LocateCache } from "../cache/locate-cache.js";
import type { PageDriver } from "../driver/types.js";
import {
  ActionFailedError,
  getSafeErrorMessage,
  MaxStepsError,
  ReplanLimitError,
  TooManyErrorsError,
} from "../errors.js";
import type { ModelTier } from "../model/types.js";
import type { ActionResult } from "../types.js";
import { WEB_ACTIONS } from "./action-space.js";
import { executeAction } from "./executor.js";
import { History } from "./history.js";

export interface ActOptions {
  maxPlanningSteps?: number;
  replanLimit?: number;
  deepLocate?: boolean;
  cache?: LocateCache;
  /** invoked after each executed step (for tracing) */
  onStep?: (info: { thought?: string; type: string; param?: unknown }) => void;
}

/** Cheap string hash for the no-progress guard. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

const MAX_IDENTICAL_SCREENSHOTS = 4;

export async function act(
  page: PageDriver,
  tier: ModelTier,
  goal: string,
  opt: ActOptions = {},
): Promise<ActionResult> {
  const history = new History();
  const maxSteps = opt.maxPlanningSteps ?? 40;
  const replanLimit = opt.replanLimit ?? 8;

  let replanCount = 0;
  let errInCycle = 0;
  let lastShotHash: string | undefined;
  let identicalCount = 0;

  for (let step = 0; step < maxSteps; step++) {
    const ctx = await tier.buildContext(page);

    // no-progress guard
    const hash = hashString(ctx.screenshotDataUrl);
    identicalCount = hash === lastShotHash ? identicalCount + 1 : 0;
    lastShotHash = hash;

    const plan = await tier.plan(ctx, goal, history.steps, WEB_ACTIONS);
    if (plan.error) {
      history.addFeedback(plan.error);
      if (++replanCount > replanLimit) throw new ReplanLimitError();
    }

    if (plan.complete) {
      if (!plan.complete.success) throw new ActionFailedError(plan.complete.message);
      return {
        success: true,
        message: plan.complete.message,
        steps: history.steps,
      };
    }

    if (!plan.action) {
      // nothing to do and no completion — allow a few replans then bail
      if (++replanCount > replanLimit) throw new ReplanLimitError();
      if (identicalCount >= MAX_IDENTICAL_SCREENSHOTS) throw new MaxStepsError();
      continue;
    }

    try {
      await executeAction(page, tier, plan, ctx, {
        cache: opt.cache,
        deepLocate: opt.deepLocate,
      });
      history.add({ thought: plan.thought, action: plan.action });
      opt.onStep?.({
        thought: plan.thought,
        type: plan.action.type,
        param: plan.action.param,
      });
      errInCycle = 0;
    } catch (e) {
      history.addFeedback(`Error executing action: ${getSafeErrorMessage(e)}`);
      // a failed action triggers replanning (stale marking handled in executor)
      if (++replanCount > replanLimit) throw new ReplanLimitError();
      if (++errInCycle > 5) throw new TooManyErrorsError();
    }

    await page.waitForSettle();
  }

  throw new MaxStepsError();
}
