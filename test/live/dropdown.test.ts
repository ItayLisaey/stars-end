/**
 * Live test for the "re-locating an OPEN combobox" fix, against a real Gemini
 * model + real browser. This is the scenario the deterministic repro can only
 * simulate: whether the REAL planner, given the open-list signal + prompt rule,
 * picks the option from the open list instead of looping on the closed trigger.
 *
 * Gated on GOOGLE_GENERATIVE_AI_API_KEY. Run with: pnpm test:live
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { Agent } from "../../src/index.js";

const HAS_KEY = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;

// A custom combobox (role=combobox + role=listbox of options) — NOT a native
// <select>. Trigger starts on "November"; opening reveals 12 large month rows;
// picking one updates the trigger and closes the list. Big, well-spaced controls
// so grounding gets a fair shot; the test is about WHICH state the planner
// targets once the list is open.
const COMBO_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 48px; font: 20px/1.4 system-ui, sans-serif; background: #fff; color: #111; }
  h1 { font-size: 26px; }
  label { display: block; margin: 24px 0 8px; font-weight: 600; }
  #trigger {
    font-size: 22px; padding: 14px 20px; width: 320px; text-align: left;
    border: 2px solid #888; border-radius: 8px; background: #fff; cursor: pointer;
  }
  #listbox { width: 360px; margin-top: 6px; border: 2px solid #888; border-radius: 8px; overflow: hidden; }
  #listbox[hidden] { display: none; }
  [role="option"] { font-size: 22px; padding: 14px 20px; cursor: pointer; }
  [role="option"]:hover { background: #eef; }
</style></head><body>
  <h1>Profile</h1>
  <label id="lbl" for="trigger">Birth month</label>
  <button id="trigger" role="combobox" aria-expanded="false" aria-controls="listbox" aria-labelledby="lbl">November</button>
  <div id="listbox" role="listbox" hidden></div>
  <script>
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const lb = document.getElementById('listbox');
    const trigger = document.getElementById('trigger');
    lb.innerHTML = months.map((m) => '<div role="option">' + m + '</div>').join('');
    trigger.addEventListener('click', () => {
      const open = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', String(!open));
      lb.hidden = open;
    });
    lb.addEventListener('click', (e) => {
      const opt = e.target.closest('[role="option"]');
      if (!opt) return;
      trigger.textContent = opt.textContent;
      trigger.setAttribute('aria-expanded', 'false');
      lb.hidden = true;
    });
  </script>
</body></html>`;

describe.skipIf(!HAS_KEY)("agent.act on a custom dropdown (live Gemini)", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });
  beforeEach(async () => {
    // DSF 1 — grounding is resolution-agnostic; 2x only inflates tokens.
    page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1000, height: 760 } });
    await page.setContent(COMBO_HTML);
  });

  it("opens the dropdown and selects an option from the OPEN list", async () => {
    const agent = new Agent(page, { maxPlanningSteps: 12 });

    // succeeds only if it picks from the open list rather than looping on the
    // closed trigger (a loop throws NoProgress/TooManyErrors and rejects here).
    const result = await agent.act("set the Birth month dropdown to August");

    expect(result.success).toBe(true);
    expect(await page.$eval("#trigger", (t) => t.textContent)).toBe("August");
  });
});
