/**
 * Native shell bootstrap (Capacitor). No-op on web/Vercel; runs in bundled iOS/Android WebView.
 */
import { Capacitor } from "@capacitor/core";
import { handleAppDeepLink, queueNativeDeepLink } from "./authRedirect.js";

/** Defer until WebView + React mount so auth listeners catch recovery deep links. */
function scheduleDeepLink(url) {
  queueNativeDeepLink(url);
  const run = () => void handleAppDeepLink(url);
  const defer = () => window.setTimeout(run, 200);
  if (document.readyState === "complete") {
    requestAnimationFrame(defer);
  } else {
    window.addEventListener("load", () => requestAnimationFrame(defer), { once: true });
  }
}

export async function initCapacitorShell() {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add("cap-native");

  const [{ App }, { StatusBar, Style }] = await Promise.all([
    import("@capacitor/app"),
    import("@capacitor/status-bar"),
  ]);

  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    /* StatusBar plugin not available on all platforms */
  }

  App.addListener("appUrlOpen", ({ url }) => {
    if (url) scheduleDeepLink(url);
  });

  // Resume from background: Circles unseen refresh (and icon badge) listens via visibility/focus;
  // also fire pageshow-equivalent so badge syncs when WebView visibility is flaky.
  App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) return;
    try {
      window.dispatchEvent(new Event("focus"));
    } catch {
      /* ignore */
    }
  });

  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) scheduleDeepLink(launch.url);
  } catch {
    /* getLaunchUrl not available on all platforms */
  }
}
