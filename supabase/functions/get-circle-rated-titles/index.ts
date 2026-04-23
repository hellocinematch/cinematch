import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// ------------------------------------------------------------------------------------------------
// Circles Phase C — get-circle-rated-titles
// ------------------------------------------------------------------------------------------------
//
// Body: { circle_id: string, p_limit?: number, p_offset?: number, view?: "recent" | "all" | "top" }
// Auth: JWT — caller must be a member of the circle.
//
// 1) Calls public.get_circle_rated_strip | get_circle_rated_all_grid | get_circle_rated_top_grid (JWT).
// 2) Fills per-title CF predictions from user_title_predictions only (batched by media_type).
//    Cold cache → prediction null (same as detail-page predict_cached; avoids N× match_predict RPCs).
//
// Response: { ok: true, member_count, gated, titles: [...], total_eligible, has_more }
// ------------------------------------------------------------------------------------------------

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Bump when this function’s behavior or deps change, then redeploy — verify via JSON `edge.version`. */
const EDGE_FUNCTION_SLUG = "get-circle-rated-titles";
const EDGE_FUNCTION_VERSION = "1.0.0";

const PREDICTION_MODEL_VERSION = "cf-v3-user-neighbors-v4";
const PREDICTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

type Pred = {
  predicted: number;
  low: number;
  high: number;
  confidence: string;
  neighborCount: number;
};

type RpcTitle = {
  media_type: string;
  tmdb_id: number;
  section: string;
  distinct_circle_raters: number;
  group_rating: number | null;
  site_rating: number | null;
  last_activity_at: string | null;
  viewer_score: number | null;
};

function predFromCacheRow(row: Record<string, unknown>): Pred | null {
  const computedAtMs = Date.parse(String(row.computed_at ?? ""));
  const fresh = Number.isFinite(computedAtMs) && (Date.now() - computedAtMs <= PREDICTION_CACHE_TTL_MS);
  const modelOk = String(row.model_version ?? "") === PREDICTION_MODEL_VERSION;
  if (!fresh || !modelOk) return null;
  return {
    predicted: Number(row.predicted),
    low: Number(row.low),
    high: Number(row.high),
    confidence: String(row.confidence),
    neighborCount: Number(row.neighbor_count ?? 0),
  };
}

/** Two indexed reads (movie + tv) instead of 2N round-trips; no match_predict_neighbor_raters here. */
async function predictionsFromCacheBatch(
  admin: SupabaseClient,
  userId: string,
  titles: RpcTitle[],
): Promise<Map<string, Pred>> {
  const out = new Map<string, Pred>();
  const unrated = titles.filter(
    (t) => !(t.viewer_score != null && Number.isFinite(Number(t.viewer_score))),
  );
  if (unrated.length === 0) return out;

  const movieIds = [
    ...new Set(unrated.filter((t) => t.media_type === "movie").map((t) => Number(t.tmdb_id))),
  ];
  const tvIds = [...new Set(unrated.filter((t) => t.media_type === "tv").map((t) => Number(t.tmdb_id)))];

  if (movieIds.length > 0) {
    const { data, error } = await admin
      .from("user_title_predictions")
      .select("predicted, low, high, confidence, neighbor_count, computed_at, model_version, tmdb_id")
      .eq("user_id", userId)
      .eq("media_type", "movie")
      .in("tmdb_id", movieIds);
    if (!error && data) {
      for (const row of data) {
        const r = row as Record<string, unknown>;
        const pred = predFromCacheRow(r);
        if (pred) out.set(`movie-${Number(r.tmdb_id)}`, pred);
      }
    }
  }
  if (tvIds.length > 0) {
    const { data, error } = await admin
      .from("user_title_predictions")
      .select("predicted, low, high, confidence, neighbor_count, computed_at, model_version, tmdb_id")
      .eq("user_id", userId)
      .eq("media_type", "tv")
      .in("tmdb_id", tvIds);
    if (!error && data) {
      for (const row of data) {
        const r = row as Record<string, unknown>;
        const pred = predFromCacheRow(r);
        if (pred) out.set(`tv-${Number(r.tmdb_id)}`, pred);
      }
    }
  }
  return out;
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
      console.error("get-circle-rated-titles: missing env keys");
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
    if (!circleId) {
      return jsonResponse({ error: "circle_id is required." }, 400);
    }

    const rawLimit = body.p_limit;
    const rawOffset = body.p_offset;
    const pLimit = typeof rawLimit === "number" && Number.isFinite(rawLimit)
      ? Math.max(1, Math.floor(rawLimit))
      : 10;
    const pOffset = typeof rawOffset === "number" && Number.isFinite(rawOffset)
      ? Math.max(0, Math.floor(rawOffset))
      : 0;

    const rawView = body.view;
    const view =
      rawView === "all" || rawView === "top"
        ? rawView
        : "recent";
    const rpcName =
      view === "all"
        ? "get_circle_rated_all_grid"
        : view === "top"
          ? "get_circle_rated_top_grid"
          : "get_circle_rated_strip";

    const { data: stripData, error: stripErr } = await authed.rpc(rpcName, {
      p_circle_id: circleId,
      p_limit: pLimit,
      p_offset: pOffset,
    });

    if (stripErr) {
      const msg = stripErr.message || "";
      if (msg.includes("not a member")) {
        return jsonResponse({ error: "You're not a member of this circle." }, 403);
      }
      if (msg.includes("not authenticated")) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const detail = [stripErr.message, (stripErr as { details?: string }).details, (stripErr as { hint?: string }).hint]
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .join(" — ");
      console.error(`get-circle-rated-titles: ${rpcName} failed`, stripErr);
      const errOut = detail.length > 0 ? detail.slice(0, 900) : "Could not load circle titles.";
      return jsonResponse({ error: errOut }, 500);
    }

    const strip = stripData as Record<string, unknown> | null;
    if (!strip || typeof strip !== "object") {
      return jsonResponse({ error: "Invalid response from strip RPC." }, 500);
    }

    const memberCount = Number(strip.member_count ?? 0);
    const gated = Boolean(strip.gated);
    const rawTitles = Array.isArray(strip.titles) ? strip.titles as RpcTitle[] : [];
    const totalEligible = Number(strip.total_eligible ?? 0);
    const hasMore = Boolean(strip.has_more);

    if (gated || memberCount < 2) {
      return jsonResponse({
        ok: true,
        member_count: memberCount,
        gated: true,
        titles: [],
        total_eligible: 0,
        has_more: false,
      });
    }

    const cacheMap = await predictionsFromCacheBatch(admin, callerId, rawTitles);
    const enriched = rawTitles.map((t) => {
      const hasRated = t.viewer_score != null && Number.isFinite(Number(t.viewer_score));
      if (hasRated) {
        return { ...t, prediction: null as Pred | null };
      }
      const key = `${String(t.media_type)}-${Number(t.tmdb_id)}`;
      const pred = cacheMap.get(key) ?? null;
      return { ...t, prediction: pred };
    });

    return jsonResponse({
      ok: true,
      member_count: memberCount,
      gated: false,
      titles: enriched,
      total_eligible: totalEligible,
      has_more: hasMore,
    });
  } catch (e) {
    console.error("get-circle-rated-titles: unhandled", (e as Error)?.message);
    return jsonResponse({ error: "Something went wrong." }, 500);
  }
});
