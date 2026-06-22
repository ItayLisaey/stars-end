/**
 * Public Agent class — wraps a Playwright `Page`. Composes driver + tier +
 * cache + trace.
 */
import type { Page } from "playwright";
import type { z } from "zod";
import { LocateCache, type CacheMode } from "./cache/locate-cache.js";
import { PlaywrightDriver } from "./driver/playwright-driver.js";
import { clickTarget } from "./driver/click-target.js";
import { verifyInputLanded } from "./driver/input-verify.js";
import { parseHotkey } from "./driver/keyboard.js";
import type { PageDriver } from "./driver/types.js";
import { resolveXpathToPoint } from "./extractor/xpath.injected.js";
import {
  assert as assertInsight,
  check as checkInsight,
  waitFor as waitForInsight,
  type WaitOpt,
} from "./insight/assert.js";
import { query as queryInsight } from "./insight/extract.js";
import { locate as locateInsight, type LocateOpt } from "./insight/locate.js";
import { createGroundingTier } from "./model/grounding-tier.js";
import type { ModelTier } from "./model/types.js";
import { act as actLoop } from "./planner/loop.js";
import { Trace, type TraceConfig } from "./trace/jsonl-trace.js";
import type { ActionResult, LocateResult, Point } from "./types.js";

export interface AgentOptions {
  model?: string;
  tier?: "grounding" | "markup" | "auto";
  cache?: { id: string; mode?: CacheMode; dir?: string };
  deepLocate?: boolean;
  maxPlanningSteps?: number;
  replanLimit?: number;
  waitForNavigationTimeoutMs?: number;
  trace?: TraceConfig | false;
}

export interface InputOpt extends LocateOpt {
  mode?: "replace" | "clear" | "typeOnly" | "append";
}

export interface ScrollParam {
  scrollType?: "singleAction" | "scrollToBottom" | "scrollToTop" | "scrollToRight" | "scrollToLeft";
  direction?: "down" | "up" | "right" | "left";
  distance?: number | null;
}

export class Agent {
  private readonly driver: PageDriver;
  private readonly tier: ModelTier;
  private readonly cache?: LocateCache;
  private readonly trace: Trace;

  constructor(
    page: Page,
    private readonly opts: AgentOptions = {},
  ) {
    this.driver = new PlaywrightDriver(page, {
      waitForSettleTimeoutMs: opts.waitForNavigationTimeoutMs,
    });
    this.tier = createGroundingTier(opts.model); // 'auto' -> grounding for Gemini
    if (opts.cache) {
      this.cache = new LocateCache({
        id: opts.cache.id,
        mode: opts.cache.mode,
        dir: opts.cache.dir,
      });
    }
    this.trace = new Trace(opts.trace ?? false);
  }

  // ---- locate with cache integration (shared by instant actions) ----

  private async resolvePoint(prompt: string, opt?: LocateOpt): Promise<Point> {
    if (this.cache) {
      const cached = this.cache.matchLocate(prompt);
      if (cached) {
        for (const xpath of cached.xpaths) {
          const point = await this.driver
            .evaluate<Point | null>(resolveXpathToPoint, xpath)
            .catch(() => null);
          if (point) {
            this.trace.record("locate", {
              prompt,
              point,
              xpath,
              cacheHit: true,
            });
            return point;
          }
        }
        this.cache.markStale(prompt);
      }
    }
    const r = await locateInsight(this.driver, this.tier, prompt, opt);
    this.cache?.writeLocate(prompt, r.xpath ? [r.xpath] : undefined);
    this.trace.record("locate", {
      prompt,
      point: { x: r.x, y: r.y },
      xpath: r.xpath,
      bbox: undefined,
    });
    return { x: r.x, y: r.y };
  }

  // ---- instant actions ----

  async tap(prompt: string, opt?: LocateOpt): Promise<void> {
    const { x, y } = await this.resolvePoint(prompt, opt);
    await clickTarget(this.driver, { x, y });
    await this.driver.waitForSettle();
    this.trace.record("action", { actionType: "tap", prompt, point: { x, y } });
  }

  async rightClick(prompt: string, opt?: LocateOpt): Promise<void> {
    const { x, y } = await this.resolvePoint(prompt, opt);
    await clickTarget(this.driver, { x, y }, { button: "right" });
    await this.driver.waitForSettle();
    this.trace.record("action", {
      actionType: "rightClick",
      prompt,
      point: { x, y },
    });
  }

  async doubleClick(prompt: string, opt?: LocateOpt): Promise<void> {
    const { x, y } = await this.resolvePoint(prompt, opt);
    await clickTarget(this.driver, { x, y }, { count: 2 });
    await this.driver.waitForSettle();
    this.trace.record("action", {
      actionType: "doubleClick",
      prompt,
      point: { x, y },
    });
  }

  async hover(prompt: string, opt?: LocateOpt): Promise<void> {
    const { x, y } = await this.resolvePoint(prompt, opt);
    await this.driver.move(x, y);
    this.trace.record("action", {
      actionType: "hover",
      prompt,
      point: { x, y },
    });
  }

  async input(value: string | number, prompt?: string, opt?: InputOpt): Promise<void> {
    let center: Point | undefined;
    if (prompt) center = await this.resolvePoint(prompt, opt);
    const mode = opt?.mode === "append" ? "typeOnly" : (opt?.mode ?? "replace");

    if (mode !== "typeOnly") {
      await this.driver.clearInput(center);
      await this.driver.waitForDomQuiet();
    } else if (center) {
      await this.driver.tap(center.x, center.y);
    }
    if (mode !== "clear") {
      const text = String(value);
      await this.driver.type(text);
      await this.driver.waitForSettle();
      await verifyInputLanded(this.driver, text, center);
    } else {
      await this.driver.waitForSettle();
    }
    this.trace.record("action", { actionType: "input", prompt });
  }

  async keyboardPress(keyName: string): Promise<void> {
    await this.driver.press(parseHotkey(keyName));
    this.trace.record("action", {
      actionType: "keyboardPress",
      prompt: keyName,
    });
  }

  async scroll(param: ScrollParam, prompt?: string): Promise<void> {
    const from = prompt ? await this.resolvePoint(prompt) : undefined;
    const scrollType = param.scrollType ?? "singleAction";
    if (scrollType !== "singleAction") {
      const edge =
        scrollType === "scrollToTop"
          ? "top"
          : scrollType === "scrollToBottom"
            ? "bottom"
            : scrollType === "scrollToLeft"
              ? "left"
              : "right";
      await this.driver.scrollTo(edge, from);
    } else {
      const size = await this.driver.size();
      const direction = param.direction ?? "down";
      const vertical = direction === "up" || direction === "down";
      const base = param.distance ?? Math.round((vertical ? size.height : size.width) * 0.7);
      const [dx, dy] =
        direction === "down"
          ? [0, base]
          : direction === "up"
            ? [0, -base]
            : direction === "right"
              ? [base, 0]
              : [-base, 0];
      await this.driver.wheel(dx, dy, from);
    }
    this.trace.record("action", { actionType: "scroll", prompt });
  }

  async locate(prompt: string, opt?: LocateOpt): Promise<LocateResult> {
    const r = await locateInsight(this.driver, this.tier, prompt, opt);
    this.trace.record("locate", {
      prompt,
      point: { x: r.x, y: r.y },
      xpath: r.xpath,
    });
    return r;
  }

  // ---- insight ----

  async query<T>(schema: z.ZodType<T>, demand: string): Promise<T> {
    const r = await queryInsight(this.driver, this.tier, schema, demand);
    this.trace.record("query", { prompt: demand });
    return r;
  }

  async assert(assertion: string): Promise<void> {
    this.trace.record("assert", { prompt: assertion });
    await assertInsight(this.driver, this.tier, assertion);
  }

  async check(assertion: string): Promise<boolean> {
    const r = await checkInsight(this.driver, this.tier, assertion);
    return r.pass;
  }

  async waitFor(assertion: string, opt?: WaitOpt): Promise<void> {
    await waitForInsight(this.driver, this.tier, assertion, opt);
  }

  // ---- autonomous ----

  async act(goal: string): Promise<ActionResult> {
    const result = await actLoop(this.driver, this.tier, goal, {
      maxPlanningSteps: this.opts.maxPlanningSteps,
      replanLimit: this.opts.replanLimit,
      deepLocate: this.opts.deepLocate,
      cache: this.cache,
      onStep: (info) =>
        this.trace.record("plan", {
          actionType: info.type,
          modelThought: info.thought,
          ok: info.ok,
          stateChanged: info.stateChanged,
          error: info.error,
        }),
    });
    return result;
  }

  // ---- lifecycle ----

  async flushTrace(): Promise<void> {
    this.cache?.flush();
    await this.trace.flush();
  }
}
