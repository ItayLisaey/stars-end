---
"stars-end": patch
---

`act()` now actively recovers from an unexpected blocking dialog instead of burning its budget on dismiss taps that keep missing. When a top-layer overlay is present and the same action repeats without changing the screen, the loop presses `Escape` once (coordinate-free, so it sidesteps the grounding imprecision that tripped the guard in the first place) before counting down the no-progress budget. Pairs with the existing auto deep-locate on small/icon-sized targets, which reduces the stray clicks that pop these guards.

Also adds a regression test confirming `input` append mode (`typeOnly`) never issues the `replace`-mode select-all, so existing field content is preserved.
