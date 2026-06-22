/**
 * The planning prompt carries the behavioral guards that the loop can't enforce
 * mechanically: surface-aware completion (A2), first/placeholder bias and
 * popover-dismiss recovery (A5), and the no-progress nudge. It also renders the
 * overlay signal and per-step feedback fed back from the loop.
 */
import { describe, expect, it } from "vitest";
import { WEB_ACTIONS } from "./action-space.js";
import { planningSystemPrompt, planningUserPrompt } from "./prompt.js";

describe("planningSystemPrompt rules", () => {
  const sys = planningSystemPrompt(WEB_ACTIONS);

  it("tells the planner a new overlay/modal counts as completion (A2)", () => {
    expect(sys).toMatch(/Surface-aware completion/i);
    expect(sys).toMatch(/modal|dialog|detail panel|popover/i);
  });

  it("biases first/Nth item away from add/placeholder tiles (A5)", () => {
    expect(sys).toMatch(/First\/Nth item/i);
    expect(sys).toMatch(/placeholder/i);
  });

  it("describes popover-dismiss recovery (A5)", () => {
    expect(sys).toMatch(/Escape|dismiss/i);
  });

  it("warns against repeating an action that changed nothing", () => {
    expect(sys).toMatch(/No-progress/i);
  });

  it("tells the planner to operate an OPEN dropdown by its options, not the closed trigger", () => {
    expect(sys).toMatch(/OPEN dropdown by its options/i);
    expect(sys).toMatch(/option labelled/i);
  });
});

describe("planningUserPrompt rendering", () => {
  it("renders nothing extra without overlay or feedback", () => {
    const p = planningUserPrompt("do a thing", []);
    expect(p).not.toMatch(/Current overlay/);
    expect(p).not.toMatch(/Feedback from previous/);
  });

  it("renders the overlay note when an overlay is open", () => {
    const p = planningUserPrompt("open the detail panel", [], {
      overlay: { present: true, description: "a modal dialog" },
    });
    expect(p).toMatch(/Current overlay/);
    expect(p).toMatch(/a modal dialog is open/);
  });

  it("renders feedback from the previous step", () => {
    const p = planningUserPrompt("submit the form", [], {
      feedback: ["The previous action produced no visible change."],
    });
    expect(p).toMatch(/Feedback from previous step/);
    expect(p).toMatch(/no visible change/);
  });

  it("does not show the overlay note when no overlay is present", () => {
    const p = planningUserPrompt("x", [], { overlay: { present: false } });
    expect(p).not.toMatch(/Current overlay/);
  });

  it("renders the open-dropdown note (with option count) when a list is open", () => {
    const p = planningUserPrompt("set the month", [], {
      openList: { open: true, optionCount: 12 },
    });
    expect(p).toMatch(/Open dropdown/);
    expect(p).toMatch(/12 options/);
    expect(p).toMatch(/by its label in this open list/);
  });

  it("omits the open-dropdown note when no list is open", () => {
    const p = planningUserPrompt("x", [], { openList: { open: false } });
    expect(p).not.toMatch(/Open dropdown/);
  });
});
