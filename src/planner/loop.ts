/**
 * act() planning loop.
 */
import type { LocateCache } from "../cache/locate-cache.js";
import type { PageDriver } from "../driver/types.js";
import {
  ActionFailedError,
  getSafeErrorMessage,
  MaxStepsError,
  NoProgressError,
  ReplanLimitError,
  TooManyErrorsError,
} from "../errors.js";
import type { ModelTier } from "../model/types.js";
import type { ActionResult } from "../types.js";
import { WEB_ACTIONS } from "./action-space.js";
import { executeAction } from "./executor.js";
import { History } from "./history.js";

export interface ActStepInfo {
  thought?: string;
  type: string;
  param?: unknown;
  /** did the action run without throwing */
  ok: boolean;
  /** did the screenshot change vs. the state before this action */
  stateChanged: boolean;
  error?: string;
}

export interface ActOptions {
  maxPlanningSteps?: number;
  replanLimit?: number;
  deepLocate?: boolean;
  cache?: LocateCache;
  /** invoked after each executed step (for tracing) */
  onStep?: (info: ActStepInfo) => void;
}

/** Cheap string hash for the no-progress guard. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/** Stable identity of an action: type + its located target (if any). */
function actionSignature(action: { type: string; param?: unknown }): string {
  const p = action.param as { locate?: { prompt?: string } } | undefined;
  const target = p?.locate?.prompt;
  return target
    ? `${action.type}:${target}`
    : `${action.type}:${JSON.stringify(action.param ?? {})}`;
}

/**
 * No-progress thresholds. Both count no-op "successes" — not just thrown errors
 * — so an obscured tap that never advances the UI bails fast instead of
 * livelocking until the host runner's timeout.
 *
 * - REPEAT: the same action+target with no screen change → the precise A1
 *   livelock; bail quickly.
 * - STALE: any actions, but the screen never changes → backstop for
 *   "hallucinate forward through steps that aren't on screen" (A4) when locates
 *   happen to resolve and throw nothing.
 */
const MAX_REPEAT = 3;
const MAX_STALE = 6;

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

  // no-progress / repetition tracking
  let prevHash: string | undefined; // screenshot hash before the previous executed step
  let prevSig: string | undefined; // signature of the previous executed action
  let repeatCount = 0; // consecutive same-action steps with no screen change
  let staleCount = 0; // consecutive steps (any action) with no screen change

  // a step's trace is emitted on the NEXT iteration, once we have the post-step
  // screenshot hash to decide `stateChanged` — avoids a second screenshot/step.
  let pending: { info: ActStepInfo; preHash: string } | undefined;
  const flush = (afterHash: string | undefined): void => {
    if (!pending) return;
    const stateChanged =
      afterHash === undefined ? pending.info.stateChanged : afterHash !== pending.preHash;
    opt.onStep?.({ ...pending.info, stateChanged });
    pending = undefined;
  };

  for (let step = 0; step < maxSteps; step++) {
    const ctx = await tier.buildContext(page);
    const hash = hashString(ctx.screenshotDataUrl);
    // this iteration's screenshot reflects the previous step's effect.
    flush(hash);
    // unchanged since just before the previous step ran => that step did nothing
    const screenUnchanged = prevHash !== undefined && hash === prevHash;

    const plan = await tier.plan(ctx, goal, history.steps, WEB_ACTIONS, history.takeFeedback());
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
      if (screenUnchanged && ++staleCount >= MAX_STALE) {
        throw new NoProgressError("no actionable plan", staleCount);
      }
      prevHash = hash;
      continue;
    }

    const sig = actionSignature(plan.action);

    // No-progress guard (A1/A4). A no-op tap throws nothing, so consecutive-error
    // counting alone never catches an obscured/no-op action; we measure whether
    // the screen actually moved.
    if (screenUnchanged) {
      staleCount++;
      if (prevSig !== undefined && sig === prevSig) {
        // (a) repeating the exact same action+target with no effect — the A1
        // livelock; bail fast.
        if (++repeatCount >= MAX_REPEAT) throw new NoProgressError(sig, repeatCount);
        history.addFeedback(
          `The previous "${sig}" action did not change the screen. The target may be obscured, a no-op, or already actioned — do not repeat it; re-ground and try a different target or approach.`,
        );
      } else {
        // a different action, but the prior one still produced no visible change:
        // nudge the planner to confirm the expected transition before advancing.
        repeatCount = 0;
        history.addFeedback(
          "The previous action produced no visible change. Confirm the expected UI (sheet/next control/overlay) actually appeared before continuing.",
        );
      }
      // (b) screen stuck across many steps regardless of which action — backstop.
      if (staleCount >= MAX_STALE) {
        throw new NoProgressError("screen unchanged across multiple steps", staleCount);
      }
    } else {
      staleCount = 0;
      repeatCount = 0;
    }

    let ok = false;
    let error: string | undefined;
    try {
      await executeAction(page, tier, plan, ctx, {
        cache: opt.cache,
        deepLocate: opt.deepLocate,
      });
      history.add({ thought: plan.thought, action: plan.action });
      ok = true;
      errInCycle = 0;
    } catch (e) {
      error = getSafeErrorMessage(e);
      history.addFeedback(`Error executing action: ${error}`);
      // a failed action triggers replanning (stale marking handled in executor)
      if (++replanCount > replanLimit) {
        flush(undefined);
        throw new ReplanLimitError();
      }
      if (++errInCycle > 5) {
        flush(undefined);
        throw new TooManyErrorsError();
      }
    }

    pending = {
      preHash: hash,
      info: {
        thought: plan.thought,
        type: plan.action.type,
        param: plan.action.param,
        ok,
        stateChanged: false,
        error,
      },
    };

    prevHash = hash;
    prevSig = sig;

    await page.waitForSettle();
  }

  flush(undefined);
  throw new MaxStepsError();
}
