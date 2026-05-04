import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EDGE_FUNCTION_SLUG = "preview-circle-invite-link";
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("preview-circle-invite-link: missing env keys");
      return jsonResponse({ error: "Server misconfigured." }, 500);
    }

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
      console.error("preview-circle-invite-link: load failed", invErr.message);
      return jsonResponse({ error: "Could not load invite." }, 500);
    }
    if (!inv || !inv.invite_token) {
      return jsonResponse({ error: "This invite is no longer valid.", code: "not_found" }, 404);
    }

    const now = Date.now();
    const exp = inv.expires_at ? new Date(String(inv.expires_at)).getTime() : NaN;
    if (Number.isFinite(exp) && exp < now) {
      return jsonResponse({
        ok: false,
        expired: true,
        error: "This invite has expired — ask your friend to send a new one.",
      }, 200);
    }

    const st = typeof inv.status === "string" ? inv.status : "";
    if (st === "revoked") {
      return jsonResponse({ error: "This invite is no longer valid.", code: "revoked" }, 410);
    }
    if (st !== "pending") {
      return jsonResponse({ error: "This invite is no longer valid.", code: "inactive" }, 410);
    }

    const circleId = typeof inv.circle_id === "string" ? inv.circle_id : "";
    const { data: circle, error: circleErr } = await admin
      .from("circles")
      .select("name, status")
      .eq("id", circleId)
      .maybeSingle();

    if (circleErr || !circle) {
      return jsonResponse({ error: "This invite is no longer valid.", code: "circle_gone" }, 410);
    }
    if (circle.status !== "active") {
      return jsonResponse({ error: "This invite is no longer valid.", code: "inactive_circle" }, 410);
    }

    const invitedBy = typeof inv.invited_by === "string" ? inv.invited_by : "";
    const { data: prof } = await admin
      .from("profiles")
      .select("name")
      .eq("id", invitedBy)
      .maybeSingle();

    const circleName = typeof circle.name === "string" ? circle.name : "A circle";
    const inviterName = typeof prof?.name === "string" && prof.name.trim()
      ? prof.name.trim()
      : "Someone";

    const claimed = typeof inv.invited_user_id === "string" && inv.invited_user_id.length > 0;

    return jsonResponse({
      ok: true,
      circle_name: circleName,
      inviter_name: inviterName,
      expires_at: inv.expires_at ?? null,
      claimed,
    });
  } catch (e) {
    console.error("preview-circle-invite-link: unhandled", e);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
