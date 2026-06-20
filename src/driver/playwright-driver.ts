/**
 * The only platform driver. Thin wrapper over a Playwright `Page`;
 * Playwright does the hard parts.
 */
import type { Page } from "playwright";
import type { Size } from "../types.js";
import { DOM_QUIET_DEFAULTS, domQuietBrowserFn } from "./dom-quiet.js";
import type { KeySpec } from "./keyboard.js";
import type { PageDriver, Screenshot, ScrollEdge } from "./types.js";

const SCROLL_TO_END = 9_999_999;

export interface PlaywrightDriverOptions {
  waitForSettleTimeoutMs?: number;
}

export class PlaywrightDriver implements PageDriver {
  private everMoved = false;

  constructor(
    private readonly page: Page,
    private readonly opts: PlaywrightDriverOptions = {},
  ) {}

  async screenshot(): Promise<Screenshot> {
    let base64: string;
    try {
      const buf = await this.page.screenshot({
        type: "jpeg",
        quality: 90,
        timeout: 10_000,
      });
      base64 = `data:image/jpeg;base64,${buf.toString("base64")}`;
    } catch (error) {
      if (this.page.isClosed()) throw error;
      base64 = await this.screenshotViaCdp();
    }
    const { width, height, dpr } = await this.page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    }));
    // screenshot pixels = CSS px * dpr; size() returns CSS px.
    return {
      base64,
      width: Math.round(width * dpr),
      height: Math.round(height * dpr),
      dpr,
    };
  }

  private async screenshotViaCdp(): Promise<string> {
    const browserName = this.page.context().browser()?.browserType().name();
    if (browserName && browserName !== "chromium") {
      throw new Error(
        `CDP screenshot fallback requires Chromium, but current browser is "${browserName}".`,
      );
    }
    const client = await this.page.context().newCDPSession(this.page);
    try {
      const result = (await client.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 90,
      })) as { data: string };
      return `data:image/jpeg;base64,${result.data}`;
    } finally {
      await client.detach().catch(() => {});
    }
  }

  async size(): Promise<Size> {
    return this.page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
  }

  async url(): Promise<string> {
    return this.page.url();
  }

  async tap(
    x: number,
    y: number,
    opt?: { button?: "left" | "right" | "middle"; count?: number },
  ): Promise<void> {
    await this.page.mouse.move(x, y);
    this.everMoved = true;
    await this.page.mouse.click(x, y, {
      button: opt?.button ?? "left",
      clickCount: opt?.count ?? 1,
    });
  }

  async move(x: number, y: number): Promise<void> {
    await this.page.mouse.move(x, y);
    this.everMoved = true;
  }

  async wheel(deltaX: number, deltaY: number, from?: { x: number; y: number }): Promise<void> {
    await this.moveBeforeScroll(from);
    await this.page.mouse.wheel(deltaX, deltaY);
  }

  async scrollTo(edge: ScrollEdge, from?: { x: number; y: number }): Promise<void> {
    await this.moveBeforeScroll(from);
    const [dx, dy] =
      edge === "top"
        ? [0, -SCROLL_TO_END]
        : edge === "bottom"
          ? [0, SCROLL_TO_END]
          : edge === "left"
            ? [-SCROLL_TO_END, 0]
            : [SCROLL_TO_END, 0];
    await this.page.mouse.wheel(dx, dy);
  }

  private async moveBeforeScroll(from?: { x: number; y: number }): Promise<void> {
    if (from) {
      await this.page.mouse.move(from.x, from.y);
      this.everMoved = true;
    } else if (!this.everMoved) {
      const { width, height } = await this.size();
      await this.page.mouse.move(Math.floor(width / 2), Math.floor(height / 2));
      this.everMoved = true;
    }
  }

  async type(text: string): Promise<void> {
    await this.page.keyboard.type(text);
  }

  async press(keys: KeySpec[]): Promise<void> {
    if (keys.length === 0) return;
    if (keys.length === 1) {
      await this.page.keyboard.press(keys[0].key);
      return;
    }
    // combo: hold all leading modifiers, press the final key, release in reverse
    const modifiers = keys.slice(0, -1);
    const final = keys[keys.length - 1];
    for (const m of modifiers) await this.page.keyboard.down(m.key);
    await this.page.keyboard.press(final.key);
    for (const m of modifiers.toReversed()) await this.page.keyboard.up(m.key);
  }

  async clearInput(center?: { x: number; y: number }): Promise<void> {
    const isMac = process.platform === "darwin";
    const modifier = isMac ? "Meta" : "Control";
    if (center) {
      await this.page.mouse.click(center.x, center.y);
      this.everMoved = true;
    }
    await this.page.keyboard.down(modifier);
    await this.page.keyboard.press("a");
    await this.page.keyboard.up(modifier);
    await this.page.keyboard.press("Backspace");
  }

  async waitForSettle(): Promise<void> {
    const timeout = this.opts.waitForSettleTimeoutMs ?? 5000;
    if (timeout === 0) return;
    try {
      // Playwright has no network-idle; best-effort selector wait.
      await this.page.waitForSelector("html", { timeout, state: "attached" });
    } catch {
      // timeout -> warn, don't throw
    }
  }

  async waitForDomQuiet(opt?: { quietMs?: number; timeoutMs?: number }): Promise<void> {
    const quietMs = opt?.quietMs ?? DOM_QUIET_DEFAULTS.quietMs;
    const timeoutMs = opt?.timeoutMs ?? DOM_QUIET_DEFAULTS.timeoutMs;
    try {
      await this.page.evaluate(domQuietBrowserFn, { quietMs, timeoutMs });
    } catch {
      // best-effort; navigation/teardown can abort the injected promise
    }
  }

  async evaluate<T>(fn: string | ((arg: any) => T | Promise<T>), arg?: unknown): Promise<T> {
    // Playwright accepts a function or a serialized string expression.
    return this.page.evaluate(fn as any, arg) as Promise<T>;
  }
}
