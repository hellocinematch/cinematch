/**
 * Reset WebView scroll/layout after returning from Mail/Safari (email confirm, recovery).
 * iOS often leaves a bad visual viewport until the next cold remount (sign-out/in).
 */

export const NATIVE_VIEWPORT_RESET_EVENT = "cinematch-native-viewport-reset";

export function resetNativeShellViewport() {
  if (typeof window === "undefined") return;
  try {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
    if (document.body) {
      document.body.scrollTop = 0;
      document.body.scrollLeft = 0;
    }
    const shell = document.querySelector(".viewport-shell");
    if (shell) void shell.offsetHeight;
  } catch {
    /* ignore */
  }
}

/** Burst of resets — layout often settles only after a few frames / Mail→app transition. */
export function scheduleNativeShellViewportReset() {
  if (typeof window === "undefined") return;
  resetNativeShellViewport();
  const run = () => resetNativeShellViewport();
  requestAnimationFrame(() => {
    run();
    window.setTimeout(run, 50);
    window.setTimeout(run, 200);
    window.setTimeout(run, 500);
    window.setTimeout(run, 1000);
  });
  try {
    window.dispatchEvent(new CustomEvent(NATIVE_VIEWPORT_RESET_EVENT));
  } catch {
    /* ignore */
  }
}

/** Drop leftover Supabase auth hash/query after session is applied (avoids odd history/layout). */
export function scrubAuthParamsFromLocation() {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    let dirty = false;
    if (u.hash && /access_token|refresh_token|type=|error=/.test(u.hash)) {
      u.hash = "";
      dirty = true;
    }
    for (const key of ["code", "error", "error_description", "error_code"]) {
      if (u.searchParams.has(key)) {
        u.searchParams.delete(key);
        dirty = true;
      }
    }
    if (!dirty) return;
    const next = `${u.pathname}${u.search}${u.hash}`;
    const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== cur) window.history.replaceState({}, "", next || "/");
  } catch {
    /* ignore */
  }
}
