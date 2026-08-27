import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as jose from "npm:jose@5";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EDGE_FUNCTION_SLUG = "push-circle-badge";
const EDGE_FUNCTION_VERSION = "1.2.0";

function jsonResponse(body: unknown, status = 200): Response {
  const payload =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? {
        ...(body as Record<string, unknown>),
        edge: { name: EDGE_FUNCTION_SLUG, version: EDGE_FUNCTION_VERSION },
      }
      : body;
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ApnsConfig = {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  host: string;
};

function readApnsConfig(): ApnsConfig | null {
  const teamId = (Deno.env.get("APNS_TEAM_ID") || "").trim();
  const keyId = (Deno.env.get("APNS_KEY_ID") || "").trim();
  const privateKeyRaw = Deno.env.get("APNS_PRIVATE_KEY") || "";
  const bundleId = (Deno.env.get("APNS_BUNDLE_ID") || "com.cinemastro.app").trim();
  const useSandbox = (Deno.env.get("APNS_USE_SANDBOX") || "").trim().toLowerCase() === "true";
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n").trim();
  if (!teamId || !keyId || !privateKey) return null;
  return {
    teamId,
    keyId,
    privateKey,
    bundleId,
    host: useSandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com",
  };
}

let cachedApnsJwt: { token: string; expMs: number } | null = null;

async function getApnsJwt(cfg: ApnsConfig): Promise<string> {
  const now = Date.now();
  if (cachedApnsJwt && cachedApnsJwt.expMs > now + 60_000) return cachedApnsJwt.token;
  const key = await jose.importPKCS8(cfg.privateKey, "ES256");
  const token = await new jose.SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setIssuedAt()
    .setExpirationTime("50m")
    .sign(key);
  cachedApnsJwt = { token, expMs: now + 50 * 60 * 1000 };
  return token;
}

type FcmConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function readFcmConfig(): FcmConfig | null {
  const jsonRaw = (Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") || "").trim();
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      const projectId = String(parsed.project_id || "").trim();
      const clientEmail = String(parsed.client_email || "").trim();
      const privateKey = String(parsed.private_key || "").replace(/\\n/g, "\n").trim();
      if (projectId && clientEmail && privateKey) {
        return { projectId, clientEmail, privateKey };
      }
    } catch {
      console.warn("push-circle-badge: FCM_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  }
  const projectId = (Deno.env.get("FCM_PROJECT_ID") || "").trim();
  const clientEmail = (Deno.env.get("FCM_CLIENT_EMAIL") || "").trim();
  const privateKey = (Deno.env.get("FCM_PRIVATE_KEY") || "").replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

let cachedFcmAccess: { token: string; expMs: number } | null = null;

async function getFcmAccessToken(cfg: FcmConfig): Promise<string> {
  const now = Date.now();
  if (cachedFcmAccess && cachedFcmAccess.expMs > now + 60_000) return cachedFcmAccess.token;
  const key = await jose.importPKCS8(cfg.privateKey, "RS256");
  const assertion = await new jose.SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(cfg.clientEmail)
    .setSubject(cfg.clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.json() as { access_token?: string; expires_in?: number; error?: string };
  const access = String(body.access_token || "").trim();
  if (!res.ok || !access) {
    throw new Error(`FCM OAuth failed ${res.status} ${body.error || JSON.stringify(body)}`);
  }
  const ttlSec = Math.max(60, Number(body.expires_in) || 3600);
  cachedFcmAccess = { token: access, expMs: now + (ttlSec - 60) * 1000 };
  return access;
}

type PushPayload = {
  badge: number;
  withAlert: boolean;
  title?: string;
  body?: string;
  circleId?: string | null;
};

async function sendApnsPush(
  cfg: ApnsConfig,
  deviceToken: string,
  payload: PushPayload,
): Promise<{ ok: boolean; status: number; body: string }> {
  const jwt = await getApnsJwt(cfg);
  const url = `https://${cfg.host}/3/device/${deviceToken}`;
  const badge = Math.max(0, Math.floor(payload.badge));
  const aps: Record<string, unknown> = { badge };
  if (payload.withAlert) {
    aps.alert = {
      title: (payload.title || "Cinemastro").slice(0, 80),
      body: (payload.body || "Someone shared a rating in your circle.").slice(0, 160),
    };
    aps.sound = "default";
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps,
      type: "circle_activity",
      circle_id: payload.circleId || null,
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

function fcmTokenLooksStale(status: number, body: string): boolean {
  if (status === 404) return true;
  if (/UNREGISTERED|NOT_FOUND/i.test(body)) return true;
  if (status === 400 && /not a valid FCM registration token/i.test(body)) return true;
  return false;
}

async function sendFcmPush(
  cfg: FcmConfig,
  deviceToken: string,
  payload: PushPayload,
): Promise<{ ok: boolean; status: number; body: string }> {
  const access = await getFcmAccessToken(cfg);
  const title = (payload.title || "Cinemastro").slice(0, 80);
  const alertBody = (payload.body || "Someone shared a rating in your circle.").slice(0, 160);
  const message: Record<string, unknown> = {
    token: deviceToken,
    data: {
      type: "circle_activity",
      circle_id: payload.circleId ? String(payload.circleId) : "",
    },
    android: { priority: "HIGH" },
  };
  if (payload.withAlert) {
    message.notification = { title, body: alertBody };
    message.android = {
      priority: "HIGH",
      notification: { sound: "default" },
    };
  }
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message }),
    },
  );
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error("push-circle-badge: missing env keys");
      return jsonResponse({ error: "Server misconfigured." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await authed.auth.getUser();
    const callerId = userRes?.user?.id;
    if (userErr || !callerId) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const rawIds = Array.isArray(body.circle_ids) ? body.circle_ids : [];
    const circleIds = [...new Set(
      rawIds
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter((x) => x.length > 0),
    )];
    if (circleIds.length === 0) {
      return jsonResponse({ ok: true, skipped: true, reason: "no_circles" });
    }
    if (circleIds.length > 20) {
      return jsonResponse({ error: "Too many circles." }, 400);
    }

    // Publish → banner; unpublish / badge sync → iOS badge number only (no Android).
    const withAlert = body.alert !== false;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: memberships, error: memErr } = await admin
      .from("circle_members")
      .select("circle_id")
      .eq("user_id", callerId)
      .in("circle_id", circleIds);
    if (memErr) {
      console.error("push-circle-badge: memberships", memErr.message);
      return jsonResponse({ error: "Could not verify membership." }, 500);
    }
    const memberSet = new Set((memberships || []).map((r) => String(r.circle_id)));
    for (const id of circleIds) {
      if (!memberSet.has(id)) {
        return jsonResponse({ error: "Not a member of one or more circles." }, 403);
      }
    }

    const { data: otherMembers, error: othersErr } = await admin
      .from("circle_members")
      .select("user_id, circle_id")
      .in("circle_id", circleIds)
      .neq("user_id", callerId);
    if (othersErr) {
      console.error("push-circle-badge: other members", othersErr.message);
      return jsonResponse({ error: "Could not load members." }, 500);
    }

    const recipientIds = [...new Set(
      (otherMembers || [])
        .map((r) => String(r.user_id || ""))
        .filter(Boolean),
    )];
    if (recipientIds.length === 0) {
      return jsonResponse({ ok: true, recipients: 0, pushed: 0 });
    }

    const circlesByUser = new Map<string, string[]>();
    for (const row of otherMembers || []) {
      const uid = String(row.user_id || "");
      const cid = String(row.circle_id || "");
      if (!uid || !cid) continue;
      const list = circlesByUser.get(uid) || [];
      if (!list.includes(cid)) list.push(cid);
      circlesByUser.set(uid, list);
    }

    const nameByCircle = new Map<string, string>();
    if (withAlert) {
      const { data: circleRows, error: nameErr } = await admin
        .from("circles")
        .select("id, name")
        .in("id", circleIds);
      if (nameErr) {
        console.warn("push-circle-badge: circle names", nameErr.message);
      } else {
        for (const row of circleRows || []) {
          const id = String(row.id || "");
          const name = typeof row.name === "string" ? row.name.trim() : "";
          if (id && name) nameByCircle.set(id, name);
        }
      }
    }

    const { data: tokens, error: tokErr } = await admin
      .from("device_push_tokens")
      .select("user_id, token, platform")
      .in("user_id", recipientIds);
    if (tokErr) {
      console.error("push-circle-badge: tokens", tokErr.message);
      return jsonResponse({ error: "Could not load device tokens." }, 500);
    }

    const iosByUser = new Map<string, string[]>();
    const androidByUser = new Map<string, string[]>();
    for (const row of tokens || []) {
      const uid = String(row.user_id || "");
      const token = String(row.token || "").trim();
      const platform = String(row.platform || "").trim().toLowerCase();
      if (!uid || !token) continue;
      const bucket = platform === "android" ? androidByUser : platform === "ios" ? iosByUser : null;
      if (!bucket) continue;
      const list = bucket.get(uid) || [];
      list.push(token);
      bucket.set(uid, list);
    }

    const apns = readApnsConfig();
    const fcm = readFcmConfig();
    if (!apns && !fcm) {
      console.warn("push-circle-badge: APNs and FCM secrets not configured; skipping send");
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "push_not_configured",
        recipients: recipientIds.length,
      });
    }
    if (!apns) {
      console.warn("push-circle-badge: APNs secrets not configured; iOS tokens skipped");
    }
    if (!fcm) {
      console.warn("push-circle-badge: FCM secrets not configured; Android tokens skipped");
    }

    let pushed = 0;
    let failed = 0;
    const staleTokens: string[] = [];

    for (const uid of recipientIds) {
      const iosTokens = iosByUser.get(uid) || [];
      const androidTokens = androidByUser.get(uid) || [];
      const sendIos = Boolean(apns && iosTokens.length);
      const sendAndroid = Boolean(fcm && withAlert && androidTokens.length);
      if (!sendIos && !sendAndroid) continue;

      const { data: totalRaw, error: totalErr } = await admin.rpc(
        "get_user_circle_unseen_total",
        { p_user_id: uid },
      );
      if (totalErr) {
        console.warn("push-circle-badge: unseen total failed", uid, totalErr.message);
        continue;
      }
      const badge = Math.max(0, Math.floor(Number(totalRaw) || 0));

      const userCircleIds = circlesByUser.get(uid) || [];
      const primaryCircleId = userCircleIds[0] || null;
      let title = "Cinemastro";
      let alertBody = "Someone shared a rating in your circle.";
      if (withAlert) {
        if (userCircleIds.length === 1) {
          const n = nameByCircle.get(userCircleIds[0]);
          if (n) title = n;
          alertBody = "Someone shared a rating.";
        } else if (userCircleIds.length > 1) {
          title = "Cinemastro";
          alertBody = "Someone shared a rating in your circles.";
        }
      }

      const payload: PushPayload = {
        badge,
        withAlert,
        title,
        body: alertBody,
        circleId: primaryCircleId,
      };

      if (sendIos && apns) {
        for (const deviceToken of iosTokens) {
          try {
            const result = await sendApnsPush(apns, deviceToken, payload);
            if (result.ok) {
              pushed += 1;
            } else {
              failed += 1;
              console.warn("push-circle-badge: APNs fail", result.status, result.body);
              if (result.status === 410 || /BadDeviceToken|Unregistered/i.test(result.body)) {
                staleTokens.push(deviceToken);
              }
            }
          } catch (e) {
            failed += 1;
            console.warn("push-circle-badge: APNs error", e);
          }
        }
      }

      if (sendAndroid && fcm) {
        for (const deviceToken of androidTokens) {
          try {
            const result = await sendFcmPush(fcm, deviceToken, payload);
            if (result.ok) {
              pushed += 1;
            } else {
              failed += 1;
              console.warn("push-circle-badge: FCM fail", result.status, result.body);
              if (fcmTokenLooksStale(result.status, result.body)) {
                staleTokens.push(deviceToken);
              }
            }
          } catch (e) {
            failed += 1;
            console.warn("push-circle-badge: FCM error", e);
          }
        }
      }
    }

    if (staleTokens.length > 0) {
      const { error: delErr } = await admin
        .from("device_push_tokens")
        .delete()
        .in("token", staleTokens);
      if (delErr) {
        console.warn("push-circle-badge: stale token delete", delErr.message);
      }
    }

    return jsonResponse({
      ok: true,
      recipients: recipientIds.length,
      pushed,
      failed,
      stale_removed: staleTokens.length,
      alert: withAlert,
      edge_note: EDGE_FUNCTION_VERSION,
    });
  } catch (e) {
    console.error("push-circle-badge: unhandled", e);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
