import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EDGE_FUNCTION_SLUG = "delete-account";
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
      console.error("delete-account: missing env keys");
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

    let body: Record<string, unknown> = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = {};
    }

    const confirm = typeof body.confirm === "string" ? body.confirm.trim() : "";
    if (confirm !== "DELETE") {
      return jsonResponse({ error: "Type DELETE to confirm." }, 400);
    }

    const { data: prep, error: prepErr } = await authed.rpc("prepare_account_deletion");
    if (prepErr) {
      console.error("delete-account: prepare failed", prepErr.message);
      return jsonResponse({ error: "Could not delete account. Try again or email support." }, 500);
    }
    if (prep && typeof prep === "object" && prep.ok !== true) {
      return jsonResponse({ error: "Could not delete account. Try again or email support." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: delErr } = await admin.auth.admin.deleteUser(callerId);
    if (delErr) {
      console.error("delete-account: auth delete failed", delErr.message);
      return jsonResponse({ error: "Account data was removed but sign-in could not be closed. Email support." }, 500);
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    console.error("delete-account: unexpected", e);
    return jsonResponse({ error: "Could not delete account. Try again or email support." }, 500);
  }
});
