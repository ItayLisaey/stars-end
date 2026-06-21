/**
 * Detects whether a top-layer surface (modal, dialog, popover) is currently
 * open over the page. Injected into the browser via `page.evaluate`.
 *
 * Why this exists: completion / recovery logic that only asks "is the target
 * still visible?" is defeated by overlays that dim — but do not remove — the
 * underlying content. A detail panel or modal that keeps the grid visible
 * behind it looks "incomplete" even though the goal was reached. This reports
 * the NEW surface so the planner can treat its appearance as progress.
 *
 * CRITICAL: `page.evaluate` serializes only the function BODY (via toString),
 * not its closure. This must be fully self-contained — no module-scope refs and
 * no inner NAMED functions (bundler keepNames would inject a `__name` helper
 * absent in the page). Arrow expressions assigned to consts are inlined fine.
 */

export interface TopLayerResult {
  present: boolean;
  description?: string;
}

export function detectTopLayerSurface(): TopLayerResult {
  // 1. native <dialog open> / showModal()
  const dialogs = Array.from(document.querySelectorAll("dialog"));
  for (const d of dialogs) {
    if ((d as HTMLDialogElement).open) {
      return { present: true, description: "a dialog" };
    }
  }

  // 2. ARIA modal / dialog roles that are actually visible
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

  const aria = Array.from(
    document.querySelectorAll('[aria-modal="true"], [role="dialog"], [role="alertdialog"]'),
  );
  for (const el of aria) {
    if (isVisible(el)) {
      const role = el.getAttribute("role");
      return {
        present: true,
        description: role === "alertdialog" ? "an alert dialog" : "a modal dialog",
      };
    }
  }

  // 3. heuristic: a large, fixed/absolute, high z-index element covering much of
  // the viewport (popovers/sheets/backdrops that use neither <dialog> nor ARIA)
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const viewportArea = vw * vh;
  if (viewportArea > 0) {
    const all = Array.from(document.body ? document.body.querySelectorAll("*") : []);
    for (const el of all) {
      const style = window.getComputedStyle(el);
      const pos = style.position;
      if (pos !== "fixed" && pos !== "absolute") continue;
      const z = parseInt(style.zIndex, 10);
      if (!Number.isFinite(z) || z < 10) continue;
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      const coverage = (rect.width * rect.height) / viewportArea;
      // covers >= 25% of the viewport and sits visibly above the page flow
      if (coverage >= 0.25 && rect.width >= vw * 0.4) {
        return { present: true, description: "an overlay panel" };
      }
    }
  }

  return { present: false };
}
