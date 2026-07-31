/**
 * Native push registration (Phase 2 badge-only). iOS first; no-op on web.
 * Registers APNs device token → register_device_push_token; after circle publish,
 * invokes push-circle-badge so recipients’ home-screen badges update when killed.
 */
import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabase";

let listenersReady = false;
let lastToken = null;
let registerInFlight = null;

function isNativeIos() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

async function persistToken(token) {
  const value = typeof token === "string" ? token.trim() : "";
  if (!value) return;
  lastToken = value;
  const { error } = await supabase.rpc("register_device_push_token", {
    p_token: value,
    p_platform: "ios",
  });
  if (error) {
    console.warn("Native push: register_device_push_token failed", error.message);
  }
}

/**
 * Request permission + register for APNs. Safe to call on every login.
 */
export async function registerNativePush() {
  if (!isNativeIos()) return;
  if (registerInFlight) return registerInFlight;

  registerInFlight = (async () => {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");

      if (!listenersReady) {
        await PushNotifications.addListener("registration", (t) => {
          void persistToken(t?.value);
        });
        await PushNotifications.addListener("registrationError", (err) => {
          console.warn("Native push: registrationError", err);
        });
        listenersReady = true;
      }

      let perm = await PushNotifications.checkPermissions();
      if (perm.receive !== "granted") {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== "granted") return;

      await PushNotifications.register();
    } catch (e) {
      console.warn("Native push: register failed", e);
    } finally {
      registerInFlight = null;
    }
  })();

  return registerInFlight;
}

/** Clear tokens for this device/user on sign-out. */
export async function unregisterNativePush() {
  if (!isNativeIos()) return;
  try {
    if (lastToken) {
      const { error } = await supabase.rpc("unregister_device_push_token", {
        p_token: lastToken,
      });
      if (error) {
        console.warn("Native push: unregister failed", error.message);
      }
      lastToken = null;
      return;
    }
    const { error } = await supabase.rpc("clear_my_device_push_tokens");
    if (error) {
      console.warn("Native push: clear_my_device_push_tokens failed", error.message);
    }
  } catch (e) {
    console.warn("Native push: unregister failed", e);
  }
}

/**
 * Fire-and-forget: ask Edge to APNs-badge other members of these circles.
 * @param {string[]} circleIds
 */
export function notifyCircleBadgePush(circleIds) {
  if (!Array.isArray(circleIds) || circleIds.length === 0) return;
  const ids = [...new Set(circleIds.map((x) => String(x || "").trim()).filter(Boolean))];
  if (ids.length === 0) return;
  void supabase.functions
    .invoke("push-circle-badge", { body: { circle_ids: ids } })
    .then(({ error }) => {
      if (error) console.warn("Native push: push-circle-badge failed", error.message);
    })
    .catch((e) => {
      console.warn("Native push: push-circle-badge invoke error", e);
    });
}
