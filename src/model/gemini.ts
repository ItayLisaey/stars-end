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
 * AI SDK providerOptions for thinking config. Gemini 3.x cannot fully disable
 * thinking; use the lowest effort.
 */
export const geminiProviderOptions = {
  google: {
    thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
  },
} as const;
