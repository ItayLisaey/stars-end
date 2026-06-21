/**
 * Reproduces the "goal-completion blindness under partial overlays" failure
 * mode: a detail panel / modal that dims but keeps the underlying target visible
 * defeats completion detection that only asks "is the target still visible?".
 *
 * The fix surfaces a NEW top-layer surface to the planner. These tests verify
 * the injected detector recognizes the common overlay shapes against a real DOM.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Browser, type Page, chromium } from "playwright";
import { detectTopLayerSurface, type TopLayerResult } from "../src/insight/top-layer.injected.js";

let browser: Browser;
let page: Page;

const detect = (): Promise<TopLayerResult> => page.evaluate(detectTopLayerSurface);

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
});
afterAll(async () => {
  await browser?.close();
});

describe("detectTopLayerSurface", () => {
  it("reports no overlay on a plain page", async () => {
    await page.setContent(`<body><main><button>Overview</button></main></body>`);
    expect(await detect()).toEqual({ present: false });
  });

  it("detects an open native <dialog>", async () => {
    await page.setContent(`<body>
      <main><button>Overview</button></main>
      <dialog id="d"><p>panel content</p></dialog>
      <script>document.getElementById('d').show()</script>
    </body>`);
    const r = await detect();
    expect(r.present).toBe(true);
    expect(r.description).toMatch(/dialog/i);
  });

  it("detects an aria-modal surface laid over the still-visible page", async () => {
    // the grid stays in the DOM behind the panel — the exact case that defeats
    // "is the target still visible?" completion checks.
    await page.setContent(`<body style="margin:0">
      <main><button>Overview</button></main>
      <div role="dialog" aria-modal="true"
           style="position:fixed;inset:0;background:rgba(0,0,0,0.4)">
        <section style="width:300px;height:400px;background:#fff">detail panel</section>
      </div>
    </body>`);
    const r = await detect();
    expect(r.present).toBe(true);
    expect(r.description).toMatch(/modal/i);
  });

  it("detects a large high-z overlay panel without ARIA/dialog markup", async () => {
    await page.setContent(`<body style="margin:0">
      <main><button>Overview</button></main>
      <div style="position:fixed;left:0;top:0;width:800px;height:480px;
                  z-index:50;background:#fff">sheet content</div>
    </body>`);
    const r = await detect();
    expect(r.present).toBe(true);
  });

  it("ignores a hidden dialog", async () => {
    await page.setContent(`<body>
      <main><button>Overview</button></main>
      <div role="dialog" aria-modal="true" style="display:none">hidden</div>
    </body>`);
    expect(await detect()).toEqual({ present: false });
  });

  it("ignores a small popover that does not dominate the viewport", async () => {
    // a tiny menu shouldn't read as a page-level surface via the size heuristic
    await page.setContent(`<body style="margin:0">
      <main><button>menu</button></main>
      <div style="position:absolute;left:10px;top:10px;width:80px;height:60px;
                  z-index:30;background:#fff">menu</div>
    </body>`);
    expect(await detect()).toEqual({ present: false });
  });
});
