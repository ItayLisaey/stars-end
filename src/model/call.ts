/**
 * AI SDK call wrappers. `generateObject` enforces the schema provider-side
 * (Gemini responseSchema), retries on mismatch, and returns a validated `T`.
 */
import { generateObject, generateText, type LanguageModelV1 } from "ai";
import type { z } from "zod";
import { DEFAULT_MODEL, resolveModel } from "../config.js";
import { geminiProviderOptions } from "./gemini.js";

interface BaseCallArgs {
  system: string;
  userText: string;
  imageDataUrl?: string;
  model?: LanguageModelV1 | string;
}

function resolve(model: BaseCallArgs["model"]): LanguageModelV1 {
  if (!model) return resolveModel();
  return typeof model === "string" ? resolveModel(model) : model;
}

/** Resolve the model id string, for picking generation-specific options. */
function modelName(model: BaseCallArgs["model"]): string {
  if (typeof model === "string") return model;
  return model?.modelId ?? DEFAULT_MODEL;
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
  const { object, usage } = await generateObject({
    model: resolve(args.model),
    schema: args.schema,
    temperature: 0, // coordinate jitter is real
    providerOptions: geminiProviderOptions(modelName(args.model)),
    system: args.system,
    messages: [{ role: "user", content: userContent(args) }],
  });
  return { object, usage };
}

export async function callText(args: BaseCallArgs): Promise<{ text: string; usage: CallUsage }> {
  const { text, usage } = await generateText({
    model: resolve(args.model),
    temperature: 0,
    providerOptions: geminiProviderOptions(modelName(args.model)),
    system: args.system,
    messages: [{ role: "user", content: userContent(args) }],
  });
  return { text, usage };
}
