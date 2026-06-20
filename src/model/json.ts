/**
 * Fallback JSON parser for `generateText` / XML-island paths. `generateObject`
 * handles the strict-schema paths; this only handles loose JSON islands inside
 * XML.
 *
 * Behaviors:
 *  - extract JSON from ```json fences / loose {...}
 *  - jsonrepair fallback
 *  - trim keys + string values, EXCEPT keys in `preserveStringValueKeys`
 *  - the `(x,y)` coordinate-tuple shortcut
 */
import { jsonrepair } from "jsonrepair";

export interface JsonParseOptions {
  /** Keys whose string values must NOT be whitespace-trimmed (e.g. ['value']). */
  preserveStringValueKeys?: string[];
}

export function extractJSONFromCodeBlock(response: string): string {
  try {
    const direct = response.match(/^\s*(\{[\s\S]*\})\s*$/);
    if (direct) return direct[1];

    const codeBlock = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlock) return codeBlock[1];

    const jsonLike = response.match(/\{[\s\S]*\}/);
    if (jsonLike) return jsonLike[0];
  } catch {
    // fall through
  }
  return response;
}

function normalizeJsonObject(obj: unknown, opt: JsonParseOptions): unknown {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) return obj.map((item) => normalizeJsonObject(item, opt));

  if (typeof obj === "object") {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const trimmedKey = key.trim();
      const preserve = opt.preserveStringValueKeys?.includes(trimmedKey) ?? false;
      normalized[trimmedKey] =
        typeof value === "string"
          ? preserve
            ? value
            : value.trim()
          : normalizeJsonObject(value, opt);
    }
    return normalized;
  }

  if (typeof obj === "string") return obj.trim();
  return obj;
}

/**
 * Parse a possibly-messy JSON string. Throws on unrecoverable input — never
 * returns a partial/undefined object silently.
 */
export function safeParseJson(raw: string, opt: JsonParseOptions = {}): unknown {
  const cleaned = extractJSONFromCodeBlock(raw);

  // (x,y) coordinate-tuple shortcut
  const tuple = cleaned.match(/\((\d+),(\d+)\)/);
  if (tuple) return [Number(tuple[1]), Number(tuple[2])];

  try {
    return normalizeJsonObject(JSON.parse(cleaned), opt);
  } catch {
    // fall through to repair
  }
  try {
    return normalizeJsonObject(JSON.parse(jsonrepair(cleaned)), opt);
  } catch (error) {
    throw new Error(
      `failed to parse LLM response into JSON. Error - ${String(error)}. Response -\n ${raw}`,
      { cause: error },
    );
  }
}
