/**
 * Thinking config must be picked per model generation. Gemini 2.5 disables
 * thinking with `thinkingBudget: 0`; Gemini 3.x is thinking-first and uses
 * `thinkingLevel` — forcing `thinkingBudget: 0` there starves the output and
 * returns empty/garbled text.
 */
import { describe, expect, it } from "vitest";
import { geminiProfile } from "./gemini.js";

const cfg = (model: string) =>
  (
    (geminiProfile.providerOptions(model)?.google ?? {}) as {
      thinkingConfig: Record<string, unknown>;
    }
  ).thinkingConfig;

describe("gemini profile thinking config", () => {
  it("disables thinking via thinkingBudget on 2.5 models", () => {
    expect(cfg("gemini-2.5-flash")).toMatchObject({ thinkingBudget: 0 });
    expect(cfg("gemini-2.5-flash")).not.toHaveProperty("thinkingLevel");
  });

  it("uses thinkingLevel (not thinkingBudget) on 3.x models", () => {
    for (const m of ["gemini-3-flash", "gemini-3.5-flash", "models/gemini-3.5-flash"]) {
      expect(cfg(m)).toMatchObject({ thinkingLevel: "minimal" });
      expect(cfg(m)).not.toHaveProperty("thinkingBudget");
    }
  });

  it("never includes thoughts in the visible output", () => {
    expect(cfg("gemini-2.5-flash")).toMatchObject({ includeThoughts: false });
    expect(cfg("gemini-3.5-flash")).toMatchObject({ includeThoughts: false });
  });
});
