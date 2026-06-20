import { describe, expect, it } from "vitest";
import { parseHotkey } from "./keyboard.js";

describe("parseHotkey", () => {
  it("parses a single named key", () => {
    expect(parseHotkey("Enter")).toEqual([{ key: "Enter" }]);
  });

  it("maps aliases to Playwright key names", () => {
    expect(parseHotkey("esc")).toEqual([{ key: "Escape" }]);
    expect(parseHotkey("return")).toEqual([{ key: "Enter" }]);
    expect(parseHotkey("space")).toEqual([{ key: "Space" }]);
  });

  it("splits a + combo", () => {
    expect(parseHotkey("Control+Shift")).toEqual([{ key: "Control" }, { key: "Shift" }]);
  });

  it("detects SelectAll for Control+A", () => {
    expect(parseHotkey("Control+A")).toEqual([
      { key: "Control" },
      { key: "A", command: "SelectAll" },
    ]);
  });

  it("detects Copy/Paste for Meta+c / Meta+v", () => {
    expect(parseHotkey("Meta+c")).toEqual([{ key: "Meta" }, { key: "c", command: "Copy" }]);
    expect(parseHotkey("Meta+v")).toEqual([{ key: "Meta" }, { key: "v", command: "Paste" }]);
  });

  it("does not assign a command without a modifier", () => {
    expect(parseHotkey("a")).toEqual([{ key: "a" }]);
  });

  it("accepts an array input", () => {
    expect(parseHotkey(["Control", "a"])).toEqual([
      { key: "Control" },
      { key: "a", command: "SelectAll" },
    ]);
  });

  it("handles whitespace-separated combos", () => {
    expect(parseHotkey("Control A")).toEqual([
      { key: "Control" },
      { key: "A", command: "SelectAll" },
    ]);
  });

  it('maps multi-word aliases like "page down"', () => {
    expect(parseHotkey("page down")).toEqual([{ key: "PageDown" }]);
  });

  it("maps arrow aliases", () => {
    expect(parseHotkey("up")).toEqual([{ key: "ArrowUp" }]);
  });
});
