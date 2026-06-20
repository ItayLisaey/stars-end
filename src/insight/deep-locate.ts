/**
 * Two-stage "deep locate" for dense/small targets. Optional second pass
 * used as a fallback when the coarse locate fails (or when `deepLocate` is set):
 *
 *   1. locate a coarse SECTION ("the area containing X") -> bbox (image px)
 *   2. expand it (expandSearchArea), crop the screenshot to it
 *   3. upscale the crop 2× (canvas, zero deps)
 *   4. re-run locate within the crop
 *   5. map the result back: originalPx = round(cropPx / scale) + cropOffset
 */
import type { PageDriver } from "../driver/types.js";
import {
  expandSearchArea,
  mapSearchAreaPixelBboxToOriginalPixelBbox,
  pixelBboxToRect,
} from "../geometry/coordinates.js";
import type { LocateModelResult, ModelTier, UIContext } from "../model/types.js";
import { cropAndScaleDataUrl, type CropResult } from "./image-crop.injected.js";

const UPSCALE = 2;

export async function deepLocate(
  page: PageDriver,
  tier: ModelTier,
  ctx: UIContext,
  instruction: string,
): Promise<LocateModelResult> {
  // 1. coarse section locate on the full image
  const section = await tier.locate(ctx, `the area containing ${instruction}`);
  if (!section.bbox) return section;

  // 2. expand the section to a search area (image px space)
  const area = expandSearchArea(pixelBboxToRect(section.bbox), ctx.size);
  if (area.width < 1 || area.height < 1) return section;

  // 3-4. crop + upscale the screenshot inside the page, then re-locate
  const crop: CropResult | null = await page
    .evaluate<CropResult>(cropAndScaleDataUrl, {
      dataUrl: ctx.screenshotDataUrl,
      left: area.left,
      top: area.top,
      width: area.width,
      height: area.height,
      scale: UPSCALE,
    })
    .catch(() => null);
  if (!crop) return section;

  const cropCtx: UIContext = {
    screenshotDataUrl: crop.dataUrl,
    size: { width: crop.width, height: crop.height },
    dpr: ctx.dpr,
  };
  const refined = await tier.locate(cropCtx, instruction);
  if (!refined.bbox) return refined;

  // 5. map the crop-space bbox back to the original image px space
  const mapped = mapSearchAreaPixelBboxToOriginalPixelBbox(refined.bbox, {
    offset: { x: area.left, y: area.top },
    scale: UPSCALE,
  });
  return { bbox: mapped, raw: refined.raw };
}
