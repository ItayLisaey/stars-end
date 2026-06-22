/**
 * Snap a vision-model click point to the real interactive element near it, so
 * the click targets the element (via Playwright's actionability-checked click)
 * instead of raw coordinates that may be a few px off.
 *
 * Resolution (CSS px, viewport-relative):
 *   1. element at the point (piercing shadow DOM) → climb to the nearest
 *      interactive ancestor (button/a/input/[role=...]/[onclick]/cursor:pointer)
 *   2. else, if the point landed in a gap/margin, snap to the nearest
 *      interactive element whose box is within `radius` px
 *   3. else null → caller clicks the raw coordinate (canvas / non-DOM targets)
 *
 * Returns a single-document xpath for the chosen element (no iframe crossing —
 * elementFromPoint doesn't pierce iframes; those fall back to the raw click).
 *
 * CRITICAL: serialized by toString() — fully self-contained, no module scope,
 * no inner NAMED functions (keepNames `__name` helper is absent in the page).
 */

export function snapToClickableXpath(arg: { x: number; y: number; radius: number }): string | null {
  const INTERACTIVE =
    "a[href],button,input,select,textarea,summary,label," +
    "[role=button],[role=link],[role=option],[role=tab],[role=menuitem]," +
    '[role=switch],[role=checkbox],[role=radio],[onclick],[tabindex]:not([tabindex="-1"])';

  // Inlined xpath builder (must stay nested for page serialization).
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const buildXpath = (start: Element): string => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const esc = (v: string): string => (window.CSS && CSS.escape ? CSS.escape(v) : v);
    const id = start.getAttribute("id");
    if (id && start.ownerDocument.querySelectorAll(`[id="${esc(id)}"]`).length === 1) {
      return `//*[@id=${JSON.stringify(id)}]`;
    }
    const segments: string[] = [];
    let node: Element | null = start;
    let d = 0;
    while (node && node.nodeType === 1 && d < 32) {
      const tag = node.tagName.toLowerCase();
      const ownId = node.getAttribute("id");
      if (ownId && node.ownerDocument.querySelectorAll(`[id="${esc(ownId)}"]`).length === 1) {
        segments.unshift(`*[@id=${JSON.stringify(ownId)}]`);
        break;
      }
      const parent: Element | null = node.parentElement;
      if (!parent) {
        segments.unshift(tag);
        break;
      }
      let index = 1;
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.tagName.toLowerCase() === tag) index++;
      }
      segments.unshift(`${tag}[${index}]`);
      node = parent;
      d++;
    }
    return `//${segments.join("/")}`;
  };

  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = window.getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && parseFloat(s.opacity || "1") !== 0;
  };

  // 1. element at the point, piercing shadow DOM
  let node: Element | null = document.elementFromPoint(arg.x, arg.y);
  let depth = 0;
  while (node && node.shadowRoot && depth < 10) {
    const inner = node.shadowRoot.elementFromPoint(arg.x, arg.y);
    if (!inner || inner === node) break;
    node = inner;
    depth++;
  }

  // climb to the nearest interactive ancestor
  for (let cur: Element | null = node, i = 0; cur && i < 12; cur = cur.parentElement, i++) {
    if (cur.matches(INTERACTIVE)) return buildXpath(cur);
  }
  // weaker signal: an ancestor styled as clickable
  for (let cur: Element | null = node, i = 0; cur && i < 12; cur = cur.parentElement, i++) {
    if (window.getComputedStyle(cur).cursor === "pointer") return buildXpath(cur);
  }

  // 2. point landed off any interactive element — snap to the nearest within radius
  let best: Element | null = null;
  let bestDist = Infinity;
  for (const el of Array.from(document.querySelectorAll(INTERACTIVE))) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const dx = Math.max(r.left - arg.x, 0, arg.x - r.right);
    const dy = Math.max(r.top - arg.y, 0, arg.y - r.bottom);
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }
  return best && bestDist <= arg.radius ? buildXpath(best) : null;
}
