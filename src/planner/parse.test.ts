import { describe, expect, it } from "vitest";
import { extractXMLTag, parsePlan } from "./parse.js";

describe("extractXMLTag", () => {
  it("extracts simple tag content", () => {
    expect(extractXMLTag("<thought>hello</thought>", "thought")).toBe("hello");
  });

  it("ignores leading think blocks (searches from end)", () => {
    expect(extractXMLTag("<think>noise</think><thought>real</thought>", "thought")).toBe("real");
  });

  it("is case-insensitive on tag name", () => {
    expect(extractXMLTag("<Thought>X</Thought>", "thought")).toBe("X");
  });

  it("handles half-open tags (no closing tag)", () => {
    expect(extractXMLTag("<action-type>Input", "action-type")).toBe("Input");
  });

  it("returns undefined when absent", () => {
    expect(extractXMLTag("<a>x</a>", "thought")).toBeUndefined();
  });
});

describe("parsePlan", () => {
  it("parses a thought + tap action", () => {
    const xml = `<thought>click submit</thought><action-type>Tap</action-type><action-param-json>{ "locate": { "prompt": "the Add to cart button" } }</action-param-json>`;
    expect(parsePlan(xml)).toEqual({
      thought: "click submit",
      action: {
        type: "Tap",
        param: { locate: { prompt: "the Add to cart button" } },
      },
      error: undefined,
      log: undefined,
    });
  });

  it("strips leaked XML tags from action-type", () => {
    const xml = `<action-type>KeyboardPress</action-type>\n<action-param-json>{"keyName":"Enter"}</action-param-json>`;
    expect(parsePlan(xml).action).toEqual({
      type: "KeyboardPress",
      param: { keyName: "Enter" },
    });
  });

  it("preserves untrimmed value for Input (preserveStringValueKeys)", () => {
    const xml = `<action-type>Input</action-type><action-param-json>{"value":"  spaced text  "}</action-param-json>`;
    expect(parsePlan(xml).action).toEqual({
      type: "Input",
      param: { value: "  spaced text  " },
    });
  });

  it("trims value for non-Input actions", () => {
    const xml = `<action-type>Tap</action-type><action-param-json>{"value":"  x  "}</action-param-json>`;
    expect(parsePlan(xml).action).toEqual({
      type: "Tap",
      param: { value: "x" },
    });
  });

  it('parses a <complete success="true"> envelope', () => {
    const xml = `<thought>done</thought><complete success="true">added backpack to cart</complete>`;
    expect(parsePlan(xml).complete).toEqual({
      success: true,
      message: "added backpack to cart",
    });
  });

  it('parses a <complete success="false"> envelope', () => {
    const xml = `<complete success="false">could not find item</complete>`;
    expect(parsePlan(xml).complete).toEqual({
      success: false,
      message: "could not find item",
    });
  });

  it("ignores <complete> when an action is also present", () => {
    const xml = `<action-type>Tap</action-type><action-param-json>{"locate":{"prompt":"x"}}</action-param-json><complete success="true">done</complete>`;
    const r = parsePlan(xml);
    expect(r.action).toBeDefined();
    expect(r.complete).toBeUndefined();
  });

  it("treats action-type null as no action", () => {
    expect(parsePlan("<action-type>null</action-type>").action).toBeUndefined();
  });

  it("captures an <error> tag", () => {
    expect(parsePlan("<error>bad locate</error>").error).toBe("bad locate");
  });
});
