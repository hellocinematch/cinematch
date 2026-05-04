import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EDGE_FUNCTION_SLUG = "claim-circle-invite-token";
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
      console.error("claim-circle-invite-token: missing env keys");
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

    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || token.length > 128) {
      return jsonResponse({ error: "Invalid invite." }, 400);
    }

    const { data: inv, error: invErr } = await admin
      .from("circle_invites")
      .select("id, circle_id, status, expires_at, invite_token, invited_user_id, invited_by")
      .eq("invite_token", token)
      .maybeSingle();

    if (invErr) {
      console.error("claim-circle-invite-token: load failed", invErr.message);
      return jsonResponse({ error: "Could not load invite." }, 500);
    }
    if (!inv || !inv.invite_token) {
      return jsonResponse({ error: "This invite is no longer valid." }, 404);
    }

    const nowIso = new Date().toISOString();
    const now = Date.now();
    const exp = inv.expires_at ? new Date(String(inv.expires_at)).getTime() : NaN;
    if (Number.isFinite(exp) && exp < now) {
      return jsonResponse({ error: "This invite has expired — ask your friend to send a new one." }, 410);
    }

    const st = typeof inv.status === "string" ? inv.status : "";
    if (st === "revoked") {
      return jsonResponse({ error: "This invite is no longer valid." }, 410);
    }
    if (st !== "pending") {
      return jsonResponse({ error: "This invite is no longer valid." }, 410);
    }

    const circleId = typeof inv.circle_id === "string" ? inv.circle_id : "";
    const inviteId = typeof inv.id === "string" ? inv.id : "";

    const { data: circle, error: circleErr } = await admin
      .from("circles")
      .select("id, name, status")
      .eq("id", circleId)
      .maybeSingle();
    if (circleErr || !circle) {
      return jsonResponse({ error: "This invite is no longer valid." }, 410);
    }
    if (circle.status !== "active") {
      return jsonResponse({ error: "This invite is no longer valid." }, 410);
    }

    const invitedUserId = typeof inv.invited_user_id === "string" ? inv.invited_user_id : null;
    if (invitedUserId && invitedUserId !== callerId) {
      return jsonResponse({
        error: "This invite link was already used by someone else.",
      }, 409);
    }

    const { count: memberCount, error: memberErr } = await admin
      .from("circle_members")
      .select("user_id", { count: "exact", head: true })
      .eq("circle_id", circleId)
      .eq("user_id", callerId);
    if (memberErr) {
      console.error("claim-circle-invite-token: member check failed", memberErr.message);
      return jsonResponse({ error: "Could not verify membership." }, 500);
    }
    if ((memberCount ?? 0) > 0) {
      const { data: inviterProf } = await admin
        .from("profiles")
        .select("name")
        .eq("id", inv.invited_by)
        .maybeSingle();
      const inviterName = typeof inviterProf?.name === "string" && inviterProf.name.trim()
        ? inviterProf.name.trim()
        : "Someone";
      return jsonResponse({
        ok: true,
        already_member: true,
        circle_id: circleId,
        circle_name: typeof circle.name === "string" ? circle.name : "This circle",
        inviter_name: inviterName,
      });
    }

    if (invitedUserId === callerId) {
      const { data: inviterProf } = await admin
        .from("profiles")
        .select("name")
        .eq("id", inv.invited_by)
        .maybeSingle();
      const inviterName = typeof inviterProf?.name === "string" && inviterProf.name.trim()
        ? inviterProf.name.trim()
        : "Someone";
      return jsonResponse({
        ok: true,
        invite_id: inviteId,
        circle_id: circleId,
        circle_name: typeof circle.name === "string" ? circle.name : "This circle",
        inviter_name: inviterName,
        claimed: true,
      });
    }

    const { data: existingPending, error: existingErr } = await admin
      .from("circle_invites")
      .select("id")
      .eq("circle_id", circleId)
      .eq("invited_user_id", callerId)
      .eq("status", "pending")
      .maybeSingle();
    if (existingErr) {
      console.error("claim-circle-invite-token: existing pending failed", existingErr.message);
      return jsonResponse({ error: "Could not verify invites." }, 500);
    }
    if (existingPending && typeof existingPending.id === "string" && existingPending.id !== inviteId) {
      await admin
        .from("circle_invites")
        .update({ status: "revoked", responded_at: nowIso })
        .eq("id", inviteId);
      const { data: inviterProf } = await admin
        .from("profiles")
        .select("name")
        .eq("id", inv.invited_by)
        .maybeSingle();
      const inviterName = typeof inviterProf?.name === "string" && inviterProf.name.trim()
        ? inviterProf.name.trim()
        : "Someone";
      const { data: c2 } = await admin.from("circles").select("name").eq("id", circleId).maybeSingle();
      return jsonResponse({
        ok: true,
        invite_id: existingPending.id,
        superseded: true,
        circle_id: circleId,
        circle_name: typeof c2?.name === "string" ? c2.name : "This circle",
        inviter_name: inviterName,
      });
    }

    const { data: authUser, error: authLookupErr } = await admin.auth.admin.getUserById(callerId);
    if (authLookupErr) {
      console.warn("claim-circle-invite-token: getUserById", authLookupErr.message);
    }
    const email =
      typeof authUser?.user?.email === "string" && authUser.user.email.trim()
        ? authUser.user.email.trim().toLowerCase()
        : null;

    const { data: updated, error: updErr } = await admin
      .from("circle_invites")
      .update({
        invited_user_id: callerId,
        invite_email: email,
      })
      .eq("id", inviteId)
      .is("invited_user_id", null)
      .select("id")
      .maybeSingle();

    if (updErr || !updated) {
      const { data: again } = await admin
        .from("circle_invites")
        .select("invited_user_id")
        .eq("id", inviteId)
        .maybeSingle();
      const uid = typeof again?.invited_user_id === "string" ? again.invited_user_id : null;
      if (uid && uid !== callerId) {
        return jsonResponse({
          error: "This invite link was already used by someone else.",
        }, 409);
      }
      console.error("claim-circle-invite-token: claim update failed", updErr?.message ?? "no row");
      return jsonResponse({ error: "Could not claim this invite. Try again." }, 409);
    }

    const { data: inviterProf } = await admin
      .from("profiles")
      .select("name")
      .eq("id", inv.invited_by)
      .maybeSingle();
    const inviterName = typeof inviterProf?.name === "string" && inviterProf.name.trim()
      ? inviterProf.name.trim()
      : "Someone";

    return jsonResponse({
      ok: true,
      invite_id: inviteId,
      circle_id: circleId,
      circle_name: typeof circle.name === "string" ? circle.name : "This circle",
      inviter_name: inviterName,
      claimed: true,
    });
  } catch (e) {
    console.error("claim-circle-invite-token: unhandled", e);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
