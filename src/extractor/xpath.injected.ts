/**
 * XPath helpers injected into the page via `page.evaluate`.
 *
 * Builds a stable xpath for an element:
 *  - order-insensitive: prefer an `@id` anchor, else a stable tag path
 *  - iframe-penetrating with a `|>>|` separator
 *  - max depth 10
 *
 * CRITICAL: `page.evaluate` serializes only a function's BODY (via toString),
 * not its closure. These functions must be fully self-contained — no module
 * scope, and NO inner named functions (bundlers' keepNames inject a `__name`
 * helper into named inner fns that does not exist in the page). The xpath
 * builder is therefore inlined as a flat loop at each use site.
 */

export function getXpathsByPoint(arg: { x: number; y: number }): string[] | null {
  const SEP = "|>>|";

  // Inlined per-document xpath builder. These helpers MUST stay nested: the
  // function is serialized to the page by toString(), so anything in outer
  // scope would be undefined there. (Scoping lint warning is intentional.)
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const buildXpath = (start: Element): string => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const escapeId = (v: string): string => (window.CSS && CSS.escape ? CSS.escape(v) : v);
    const id = start.getAttribute("id");
    if (id && start.ownerDocument.querySelectorAll(`[id="${escapeId(id)}"]`).length === 1) {
      return `//*[@id=${JSON.stringify(id)}]`;
    }
    const segments: string[] = [];
    let node: Element | null = start;
    let d = 0;
    while (node && node.nodeType === 1 && d < 32) {
      const tag = node.tagName.toLowerCase();
      const ownId = node.getAttribute("id");
      if (ownId && node.ownerDocument.querySelectorAll(`[id="${escapeId(ownId)}"]`).length === 1) {
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

  const MAX_DEPTH = 10;
  let win: Window = window;
  let doc: Document = document;
  let left = arg.x;
  let top = arg.y;
  let prefix = "";
  let lastFound: Element | null = null;
  let depth = 0;

  while (depth < MAX_DEPTH) {
    depth++;
    const el = doc.elementFromPoint(left, top);
    if (!el) break;
    lastFound = el;

    const tag = el.tagName.toLowerCase();
    if (tag === "iframe" || tag === "frame") {
      try {
        const frame = el as HTMLIFrameElement;
        const cw = frame.contentWindow;
        const cd = frame.contentDocument;
        if (cw && cd) {
          const rect = frame.getBoundingClientRect();
          const style = win.getComputedStyle(frame);
          const borderLeft = parseFloat(style.borderLeftWidth) || 0;
          const borderTop = parseFloat(style.borderTopWidth) || 0;
          const padLeft = parseFloat(style.paddingLeft) || 0;
          const padTop = parseFloat(style.paddingTop) || 0;
          prefix += `${buildXpath(el)}${SEP}`;
          left = left - rect.left - borderLeft - padLeft;
          top = top - rect.top - borderTop - padTop;
          win = cw;
          doc = cd;
          continue;
        }
      } catch {
        // cross-origin: stop penetrating, return the iframe element's xpath
      }
    }
    return [prefix + buildXpath(el)];
  }

  return lastFound ? [prefix + buildXpath(lastFound)] : null;
}

/** Resolve a (possibly iframe-compound) xpath to a CSS-px center point. */
export function resolveXpathToPoint(xpath: string): { x: number; y: number } | null {
  const SEP = "|>>|";
  const parts = xpath.split(SEP);
  let win: Window = window;
  let doc: Document = document;
  let offsetX = 0;
  let offsetY = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const result = doc.evaluate(part, doc, null, 9 /* FIRST_ORDERED_NODE_TYPE */, null);
    const node = result.singleNodeValue as Element | null;
    if (!node) return null;

    if (i < parts.length - 1) {
      const frame = node as HTMLIFrameElement;
      const cw = frame.contentWindow;
      const cd = frame.contentDocument;
      if (!cw || !cd) return null;
      const rect = frame.getBoundingClientRect();
      const style = win.getComputedStyle(frame);
      offsetX +=
        rect.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0);
      offsetY +=
        rect.top + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.paddingTop) || 0);
      win = cw;
      doc = cd;
    } else {
      const rect = node.getBoundingClientRect();
      return {
        x: offsetX + rect.left + rect.width / 2,
        y: offsetY + rect.top + rect.height / 2,
      };
    }
  }
  return null;
}
