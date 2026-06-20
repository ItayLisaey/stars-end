/**
 * query / extract. With AI SDK strict mode we pass the caller's Zod
 * schema directly to generateObject, wrapped in a thought/data/errors envelope.
 */
import { z } from "zod";
import type { PageDriver } from "../driver/types.js";
import { ExtractError } from "../errors.js";
import { callObject } from "../model/call.js";
import { safeParseJson } from "../model/json.js";
import { extractXMLTag } from "../planner/parse.js";
import { EXTRACT_SYSTEM_PROMPT } from "./prompts.js";
import type { ModelTier, UIContext } from "../model/types.js";

export interface ExtractOpt {
  context?: UIContext;
}

export interface XMLExtractionResult<T> {
  thought?: string;
  data: T;
  errors?: string[];
}

/**
 * Parse the XML `<thought>/<data-json>/<errors>` extraction envelope — used when
 * a provider chokes on a complex nested schema in strict mode.
 */
export function parseXMLExtractionResponse<T>(xml: string): XMLExtractionResult<T> {
  const thought = extractXMLTag(xml, "thought");
  const dataJsonStr = extractXMLTag(xml, "data-json");
  if (!dataJsonStr) {
    throw new Error("Missing required field: data-json");
  }
  let data: T;
  try {
    data = safeParseJson(dataJsonStr) as T;
  } catch (e) {
    throw new Error(`Failed to parse data-json: ${String(e)}`, { cause: e });
  }
  let errors: string[] | undefined;
  const errorsStr = extractXMLTag(xml, "errors");
  if (errorsStr) {
    try {
      const parsed = safeParseJson(errorsStr);
      if (Array.isArray(parsed)) errors = parsed;
    } catch {
      // ignore an unparseable errors field
    }
  }
  return {
    ...(thought ? { thought } : {}),
    data,
    ...(errors && errors.length > 0 ? { errors } : {}),
  };
}

export async function query<T>(
  page: PageDriver,
  tier: ModelTier,
  schema: z.ZodType<T>,
  demand: string,
  opt?: ExtractOpt,
): Promise<T> {
  const ctx = opt?.context ?? (await tier.buildContext(page));
  const envelope = z.object({
    thought: z.string().optional(),
    data: schema,
    errors: z.array(z.string()).optional(),
  });
  const { object } = await callObject({
    schema: envelope,
    system: EXTRACT_SYSTEM_PROMPT,
    userText: `<DATA_DEMAND>\n${demand}\n</DATA_DEMAND>`,
    imageDataUrl: ctx.screenshotDataUrl,
  });

  if (object.errors?.length) throw new ExtractError(object.errors);
  return object.data as T;
}
