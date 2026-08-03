/**
 * Native push (iOS). Registers APNs token; after circle publish invokes
 * push-circle-badge (banner + badge). Unpublish syncs badge only (no alert).
 */
import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabase";

export const CIRCLE_PUSH_OPEN_EVENT = "cinematch-circle-push-open";

let listenersReady = false;
let lastToken = null;
let registerInFlight = null;

function isNativeIos() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

function emitCirclePushOpen(circleId) {
  const id = typeof circleId === "string" ? circleId.trim() : "";
  if (!id) return;
  try {
    window.dispatchEvent(new CustomEvent(CIRCLE_PUSH_OPEN_EVENT, { detail: { circleId: id } }));
  } catch {
    /* ignore */
  }
}

function circleIdFromNotificationData(data) {
  if (!data || typeof data !== "object") return "";
  const raw = data.circle_id ?? data.circleId;
  return typeof raw === "string" ? raw.trim() : "";
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
        await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          const id = circleIdFromNotificationData(action?.notification?.data);
          if (id) emitCirclePushOpen(id);
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
 * Fire-and-forget: APNs to other members of these circles.
 * @param {string[]} circleIds
 * @param {{ alert?: boolean }} [opts] `alert: false` = badge number only (e.g. unpublish).
 */
export function notifyCircleBadgePush(circleIds, opts = {}) {
  if (!Array.isArray(circleIds) || circleIds.length === 0) return;
  const ids = [...new Set(circleIds.map((x) => String(x || "").trim()).filter(Boolean))];
  if (ids.length === 0) return;
  const alert = opts.alert !== false;
  void supabase.functions
    .invoke("push-circle-badge", { body: { circle_ids: ids, alert } })
    .then(({ error }) => {
      if (error) console.warn("Native push: push-circle-badge failed", error.message);
    })
    .catch((e) => {
      console.warn("Native push: push-circle-badge invoke error", e);
    });
}
