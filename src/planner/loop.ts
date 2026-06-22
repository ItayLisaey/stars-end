/**
 * act() planning loop.
 */
import type { LocateCache } from "../cache/locate-cache.js";
import { parseHotkey } from "../driver/keyboard.js";
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
  let escapeRecoveryTried = false; // dismissed a blocking overlay via Escape this episode

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

  // Independent yes/no completion check via the tier (a different, constrained
  // call than the planner). Tiers that don't implement it (lightweight/fake)
  // make the loop skip the check entirely — `onError` is the assumed answer both
  // when the capability is absent and when the check itself throws.
  const checkGoalSatisfied = async (onError: boolean): Promise<boolean> => {
    if (!tier.isGoalSatisfied) return onError;
    try {
      return await tier.isGoalSatisfied(page, goal);
    } catch {
      return onError;
    }
  };

  // Last-resort check before GIVING UP: some planners (observed on
  // gemini-3.5-flash) stop emitting a valid <complete> once the goal is met
  // (empty/off-task text), so the loop would throw even though the task is done.
  // If we've made progress and the goal is satisfied, succeed. Errs toward
  // throwing (onError=false) so an unverifiable state still surfaces.
  const inferComplete = async (): Promise<ActionResult | null> => {
    if (history.steps.length === 0) return null;
    if (await checkGoalSatisfied(false)) {
      return { success: true, message: `goal satisfied (inferred): ${goal}`, steps: history.steps };
    }
    return null;
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
      // Verify a claimed success before trusting it. Some planners declare
      // completion prematurely — even while their own thought lists remaining
      // steps. Confirm against the screen with an independent check; if it isn't
      // actually satisfied, reject the claim and keep going (bounded by
      // replanLimit). Errs toward trusting the planner if the check can't run.
      if (history.steps.length === 0 || (await checkGoalSatisfied(true))) {
        return { success: true, message: plan.complete.message, steps: history.steps };
      }
      history.addFeedback(
        `You reported the task complete, but the goal is NOT yet satisfied on screen. Do not claim completion — perform the next concrete action toward: ${goal}.`,
      );
      if (++replanCount > replanLimit) throw new ReplanLimitError();
      prevHash = hash;
      continue;
    }

    if (!plan.action) {
      // No action AND no completion — the planner returned an empty/unparseable
      // response. Nudge it with the exact format + an explicit "complete if
      // done" so the next prompt differs (a bare retry at temperature 0 repeats
      // the same blank output).
      history.addFeedback(
        'Your previous response did not contain a valid step. Respond with EXACTLY one <action-type> + <action-param-json>, OR — if the goal is already satisfied on screen — <complete success="true">what was accomplished</complete>.',
      );
      if (++replanCount > replanLimit) {
        const done = await inferComplete();
        if (done) return done;
        throw new ReplanLimitError();
      }
      if (screenUnchanged && ++staleCount >= MAX_STALE) {
        const done = await inferComplete();
        if (done) return done;
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
        // An unexpected dialog/overlay is up and the repeated action isn't
        // landing — a stray click likely tripped a guard, and taps on its
        // dismiss control keep missing. Try a deterministic Escape dismissal
        // ONCE before spending the no-progress budget; coordinate-free, so it
        // sidesteps the grounding imprecision that caused the loop.
        //
        // Skip when a dropdown/combobox is open: that listbox is almost
        // certainly what the agent is operating, and Escape would close the very
        // list it needs to pick from.
        if (ctx.overlay?.present && !ctx.openList?.open && !escapeRecoveryTried) {
          escapeRecoveryTried = true;
          await page.press(parseHotkey("Escape")).catch(() => {});
          await page.waitForSettle();
          history.addFeedback(
            "A blocking dialog/overlay was not dismissed by the repeated action; pressed Escape to recover. Re-read the screen, then continue toward the goal.",
          );
          prevHash = hash; // measure Escape's effect next iteration; don't advance the action
          continue;
        }
        // (a) repeating the exact same action+target with no effect — the A1
        // livelock; bail fast. But first check whether the goal is already done:
        // a planner that can't emit <complete> keeps re-tapping a target it has
        // already actioned (e.g. an option it already selected).
        if (++repeatCount >= MAX_REPEAT) {
          const done = await inferComplete();
          if (done) return done;
          throw new NoProgressError(sig, repeatCount);
        }
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
        const done = await inferComplete();
        if (done) return done;
        throw new NoProgressError("screen unchanged across multiple steps", staleCount);
      }
    } else {
      staleCount = 0;
      repeatCount = 0;
      escapeRecoveryTried = false; // progress made — allow recovery again later
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
  const done = await inferComplete();
  if (done) return done;
  throw new MaxStepsError();
}
