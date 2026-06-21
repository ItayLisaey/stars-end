# stars-end

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
