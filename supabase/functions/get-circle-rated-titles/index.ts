import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// ------------------------------------------------------------------------------------------------
// Circles Phase C — get-circle-rated-titles
// ------------------------------------------------------------------------------------------------
//
// Body: { circle_id: string }
// Auth: JWT — caller must be a member of the circle.
//
// 1) Calls public.get_circle_rated_strip(p_circle_id) with the caller's JWT (sets auth.uid()).
// 2) For each title where the viewer has no ratings row, enriches with CF prediction via
//    match_predict_neighbor_raters (service role) + user_title_predictions cache read-through.
//
// Response: { ok: true, member_count, gated, titles: [...] }
// Each title includes RPC fields plus optional `prediction` when viewer_score is null.
// ------------------------------------------------------------------------------------------------

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SIMILARITY_FLOOR_READ = 0.10;
const PREDICTION_MODEL_VERSION = "cf-v3-user-neighbors-v4";
const PREDICTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const CONFIDENCE_HIGH_WEIGHT = 3.0;
const CONFIDENCE_MEDIUM_WEIGHT = 1.5;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
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

function predFromWeightedRaters(raters: { score: number; similarity: number }[]): Pred | null {
  if (raters.length === 0) return null;
  const weightedSum = raters.reduce((s, r) => s + r.score * r.similarity, 0);
  const totalWeight = raters.reduce((s, r) => s + r.similarity, 0);
  const predicted = Math.round((weightedSum / totalWeight) * 10) / 10;
  const confidence = totalWeight >= CONFIDENCE_HIGH_WEIGHT
    ? "high"
    : totalWeight >= CONFIDENCE_MEDIUM_WEIGHT
    ? "medium"
    : "low";
  const nRatings = raters.map((r) => r.score);
  const mean = nRatings.reduce((a, b) => a + b, 0) / nRatings.length;
  const stdDev = Math.sqrt(nRatings.reduce((s, r) => s + (r - mean) ** 2, 0) / nRatings.length);
  const margin = stdDev * 0.8;
  return {
    predicted,
    low: Math.max(1, Math.round((predicted - margin) * 10) / 10),
    high: Math.min(10, Math.round((predicted + margin) * 10) / 10),
    confidence,
    neighborCount: raters.length,
  };
}

async function predictForTitle(
  admin: SupabaseClient,
  userId: string,
  mediaType: string,
  tmdbId: number,
): Promise<Pred | null> {
  if (mediaType !== "movie" && mediaType !== "tv") return null;

  const { data: cached, error: cacheErr } = await admin
    .from("user_title_predictions")
    .select("predicted, low, high, confidence, neighbor_count, computed_at, model_version")
    .eq("user_id", userId)
    .eq("media_type", mediaType)
    .eq("tmdb_id", tmdbId)
    .maybeSingle();

  if (!cacheErr && cached) {
    const row = cached as Record<string, unknown>;
    const computedAtMs = Date.parse(String(row.computed_at ?? ""));
    const fresh = Number.isFinite(computedAtMs) && (Date.now() - computedAtMs <= PREDICTION_CACHE_TTL_MS);
    const modelOk = String(row.model_version ?? "") === PREDICTION_MODEL_VERSION;
    if (fresh && modelOk) {
      return {
        predicted: Number(row.predicted),
        low: Number(row.low),
        high: Number(row.high),
        confidence: String(row.confidence),
        neighborCount: Number(row.neighbor_count ?? 0),
      };
    }
  }

  const { data, error } = await admin.rpc("match_predict_neighbor_raters", {
    p_user_id: userId,
    p_media_type: mediaType,
    p_tmdb_id: tmdbId,
    p_min_similarity: SIMILARITY_FLOOR_READ,
  });
  if (error) {
    console.warn("get-circle-rated-titles: match_predict_neighbor_raters failed", error.message);
    return null;
  }
  const rows = (data ?? []) as { score: number | string; similarity: number | string }[];
  const raters = rows.map((r) => ({
    score: Number(r.score),
    similarity: Number(r.similarity),
  }));
  return predFromWeightedRaters(raters);
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

    const { data: stripData, error: stripErr } = await authed.rpc("get_circle_rated_strip", {
      p_circle_id: circleId,
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
      console.error("get-circle-rated-titles: get_circle_rated_strip failed", stripErr);
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

    if (gated || memberCount < 2) {
      return jsonResponse({
        ok: true,
        member_count: memberCount,
        gated: true,
        titles: [],
      });
    }

    const enriched = await Promise.all(
      rawTitles.map(async (t) => {
        const hasRated = t.viewer_score != null && Number.isFinite(Number(t.viewer_score));
        if (hasRated) {
          return { ...t, prediction: null as Pred | null };
        }
        const pred = await predictForTitle(
          admin,
          callerId,
          String(t.media_type),
          Number(t.tmdb_id),
        );
        return { ...t, prediction: pred };
      }),
    );

    return jsonResponse({
      ok: true,
      member_count: memberCount,
      gated: false,
      titles: enriched,
    });
  } catch (e) {
    console.error("get-circle-rated-titles: unhandled", (e as Error)?.message);
    return jsonResponse({ error: "Something went wrong." }, 500);
  }
});
