/**
 * Live smoke test for the autonomous planning loop (`agent.act`) against a real
 * Gemini model and a real headless browser. Gated on GOOGLE_GENERATIVE_AI_API_KEY.
 *
 * Run with: pnpm test:live
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { Agent } from "../../src/index.js";

const HAS_KEY = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;

// A clear, grounding-friendly todo page (big, well-spaced controls).
const TODO_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 48px; font: 20px/1.4 system-ui, sans-serif; background: #fff; color: #111; }
  h1 { font-size: 28px; }
  #new-todo { font-size: 22px; padding: 14px 16px; width: 420px; border: 2px solid #888; border-radius: 8px; }
  #add { font-size: 22px; padding: 14px 28px; margin-left: 12px; border: 0; border-radius: 8px;
         background: #2563eb; color: #fff; cursor: pointer; }
  ul { margin-top: 28px; padding-left: 24px; }
  li { font-size: 22px; padding: 6px 0; }
</style></head><body>
  <h1>My Tasks</h1>
  <div>
    <input id="new-todo" placeholder="What needs to be done?" />
    <button id="add">Add task</button>
  </div>
  <ul id="list"></ul>
  <script>
    document.getElementById('add').addEventListener('click', () => {
      const input = document.getElementById('new-todo');
      const value = input.value.trim();
      if (!value) return;
      const li = document.createElement('li');
      li.textContent = value;
      document.getElementById('list').appendChild(li);
      input.value = '';
    });
  </script>
</body></html>`;

describe.skipIf(!HAS_KEY)("agent.act (live Gemini)", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1000, height: 700 } });
    await page.setContent(TODO_HTML);
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("adds a task to the list from a natural-language goal", async () => {
    const agent = new Agent(page, { model: "gemini-2.5-flash", maxPlanningSteps: 8 });

    const result = await agent.act('add a task that says "buy milk"');

    expect(result.success).toBe(true);

    // the DOM actually reflects the new task
    const items = await page.$$eval("#list li", (els) => els.map((e) => e.textContent?.trim()));
    expect(items.some((t) => /buy milk/i.test(t ?? ""))).toBe(true);
  });
});

// Surface a clear note when the key is missing rather than silently passing zero tests.
describe.runIf(!HAS_KEY)("agent.act (live Gemini)", () => {
  it("is skipped without GOOGLE_GENERATIVE_AI_API_KEY", () => {
    expect(HAS_KEY).toBe(false);
  });
});
