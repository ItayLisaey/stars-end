/**
 * Planning system prompt. The action list is generated from the action-space
 * descriptions/samples (NOT Zod `_def` reflection), then the rules and output
 * format are appended.
 */
import type { OverlaySurface } from "../model/types.js";
import type { Step } from "../types.js";
import type { ActionDef } from "./action-space.js";

const NO_PREVIOUS_ACTIONS = "(none yet — this is the first step)";

function actionListText(actionSpace: ActionDef[]): string {
  return actionSpace
    .map((a) => {
      const sample = JSON.stringify(a.sample);
      return `- ${a.name}: ${a.description}\n  param example: ${sample}`;
    })
    .join("\n");
}

const WISDOM = `## Rules (follow exactly)
- A <thought> is REQUIRED on every step.
- Explicit steps vs high-level goal: if the user gave exact steps, do ONLY those — no helpful extras. "fill the form" does NOT mean submit; "type X" does NOT mean press Enter; "click Y" does NOT mean wait/verify afterwards.
- Durable-change completion: for create/edit/update/delete/save/send/submit/apply/publish intents, do not stop at an unsaved draft — drive through Save/Confirm/OK/Submit/Apply. If the user only asked for an intermediate UI state, stop there.
- Do NOT re-verify input after typing (CRITICAL): if the previous step was an Input and the field is non-empty, treat it as success. Do NOT clear / re-Input / "fix" based on visible text — clipping, scroll, narrow fields, and selection make it look wrong. Retry only if the field is clearly empty or there is an explicit error.
- Open dropdown/listbox: open the control, then scroll the OPEN LIST in small 50–120px increments with an explicit distance; never omit distance. Tap the option once visible.
- Do not assert while a spinner/skeleton/progress bar is visible — wait for load.
- Surface-aware completion: completion is NOT "is the target still visible?". If your goal was to open/show/select/expand something and a NEW modal, dialog, detail panel, sheet, or popover is now open — even one that only dims but keeps the page visible behind it — the task is DONE. Return <complete success="true">; do NOT re-click the underlying element you can still see behind the overlay.
- First/Nth item: when told to use "the first / Nth / last" item, ignore add/new/empty/placeholder tiles (e.g. a "+ Add" or "New" card) and count only real content items. The visually top-left tile is often a placeholder, not the first item.
- Unexpected popover recovery: if a tap opened a menu/popover/dialog you did NOT intend (and it now blocks your target), dismiss it FIRST — press Escape or click outside — then retry the intended target. Do not keep tapping behind it.
- No-progress: if feedback says your last action did not change the screen, do NOT repeat the same action on the same target. Re-ground (the target may be obscured, offscreen, or a no-op) and choose a different target or approach.`;

const ENVELOPE = `## Output format (XML)
Respond with exactly one step. For an action:
<thought>observe the current screenshot, decide the single next action</thought>
<action-type>Tap</action-type>
<action-param-json>{ "locate": { "prompt": "the Add to cart button" } }</action-param-json>

To finish (success or give-up):
<thought>the cart shows the item, task done</thought>
<complete success="true">added backpack to cart</complete>

If you cannot proceed, use <complete success="false">reason</complete>. Never output both an action and <complete>.`;

export function planningSystemPrompt(actionSpace: ActionDef[]): string {
  return `## Role
You are an autonomous web agent. You see a screenshot and a goal, and you choose ONE next action at a time to make progress toward the goal.

## Available actions
${actionListText(actionSpace)}

${WISDOM}

${ENVELOPE}`;
}

export interface PlanningContext {
  /** errors / no-progress nudges surfaced from the previous step(s) */
  feedback?: string[];
  /** a top-layer modal/dialog/popover currently open over the page */
  overlay?: OverlaySurface;
}

export function planningUserPrompt(goal: string, history: Step[], extra?: PlanningContext): string {
  const logs =
    history.length === 0
      ? NO_PREVIOUS_ACTIONS
      : history
          .map((s, i) => {
            const action = `${s.action.type}${
              s.action.param ? ` ${JSON.stringify(s.action.param)}` : ""
            }`;
            return `${i + 1}. ${s.thought ? `(${s.thought}) ` : ""}${action}`;
          })
          .join("\n");

  const overlayNote = extra?.overlay?.present
    ? `\n\n## Current overlay\n${extra.overlay.description ?? "an overlay"} is open over the page. If opening it was the goal, you are likely done.`
    : "";

  const feedbackNote =
    extra?.feedback && extra.feedback.length > 0
      ? `\n\n## Feedback from previous step(s)\n${extra.feedback.map((f) => `- ${f}`).join("\n")}`
      : "";

  return `## Goal
${goal}

## Previous actions
${logs}${overlayNote}${feedbackNote}

Decide the single next action (or completion) now.`;
}
