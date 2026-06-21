/**
 * Verifies that an `input` actually landed text in the field, instead of
 * trusting that the type/keystrokes had an effect. Rich/contenteditable
 * composers can silently drop input when focus never reaches them — the action
 * "succeeds" but the field stays empty, and the planner then proceeds on a
 * believed-but-false state.
 *
 * Reads the field back; if it is definitively empty after we typed a non-empty
 * value, it does ONE focus-and-retype recovery, then throws
 * {@link InputVerificationError} if still empty. A `null` read (no editable
 * field resolvable) is treated as unverifiable and passes, to avoid
 * false-positive failures on exotic widgets.
 */
import { InputVerificationError } from "../errors.js";
import type { Point } from "../types.js";
import type { PageDriver } from "./types.js";

/** True once we can confirm the typed text is present (or confirm we can't tell). */
async function landed(driver: PageDriver, point: Point | undefined): Promise<boolean> {
  const read = await driver.readEditableValue(point);
  // null => could not resolve an editable field; do not flag a false failure.
  return read === null || read.trim() !== "";
}

export async function verifyInputLanded(
  driver: PageDriver,
  value: string,
  point?: Point,
): Promise<void> {
  // nothing meaningful to verify for an empty/clear value
  if (value.trim() === "") return;

  if (await landed(driver, point)) return;

  // recovery: explicitly re-focus the field and retype once
  if (point) {
    await driver.tap(point.x, point.y);
    await driver.type(value);
    await driver.waitForSettle();
    if (await landed(driver, point)) return;
  }

  throw new InputVerificationError(value);
}
