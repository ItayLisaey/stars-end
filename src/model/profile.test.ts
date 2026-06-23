/**
 * The model-profile registry: built-in Gemini resolution, custom registration
 * (taking precedence), and a clear error for unknown models.
 */
import { describe, expect, it, vi } from "vitest";
import { UnsupportedModelError } from "../errors.js";
import type { CoordinateAdapter } from "../types.js";
import { type ModelProfile, profileFor, registerProfile } from "./profile.js";

const fakeModel = { modelId: "x" } as unknown as ReturnType<ModelProfile["languageModel"]>;
const pointAdapter: CoordinateAdapter = { shape: "point", order: "xy" };

describe("model profile registry", () => {
  it("resolves Gemini ids to the built-in gemini profile", () => {
    expect(profileFor("gemini-2.5-flash").name).toBe("gemini");
    expect(profileFor("gemini-3.5-flash").name).toBe("gemini");
    expect(profileFor("models/gemini-2.5-flash").name).toBe("gemini");
  });

  it("throws UnsupportedModelError for an unknown model", () => {
    expect(() => profileFor("gpt-9-omega")).toThrow(UnsupportedModelError);
  });

  it("lets a custom profile handle new model ids", () => {
    const custom: ModelProfile = {
      name: "acme",
      matches: (id) => id.startsWith("acme-"),
      languageModel: vi.fn(() => fakeModel),
      adapter: pointAdapter,
      providerOptions: () => undefined,
      temperature: 0.2,
    };
    registerProfile(custom);

    const p = profileFor("acme-vision-1");
    expect(p.name).toBe("acme");
    expect(p.adapter).toBe(pointAdapter);
    expect(p.temperature).toBe(0.2);
    // unrelated ids still hit the built-in
    expect(profileFor("gemini-2.5-flash").name).toBe("gemini");
  });

  it("custom profiles take precedence over built-ins", () => {
    const override: ModelProfile = {
      name: "gemini-override",
      matches: (id) => id === "gemini-2.5-flash",
      languageModel: vi.fn(() => fakeModel),
      adapter: pointAdapter,
      providerOptions: () => undefined,
    };
    registerProfile(override);
    expect(profileFor("gemini-2.5-flash").name).toBe("gemini-override");
    // a different gemini id still resolves to the built-in
    expect(profileFor("gemini-3.5-flash").name).toBe("gemini");
  });
});
