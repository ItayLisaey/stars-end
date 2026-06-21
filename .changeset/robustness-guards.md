---
"stars-end": minor
---

Harden the autonomous `act()` loop and instant actions against the failure modes seen in real e2e runs:

- **No-progress / repetition guard.** The loop now bails fast with a new `NoProgressError` when an action repeatedly produces no state change (an obscured/no-op tap that "succeeds" at coordinates) or when the screen stays frozen across steps — previously only consecutive *thrown* errors could stop the loop, so a no-op livelocked until the host runner's timeout. Step feedback is now also surfaced to the planner.
- **Input verification.** `input` (action + `Agent.input`) reads the field back after typing and throws a new `InputVerificationError` when no text landed (focus never reaching a rich/contenteditable composer), with one focus-and-retype recovery first. Unreadable widgets are treated as unverifiable and pass, to avoid false failures.
- **Auto deep-locate on small targets.** `locate()` now engages the two-stage crop+upscale pass for small/icon-sized hits, not only when the coarse locate finds nothing.
- **Surface-aware planning.** A top-layer modal/dialog/popover is detected and surfaced to the planner, with prompt rules for surface-aware completion, first/Nth-item bias away from add/placeholder tiles, and dismiss-then-retry recovery for unexpected popovers.
- **Richer trace.** Per-step action outcome (`ok`, `stateChanged`) is now emitted in the trace.

New exported error classes: `NoProgressError`, `InputVerificationError`.
