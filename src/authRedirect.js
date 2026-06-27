/**
 * Auth redirect URLs + native deep-link session completion (Capacitor).
 * Web uses public site origin; native password reset uses custom scheme → appUrlOpen.
 */
import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabase";

/** Must match CFBundleURLSchemes (iOS) and Android intent-filter; whitelist in Supabase redirect URLs. */
export const NATIVE_APP_AUTH_SCHEME = "com.cinemastro.app";

/** Dispatched after native deep link routing; App.jsx opens recovery / join when needed. */
export const AUTH_DEEPLINK_EVENT = "cinematch-auth-deeplink";

let lastHandledDeepLink = "";

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

/** Canonical web origin for share links and web auth redirects. */
export function getPublicSiteOrigin() {
  let base = import.meta.env.VITE_PUBLIC_SITE_URL;
  if (typeof base !== "string" || !base.trim()) {
    if (typeof window !== "undefined" && window.location?.origin) {
      base = window.location.origin;
    } else {
      base = "https://www.cinemastro.com";
    }
  }
  return String(base).trim().replace(/\/+$/, "");
}

/** Supabase `redirectTo` for password-reset emails (`?recovery=1` for in-app reset screen). */
export function passwordRecoveryRedirectTo() {
  if (isNativeApp()) {
    return `${NATIVE_APP_AUTH_SCHEME}://localhost/?recovery=1`;
  }
  const u = new URL(`${getPublicSiteOrigin()}/`);
  u.searchParams.set("recovery", "1");
  return u.toString();
}

function parseDeepLinkUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) throw new Error("empty url");
  if (raw.startsWith(`${NATIVE_APP_AUTH_SCHEME}:`)) {
    return new URL(raw.replace(`${NATIVE_APP_AUTH_SCHEME}:`, "https:"));
  }
  return new URL(raw);
}

/** Map native scheme URL → SPA path (`/?recovery=1#…`, `/join/:token`, …). */
export function appDeepLinkToBrowserPath(url) {
  const parsed = parseDeepLinkUrl(url);
  const path = `${parsed.pathname || "/"}${parsed.search}${parsed.hash}`;
  return path || "/";
}

/** True when Supabase redirect or SPA path marks a password-recovery landing. */
export function deepLinkIndicatesRecovery(href) {
  try {
    const parsed =
      String(href || "").startsWith(`${NATIVE_APP_AUTH_SCHEME}:`)
        ? parseDeepLinkUrl(href)
        : new URL(href);
    if (parsed.searchParams.get("recovery") === "1") return true;
    const hash = parsed.hash || "";
    return /type=recovery(?:&|$|#|%26)/i.test(hash) || /type%3[Dd]recovery/i.test(hash + parsed.search);
  } catch {
    return false;
  }
}

async function completeAuthSessionFromHref(href) {
  let parsed;
  try {
    parsed =
      String(href || "").startsWith(`${NATIVE_APP_AUTH_SCHEME}:`)
        ? parseDeepLinkUrl(href)
        : new URL(href);
  } catch {
    return false;
  }

  const code = parsed.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return !error;
  }

  const hashRaw = parsed.hash?.startsWith("#") ? parsed.hash.slice(1) : parsed.hash || "";
  if (!hashRaw) return false;

  const hashParams = new URLSearchParams(hashRaw);
  const access_token = hashParams.get("access_token");
  const refresh_token = hashParams.get("refresh_token");
  if (!access_token || !refresh_token) return false;

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  return !error;
}

/** Apply PKCE `code` or implicit `#access_token` from a Supabase auth redirect. */
export async function completeAuthSessionFromUrl(url) {
  return completeAuthSessionFromHref(url);
}

/** Native deep link — route, complete Supabase session, notify App (recovery / join). */
export async function handleAppDeepLink(url) {
  if (!url || typeof window === "undefined") return;
  if (url === lastHandledDeepLink) return;
  lastHandledDeepLink = url;

  const path = appDeepLinkToBrowserPath(url);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (path !== current) {
    window.history.replaceState({}, "", path);
  }

  let sessionSet = await completeAuthSessionFromHref(url);
  if (!sessionSet) {
    sessionSet = await completeAuthSessionFromHref(window.location.href);
  }

  const recovery =
    deepLinkIndicatesRecovery(url) ||
    deepLinkIndicatesRecovery(window.location.href);

  window.dispatchEvent(
    new CustomEvent(AUTH_DEEPLINK_EVENT, {
      detail: { recovery, sessionSet, path },
    }),
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
}
