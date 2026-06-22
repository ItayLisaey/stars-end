/**
 * Click a located target robustly: snap the vision-model point to the real
 * interactive element near it and click THAT element (Playwright actionability),
 * falling back to a raw coordinate click when no element resolves (canvas /
 * non-DOM targets) or the element click fails (obscured / detached).
 *
 * This corrects the dominant miss mode — the model's point landing a few px off
 * a normal-sized button — without trusting the raw pixel. See
 * `snap-to-clickable.injected.ts`.
 */
import { snapToClickableXpath } from "../extractor/snap-to-clickable.injected.js";
import type { Point } from "../types.js";
import type { PageDriver } from "./types.js";

/** How far (CSS px) a point may sit from a control's box and still snap to it. */
const SNAP_RADIUS_CSS = 24;

export async function clickTarget(
  driver: PageDriver,
  point: Point,
  opt?: { button?: "left" | "right" | "middle"; count?: number },
): Promise<void> {
  const xpath = await driver
    .evaluate<string | null>(snapToClickableXpath, {
      x: point.x,
      y: point.y,
      radius: SNAP_RADIUS_CSS,
    })
    .catch(() => null);

  if (xpath && (await driver.clickXpath(xpath, opt))) return;

  // no interactive element resolved, or the element click failed — click the
  // raw coordinate (still triggers JS listeners on non-semantic targets).
  await driver.tap(point.x, point.y, opt);
}
