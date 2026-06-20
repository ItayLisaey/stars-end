/**
 * Action object -> driver calls, with just-in-time locate resolution.
 * Resolution order:
 *   1. inline plan bbox (VL planner returned coords) — unless deepLocate
 *   2. xpath cache hit — re-resolve against the live DOM
 *   3. AI locate, then write the cache
 */
import type { LocateCache } from "../cache/locate-cache.js";
import type { PageDriver } from "../driver/types.js";
import { UnknownActionError } from "../errors.js";
import { resolveXpathToPoint } from "../extractor/xpath.injected.js";
import { pixelBboxToRect, rectCenter } from "../geometry/coordinates.js";
import { locate } from "../insight/locate.js";
import type { ModelTier, PlanModelResult, UIContext } from "../model/types.js";
import type { Point } from "../types.js";
import { findAction, normalizeActionParam } from "./action-space.js";

export interface ExecuteOptions {
  cache?: LocateCache;
  deepLocate?: boolean;
}

function bboxToCssPoint(bbox: [number, number, number, number], dpr: number): Point {
  const center = rectCenter(pixelBboxToRect(bbox));
  return { x: center.x / dpr, y: center.y / dpr };
}

async function resolveLocate(
  page: PageDriver,
  tier: ModelTier,
  ctx: UIContext,
  plan: PlanModelResult,
  prompt: string | undefined,
  opt: ExecuteOptions,
): Promise<Point> {
  // 1. inline plan bbox (only when the planner grounded inline and not deepLocate)
  if (plan.action?.locatedBbox && !opt.deepLocate) {
    return bboxToCssPoint(plan.action.locatedBbox, ctx.dpr);
  }

  // 2. xpath cache hit -> re-resolve against the live DOM
  if (prompt && opt.cache) {
    const cached = opt.cache.matchLocate(prompt);
    if (cached) {
      for (const xpath of cached.xpaths) {
        const point = await page
          .evaluate<Point | null>(resolveXpathToPoint, xpath)
          .catch(() => null);
        if (point) return point;
      }
      // cache entry no longer resolves -> mark stale so AI result replaces it
      opt.cache.markStale(prompt);
    }
  }

  // 3. AI locate
  if (!prompt) throw new Error("action requires a target but no locate prompt was provided");
  const result = await locate(page, tier, prompt, {
    context: ctx,
    deepLocate: opt.deepLocate,
  });
  opt.cache?.writeLocate(prompt, result.xpath ? [result.xpath] : undefined);
  return { x: result.x, y: result.y };
}

export async function executeAction(
  page: PageDriver,
  tier: ModelTier,
  plan: PlanModelResult,
  ctx: UIContext,
  opt: ExecuteOptions = {},
): Promise<void> {
  if (!plan.action) throw new Error("no action to execute");
  const def = findAction(plan.action.type);
  if (!def) throw new UnknownActionError(plan.action.type);

  const normalized = normalizeActionParam(def.name, plan.action.param);
  const param = def.paramSchema.parse(normalized ?? {}) as Record<string, unknown> & {
    locate?: { prompt: string };
  };

  let point: Point | undefined;
  if (def.needsLocate || param.locate) {
    point = await resolveLocate(page, tier, ctx, plan, param.locate?.prompt, opt);
  }

  await def.run(
    {
      driver: page,
      point,
      viewport: {
        width: ctx.size.width / ctx.dpr,
        height: ctx.size.height / ctx.dpr,
      },
    },
    param,
  );
}
