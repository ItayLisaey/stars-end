/**
 * Resolved config. The provider/model factory now lives in model profiles
 * (see `model/profile.ts`); `resolveModel` just delegates to the matching one.
 */
import type { LanguageModelV1 } from "ai";
import { profileFor } from "./model/profile.js";

export const DEFAULT_MODEL = "gemini-2.5-flash";

export function resolveModel(name: string = DEFAULT_MODEL): LanguageModelV1 {
  return profileFor(name).languageModel(name);
}
