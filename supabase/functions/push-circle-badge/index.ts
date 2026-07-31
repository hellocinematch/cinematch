import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as jose from "npm:jose@5";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EDGE_FUNCTION_SLUG = "push-circle-badge";
const EDGE_FUNCTION_VERSION = "1.0.0";

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

let cachedJwt: { token: string; expMs: number } | null = null;

async function getApnsJwt(cfg: ApnsConfig): Promise<string> {
  const now = Date.now();
  if (cachedJwt && cachedJwt.expMs > now + 60_000) return cachedJwt.token;
  const key = await jose.importPKCS8(cfg.privateKey, "ES256");
  const token = await new jose.SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setIssuedAt()
    .setExpirationTime("50m")
    .sign(key);
  cachedJwt = { token, expMs: now + 50 * 60 * 1000 };
  return token;
}

async function sendApnsBadge(
  cfg: ApnsConfig,
  deviceToken: string,
  badge: number,
): Promise<{ ok: boolean; status: number; body: string }> {
  const jwt = await getApnsJwt(cfg);
  const url = `https://${cfg.host}/3/device/${deviceToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({ aps: { badge: Math.max(0, Math.floor(badge)) } }),
  });
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

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Caller must be a member of every listed circle.
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

    const { data: tokens, error: tokErr } = await admin
      .from("device_push_tokens")
      .select("user_id, token, platform")
      .in("user_id", recipientIds)
      .eq("platform", "ios");
    if (tokErr) {
      console.error("push-circle-badge: tokens", tokErr.message);
      return jsonResponse({ error: "Could not load device tokens." }, 500);
    }

    const tokensByUser = new Map<string, string[]>();
    for (const row of tokens || []) {
      const uid = String(row.user_id || "");
      const token = String(row.token || "").trim();
      if (!uid || !token) continue;
      const list = tokensByUser.get(uid) || [];
      list.push(token);
      tokensByUser.set(uid, list);
    }

    const apns = readApnsConfig();
    if (!apns) {
      console.warn("push-circle-badge: APNs secrets not configured; skipping send");
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "apns_not_configured",
        recipients: recipientIds.length,
        devices: [...tokensByUser.values()].reduce((n, t) => n + t.length, 0),
      });
    }

    let pushed = 0;
    let failed = 0;
    const staleTokens: string[] = [];

    for (const uid of recipientIds) {
      const deviceTokens = tokensByUser.get(uid);
      if (!deviceTokens?.length) continue;

      const { data: totalRaw, error: totalErr } = await admin.rpc(
        "get_user_circle_unseen_total",
        { p_user_id: uid },
      );
      if (totalErr) {
        console.warn("push-circle-badge: unseen total failed", uid, totalErr.message);
        continue;
      }
      const badge = Math.max(0, Math.floor(Number(totalRaw) || 0));

      for (const deviceToken of deviceTokens) {
        try {
          const result = await sendApnsBadge(apns, deviceToken, badge);
          if (result.ok) {
            pushed += 1;
          } else {
            failed += 1;
            console.warn("push-circle-badge: APNs fail", result.status, result.body);
            // Gone / BadDeviceToken → drop token
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
    });
  } catch (e) {
    console.error("push-circle-badge: unhandled", e);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
