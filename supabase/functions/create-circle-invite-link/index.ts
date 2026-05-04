import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EDGE_FUNCTION_SLUG = "create-circle-invite-link";
const EDGE_FUNCTION_VERSION = "1.0.0";

const CIRCLE_MEMBER_CAP = 25;
const INVITE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

function randomTokenHex(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !serviceKey) {
      console.error("create-circle-invite-link: missing env keys");
      return jsonResponse({ error: "Server misconfigured." }, 500);
    }

    const authed = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await authed.auth.getUser();
    if (userErr || !userRes?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const callerId = userRes.user.id;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const circleId = typeof body.circle_id === "string" ? body.circle_id.trim() : "";
    if (!circleId) return jsonResponse({ error: "circle_id is required." }, 400);

    const { data: circleRow, error: circleErr } = await admin
      .from("circles")
      .select("id, status")
      .eq("id", circleId)
      .maybeSingle();
    if (circleErr) {
      console.error("create-circle-invite-link: fetch circle failed", circleErr.message);
      return jsonResponse({ error: "Could not load circle." }, 500);
    }
    if (!circleRow) return jsonResponse({ error: "Circle not found." }, 404);
    if (circleRow.status !== "active") {
      return jsonResponse({ error: "This circle has been archived — new invites aren't allowed." }, 409);
    }

    const { data: callerMembership, error: callerMemErr } = await admin
      .from("circle_members")
      .select("role")
      .eq("circle_id", circleId)
      .eq("user_id", callerId)
      .maybeSingle();
    if (callerMemErr) {
      console.error("create-circle-invite-link: caller membership failed", callerMemErr.message);
      return jsonResponse({ error: "Could not verify your membership." }, 500);
    }
    const r = typeof callerMembership?.role === "string" ? callerMembership.role : "";
    if (r !== "admin" && r !== "creator") {
      return jsonResponse({ error: "Only a circle host can send invites." }, 403);
    }

    const { count: memberCount, error: memberCountErr } = await admin
      .from("circle_members")
      .select("user_id", { count: "exact", head: true })
      .eq("circle_id", circleId);
    if (memberCountErr) {
      console.error("create-circle-invite-link: member count failed", memberCountErr.message);
      return jsonResponse({ error: "Could not verify member count." }, 500);
    }
    if ((memberCount ?? 0) >= CIRCLE_MEMBER_CAP) {
      return jsonResponse(
        { error: `This circle is full (${CIRCLE_MEMBER_CAP}/${CIRCLE_MEMBER_CAP} members).` },
        409,
      );
    }

    const token = randomTokenHex(24);
    const expiresAt = new Date(Date.now() + INVITE_LINK_TTL_MS).toISOString();

    const { data: inserted, error: insertErr } = await admin
      .from("circle_invites")
      .insert({
        circle_id: circleId,
        invited_by: callerId,
        invited_user_id: null,
        invite_token: token,
        expires_at: expiresAt,
        status: "pending",
      })
      .select("id, circle_id, invite_token, expires_at, created_at")
      .maybeSingle();

    if (insertErr || !inserted) {
      console.error(
        "create-circle-invite-link: insert failed",
        insertErr?.message ?? "no row returned",
      );
      return jsonResponse({ error: "Could not create invite link." }, 500);
    }

    return jsonResponse({
      ok: true,
      invite: inserted,
      invite_token: token,
    });
  } catch (e) {
    console.error("create-circle-invite-link: unhandled", e);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
