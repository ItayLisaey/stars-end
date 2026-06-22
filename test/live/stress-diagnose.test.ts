/**
 * Traces the two failing hard scenarios (T1 wizard, T3 swatch) with the Agent's
 * step trace, to see whether the failures are real agent weaknesses or fixture
 * bugs. Gated on GOOGLE_GENERATIVE_AI_API_KEY + STRESSDIAG=1.
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import { type Browser, chromium } from "playwright";
import { Agent } from "../../src/index.js";

const HAS_KEY = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const MODEL = process.env.MODEL;

let browser: Browser;
const BASE = `body{margin:0;padding:32px;font:18px/1.4 system-ui,sans-serif;background:#fff;color:#111}button{font:inherit;cursor:pointer}h1{font-size:22px}`;

const trace = (label: string) => ({
  sink: (e: {
    kind: string;
    actionType?: string;
    ok?: boolean;
    stateChanged?: boolean;
    modelThought?: string;
  }) => {
    if (e.kind === "plan") {
      // eslint-disable-next-line no-console
      console.log(
        `${label} | ${e.actionType} ok=${e.ok} changed=${e.stateChanged} :: ${(e.modelThought ?? "").replace(/\s+/g, " ").slice(0, 110)}`,
      );
    }
  },
});

describe.skipIf(!HAS_KEY || !process.env.STRESSDIAG)("stress diagnose (live)", () => {
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("T1 wizard trace", async () => {
    const html = `<!doctype html><meta charset=utf-8><style>${BASE}
        .step{display:none}.step.on{display:block}label{display:block;margin:12px 0 4px}
        input[type=text]{font:inherit;padding:8px 10px;width:260px}.opt{display:block;margin:6px 0}button{margin-top:14px;padding:10px 18px}</style>
        <h1>Create account</h1>
        <div class=step id=s1><label>Full name</label><input id=fullname type=text><button id=n1>Next</button></div>
        <div class=step id=s2><label>Plan</label>
          <label class=opt><input type=radio name=plan value=Basic>Basic</label>
          <label class=opt><input type=radio name=plan value=Pro>Pro</label>
          <label class=opt><input type=radio name=plan value=Enterprise>Enterprise</label><button id=n2>Next</button></div>
        <div class=step id=s3><label><input type=checkbox id=terms>I accept the terms</label><button id=submit>Submit</button></div>
        <div id=done></div>
        <script>s1.classList.add('on');
          const $=(id)=>document.getElementById(id);n1.onclick=()=>{if($('fullname').value.trim()){s1.classList.remove('on');s2.classList.add('on')}};
          n2.onclick=()=>{const p=document.querySelector('input[name=plan]:checked');if(p){s2.classList.remove('on');s3.classList.add('on')}};
          submit.onclick=()=>{if(terms.checked){const p=document.querySelector('input[name=plan]:checked').value;done.textContent='SUBMITTED name='+name.value+' plan='+p}};</script>`;
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 1000, height: 720 },
    });
    await page.setContent(html);
    try {
      const r = await new Agent(page, {
        maxPlanningSteps: 14,
        model: MODEL,
        trace: trace("T1"),
      }).act(
        "Create the account: enter the full name Ada Lovelace, choose the Pro plan, accept the terms, and submit.",
      );
      // eslint-disable-next-line no-console
      console.log("T1 OUTCOME", r.success, r.message);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log("T1 THREW", (e as Error).name, (e as Error).message);
    }
    const dump = await page.evaluate(() => ({
      name: (document.getElementById("fullname") as HTMLInputElement | null)?.value,
      s2on: document.getElementById("s2")?.classList.contains("on"),
      s3on: document.getElementById("s3")?.classList.contains("on"),
      done: document.getElementById("done")?.textContent,
    }));
    // eslint-disable-next-line no-console
    console.log("T1 DOM", JSON.stringify(dump));
    await page.close();
  }, 300_000);

  it("T3 swatch trace", async () => {
    const colors = ["red", "orange", "gold", "green", "teal", "blue", "indigo", "violet"];
    const html = `<!doctype html><meta charset=utf-8><style>${BASE}
        .sw{display:inline-block;width:30px;height:30px;margin:2px;border:1px solid #0002;vertical-align:top}</style>
        <h1>Pick a colour</h1>
        <div>${colors.map((c) => `<span class=sw data-c="${c}" style="background:${c}" aria-label="${c}"></span>`).join("")}</div>
        <div id=log></div>
        <script>document.querySelectorAll('.sw').forEach(s=>s.onclick=()=>log.textContent=s.dataset.c)</script>`;
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 1000, height: 720 },
    });
    await page.setContent(html);
    try {
      const r = await new Agent(page, {
        maxPlanningSteps: 8,
        model: MODEL,
        trace: trace("T3"),
      }).act("Click the green colour swatch.");
      // eslint-disable-next-line no-console
      console.log("T3 OUTCOME", r.success, r.message);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log("T3 THREW", (e as Error).name, (e as Error).message);
    }
    // eslint-disable-next-line no-console
    console.log("T3 DOM log =", await page.$eval("#log", (d) => d.textContent));
    await page.close();
  }, 300_000);

  it("T8 confirm-cancel trace", async () => {
    const html = `<!doctype html><meta charset=utf-8><style>${BASE}
        #dlg{display:none;position:fixed;inset:0;background:#0006;align-items:center;justify-content:center}
        #dlg.on{display:flex}.card{background:#fff;padding:24px;border-radius:10px;max-width:360px}
        .card button{margin:14px 8px 0 0;padding:10px 16px}#del{padding:10px 16px}</style>
        <h1>Project</h1><div id=statusbox>Project: Apollo</div>
        <button id=del>Delete project</button>
        <div id=dlg role=dialog aria-modal=true><div class=card><p>Delete <b>Apollo</b> permanently?</p>
          <button id=confirmbtn>Delete permanently</button><button id=keep>Keep project</button></div></div>
        <script>const $=(id)=>document.getElementById(id);
          $('del').onclick=()=>$('dlg').classList.add('on');
          $('confirmbtn').onclick=()=>{$('statusbox').textContent='Project deleted';$('dlg').classList.remove('on')};
          $('keep').onclick=()=>$('dlg').classList.remove('on');</script>`;
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 1000, height: 720 },
    });
    await page.setContent(html);
    try {
      const r = await new Agent(page, {
        maxPlanningSteps: 10,
        model: MODEL,
        trace: trace("T8"),
      }).act(
        "Open the delete confirmation for the project, then cancel it — keep the project, do NOT delete it.",
      );
      // eslint-disable-next-line no-console
      console.log("T8 OUTCOME", r.success, r.message);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log("T8 THREW", (e as Error).name, (e as Error).message);
    }
    const dump = await page.evaluate(() => ({
      status: document.getElementById("statusbox")?.textContent,
      dlgOpen: document.getElementById("dlg")?.classList.contains("on"),
    }));
    // eslint-disable-next-line no-console
    console.log("T8 DOM", JSON.stringify(dump));
    await page.close();
  }, 300_000);
});
