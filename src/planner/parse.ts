/**
 * XML planning-envelope parser. Extracts the planner's thought, action, and
 * completion tags from the model's XML response.
 */
import { safeParseJson } from "../model/json.js";

export interface PlanParseResult {
  thought?: string;
  action?: { type: string; param?: unknown };
  complete?: { success: boolean; message?: string };
  error?: string;
  log?: string;
}

type JsonParser = (raw: string, opt?: { preserveStringValueKeys?: string[] }) => unknown;

/**
 * Extract content from an XML tag, searching from the END so leading model
 * "thinking" (e.g. `<think>...</think>`) before the real tags is ignored.
 * Handles half-open tags like `<action-type>Input` (no close tag).
 */
export function extractXMLTag(xmlString: string, tagName: string): string | undefined {
  const lower = xmlString.toLowerCase();
  const lowerTag = tagName.toLowerCase();
  const closeTag = `</${lowerTag}>`;
  const openTag = `<${lowerTag}>`;

  const lastCloseIndex = lower.lastIndexOf(closeTag);
  if (lastCloseIndex === -1) {
    // half-open fallback: extract until the next tag boundary
    const lastOpenIndex = lower.lastIndexOf(openTag);
    if (lastOpenIndex === -1) return undefined;
    const contentStart = lastOpenIndex + openTag.length;
    const remaining = xmlString.substring(contentStart);
    const nextTagIndex = remaining.indexOf("<");
    return (nextTagIndex === -1 ? remaining : remaining.substring(0, nextTagIndex)).trim();
  }

  const searchArea = lower.substring(0, lastCloseIndex);
  const lastOpenIndex = searchArea.lastIndexOf(openTag);
  if (lastOpenIndex === -1) return undefined;
  return xmlString.substring(lastOpenIndex + openTag.length, lastCloseIndex).trim();
}

export function parsePlan(xml: string, parseJson: JsonParser = safeParseJson): PlanParseResult {
  const thought = extractXMLTag(xml, "thought");
  const error = extractXMLTag(xml, "error");
  const log = extractXMLTag(xml, "log") || undefined;
  const type = extractXMLTag(xml, "action-type");
  const paramStr = extractXMLTag(xml, "action-param-json");

  const completeMatch = xml.match(/<complete\s+success="(true|false)">([\s\S]*?)<\/complete>/i);
  const complete = completeMatch
    ? {
        success: completeMatch[1] === "true",
        message: completeMatch[2]?.trim() || undefined,
      }
    : undefined;

  let action: { type: string; param?: unknown } | undefined;
  if (type && type.toLowerCase() !== "null") {
    // strip leaked tags: "KeyboardPress</action-type>..." -> "KeyboardPress"
    const name = type.split("<")[0].trim();
    let param: unknown;
    if (paramStr) {
      try {
        param = parseJson(paramStr, {
          preserveStringValueKeys: name.toLowerCase() === "input" ? ["value"] : undefined,
        });
      } catch (e) {
        throw new Error(`Failed to parse action-param-json: ${String(e)}`, {
          cause: e,
        });
      }
    }
    action = param !== undefined ? { type: name, param } : { type: name };
  }

  // If both action and <complete> present, ignore <complete>.
  if (action && complete) {
    return { thought, action, error, log };
  }
  return { thought, action, complete, error, log };
}
