import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// ------------------------------------------------------------------------------------------------
// Circles Phase B — send-circle-invite
// ------------------------------------------------------------------------------------------------
//
// Body: { circle_id: string, invited_email: string }
// Auth: caller's JWT — must be the creator of an active circle.
//
// Logic:
//   1. Resolve caller (user) via JWT.
//   2. Verify (creator + active) using service role.
//   3. Resolve invited_email -> profiles.id via service role (auth.users).
//      - No match -> 404 "no account found for that email".
//      - Match == caller -> 400 "you're already the creator".
//   4. Reject if recipient is already a member of the circle.
//   5. Reject if member cap would be breached (25/25).
//   6. If recipient is at the 10-active-circle cap, write the invite with status='auto_declined'
//      + responded_at=now() (spec §3.2).
//   7. Otherwise write with status='pending'.
//   8. Handles the circle_invites_unique_pending constraint by UPDATE-on-conflict: a prior row
//      in accepted/declined/auto_declined that needs resending is flipped back to 'pending'
//      (or 'auto_declined' if the cap path fires). An already-pending row is returned idempotently.
//
// Response on success: { ok: true, invite: <row>, recipient: { id, name }, status }
// Errors surface as { error: string } with a 4xx/5xx status.
// ------------------------------------------------------------------------------------------------

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Bump when this function’s behavior or deps change, then redeploy — verify via JSON `edge.version`. */
const EDGE_FUNCTION_SLUG = "send-circle-invite";
const EDGE_FUNCTION_VERSION = "1.0.1";

const CIRCLE_MEMBER_CAP = 25;
const CIRCLE_USER_ACTIVE_CAP = 10;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

type ResolveEmailResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "rpc_error"; message: string };

async function resolveEmailToUserId(admin: SupabaseClient, email: string): Promise<ResolveEmailResult> {
  const { data, error } = await admin.rpc("resolve_profile_id_by_email", { email_in: email });
  if (error) {
    console.warn("send-circle-invite: resolve_profile_id_by_email failed", error.message);
    return { ok: false, reason: "rpc_error", message: error.message };
  }
  if (typeof data === "string" && data.length > 0) return { ok: true, userId: data };
  return { ok: false, reason: "not_found" };
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
      console.error("send-circle-invite: missing SUPABASE_URL / ANON / SERVICE keys");
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
    const invitedEmailRaw = typeof body.invited_email === "string" ? body.invited_email : "";
    const invitedEmail = invitedEmailRaw.trim();

    if (!circleId) return jsonResponse({ error: "circle_id is required." }, 400);
    if (!invitedEmail) return jsonResponse({ error: "Enter an email address." }, 400);
    if (!EMAIL_REGEX.test(invitedEmail)) {
      return jsonResponse({ error: "That doesn't look like a valid email address." }, 400);
    }

    // --- 1. Verify circle exists, is active, and caller is creator. -----------------------------
    const { data: circleRow, error: circleErr } = await admin
      .from("circles")
      .select("id, name, vibe, status, creator_id")
      .eq("id", circleId)
      .maybeSingle();
    if (circleErr) {
      console.error("send-circle-invite: fetch circle failed", circleErr.message);
      return jsonResponse({ error: "Could not load circle." }, 500);
    }
    if (!circleRow) return jsonResponse({ error: "Circle not found." }, 404);

    const { data: callerMembership, error: callerMemErr } = await admin
      .from("circle_members")
      .select("role")
      .eq("circle_id", circleId)
      .eq("user_id", callerId)
      .maybeSingle();
    if (callerMemErr) {
      console.error("send-circle-invite: caller membership failed", callerMemErr.message);
      return jsonResponse({ error: "Could not verify your membership." }, 500);
    }
    const r = typeof callerMembership?.role === "string" ? callerMembership.role : "";
    if (r !== "creator" && r !== "admin") {
      return jsonResponse({ error: "Only a circle host can send invites." }, 403);
    }
    if (circleRow.status !== "active") {
      return jsonResponse({ error: "This circle has been archived — new invites aren't allowed." }, 409);
    }

    // --- 2. Resolve recipient email -> user id. -------------------------------------------------
    const resolved = await resolveEmailToUserId(admin, invitedEmail);
    if (!resolved.ok && resolved.reason === "rpc_error") {
      return jsonResponse(
        {
          error:
            "Could not look up that email. If this keeps happening, run the latest Circles SQL migration (grant execute on resolve_profile_id_by_email) and redeploy.",
        },
        500,
      );
    }
    if (!resolved.ok) {
      return jsonResponse(
        { error: "No Cinemastro account found for that email. Ask them to sign up first." },
        404,
      );
    }
    const invitedUserId = resolved.userId;
    if (invitedUserId === callerId) {
      return jsonResponse({ error: "You can't invite yourself." }, 400);
    }

    // --- 3. Already a member? -------------------------------------------------------------------
    const { count: existingMemberCount, error: existingMemberErr } = await admin
      .from("circle_members")
      .select("user_id", { count: "exact", head: true })
      .eq("circle_id", circleId)
      .eq("user_id", invitedUserId);
    if (existingMemberErr) {
      console.error("send-circle-invite: member check failed", existingMemberErr.message);
      return jsonResponse({ error: "Could not verify membership." }, 500);
    }
    if ((existingMemberCount ?? 0) > 0) {
      return jsonResponse({ error: "That person is already in this circle." }, 409);
    }

    // --- 4. Member cap (25). --------------------------------------------------------------------
    const { count: memberCount, error: memberCountErr } = await admin
      .from("circle_members")
      .select("user_id", { count: "exact", head: true })
      .eq("circle_id", circleId);
    if (memberCountErr) {
      console.error("send-circle-invite: member count failed", memberCountErr.message);
      return jsonResponse({ error: "Could not verify member count." }, 500);
    }
    if ((memberCount ?? 0) >= CIRCLE_MEMBER_CAP) {
      return jsonResponse(
        { error: `This circle is full (${CIRCLE_MEMBER_CAP}/${CIRCLE_MEMBER_CAP} members).` },
        409,
      );
    }

    // --- 5. Recipient's active-circle cap (auto_declined path, spec §3.2). ----------------------
    const { data: recipientMemberships, error: recipientMembershipsErr } = await admin
      .from("circle_members")
      .select("circle_id, circles!inner ( status )")
      .eq("user_id", invitedUserId);
    if (recipientMembershipsErr) {
      console.error(
        "send-circle-invite: recipient memberships failed",
        recipientMembershipsErr.message,
      );
      return jsonResponse({ error: "Could not verify recipient's circle count." }, 500);
    }
    const activeCount = (recipientMemberships ?? []).reduce((n, row) => {
      const c = row.circles as { status?: string } | { status?: string }[] | null;
      const status = Array.isArray(c) ? c[0]?.status : c?.status;
      return status === "active" ? n + 1 : n;
    }, 0);
    const autoDecline = activeCount >= CIRCLE_USER_ACTIVE_CAP;

    // --- 6. Lookup recipient display name (nice-to-have for the sender's toast). ----------------
    const { data: recipientProfile } = await admin
      .from("profiles")
      .select("id, name")
      .eq("id", invitedUserId)
      .maybeSingle();

    // --- 7. Upsert the invite. Handles the circle_invites_unique_pending constraint by flipping
    //       any prior terminal row back to pending (or auto_declined). ---------------------------
    const nowIso = new Date().toISOString();
    const desiredStatus = autoDecline ? "auto_declined" : "pending";

    const { data: priorInvite, error: priorInviteErr } = await admin
      .from("circle_invites")
      .select("id, status")
      .eq("circle_id", circleId)
      .eq("invited_user_id", invitedUserId)
      .maybeSingle();
    if (priorInviteErr) {
      console.error("send-circle-invite: prior invite lookup failed", priorInviteErr.message);
      return jsonResponse({ error: "Could not check existing invite." }, 500);
    }

    let inviteRow: Record<string, unknown> | null = null;

    if (priorInvite) {
      // Idempotent return for already-pending invites (don't bump created_at or responded_at).
      if (priorInvite.status === "pending" && !autoDecline) {
        const { data: refetched } = await admin
          .from("circle_invites")
          .select("id, circle_id, invited_by, invited_user_id, status, created_at, responded_at")
          .eq("id", priorInvite.id)
          .maybeSingle();
        inviteRow = refetched ?? { id: priorInvite.id, status: "pending" };
      } else {
        const update: Record<string, unknown> = {
          status: desiredStatus,
          invited_by: callerId,
          responded_at: autoDecline ? nowIso : null,
        };
        const { data: updated, error: updateErr } = await admin
          .from("circle_invites")
          .update(update)
          .eq("id", priorInvite.id)
          .select("id, circle_id, invited_by, invited_user_id, status, created_at, responded_at")
          .maybeSingle();
        if (updateErr || !updated) {
          console.error(
            "send-circle-invite: update existing invite failed",
            updateErr?.message ?? "no row returned",
          );
          return jsonResponse({ error: "Could not update invite." }, 500);
        }
        inviteRow = updated;
      }
    } else {
      const insertPayload: Record<string, unknown> = {
        circle_id: circleId,
        invited_by: callerId,
        invited_user_id: invitedUserId,
        status: desiredStatus,
      };
      if (autoDecline) insertPayload.responded_at = nowIso;

      const { data: inserted, error: insertErr } = await admin
        .from("circle_invites")
        .insert(insertPayload)
        .select("id, circle_id, invited_by, invited_user_id, status, created_at, responded_at")
        .maybeSingle();
      if (insertErr || !inserted) {
        console.error(
          "send-circle-invite: insert invite failed",
          insertErr?.message ?? "no row returned",
        );
        return jsonResponse({ error: "Could not create invite." }, 500);
      }
      inviteRow = inserted;
    }

    return jsonResponse({
      ok: true,
      status: desiredStatus,
      auto_declined: autoDecline,
      invite: inviteRow,
      recipient: {
        id: invitedUserId,
        name: recipientProfile?.name ?? null,
      },
      circle: {
        id: circleRow.id,
        name: circleRow.name,
        vibe: circleRow.vibe,
      },
    });
  } catch (e) {
    console.error("send-circle-invite: unhandled", e);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
