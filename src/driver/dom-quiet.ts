/**
 * waitForDomQuiet. A MutationObserver that resolves after `quietMs` of
 * no mutations, capped by `timeoutMs`. Used after clearInput before typing so
 * frameworks don't drop keystrokes.
 *
 * The function body is serialized and injected via `page.evaluate`; keep it
 * self-contained (no closures over module scope).
 */

export interface DomQuietOptions {
  quietMs?: number;
  timeoutMs?: number;
}

/** Runs in the page. Resolves once the DOM is quiet or the timeout elapses. */
export function domQuietBrowserFn(opt: { quietMs: number; timeoutMs: number }): Promise<void> {
  return new Promise<void>((resolve) => {
    const { quietMs, timeoutMs } = opt;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const start = Date.now();

    const observer = new MutationObserver(() => {
      if (quietTimer) clearTimeout(quietTimer);
      schedule();
    });

    const finish = () => {
      if (quietTimer) clearTimeout(quietTimer);
      observer.disconnect();
      resolve();
    };

    const schedule = () => {
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) {
        finish();
        return;
      }
      quietTimer = setTimeout(finish, Math.min(quietMs, remaining));
    };

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    schedule();
  });
}

export const DOM_QUIET_DEFAULTS = { quietMs: 300, timeoutMs: 2000 };
