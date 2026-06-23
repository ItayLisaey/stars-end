/**
 * AI SDK call wrappers. `generateObject` enforces the schema provider-side
 * (Gemini responseSchema), retries on mismatch, and returns a validated `T`.
 * The model, temperature, and providerOptions all come from the matching model
 * profile (see `profile.ts`), so per-model settings are attached in one place.
 */
import { generateObject, generateText, type LanguageModelV1 } from "ai";
import type { z } from "zod";
import { DEFAULT_MODEL } from "../config.js";
import { type ModelProfile, profileFor } from "./profile.js";

interface BaseCallArgs {
  system: string;
  userText: string;
  imageDataUrl?: string;
  model?: LanguageModelV1 | string;
}

/** Resolve the model id string, for selecting and configuring the profile. */
function modelName(model: BaseCallArgs["model"]): string {
  if (typeof model === "string") return model;
  return model?.modelId ?? DEFAULT_MODEL;
}

/** The model + its profile (a pre-built LanguageModelV1 keeps its own profile). */
function resolve(model: BaseCallArgs["model"]): { model: LanguageModelV1; profile: ModelProfile } {
  const id = modelName(model);
  const profile = profileFor(id);
  return {
    model: typeof model === "object" && model ? model : profile.languageModel(id),
    profile,
  };
}

function userContent(args: BaseCallArgs) {
  return [
    ...(args.imageDataUrl ? [{ type: "image" as const, image: args.imageDataUrl }] : []),
    { type: "text" as const, text: args.userText },
  ];
}

export interface CallUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export async function callObject<T>(
  args: BaseCallArgs & { schema: z.ZodType<T> },
): Promise<{ object: T; usage: CallUsage }> {
  const { model, profile } = resolve(args.model);
  const { object, usage } = await generateObject({
    model,
    schema: args.schema,
    temperature: profile.temperature ?? 0, // coordinate jitter is real
    providerOptions: profile.providerOptions(modelName(args.model)),
    system: args.system,
    messages: [{ role: "user", content: userContent(args) }],
  });
  return { object, usage };
}

export async function callText(args: BaseCallArgs): Promise<{ text: string; usage: CallUsage }> {
  const { model, profile } = resolve(args.model);
  const { text, usage } = await generateText({
    model,
    temperature: profile.temperature ?? 0,
    providerOptions: profile.providerOptions(modelName(args.model)),
    system: args.system,
    messages: [{ role: "user", content: userContent(args) }],
  });
  return { text, usage };
}
