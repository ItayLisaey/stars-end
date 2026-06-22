---
"stars-end": minor
---

Strengthen completion handling and small-target grounding (found via a live stress suite):

- **Verify claimed completions.** When the planner emits `<complete success="true">` after making progress, `act()` confirms the goal against the screen (via the tier's new `isGoalSatisfied` check) and, if it isn't actually satisfied, rejects the premature claim and continues. The symmetric partner to the existing "infer completion when the planner won't emit one." The completion check is now a tier capability, so lightweight/fake tiers skip it (no model calls in unit tests).
- **Infer completion on every give-up path.** The completion fallback now also guards the repeat / stale no-progress bails (not just the empty-plan and max-steps paths), so a planner that keeps re-actioning an already-done target still succeeds.
- **Auto deep-locate on ~30px targets.** Raised the "small target" threshold from 28→32 CSS px so compact icons/swatches/dense controls get the crop+upscale refine pass (kept below typical 36–44px rows/buttons so normal controls don't pay for it).
- **Completion-honesty prompt rule:** never complete while remaining steps are pending or unconfirmed.
