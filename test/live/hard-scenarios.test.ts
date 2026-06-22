/**
 * Eight hard, app-agnostic stress scenarios against a real Gemini model + real
 * browser. Each targets a DIFFERENT capability/failure surface. They push the
 * library on purpose, so results are not all green — and they're inputs to
 * library improvements, not pass/fail CI gates.
 *
 * Status on the library default (gemini-2.5-flash), as of this commit:
 *  - Reliable: T2 (conditional reveal), T4 (stepper), T6 (tabs), T7 (search),
 *    and T3 (small swatch) once deep-locate auto-engages on ~30px targets.
 *  - Live-nondeterministic: T5 (toggle reconciliation) and T8 (confirm/cancel)
 *    flip run-to-run — they hinge on a single button-tap landing, which is a
 *    grounding-precision coin-flip on this model, NOT a deterministic bug.
 *  - Hard: T1 (gated multi-step wizard) — the agent struggles to drive the
 *    Next→Next→Submit gating reliably.
 * Deliberately NOT "fixed" by overfitting: an attempt to force T1/T8 with a
 * no-op-tap deep-locate retry regressed T5, so it was reverted.
 *
 * Gated on GOOGLE_GENERATIVE_AI_API_KEY + STRESS=1 (kept out of the normal
 * test:live smoke). MODEL overrides the model (default => library default).
 * Run: STRESS=1 enever exec -- npx vitest run --config vitest.live.config.ts \
 *        test/live/hard-scenarios.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { Agent } from "../../src/index.js";

const HAS_KEY = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const MODEL = process.env.MODEL;

let browser: Browser;

async function withPage<T>(html: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: 1000, height: 720 },
  });
  try {
    await page.setContent(html);
    return await fn(page);
  } finally {
    await page.close();
  }
}

const BASE = `body{margin:0;padding:32px;font:18px/1.4 system-ui,sans-serif;background:#fff;color:#111}
  button{font:inherit;cursor:pointer}h1{font-size:22px}`;

describe.skipIf(!HAS_KEY || !process.env.STRESS)("hard scenarios (live Gemini)", () => {
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  // T1 — gated multi-step wizard; must complete every step AND submit.
  it("T1 gated wizard: fills each gated step and submits", async () => {
    const html = `<!doctype html><meta charset=utf-8><style>${BASE}
      .step{display:none}.step.on{display:block}label{display:block;margin:12px 0 4px}
      input[type=text]{font:inherit;padding:8px 10px;width:260px}
      .opt{display:block;margin:6px 0}button{margin-top:14px;padding:10px 18px}</style>
      <h1>Create account</h1>
      <div class=step id=s1 ><label>Full name</label><input id=name type=text>
        <button id=n1>Next</button></div>
      <div class=step id=s2><label>Plan</label>
        <label class=opt><input type=radio name=plan value=Basic>Basic</label>
        <label class=opt><input type=radio name=plan value=Pro>Pro</label>
        <label class=opt><input type=radio name=plan value=Enterprise>Enterprise</label>
        <button id=n2>Next</button></div>
      <div class=step id=s3><label><input type=checkbox id=terms>I accept the terms</label>
        <button id=submit>Submit</button></div>
      <div id=done></div>
      <script>
        s1.classList.add('on');
        n1.onclick=()=>{if(name.value.trim()){s1.classList.remove('on');s2.classList.add('on')}};
        n2.onclick=()=>{const p=document.querySelector('input[name=plan]:checked');if(p){s2.classList.remove('on');s3.classList.add('on')}};
        submit.onclick=()=>{if(terms.checked){const p=document.querySelector('input[name=plan]:checked').value;done.textContent='SUBMITTED name='+name.value+' plan='+p}};
      </script>`;
    const out = await withPage(html, async (page) => {
      const r = await new Agent(page, { maxPlanningSteps: 14, model: MODEL }).act(
        "Create the account: enter the full name Ada Lovelace, choose the Pro plan, accept the terms, and submit.",
      );
      const done = await page.$eval("#done", (d) => d.textContent ?? "");
      return { success: r.success, done };
    });
    // eslint-disable-next-line no-console
    console.log("T1:", out);
    expect(out.done).toContain("name=Ada Lovelace");
    expect(out.done).toContain("plan=Pro");
  });

  // T2 — a field that only appears after selecting "Other".
  it("T2 conditional reveal: selects Other and fills the revealed field", async () => {
    const html = `<!doctype html><meta charset=utf-8><style>${BASE}
      label.opt{display:block;margin:8px 0}#specify{display:none;margin-top:12px}
      input[type=text]{font:inherit;padding:8px 10px;width:260px}</style>
      <h1>How did you hear about us?</h1>
      <label class=opt><input type=radio name=src value=Search>Search engine</label>
      <label class=opt><input type=radio name=src value=Friend>A friend</label>
      <label class=opt><input type=radio name=src value=Other>Other</label>
      <div id=specify><label>Please specify</label><input id=other type=text></div>
      <script>
        document.querySelectorAll('input[name=src]').forEach(r=>r.onchange=()=>{
          specify.style.display = (document.querySelector('input[name=src]:checked').value==='Other')?'block':'none';
        });
      </script>`;
    const out = await withPage(html, async (page) => {
      const r = await new Agent(page, { maxPlanningSteps: 10, model: MODEL }).act(
        'Choose "Other" for how you heard about us, then type "a colleague" in the box that appears.',
      );
      const checked = await page
        .$eval("input[name=src]:checked", (e: any) => e.value)
        .catch(() => "");
      const other = await page.$eval("#other", (e: any) => e.value);
      return { success: r.success, checked, other };
    });
    // eslint-disable-next-line no-console
    console.log("T2:", out);
    expect(out.checked).toBe("Other");
    expect(out.other.toLowerCase()).toContain("colleague");
  });

  // T3 — precise grounding of a small, text-less target by colour.
  it("T3 small swatch: clicks the correct tiny colour swatch", async () => {
    const colors = ["red", "orange", "gold", "green", "teal", "blue", "indigo", "violet"];
    const html = `<!doctype html><meta charset=utf-8><style>${BASE}
      .sw{display:inline-block;width:30px;height:30px;margin:2px;border:1px solid #0002;vertical-align:top}</style>
      <h1>Pick a colour</h1>
      <div>${colors.map((c) => `<span class=sw data-c="${c}" style="background:${c}" aria-label="${c}"></span>`).join("")}</div>
      <div id=log></div>
      <script>document.querySelectorAll('.sw').forEach(s=>s.onclick=()=>log.textContent=s.dataset.c)</script>`;
    const out = await withPage(html, async (page) => {
      const r = await new Agent(page, { maxPlanningSteps: 8, model: MODEL }).act(
        "Click the green colour swatch.",
      );
      return { success: r.success, log: await page.$eval("#log", (d) => d.textContent ?? "") };
    });
    // eslint-disable-next-line no-console
    console.log("T3:", out);
    expect(out.log).toBe("green");
  });

  // T4 — incremental stepper: must read the value and stop exactly at 6.
  it("T4 stepper: increments to exactly 6", async () => {
    const html = `<!doctype html><meta charset=utf-8><style>${BASE}
      .q{display:inline-flex;align-items:center;gap:14px;border:1px solid #9994;border-radius:8px;padding:6px 10px}
      .q button{width:30px;height:30px;font-size:18px}#val{font-size:20px;min-width:24px;text-align:center}</style>
      <h1>Quantity</h1>
      <div class=q><button id=dec>−</button><span id=val>1</span><button id=inc>+</button></div>
      <script>let v=1;const r=()=>val.textContent=v;inc.onclick=()=>{v++;r()};dec.onclick=()=>{if(v>0)v--;r()}</script>`;
    const out = await withPage(html, async (page) => {
      const r = await new Agent(page, { maxPlanningSteps: 16, model: MODEL }).act(
        "Set the quantity to exactly 6.",
      );
      return { success: r.success, val: await page.$eval("#val", (d) => d.textContent ?? "") };
    });
    // eslint-disable-next-line no-console
    console.log("T4:", out);
    expect(out.val).toBe("6");
  });

  // T5 — read current toggle states and change only what's needed.
  it("T5 toggle reconciliation: turns off only the extra toggle", async () => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const sw = (id: string, label: string, on: boolean) =>
      `<button role=switch id=${id} aria-checked=${on} class="sw${on ? " on" : ""}"><span class=knob></span></button> <span>${label}</span><br>`;
    const html = `<!doctype html><meta charset=utf-8><style>${BASE}
      .sw{width:48px;height:26px;border-radius:13px;border:0;background:#bbb;position:relative;vertical-align:middle;margin:6px 8px 6px 0}
      .sw.on{background:#22c55e}.knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.1s}
      .sw.on .knob{left:25px}span{font-size:17px}</style>
      <h1>Notifications</h1>
      ${sw("email", "Email", true)}${sw("sms", "SMS", false)}${sw("push", "Push", true)}
      ${sw("calls", "Calls", false)}${sw("news", "Newsletter", true)}
      <script>document.querySelectorAll('.sw').forEach(b=>b.onclick=()=>{const on=b.getAttribute('aria-checked')!=='true';b.setAttribute('aria-checked',on);b.classList.toggle('on',on)})</script>`;
    const out = await withPage(html, async (page) => {
      const r = await new Agent(page, { maxPlanningSteps: 12, model: MODEL }).act(
        "Make sure ONLY Email and Push notifications are on. Turn off any other notifications that are currently on; leave Email and Push as they are.",
      );
      const st = await page.evaluate(() =>
        Object.fromEntries(
          ["email", "sms", "push", "calls", "news"].map((id) => [
            id,
            document.getElementById(id)!.getAttribute("aria-checked"),
          ]),
        ),
      );
      return { success: r.success, st };
    });
    // eslint-disable-next-line no-console
    console.log("T5:", out);
    expect(out.st).toEqual({
      email: "true",
      sms: "false",
      push: "true",
      calls: "false",
      news: "false",
    });
  });

  // T6 — the target control lives only in a non-active tab.
  it("T6 tabs: switches to Security and enables 2FA", async () => {
    const html = `<!doctype html><meta charset=utf-8><style>${BASE}
      .tabs{display:flex;gap:4px;border-bottom:2px solid #eee;margin-bottom:16px}
      .tab{padding:10px 16px;border:0;background:#f4f4f5}.tab.active{background:#fff;border-bottom:2px solid #2563eb}
      .panel{display:none}.panel.on{display:block}
      .sw{width:48px;height:26px;border-radius:13px;border:0;background:#bbb;vertical-align:middle;margin-right:8px}
      .sw.on{background:#22c55e}</style>
      <h1>Settings</h1>
      <div class=tabs><button class="tab active" data-p=profile>Profile</button>
        <button class=tab data-p=billing>Billing</button><button class=tab data-p=security>Security</button></div>
      <div class="panel on" id=profile><button class=sw id=emailpref></button>Email notifications</div>
      <div class=panel id=billing><button class=sw id=autorenew></button>Auto-renew</div>
      <div class=panel id=security><button class=sw id=twofa></button>Two-factor authentication</div>
      <script>
        document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
          document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');
          document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));document.getElementById(t.dataset.p).classList.add('on')});
        document.querySelectorAll('.sw').forEach(b=>b.onclick=()=>b.classList.toggle('on'))
      </script>`;
    const out = await withPage(html, async (page) => {
      const r = await new Agent(page, { maxPlanningSteps: 10, model: MODEL }).act(
        "Enable two-factor authentication.",
      );
      const twofa = await page.$eval("#twofa", (e) => e.classList.contains("on"));
      const emailpref = await page.$eval("#emailpref", (e) => e.classList.contains("on"));
      return { success: r.success, twofa, emailpref };
    });
    // eslint-disable-next-line no-console
    console.log("T6:", out);
    expect(out.twofa).toBe(true);
    expect(out.emailpref).toBe(false); // didn't toggle the visible decoy
  });

  // T7 — async-filtered results with look-alikes; pick the exact one.
  it("T7 search: picks the exact item among look-alikes", async () => {
    const html = `<!doctype html><meta charset=utf-8><style>${BASE}
      input{font:inherit;padding:8px 10px;width:300px}#results{list-style:none;padding:0;margin:10px 0;width:300px}
      #results li{padding:8px 10px;border:1px solid #eee;cursor:pointer}</style>
      <h1>Add ingredient</h1>
      <input id=q placeholder="Search…"><ul id=results></ul><div id=selected></div>
      <script>
        const items=["Apple","Mango","Mango Juice","Mangosteen","Mandarin","Banana","Grape"];
        let t;q.oninput=()=>{clearTimeout(t);results.innerHTML='';t=setTimeout(()=>{
          items.filter(i=>i.toLowerCase().includes(q.value.toLowerCase().trim())&&q.value.trim()).forEach(i=>{
            const li=document.createElement('li');li.textContent=i;li.onclick=()=>selected.textContent='SEL:'+i;results.appendChild(li)})},400)};
      </script>`;
    const out = await withPage(html, async (page) => {
      const r = await new Agent(page, { maxPlanningSteps: 10, model: MODEL }).act(
        'Search for "mango" and select the plain Mango — not Mango Juice or Mangosteen.',
      );
      return { success: r.success, sel: await page.$eval("#selected", (d) => d.textContent ?? "") };
    });
    // eslint-disable-next-line no-console
    console.log("T7:", out);
    expect(out.sel).toBe("SEL:Mango");
  });

  // T8 — open a destructive confirm, then take the SAFE option.
  it("T8 confirm-cancel: opens delete confirm but keeps the project", async () => {
    const html = `<!doctype html><meta charset=utf-8><style>${BASE}
      #dlg{display:none;position:fixed;inset:0;background:#0006;align-items:center;justify-content:center}
      #dlg.on{display:flex}.card{background:#fff;padding:24px;border-radius:10px;max-width:360px}
      .card button{margin:14px 8px 0 0;padding:10px 16px}#del{padding:10px 16px}</style>
      <h1>Project</h1><div id=status>Project: Apollo</div>
      <button id=del>Delete project</button>
      <div id=dlg role=dialog aria-modal=true><div class=card><p>Delete <b>Apollo</b> permanently? This cannot be undone.</p>
        <button id=confirm>Delete permanently</button><button id=keep>Keep project</button></div></div>
      <script>
        del.onclick=()=>dlg.classList.add('on');
        confirm.onclick=()=>{status.textContent='Project deleted';dlg.classList.remove('on')};
        keep.onclick=()=>dlg.classList.remove('on');
      </script>`;
    const out = await withPage(html, async (page) => {
      const r = await new Agent(page, { maxPlanningSteps: 10, model: MODEL }).act(
        "Open the delete confirmation for the project, then cancel it — keep the project, do NOT delete it.",
      );
      const status = await page.$eval("#status", (d) => d.textContent ?? "");
      const dlgOpen = await page.$eval("#dlg", (e) => e.classList.contains("on"));
      return { success: r.success, status, dlgOpen };
    });
    // eslint-disable-next-line no-console
    console.log("T8:", out);
    expect(out.status).toBe("Project: Apollo"); // not deleted
    expect(out.dlgOpen).toBe(false); // dialog dismissed
  });
});
