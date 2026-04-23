import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ------------------------------------------------------------------------------------------------
// Circles Phase B — accept-circle-invite
// ------------------------------------------------------------------------------------------------
//
// Body: { invite_id: string }
// Auth: caller's JWT. Must equal circle_invites.invited_user_id for a pending invite.
//
// Checks (all return a friendly error without mutating the invite unless noted):
//   * Invite exists, belongs to caller, and is currently 'pending'.
//   * Circle still exists and is 'active' — if archived, decline the invite
//     (status='declined', responded_at=now()) and return an error. Stale cleanup.
//   * Caller is not already a member (idempotent defensive check; leave invite pending).
//   * Caller is below the 10-active-circle cap. If at cap, error and LEAVE pending
//     (spec §3.3 + Phase A confirmation — accept-time cap race does not auto-decline).
//   * Circle is below the 25-member cap. If full, error and LEAVE pending (sender can retry).
//
// On success, insert the member row first (as service role to bypass RLS), then flip the invite
// to 'accepted'. Order matters: if the member insert fails we never mark the invite accepted.
//
// Response: { ok: true, circle: <full row with members[]>, role: 'member' }
// ------------------------------------------------------------------------------------------------

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Bump when this function’s behavior or deps change, then redeploy — verify via JSON `edge.version`. */
const EDGE_FUNCTION_SLUG = "accept-circle-invite";
const EDGE_FUNCTION_VERSION = "1.0.0";

const CIRCLE_MEMBER_CAP = 25;
const CIRCLE_USER_ACTIVE_CAP = 10;

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
      console.error("accept-circle-invite: missing env keys");
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

    const inviteId = typeof body.invite_id === "string" ? body.invite_id.trim() : "";
    if (!inviteId) return jsonResponse({ error: "invite_id is required." }, 400);

    // --- 1. Load invite. ------------------------------------------------------------------------
    const { data: invite, error: inviteErr } = await admin
      .from("circle_invites")
      .select("id, circle_id, invited_by, invited_user_id, status, created_at, responded_at")
      .eq("id", inviteId)
      .maybeSingle();
    if (inviteErr) {
      console.error("accept-circle-invite: load invite failed", inviteErr.message);
      return jsonResponse({ error: "Could not load invite." }, 500);
    }
    if (!invite) return jsonResponse({ error: "That invite is no longer available." }, 404);
    if (invite.invited_user_id !== callerId) {
      return jsonResponse({ error: "This invite isn't for you." }, 403);
    }
    if (invite.status !== "pending") {
      return jsonResponse({ error: "This invite has already been responded to." }, 409);
    }

    // --- 2. Load circle. ------------------------------------------------------------------------
    const { data: circle, error: circleErr } = await admin
      .from("circles")
      .select("id, name, description, vibe, status, archived_at, created_at, creator_id")
      .eq("id", invite.circle_id)
      .maybeSingle();
    if (circleErr) {
      console.error("accept-circle-invite: load circle failed", circleErr.message);
      return jsonResponse({ error: "Could not load circle." }, 500);
    }
    if (!circle) {
      return jsonResponse({ error: "That circle no longer exists." }, 404);
    }
    if (circle.status !== "active") {
      // Stale invite cleanup: mark declined so it stops showing in the bell.
      await admin
        .from("circle_invites")
        .update({ status: "declined", responded_at: new Date().toISOString() })
        .eq("id", invite.id);
      return jsonResponse({ error: "That circle has been archived." }, 409);
    }

    // --- 3. Already a member? (idempotent; leave invite pending so a retry is a no-op.) ---------
    const { count: existingMemberCount, error: existingMemberErr } = await admin
      .from("circle_members")
      .select("user_id", { count: "exact", head: true })
      .eq("circle_id", circle.id)
      .eq("user_id", callerId);
    if (existingMemberErr) {
      console.error("accept-circle-invite: member check failed", existingMemberErr.message);
      return jsonResponse({ error: "Could not verify membership." }, 500);
    }
    if ((existingMemberCount ?? 0) > 0) {
      // Clean the invite quietly, then surface the circle row to the client.
      await admin
        .from("circle_invites")
        .update({ status: "accepted", responded_at: new Date().toISOString() })
        .eq("id", invite.id);
      const fresh = await fetchCircleWithMembers(admin, circle.id);
      return jsonResponse({ ok: true, circle: fresh, role: "member", already_member: true });
    }

    // --- 4. Accept-time user-cap race. Error + LEAVE pending. -----------------------------------
    const { data: myMemberships, error: myMembershipsErr } = await admin
      .from("circle_members")
      .select("circle_id, circles!inner ( status )")
      .eq("user_id", callerId);
    if (myMembershipsErr) {
      console.error(
        "accept-circle-invite: caller memberships failed",
        myMembershipsErr.message,
      );
      return jsonResponse({ error: "Could not verify your circle count." }, 500);
    }
    const activeCount = (myMemberships ?? []).reduce((n, row) => {
      const c = row.circles as { status?: string } | { status?: string }[] | null;
      const status = Array.isArray(c) ? c[0]?.status : c?.status;
      return status === "active" ? n + 1 : n;
    }, 0);
    if (activeCount >= CIRCLE_USER_ACTIVE_CAP) {
      return jsonResponse(
        {
          error:
            `You've reached your ${CIRCLE_USER_ACTIVE_CAP}-circle limit. Leave a circle to join this one.`,
          cap_reached: true,
        },
        409,
      );
    }

    // --- 5. Circle member cap race. Error + LEAVE pending. --------------------------------------
    const { count: memberCount, error: memberCountErr } = await admin
      .from("circle_members")
      .select("user_id", { count: "exact", head: true })
      .eq("circle_id", circle.id);
    if (memberCountErr) {
      console.error("accept-circle-invite: member count failed", memberCountErr.message);
      return jsonResponse({ error: "Could not verify member count." }, 500);
    }
    if ((memberCount ?? 0) >= CIRCLE_MEMBER_CAP) {
      return jsonResponse({ error: "That circle is now full." }, 409);
    }

    // --- 6. Insert member row, then flip invite accepted. ---------------------------------------
    const { error: insertErr } = await admin.from("circle_members").insert({
      circle_id: circle.id,
      user_id: callerId,
      role: "member",
    });
    if (insertErr) {
      // Unique-violation race: another concurrent accept already inserted; treat as success.
      const duplicate = String(insertErr.code ?? "") === "23505";
      if (!duplicate) {
        console.error("accept-circle-invite: member insert failed", insertErr.message);
        return jsonResponse({ error: "Could not join the circle." }, 500);
      }
    }

    const { error: acceptErr } = await admin
      .from("circle_invites")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("id", invite.id);
    if (acceptErr) {
      console.warn(
        "accept-circle-invite: member inserted but invite flip failed",
        acceptErr.message,
      );
      // Don't fail the whole request — membership is the source of truth.
    }

    const fresh = await fetchCircleWithMembers(admin, circle.id);
    return jsonResponse({ ok: true, circle: fresh, role: "member" });
  } catch (e) {
    console.error("accept-circle-invite: unhandled", e);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});

async function fetchCircleWithMembers(
  admin: ReturnType<typeof createClient>,
  circleId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from("circles")
    .select(`
      id,
      name,
      description,
      vibe,
      status,
      archived_at,
      created_at,
      creator_id,
      circle_members ( user_id, role, joined_at )
    `)
    .eq("id", circleId)
    .maybeSingle();
  if (error) {
    console.warn("accept-circle-invite: fetchCircleWithMembers failed", error.message);
    return null;
  }
  return (data as Record<string, unknown> | null) ?? null;
}
