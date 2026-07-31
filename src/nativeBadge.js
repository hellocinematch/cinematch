/**
 * Native home-screen icon badge (Capacitor). No-op on web.
 * Count = sum of circle unseen-others (same RPC as Circles list bells).
 */
import { Capacitor } from "@capacitor/core";

let permissionRequested = false;

function isNative() {
  return Capacitor.isNativePlatform();
}

async function ensureBadgePermission() {
  if (!isNative() || permissionRequested) return;
  permissionRequested = true;
  try {
    const { Badge } = await import("@capawesome/capacitor-badge");
    const current = await Badge.checkPermissions();
    if (current?.display === "granted") return;
    await Badge.requestPermissions();
  } catch (e) {
    console.warn("Native badge: permission check failed", e);
  }
}

/** @param {number} count */
export async function syncAppIconBadgeCount(count) {
  if (!isNative()) return;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  try {
    await ensureBadgePermission();
    const { Badge } = await import("@capawesome/capacitor-badge");
    if (n <= 0) {
      await Badge.clear();
    } else {
      await Badge.set({ count: n });
    }
  } catch (e) {
    console.warn("Native badge: set failed", e);
  }
}

export async function clearAppIconBadge() {
  if (!isNative()) return;
  try {
    const { Badge } = await import("@capawesome/capacitor-badge");
    await Badge.clear();
  } catch (e) {
    console.warn("Native badge: clear failed", e);
  }
}

/** Sum unseenOthers across fetchMyCircleUnseenActivity rows (or circleUnseenById map values). */
export function sumCircleUnseenOthers(rowsOrMap) {
  if (!rowsOrMap) return 0;
  if (Array.isArray(rowsOrMap)) {
    return rowsOrMap.reduce((acc, r) => acc + (Math.max(0, Number(r?.unseenOthers) || 0)), 0);
  }
  let total = 0;
  for (const v of Object.values(rowsOrMap)) {
    total += Math.max(0, Number(v?.unseenOthers) || 0);
  }
  return total;
}
