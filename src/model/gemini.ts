/**
 * Gemini coordinate adapter + provider options.
 * Gemini returns bbox as [y,x,y,x], normalized 0–1000.
 */
import type { CoordinateAdapter } from "../types.js";

export const geminiAdapter: CoordinateAdapter = {
  shape: "bbox",
  order: "yx",
  normalizedBy: 1000,
};

/**
 * AI SDK `providerOptions` for Gemini "thinking", per model generation. The
 * knob differs across generations and using the wrong one breaks the model:
 *
 * - **2.5** (`gemini-2.5-*`): thinking is opt-in and CAN be disabled with
 *   `thinkingBudget: 0` — which we do, since our short XML planning/locate calls
 *   don't benefit from it and it adds latency/cost.
 * - **3.x** (`gemini-3*`, e.g. `gemini-3.5-flash`): thinking-first models that
 *   CANNOT disable thinking and use `thinkingLevel`, NOT `thinkingBudget`.
 *   Forcing `thinkingBudget: 0` here is a known anti-pattern — it starves the
 *   output and the model returns empty/garbled text. Use `thinkingLevel:
 *   "minimal"` for low latency while keeping thinking on.
 */
export function geminiProviderOptions(modelName: string) {
  const is3x = /(^|\/)gemini-3/.test(modelName);
  const thinkingConfig: Record<string, string | number | boolean> = is3x
    ? { thinkingLevel: "minimal", includeThoughts: false }
    : { thinkingBudget: 0, includeThoughts: false };
  return { google: { thinkingConfig } };
}
