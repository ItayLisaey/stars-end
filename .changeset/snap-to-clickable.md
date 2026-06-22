---
"stars-end": minor
---

Click the located element, not the raw coordinate. Vision models routinely return a click point a few pixels off a normal-sized control; a blind `mouse.click(x,y)` then misses and the agent can't tell a missed click from a no-op button.

The click pipeline now snaps the located point to the real interactive element near it (`elementFromPoint` → climb to the nearest `button`/`a`/`input`/`[role=…]`/`cursor:pointer` ancestor, or snap to the nearest interactive element within ~24px) and clicks THAT element via Playwright's actionability-checked `locator.click()` (auto-wait, scroll-into-view, hit-test). It falls back to a raw coordinate click when no element resolves (canvas / non-DOM targets) or the element click fails.

This is the approach every high-accuracy DOM-aware web agent uses (browser-use, Skyvern, SeeAct, WebVoyager); pure-coordinate clicking is for surfaces with no DOM. Applies to `tap`/`rightClick`/`doubleClick` (action + Agent). It measurably reduces missed clicks on buttons, options, toggles, and icons.
