/**
 * Flake-rate measurement (NOT a pass/fail test) for the open-dropdown re-locate
 * fix, against the real Gemini model. Runs the SAME hard scenario N times and
 * tallies how often act() succeeds, so the fix can be A/B'd: run once on the
 * branch (fix on), once with the open-list signal+rule disabled (fix off), and
 * compare the success rates.
 *
 * Hard on purpose — the conditions the clean smoke test lacked:
 *  - compact trigger + options (~28px),
 *  - a long list whose target sits BELOW THE FOLD, so the OPEN list must be
 *    scrolled to reach it,
 *  - the dropdown tucked against the panel's right edge.
 *
 * Gated on GOOGLE_GENERATIVE_AI_API_KEY and MEASURE=1 (kept out of `test:live`).
 * Run:  MEASURE=1 RUNS=12 enever exec -- npx vitest run \
 *         --config vitest.live.config.ts test/live/dropdown-flake.test.ts
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { Agent } from "../../src/index.js";

const HAS_KEY = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const RUNS = Number(process.env.RUNS ?? 12);

// Years 2000–2034 in a short, scrollable listbox; target (2034) is at the
// bottom, off-screen until the OPEN list is scrolled. Compact controls, right-
// aligned against the panel edge.
const HARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 24px; font: 15px/1.3 system-ui, sans-serif; background: #f3f4f6; color: #111; }
  .panel { width: 360px; margin-left: auto; background: #fff; border: 1px solid #d1d5db;
           border-radius: 10px; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  label { display: block; font-size: 13px; color: #374151; margin: 0 0 4px; }
  .row { display: flex; justify-content: flex-end; }
  #trigger { font-size: 14px; padding: 6px 10px; width: 130px; text-align: left;
             border: 1px solid #9ca3af; border-radius: 6px; background: #fff; cursor: pointer; }
  #listbox { width: 130px; max-height: 170px; overflow-y: auto; margin-left: auto;
             border: 1px solid #9ca3af; border-radius: 6px; background: #fff; }
  #listbox[hidden] { display: none; }
  [role="option"] { font-size: 14px; padding: 6px 10px; cursor: pointer; }
  [role="option"]:hover { background: #eef2ff; }
</style></head><body>
  <div class="panel">
    <h1>Account settings</h1>
    <label for="trigger">Founding year</label>
    <div class="row">
      <button id="trigger" role="combobox" aria-expanded="false" aria-controls="listbox">2000</button>
    </div>
    <div class="row"><div id="listbox" role="listbox" hidden></div></div>
  </div>
  <script>
    const years = [];
    for (let y = 2000; y <= 2034; y++) years.push(String(y));
    const lb = document.getElementById('listbox');
    const trigger = document.getElementById('trigger');
    lb.innerHTML = years.map((y) => '<div role="option">' + y + '</div>').join('');
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

// Vary the target each run so repeated runs are independent samples (the lib
// calls the model at temperature 0, so an identical scenario would repeat the
// same trajectory). All BELOW the fold — each needs the open list scrolled, so
// every sample exercises the hard path.
const TARGETS = ["2034", "2028", "2031", "2026", "2033", "2029", "2030", "2027"];
const STEPS = Number(process.env.STEPS ?? 12);

describe.skipIf(!HAS_KEY || !process.env.MEASURE)("dropdown flake rate (live Gemini)", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it(`measures success rate over ${RUNS} runs`, async () => {
    let passed = 0;
    const failures: string[] = [];

    for (let i = 0; i < RUNS; i++) {
      const target = TARGETS[i % TARGETS.length];
      let page: Page | undefined;
      let outcome = "ok";
      try {
        page = await browser.newPage({
          deviceScaleFactor: 1,
          viewport: { width: 900, height: 640 },
        });
        await page.setContent(HARD_HTML);
        const agent = new Agent(page, { maxPlanningSteps: STEPS, model: process.env.MODEL });
        await agent.act(`set the Founding year dropdown to ${target}`);
        const picked = await page.$eval("#trigger", (t) => t.textContent);
        if (picked === target) passed++;
        else {
          outcome = `wrong "${picked}"`;
          failures.push(`run ${i} (->${target}): wrong value "${picked}"`);
        }
      } catch (e) {
        outcome = (e as Error).name;
        failures.push(`run ${i} (->${target}): ${(e as Error).name}`);
      } finally {
        await page?.close();
      }
      console.log(
        `[run ${i + 1}/${RUNS}] target=${target} outcome=${outcome} passed-so-far=${passed}`,
      );
    }

    console.log(`FLAKE_RESULT runs=${RUNS} passed=${passed} failed=${RUNS - passed}`);
    console.log(`FLAKE_FAILURES ${JSON.stringify(failures)}`);
  }, 1_800_000);
});
