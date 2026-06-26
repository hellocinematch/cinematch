/**
 * Native shell bootstrap (Capacitor). No-op on web/Vercel; runs in bundled iOS/Android WebView.
 * Deep links + push land in later milestones — App listener stub keeps routing hook in one place.
 */
import { Capacitor } from "@capacitor/core";

export async function initCapacitorShell() {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add("cap-native");

  const [{ App }, { StatusBar, Style }] = await Promise.all([
    import("@capacitor/app"),
    import("@capacitor/status-bar"),
  ]);

  try {
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    /* StatusBar plugin not available on all platforms */
  }

  App.addListener("appUrlOpen", ({ url }) => {
    if (!url || typeof window === "undefined") return;
    try {
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      if (path && path !== "/") {
        window.history.replaceState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    } catch {
      /* ignore malformed deep links until universal links are configured */
    }
  });
}
