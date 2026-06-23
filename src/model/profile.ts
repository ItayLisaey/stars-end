/**
 * Model profiles — the plugin seam between the library and the AI SDK. A
 * profile bundles everything model/provider-specific the library needs so that
 * adding a model (or a whole new provider / grounding model) is a single
 * `registerProfile(...)` call, and each model gets the RIGHT settings attached
 * (e.g. the per-generation Gemini thinking config).
 */
import type { LanguageModelV1 } from "ai";
import { UnsupportedModelError } from "../errors.js";
import type { CoordinateAdapter } from "../types.js";
import { geminiProfile } from "./gemini.js";

/** AI SDK `providerOptions` shape (provider → option bag). */
export type ProviderOptions = Record<string, Record<string, JsonValue>>;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ModelProfile {
  /** human-readable label, e.g. "gemini" */
  readonly name: string;
  /** does this profile handle the given model id? */
  matches(modelId: string): boolean;
  /** build the AI SDK language model for the id (provider lives here) */
  languageModel(modelId: string): LanguageModelV1;
  /** how this model emits grounding coordinates (normalized/order/shape) */
  readonly adapter: CoordinateAdapter;
  /** AI SDK providerOptions for the id (thinking/reasoning config, etc.) */
  providerOptions(modelId: string): ProviderOptions | undefined;
  /** sampling temperature for this model (default 0) */
  readonly temperature?: number;
}

const builtin: ModelProfile[] = [geminiProfile];
const custom: ModelProfile[] = [];

/**
 * Register a custom model profile. Most-recently-registered wins, and custom
 * profiles take precedence over the built-ins — so you can override a built-in
 * for specific ids or add an entirely new provider.
 */
export function registerProfile(profile: ModelProfile): void {
  custom.unshift(profile);
}

/** Resolve the profile for a model id, or throw {@link UnsupportedModelError}. */
export function profileFor(modelId: string): ModelProfile {
  const match = custom.find((p) => p.matches(modelId)) ?? builtin.find((p) => p.matches(modelId));
  if (!match) throw new UnsupportedModelError(modelId);
  return match;
}
