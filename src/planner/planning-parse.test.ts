/**
 * Tests for the XML planning-response parser (`parsePlan`), covering the full
 * range of model output shapes: thought/action/log/error/complete tags,
 * whitespace handling, malformed JSON, and case-insensitive matching.
 */
import { describe, expect, it } from "vitest";
import { parsePlan } from "./parse.js";

describe("parsePlan", () => {
  it("parses a complete response with all fields", () => {
    const xml = `
<thought>I need to click the login button</thought>
<memory>User credentials are already filled</memory>
<log>Click the login button</log>
<error></error>
<action-type>Tap</action-type>
<action-param-json>
{
  "locate": {
    "prompt": "The login button",
    "bbox": [100, 200, 300, 400]
  }
}
</action-param-json>`.trim();
    const r = parsePlan(xml);
    expect(r.thought).toBe("I need to click the login button");
    expect(r.log).toBe("Click the login button");
    expect(r.action).toEqual({
      type: "Tap",
      param: { locate: { prompt: "The login button", bbox: [100, 200, 300, 400] } },
    });
  });

  it("parses with only required fields", () => {
    const xml = `
<log>Performing action</log>
<action-type>Tap</action-type>
<action-param-json>
{
  "locate": {
    "prompt": "Button"
  }
}
</action-param-json>`.trim();
    const r = parsePlan(xml);
    expect(r.log).toBe("Performing action");
    expect(r.action).toEqual({ type: "Tap", param: { locate: { prompt: "Button" } } });
  });

  it("treats action-type null as no action", () => {
    const r = parsePlan(`<log>Task completed</log>\n<action-type>null</action-type>`);
    expect(r.action).toBeUndefined();
    expect(r.log).toBe("Task completed");
  });

  it("parses a response without an action-type", () => {
    const r = parsePlan(`<log>Just logging</log>`);
    expect(r.action).toBeUndefined();
    expect(r.log).toBe("Just logging");
  });

  it("parses an error field alongside an action", () => {
    const xml = `
<log>Attempting to recover</log>
<error>Previous action failed</error>
<action-type>Scroll</action-type>
<action-param-json>
{
  "direction": "down"
}
</action-param-json>`.trim();
    const r = parsePlan(xml);
    expect(r.error).toBe("Previous action failed");
    expect(r.action).toEqual({ type: "Scroll", param: { direction: "down" } });
  });

  it("parses an action without param", () => {
    const r = parsePlan(`<log>Waiting</log>\n<action-type>Wait</action-type>`);
    expect(r.action).toEqual({ type: "Wait" });
  });

  it("handles multiline content in tags", () => {
    const xml = `
<thought>
  This is a complex thought
  spanning multiple lines
</thought>
<log>Executing complex action</log>
<action-type>Input</action-type>
<action-param-json>
{
  "value": "test value",
  "locate": {
    "prompt": "input field"
  }
}
</action-param-json>`.trim();
    const r = parsePlan(xml);
    expect(r.thought).toBe("This is a complex thought\n  spanning multiple lines");
    expect(r.action?.type).toBe("Input");
  });

  it("preserves Input value boundary whitespace while trimming other strings", () => {
    const xml = `
<log>Type text with boundary spaces</log>
<action-type>Input</action-type>
<action-param-json>
{
  "value": "  test value  ",
  "locate": {
    "prompt": "  input field  "
  }
}
</action-param-json>`.trim();
    expect(parsePlan(xml).action).toEqual({
      type: "Input",
      param: { value: "  test value  ", locate: { prompt: "input field" } },
    });
  });

  it("preserves Input value boundary whitespace from JSON code blocks", () => {
    const xml = `
<log>Type text with boundary spaces</log>
<action-type>Input</action-type>
<action-param-json>
\`\`\`json
{
  "value": "  test value  ",
  "locate": {
    "prompt": "  input field  "
  }
}
\`\`\`
</action-param-json>`.trim();
    expect(parsePlan(xml).action).toEqual({
      type: "Input",
      param: { value: "  test value  ", locate: { prompt: "input field" } },
    });
  });

  it("preserves Input value boundary whitespace from repaired (malformed) params", () => {
    const xml = `
<log>Type text with boundary spaces</log>
<action-type>Input</action-type>
<action-param-json>
{ value: "  test value  ", locate: {" prompt ": "  input field  ",}, }
</action-param-json>`.trim();
    expect(parsePlan(xml).action).toEqual({
      type: "Input",
      param: { value: "  test value  ", locate: { prompt: "input field" } },
    });
  });

  it("does not throw when log is missing and only a complete tag is present", () => {
    const xml = `<thought>Some thought</thought>\n<complete success="true">Task completed</complete>`;
    const r = parsePlan(xml);
    expect(r.thought).toBe("Some thought");
    expect(r.action).toBeUndefined();
    expect(r.complete).toEqual({ success: true, message: "Task completed" });
  });

  it("throws when action-param-json is invalid JSON", () => {
    const xml = `
<log>Action</log>
<action-type>Tap</action-type>
<action-param-json>
{invalid json}
</action-param-json>`.trim();
    expect(() => parsePlan(xml)).toThrow(/Failed to parse action-param-json/);
  });

  it("handles case-insensitive tag matching", () => {
    const xml = `<LOG>Case insensitive log</LOG>\n<ACTION-TYPE>Tap</ACTION-TYPE>`;
    const r = parsePlan(xml);
    expect(r.log).toBe("Case insensitive log");
    expect(r.action?.type).toBe("Tap");
  });

  it("parses a half-open action-type tag without a closing tag", () => {
    const xml = `
<thought>The Priority input field is active now.</thought>
<log>Type "1000" into the Priority input field</log>
<action-type>Input
<action-param-json>
{
  "value": "1000"
}
</action-param-json>`.trim();
    const r = parsePlan(xml);
    expect(r.action).toEqual({ type: "Input", param: { value: "1000" } });
  });

  it("parses XML with special characters in content", () => {
    const xml = `
<log>Click "Submit" button</log>
<action-type>Tap</action-type>
<action-param-json>
{
  "locate": {
    "prompt": "Button with & symbol"
  }
}
</action-param-json>`.trim();
    const r = parsePlan(xml);
    expect(r.log).toBe('Click "Submit" button');
    expect((r.action!.param as any).locate.prompt).toBe("Button with & symbol");
  });

  it("parses a complete tag with success=true and message", () => {
    const xml = `<thought>Task completed successfully</thought>\n<complete success="true">The product names are: 'Product A', 'Product B', 'Product C'</complete>`;
    expect(parsePlan(xml).complete).toEqual({
      success: true,
      message: "The product names are: 'Product A', 'Product B', 'Product C'",
    });
  });

  it("parses a complete tag with success=false and error message", () => {
    const xml = `<thought>Task failed</thought>\n<complete success="false">Unable to find the required element on the page</complete>`;
    expect(parsePlan(xml).complete).toEqual({
      success: false,
      message: "Unable to find the required element on the page",
    });
  });

  it("parses a complete tag with an empty message", () => {
    const xml = `<thought>Task completed</thought>\n<complete success="true"></complete>`;
    expect(parsePlan(xml).complete).toEqual({ success: true, message: undefined });
  });

  it("parses a complete tag with a multiline message", () => {
    const xml = `
<thought>Data extraction completed</thought>
<complete success="true">
Extracted data:
- Item 1: Value A
- Item 2: Value B
- Item 3: Value C
</complete>`.trim();
    expect(parsePlan(xml).complete).toEqual({
      success: true,
      message: "Extracted data:\n- Item 1: Value A\n- Item 2: Value B\n- Item 3: Value C",
    });
  });

  it("handles a complete tag case-insensitively", () => {
    const xml = `<thought>done</thought>\n<COMPLETE success="true">finished</COMPLETE>`;
    expect(parsePlan(xml).complete).toEqual({ success: true, message: "finished" });
  });

  it("strips trailing XML tags leaked into action-type by the LLM", () => {
    const xml = `<action-type>KeyboardPress</action-type>\n<action-param-json>{"keyName":"Enter"}</action-param-json>`;
    expect(parsePlan(xml).action).toEqual({ type: "KeyboardPress", param: { keyName: "Enter" } });
  });
});
