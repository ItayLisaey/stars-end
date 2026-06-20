import { describe, expect, it } from "vitest";
import { extractJSONFromCodeBlock, safeParseJson } from "./json.js";

describe("extractJSONFromCodeBlock", () => {
  it("returns a direct JSON object", () => {
    expect(extractJSONFromCodeBlock('  {"a":1}  ')).toBe('{"a":1}');
  });
  it("strips ```json fences", () => {
    expect(extractJSONFromCodeBlock('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("strips bare ``` fences", () => {
    expect(extractJSONFromCodeBlock('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("finds a loose JSON-like structure in text", () => {
    expect(extractJSONFromCodeBlock('here it is {"a":1} ok')).toBe('{"a":1}');
  });
});

describe("safeParseJson", () => {
  it("parses clean JSON and trims keys + string values", () => {
    expect(safeParseJson('{ " name " : " Tap " }')).toEqual({ name: "Tap" });
  });

  it("preserves whitespace in preserveStringValueKeys", () => {
    expect(
      safeParseJson('{"value":"  hello world  "}', {
        preserveStringValueKeys: ["value"],
      }),
    ).toEqual({
      value: "  hello world  ",
    });
  });

  it("trims value when not in preserveStringValueKeys", () => {
    expect(safeParseJson('{"value":"  hello  "}')).toEqual({ value: "hello" });
  });

  it("repairs malformed JSON with jsonrepair", () => {
    expect(safeParseJson("{a: 1, b: 'two',}")).toEqual({ a: 1, b: "two" });
  });

  it("handles the (x,y) coordinate tuple shortcut", () => {
    expect(safeParseJson("(300,500)")).toEqual([300, 500]);
  });

  it("recurses into nested objects/arrays", () => {
    expect(safeParseJson('{"locate":{" prompt ":" the button "}}')).toEqual({
      locate: { prompt: "the button" },
    });
  });

  it("is lenient: jsonrepair coerces arbitrary text into a JSON string", () => {
    // jsonrepair stringifies non-JSON input
    expect(safeParseJson("not json at all !!!")).toBe("not json at all !!!");
  });
});
