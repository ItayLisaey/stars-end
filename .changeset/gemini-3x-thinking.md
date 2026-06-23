---
"stars-end": patch
---

Fix Gemini "thinking" config per model generation — Gemini 3.x models (e.g. `gemini-3.5-flash`) were being crippled. We forced `thinkingConfig.thinkingBudget: 0` on every call, which is correct for 2.5 (disables thinking) but a documented anti-pattern on thinking-first 3.x models: they can't disable thinking and use `thinkingLevel`, not `thinkingBudget`. Forcing the budget to 0 starved their output, producing empty/garbled planning responses (which looked like "3.5 is worse than 2.5" — it wasn't).

Now generation-aware: 2.5 keeps `thinkingBudget: 0`; 3.x uses `thinkingLevel: "minimal"`. With the fix, `gemini-3.5-flash` passes the full live stress suite 8/8 (was 6/8 with empty-completion glitches).
