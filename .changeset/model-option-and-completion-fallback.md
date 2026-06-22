---
"stars-end": minor
---

Fix two issues found while testing the dropdown work against the real model:

- **`Agent({ model })` now actually takes effect.** It was dead — `plan`/`locate` and the `check`/`query`/`assert` insights always used the library default (`gemini-2.5-flash`) regardless of the option. The model is now carried on the grounding tier (`createGroundingTier(model)`) and threaded through every model call. Behavior change: callers who passed a non-default model were silently getting the default and will now get the model they asked for.

- **Completion fallback in `act()`.** Some planners (observed on `gemini-3.5-flash`) stop emitting a valid `<complete>` once the goal is met — they return empty or off-task text — so the loop would throw `NoProgressError`/`MaxStepsError` even though the task succeeded. When `act()` is about to give up _and_ it has made progress, it now asks an independent yes/no `check` whether the goal is satisfied and returns success if so. Measured on a hard scroll-to-below-fold dropdown scenario on 3.5-flash: 0/6 → 5/5.
