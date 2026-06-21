/**
 * Reads the current text of an editable field, for verifying that an `input`
 * action actually landed. Injected into the browser via `page.evaluate`.
 *
 * Resolution: if a point is given, take the element there and climb to the
 * nearest editable ancestor; otherwise fall back to `document.activeElement`.
 * Handles <input>/<textarea> (`.value`) and contenteditable / rich composers
 * (`.textContent`).
 *
 * Returns the field's text, or `null` when no editable field could be found
 * (so callers can distinguish "empty field" from "could not read" and avoid
 * false-positive verification failures).
 *
 * CRITICAL: serialized by toString() — fully self-contained, no module scope,
 * no inner NAMED functions (keepNames `__name` helper is absent in the page).
 */

export function readEditableValueAtPoint(arg: { x?: number; y?: number } | null): string | null {
  // Nested by necessity: serialized into the page by toString(), so it cannot
  // live in module scope. (Scoping lint warning is intentional.)
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const isEditable = (el: Element | null): boolean => {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") return true;
    const ce = (el as HTMLElement).isContentEditable;
    return ce === true;
  };

  let el: Element | null = null;

  if (arg && typeof arg.x === "number" && typeof arg.y === "number") {
    let node: Element | null = document.elementFromPoint(arg.x, arg.y);
    // climb to the nearest editable ancestor (the point may hit an inner span)
    let depth = 0;
    while (node && depth < 10) {
      if (isEditable(node)) {
        el = node;
        break;
      }
      node = node.parentElement;
      depth++;
    }
  }

  // fall back to whatever currently holds focus
  if (!el && isEditable(document.activeElement)) {
    el = document.activeElement;
  }

  if (!el) return null;

  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") {
    return (el as HTMLInputElement | HTMLTextAreaElement).value ?? "";
  }
  // contenteditable / rich composer
  return (el as HTMLElement).textContent ?? "";
}
