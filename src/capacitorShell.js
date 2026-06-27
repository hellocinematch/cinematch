/**
 * Native shell bootstrap (Capacitor). No-op on web/Vercel; runs in bundled iOS/Android WebView.
 */
import { Capacitor } from "@capacitor/core";
import { handleAppDeepLink } from "./authRedirect.js";

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
    void handleAppDeepLink(url);
  });
}
