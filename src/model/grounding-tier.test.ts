/**
 * The model id passed to createGroundingTier is carried on the tier, so every
 * call made through it (plan/locate, and the check/query insights that receive
 * the tier) uses that model. Previously the Agent's `model` option was dead —
 * it never reached the model calls.
 */
import { describe, expect, it } from "vitest";
import { createGroundingTier, groundingTier } from "./grounding-tier.js";

describe("createGroundingTier", () => {
  it("carries the requested model id on the tier", () => {
    expect(createGroundingTier("gemini-3.5-flash").model).toBe("gemini-3.5-flash");
  });

  it("leaves model undefined (library default) when none is given", () => {
    expect(createGroundingTier().model).toBeUndefined();
    expect(groundingTier.model).toBeUndefined();
  });

  it("is a grounding tier", () => {
    expect(createGroundingTier("x").kind).toBe("grounding");
  });
});
