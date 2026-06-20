/**
 * Resolved config + model factory. Env: GOOGLE_GENERATIVE_AI_API_KEY.
 * The provider abstraction keeps the library model-independent: swapping
 * `@ai-sdk/google` for another provider is a one-liner.
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV1 } from "ai";

export const DEFAULT_MODEL = "gemini-2.5-flash";

let googleProvider: ReturnType<typeof createGoogleGenerativeAI> | undefined;

function google() {
  if (!googleProvider) {
    googleProvider = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
  }
  return googleProvider;
}

export function resolveModel(name: string = DEFAULT_MODEL): LanguageModelV1 {
  return google()(name);
}
