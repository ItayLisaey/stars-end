/**
 * Detects whether a custom dropdown/combobox is currently OPEN — a visible
 * `role="listbox"`/`menu` of options, or a `role="combobox"` /
 * `aria-expanded="true"` trigger with its popup showing. Injected via
 * `page.evaluate`.
 *
 * Why this exists: after an action opens a dropdown, the planner tends to keep
 * the CLOSED mental model and re-locate the trigger by its old value ("the X
 * dropdown showing Nov") — but the screen now shows the option LIST, so the
 * locate misses and loops. Surfacing "a list of N options is open" lets the
 * planner target `role="option"` items in the open surface instead.
 *
 * CRITICAL: serialized by toString() — fully self-contained, no module scope,
 * no inner NAMED functions (keepNames `__name` helper is absent in the page).
 */

export interface OpenListResult {
  open: boolean;
  /** count of visible options in the open surface */
  optionCount?: number;
}

export function detectOpenListbox(): OpenListResult {
  // Nested by necessity: serialized into the page by toString(), so it cannot
  // live in module scope. (Scoping lint warning is intentional.)
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") === 0) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    return true;
  };

  const countVisibleOptions = (root: ParentNode): number => {
    let n = 0;
    for (const opt of Array.from(root.querySelectorAll('[role="option"], [role="menuitem"]'))) {
      if (isVisible(opt)) n++;
    }
    return n;
  };

  // 1. a visible listbox/menu surface with options
  const surfaces = Array.from(document.querySelectorAll('[role="listbox"], [role="menu"]'));
  for (const surface of surfaces) {
    if (!isVisible(surface)) continue;
    const count = countVisibleOptions(surface);
    if (count > 0) return { open: true, optionCount: count };
  }

  // 2. an expanded combobox trigger — its popup may be portalled elsewhere, so
  // fall back to a document-wide visible-option count.
  const expanded = Array.from(
    document.querySelectorAll('[role="combobox"][aria-expanded="true"], [aria-expanded="true"]'),
  ).filter((el) => isVisible(el));
  if (expanded.length > 0) {
    const count = countVisibleOptions(document);
    if (count > 0) return { open: true, optionCount: count };
  }

  return { open: false };
}
