/**
 * Diagnostic (not an assertion): run ONE act() on the hard below-the-fold
 * dropdown scenario and print the agent's per-step thought + chosen action +
 * whether the screen changed, so we can see exactly which step breaks.
 *
 * Gated on GOOGLE_GENERATIVE_AI_API_KEY + DIAGNOSE=1.
 * Run: DIAGNOSE=1 enever exec -- npx vitest run --config vitest.live.config.ts \
 *        test/live/dropdown-diagnose.test.ts
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { PlaywrightDriver } from "../../src/driver/playwright-driver.js";
import { createGroundingTier } from "../../src/model/grounding-tier.js";
import { act } from "../../src/planner/loop.js";

const HAS_KEY = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const TARGET = process.env.TARGET ?? "2034";
const MODEL = process.env.MODEL; // e.g. gemini-3.5-flash; undefined => default

const HARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 24px; font: 15px/1.3 system-ui, sans-serif; background: #f3f4f6; color: #111; }
  .panel { width: 360px; margin-left: auto; background: #fff; border: 1px solid #d1d5db; border-radius: 10px; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  label { display: block; font-size: 13px; color: #374151; margin: 0 0 4px; }
  .row { display: flex; justify-content: flex-end; }
  #trigger { font-size: 14px; padding: 6px 10px; width: 130px; text-align: left; border: 1px solid #9ca3af; border-radius: 6px; background: #fff; cursor: pointer; }
  #listbox { width: 130px; max-height: 170px; overflow-y: auto; margin-left: auto; border: 1px solid #9ca3af; border-radius: 6px; background: #fff; }
  #listbox[hidden] { display: none; }
  [role="option"] { font-size: 14px; padding: 6px 10px; cursor: pointer; }
</style></head><body>
  <div class="panel">
    <h1>Account settings</h1>
    <label for="trigger">Founding year</label>
    <div class="row"><button id="trigger" role="combobox" aria-expanded="false" aria-controls="listbox">2000</button></div>
    <div class="row"><div id="listbox" role="listbox" hidden></div></div>
  </div>
  <script>
    const years = []; for (let y = 2000; y <= 2034; y++) years.push(String(y));
    const lb = document.getElementById('listbox'); const trigger = document.getElementById('trigger');
    lb.innerHTML = years.map((y) => '<div role="option">' + y + '</div>').join('');
    trigger.addEventListener('click', () => { const open = trigger.getAttribute('aria-expanded') === 'true'; trigger.setAttribute('aria-expanded', String(!open)); lb.hidden = open; });
    lb.addEventListener('click', (e) => { const opt = e.target.closest('[role="option"]'); if (!opt) return; trigger.textContent = opt.textContent; trigger.setAttribute('aria-expanded', 'false'); lb.hidden = true; });
  </script>
</body></html>`;

describe.skipIf(!HAS_KEY || !process.env.DIAGNOSE)("diagnose dropdown scroll (live)", () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it(`traces one act() to ${TARGET}`, async () => {
    page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 900, height: 640 } });
    await page.setContent(HARD_HTML);
    const driver = new PlaywrightDriver(page);

    let n = 0;
    try {
      const r = await act(
        driver,
        createGroundingTier(MODEL),
        `set the Founding year dropdown to ${TARGET}`,
        {
          maxPlanningSteps: 20,
          onStep: (s) => {
            n++;
            const param = JSON.stringify(s.param ?? {});
            // eslint-disable-next-line no-console
            console.log(
              `STEP ${n} | ${s.type} ${param} | ok=${s.ok} changed=${s.stateChanged}${
                s.error ? ` err=${s.error}` : ""
              }\n        thought: ${(s.thought ?? "").replace(/\s+/g, " ").slice(0, 160)}`,
            );
          },
        },
      );
      // eslint-disable-next-line no-console
      console.log(`OUTCOME success=${r.success} msg=${r.message}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`OUTCOME threw ${(e as Error).name}: ${(e as Error).message}`);
    }
    const trigger = await page.$eval("#trigger", (t) => t.textContent);
    const expanded = await page.$eval("#trigger", (t) => t.getAttribute("aria-expanded"));
    // eslint-disable-next-line no-console
    console.log(`FINAL trigger="${trigger}" aria-expanded=${expanded} steps=${n}`);
    await page.close();
  }, 600_000);
});
