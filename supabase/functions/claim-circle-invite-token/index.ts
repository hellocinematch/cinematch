import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EDGE_FUNCTION_SLUG = "claim-circle-invite-token";
const EDGE_FUNCTION_VERSION = "1.0.1";

const CIRCLE_MEMBER_CAP = 25;

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
      .select("id, circle_id, status, expires_at, invite_token, invited_user_id, invited_by, invite_email")
      .eq("invite_token", token)
      .maybeSingle();

    if (invErr) {
      console.error("claim-circle-invite-token: load failed", invErr.message);
      return jsonResponse({ error: "Could not load invite." }, 500);
    }
    if (!inv || !inv.invite_token) {
      return jsonResponse({ error: "This invite is no longer valid." }, 404);
    }

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

    const circleName = typeof circle.name === "string" ? circle.name : "This circle";
    const { count: memberTotal, error: memberTotalErr } = await admin
      .from("circle_members")
      .select("user_id", { count: "exact", head: true })
      .eq("circle_id", circleId);
    if (memberTotalErr) {
      console.error("claim-circle-invite-token: member count failed", memberTotalErr.message);
      return jsonResponse({ error: "Could not verify membership." }, 500);
    }
    if ((memberTotal ?? 0) >= CIRCLE_MEMBER_CAP) {
      return jsonResponse({ error: "This circle is full." }, 409);
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

    const { data: inviterProf } = await admin
      .from("profiles")
      .select("name")
      .eq("id", inv.invited_by)
      .maybeSingle();
    const inviterName = typeof inviterProf?.name === "string" && inviterProf.name.trim()
      ? inviterProf.name.trim()
      : "Someone";

    if ((memberCount ?? 0) > 0) {
      return jsonResponse({
        ok: true,
        already_member: true,
        circle_id: circleId,
        circle_name: circleName,
        inviter_name: inviterName,
      });
    }

    const lockedEmail = typeof inv.invite_email === "string"
      ? inv.invite_email.trim().toLowerCase()
      : "";

    async function callerEmail(): Promise<string | null> {
      const { data: authUser, error: authLookupErr } = await admin.auth.admin.getUserById(callerId);
      if (authLookupErr) {
        console.warn("claim-circle-invite-token: getUserById", authLookupErr.message);
      }
      const email = authUser?.user?.email;
      return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
    }

    async function openPersonalInvite(): Promise<string | null> {
      const loadRow = async () => {
        const { data, error } = await admin
          .from("circle_invites")
          .select("id, status")
          .eq("circle_id", circleId)
          .eq("invited_user_id", callerId)
          .maybeSingle();
        if (error) {
          console.error("claim-circle-invite-token: personal lookup failed", error.message);
          return null;
        }
        return data;
      };

      const touch = async (rowId: string, status: string) => {
        if (status === "pending") {
          await admin.from("circle_invites").update({ invited_by: inv.invited_by }).eq("id", rowId);
          return true;
        }
        const { error } = await admin
          .from("circle_invites")
          .update({
            status: "pending",
            responded_at: null,
            invited_by: inv.invited_by,
          })
          .eq("id", rowId);
        if (error) {
          console.error("claim-circle-invite-token: revive failed", error.message);
          return false;
        }
        return true;
      };

      const existing = await loadRow();
      if (existing && typeof existing.id === "string") {
        const ok = await touch(existing.id, typeof existing.status === "string" ? existing.status : "");
        return ok ? existing.id : null;
      }

      const email = await callerEmail();
      const { data: inserted, error: insertErr } = await admin
        .from("circle_invites")
        .insert({
          circle_id: circleId,
          invited_by: inv.invited_by,
          invited_user_id: callerId,
          invite_email: email,
          status: "pending",
        })
        .select("id")
        .maybeSingle();
      if (inserted && typeof inserted.id === "string") return inserted.id;
      if (String(insertErr?.code ?? "") !== "23505") {
        console.error(
          "claim-circle-invite-token: personal insert failed",
          insertErr?.message ?? "no row",
        );
        return null;
      }
      const again = await loadRow();
      if (again && typeof again.id === "string") {
        const ok = await touch(again.id, typeof again.status === "string" ? again.status : "");
        return ok ? again.id : null;
      }
      return null;
    }

    function claimedResponse(personalInviteId: string) {
      return jsonResponse({
        ok: true,
        invite_id: personalInviteId,
        circle_id: circleId,
        circle_name: circleName,
        inviter_name: inviterName,
        claimed: true,
      });
    }

    if (lockedEmail) {
      const email = await callerEmail();
      if (!email || email !== lockedEmail) {
        return jsonResponse({
          error: "This invite was sent to a different email address.",
        }, 403);
      }
      const boundId = typeof inv.invited_user_id === "string" ? inv.invited_user_id : null;
      if (boundId && boundId !== callerId) {
        return jsonResponse({
          error: "This invite link was already used by someone else.",
        }, 409);
      }
      if (boundId === callerId) return claimedResponse(inviteId);

      const { data: updated, error: updErr } = await admin
        .from("circle_invites")
        .update({ invited_user_id: callerId, invite_email: lockedEmail })
        .eq("id", inviteId)
        .is("invited_user_id", null)
        .select("id")
        .maybeSingle();
      if (updated && typeof updated.id === "string") return claimedResponse(updated.id);
      if (updErr && String(updErr.code ?? "") !== "23505") {
        console.error("claim-circle-invite-token: email bind failed", updErr.message);
      }
      const personalId = await openPersonalInvite();
      if (!personalId) return jsonResponse({ error: "Could not claim this invite. Try again." }, 409);
      return claimedResponse(personalId);
    }

    const personalId = await openPersonalInvite();
    if (!personalId) return jsonResponse({ error: "Could not claim this invite. Try again." }, 409);
    return claimedResponse(personalId);
  } catch (e) {
    console.error("claim-circle-invite-token: unhandled", e);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
