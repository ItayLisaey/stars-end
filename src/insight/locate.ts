/**
 * locate: tier -> pixel bbox -> CSS point + xpath.
 * locate(instruction) -> { x, y } in CSS px.
 */
import type { PageDriver } from "../driver/types.js";
import { ElementNotFoundError } from "../errors.js";
import { pixelBboxToRect, rectCenter } from "../geometry/coordinates.js";
import type { LocateModelResult, ModelTier, UIContext } from "../model/types.js";
import { getXpathsByPoint } from "../extractor/xpath.injected.js";
import type { LocateResult } from "../types.js";
import { deepLocate } from "./deep-locate.js";

export interface LocateOpt {
  /** force the two-stage crop+upscale pass; otherwise it runs only as a fallback */
  deepLocate?: boolean;
  searchArea?: string;
  /** reuse an already-built context to avoid a second screenshot */
  context?: UIContext;
}

export async function locate(
  page: PageDriver,
  tier: ModelTier,
  prompt: string,
  opt?: LocateOpt,
): Promise<LocateResult> {
  const ctx = opt?.context ?? (await tier.buildContext(page));

  let res: LocateModelResult;
  if (opt?.deepLocate) {
    // forced two-stage pass
    res = await deepLocate(page, tier, ctx, prompt);
  } else {
    res = await tier.locate(ctx, prompt, { searchArea: opt?.searchArea });
    // fall back to the two-stage pass when the coarse locate finds nothing
    if (!res.bbox) {
      const refined = await deepLocate(page, tier, ctx, prompt).catch(() => res);
      if (refined.bbox) res = refined;
    }
  }

  if (!res.bbox) throw new ElementNotFoundError(prompt, res.errors);

  const rect = pixelBboxToRect(res.bbox);
  const center = rectCenter(rect);
  const cssX = center.x / ctx.dpr;
  const cssY = center.y / ctx.dpr;

  // xpath for caching (VL tier still needs getXpathsByPoint)
  const xpaths = await page
    .evaluate<string[] | null>(getXpathsByPoint, { x: cssX, y: cssY })
    .catch(() => null);

  return { x: cssX, y: cssY, rect, xpath: xpaths?.[0] };
}
