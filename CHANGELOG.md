# stars-end

## 0.4.0

### Minor Changes

- 902c54a: Add a model-profile plugin system. Everything model/provider-specific — the AI SDK model factory, the coordinate adapter (how the model emits bboxes), the `providerOptions` (e.g. the per-generation Gemini thinking config), and the sampling temperature — is now bundled in a `ModelProfile` resolved from a registry, instead of being scattered across `config`, `call`, and the grounding tier.

  New public API:

  - `registerProfile(profile)` — plug in a custom model/provider (custom profiles take precedence over built-ins, so you can also override one).
  - `profileFor(modelId)` and the `ModelProfile` / `ProviderOptions` types.
  - `UnsupportedModelError` — thrown when no profile matches a model id.

  The built-in Gemini profile carries the generation-aware thinking config. Using a model with no matching profile now throws `UnsupportedModelError` (it can't pick a coordinate adapter / provider) rather than silently misbehaving.

### Patch Changes

- c5245c2: Fix Gemini "thinking" config per model generation — Gemini 3.x models (e.g. `gemini-3.5-flash`) were being crippled. We forced `thinkingConfig.thinkingBudget: 0` on every call, which is correct for 2.5 (disables thinking) but a documented anti-pattern on thinking-first 3.x models: they can't disable thinking and use `thinkingLevel`, not `thinkingBudget`. Forcing the budget to 0 starved their output, producing empty/garbled planning responses (which looked like "3.5 is worse than 2.5" — it wasn't).

  Now generation-aware: 2.5 keeps `thinkingBudget: 0`; 3.x uses `thinkingLevel: "minimal"`. With the fix, `gemini-3.5-flash` passes the full live stress suite 8/8 (was 6/8 with empty-completion glitches).

## 0.3.0

### Minor Changes

- 8294f41: Strengthen completion handling and small-target grounding (found via a live stress suite):

  - **Verify claimed completions.** When the planner emits `<complete success="true">` after making progress, `act()` confirms the goal against the screen (via the tier's new `isGoalSatisfied` check) and, if it isn't actually satisfied, rejects the premature claim and continues. The symmetric partner to the existing "infer completion when the planner won't emit one." The completion check is now a tier capability, so lightweight/fake tiers skip it (no model calls in unit tests).
  - **Infer completion on every give-up path.** The completion fallback now also guards the repeat / stale no-progress bails (not just the empty-plan and max-steps paths), so a planner that keeps re-actioning an already-done target still succeeds.
  - **Auto deep-locate on ~30px targets.** Raised the "small target" threshold from 28→32 CSS px so compact icons/swatches/dense controls get the crop+upscale refine pass (kept below typical 36–44px rows/buttons so normal controls don't pay for it).
  - **Completion-honesty prompt rule:** never complete while remaining steps are pending or unconfirmed.

- 50aa27a: Fix two issues found while testing the dropdown work against the real model:

  - **`Agent({ model })` now actually takes effect.** It was dead — `plan`/`locate` and the `check`/`query`/`assert` insights always used the library default (`gemini-2.5-flash`) regardless of the option. The model is now carried on the grounding tier (`createGroundingTier(model)`) and threaded through every model call. Behavior change: callers who passed a non-default model were silently getting the default and will now get the model they asked for.

  - **Completion fallback in `act()`.** Some planners (observed on `gemini-3.5-flash`) stop emitting a valid `<complete>` once the goal is met — they return empty or off-task text — so the loop would throw `NoProgressError`/`MaxStepsError` even though the task succeeded. When `act()` is about to give up _and_ it has made progress, it now asks an independent yes/no `check` whether the goal is satisfied and returns success if so. Measured on a hard scroll-to-below-fold dropdown scenario on 3.5-flash: 0/6 → 5/5.

- b459fde: Click the located element, not the raw coordinate. Vision models routinely return a click point a few pixels off a normal-sized control; a blind `mouse.click(x,y)` then misses and the agent can't tell a missed click from a no-op button.

  The click pipeline now snaps the located point to the real interactive element near it (`elementFromPoint` → climb to the nearest `button`/`a`/`input`/`[role=…]`/`cursor:pointer` ancestor, or snap to the nearest interactive element within ~24px) and clicks THAT element via Playwright's actionability-checked `locator.click()` (auto-wait, scroll-into-view, hit-test). It falls back to a raw coordinate click when no element resolves (canvas / non-DOM targets) or the element click fails.

  This is the approach every high-accuracy DOM-aware web agent uses (browser-use, Skyvern, SeeAct, WebVoyager); pure-coordinate clicking is for surfaces with no DOM. Applies to `tap`/`rightClick`/`doubleClick` (action + Agent). It measurably reduces missed clicks on buttons, options, toggles, and icons.

### Patch Changes

- 70fd337: Fix the dominant flake on forms with several custom dropdowns: after an action opens a `role="combobox"`/`listbox`, the planner would keep re-locating the trigger by its closed-state value ("the X dropdown showing Nov") even though the screen now shows the option list — the locate missed, repeated, and looped to `TooManyErrors`.

  - Detect an open dropdown/combobox (visible `role="listbox"`/`menu` with options, or an `aria-expanded` combobox with a portalled list) and surface it to the planner, with the visible option count.
  - Add a planning rule to operate an OPEN dropdown by its options ("the option labelled X in the open list") rather than the closed trigger, and to scroll the open list when the wanted option is below the fold.
  - Compose safely with the dialog Escape-recovery from 0.2.1: the loop no longer presses Escape while a dropdown is open, so recovery can't close the list the agent is actively picking from.

## 0.2.1

### Patch Changes

- 27c9124: `act()` now actively recovers from an unexpected blocking dialog instead of burning its budget on dismiss taps that keep missing. When a top-layer overlay is present and the same action repeats without changing the screen, the loop presses `Escape` once (coordinate-free, so it sidesteps the grounding imprecision that tripped the guard in the first place) before counting down the no-progress budget. Pairs with the existing auto deep-locate on small/icon-sized targets, which reduces the stray clicks that pop these guards.

  Also adds a regression test confirming `input` append mode (`typeOnly`) never issues the `replace`-mode select-all, so existing field content is preserved.

## 0.2.0

### Minor Changes

- 86ec224: Harden the autonomous `act()` loop and instant actions against the failure modes seen in real e2e runs:

  - **No-progress / repetition guard.** The loop now bails fast with a new `NoProgressError` when an action repeatedly produces no state change (an obscured/no-op tap that "succeeds" at coordinates) or when the screen stays frozen across steps — previously only consecutive _thrown_ errors could stop the loop, so a no-op livelocked until the host runner's timeout. Step feedback is now also surfaced to the planner.
  - **Input verification.** `input` (action + `Agent.input`) reads the field back after typing and throws a new `InputVerificationError` when no text landed (focus never reaching a rich/contenteditable composer), with one focus-and-retype recovery first. Unreadable widgets are treated as unverifiable and pass, to avoid false failures.
  - **Auto deep-locate on small targets.** `locate()` now engages the two-stage crop+upscale pass for small/icon-sized hits, not only when the coarse locate finds nothing.
  - **Surface-aware planning.** A top-layer modal/dialog/popover is detected and surfaced to the planner, with prompt rules for surface-aware completion, first/Nth-item bias away from add/placeholder tiles, and dismiss-then-retry recovery for unexpected popovers.
  - **Richer trace.** Per-step action outcome (`ok`, `stateChanged`) is now emitted in the trace.

  New exported error classes: `NoProgressError`, `InputVerificationError`.

## 0.1.1

### Patch Changes

- e0a5819: Docs: lead the README with `act()`, frame the library as an e2e testing tool, demote Gemini to a supported-provider mention, and use an absolute header image URL. Add a gated live `act()` smoke test.
