import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-compute-neighbors-secret",
};

/** Bump when this function’s behavior or deps change, then redeploy — verify via JSON `edge.version`. */
const EDGE_FUNCTION_SLUG = "compute-neighbors";
const EDGE_FUNCTION_VERSION = "1.0.0";

/** Profiles whose `name` starts with this (case-insensitive) are not subjects; they may still be neighbors. */
const SEED_PREFIX = "seed";

/** Architecture doc §2e — discard weak edges before storing. */
const NOISE_FLOOR = 0.10;

const MIN_NEIGHBOR_OVERLAP = 1;

/** PostgREST / payload limits — insert in chunks (not a neighbor count cap). */
const NEIGHBOR_INSERT_BATCH = 500;

/** Smaller `IN` lists keep each overlap statement under statement_timeout on huge `ratings` tables. */
const MAX_TMDB_IDS_PER_CHUNK = 60;

const OVERLAP_PAGE_SIZE = 1000;

/** Max overlap pages per (media_type × tmdb chunk); bounds total rows read per chunk. */
const MAX_OVERLAP_PAGES_PER_CHUNK = 80;

/**
 * Only this many of the user's rated titles participate in overlap discovery (sorted keys, deterministic).
 * Tunes CPU/DB time; raise via secret COMPUTE_NEIGHBORS_MAX_USER_KEYS (cap ~400).
 */
function maxUserKeysForOverlap(): number {
  const raw = Deno.env.get("COMPUTE_NEIGHBORS_MAX_USER_KEYS");
  const n = raw ? parseInt(raw, 10) : 220;
  if (!Number.isFinite(n) || n < 30) return 220;
  return Math.min(n, 400);
}

function capUserRatingsMapForOverlap(userMap: RatingsMap): RatingsMap {
  const limit = maxUserKeysForOverlap();
  const keys = Object.keys(userMap).sort();
  if (keys.length <= limit) return userMap;
  const out: RatingsMap = {};
  for (let i = 0; i < limit; i++) {
    const k = keys[i]!;
    out[k] = userMap[k]!;
  }
  return out;
}

type RatingsMap = Record<string, number>;

type RatingRow = {
  user_id: string;
  media_type: string;
  tmdb_id: number;
  score: number;
};

function ratingRowKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}-${tmdbId}`;
}

/** Same restricted cosine as `match` (shared-title subspace). */
function cosineSimilarity(ratingsA: RatingsMap, ratingsB: RatingsMap): number {
  const shared = Object.keys(ratingsA).filter((id) => id in ratingsB);
  if (shared.length < MIN_NEIGHBOR_OVERLAP) return 0;
  const dot = shared.reduce((s, id) => s + ratingsA[id] * ratingsB[id], 0);
  const magA = Math.sqrt(shared.reduce((s, id) => s + ratingsA[id] ** 2, 0));
  const magB = Math.sqrt(shared.reduce((s, id) => s + ratingsB[id] ** 2, 0));
  const raw = magA && magB ? dot / (magA * magB) : 0;
  if (!Number.isFinite(raw)) return 0;
  /** DB `user_neighbors_similarity_check`: similarity between 0 and 1 inclusive. */
  return Math.min(1, Math.max(0, raw));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

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

async function fetchAllRealUserIds(admin: SupabaseClient): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 500;
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, name")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const name = row.name as string | null | undefined;
      if (!name?.toLowerCase().startsWith(SEED_PREFIX)) {
        ids.push(row.id as string);
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return ids;
}

async function loadUserRatingsMap(admin: SupabaseClient, userId: string): Promise<RatingsMap> {
  const map: RatingsMap = {};
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("ratings")
      .select("media_type, tmdb_id, score")
      .eq("user_id", userId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as { media_type: string; tmdb_id: number; score: number }[];
    if (rows.length === 0) break;
    for (const r of rows) {
      map[ratingRowKey(r.media_type, r.tmdb_id)] = r.score;
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

/** All ratings from other users on any of this user's rated titles (paged per chunk). */
async function fetchOverlapRowsForChunk(
  admin: SupabaseClient,
  excludeUserId: string,
  mediaType: string,
  tmdbIds: number[],
): Promise<RatingRow[]> {
  const unique = [...new Set(tmdbIds)];
  const out: RatingRow[] = [];
  for (let i = 0; i < unique.length; i += MAX_TMDB_IDS_PER_CHUNK) {
    const chunk = unique.slice(i, i + MAX_TMDB_IDS_PER_CHUNK);
    let page = 0;
    let from = 0;
    for (;;) {
      if (page >= MAX_OVERLAP_PAGES_PER_CHUNK) break;
      page++;
      const { data, error } = await admin
        .from("ratings")
        .select("user_id, media_type, tmdb_id, score")
        .eq("media_type", mediaType)
        .in("tmdb_id", chunk)
        .neq("user_id", excludeUserId)
        .range(from, from + OVERLAP_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as RatingRow[];
      if (rows.length === 0) break;
      for (const r of rows) out.push(r);
      if (rows.length < OVERLAP_PAGE_SIZE) break;
      from += OVERLAP_PAGE_SIZE;
    }
  }
  return out;
}

function buildCandidateMapsFromOverlap(
  userMap: RatingsMap,
  rows: RatingRow[],
): Map<string, RatingsMap> {
  const candidateMap = new Map<string, RatingsMap>();
  const userKeys = new Set(Object.keys(userMap));
  for (const r of rows) {
    const key = ratingRowKey(r.media_type, r.tmdb_id);
    if (!userKeys.has(key)) continue;
    let m = candidateMap.get(r.user_id);
    if (!m) {
      m = {};
      candidateMap.set(r.user_id, m);
    }
    m[key] = r.score;
  }
  return candidateMap;
}

async function isSeedSubject(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("profiles")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  const name = data?.name as string | null | undefined;
  return Boolean(name?.toLowerCase().startsWith(SEED_PREFIX));
}

async function cleanupStagingRun(admin: SupabaseClient, runId: string): Promise<void> {
  await admin.from("user_neighbors_staging").delete().eq("run_id", runId);
}

/**
 * Recomputes neighbors entirely in memory first, then swaps into `user_neighbors` in one DB
 * transaction (`commit_user_neighbors_swap`) so a failed run never leaves the user with rows
 * deleted but not re-inserted.
 */
async function computeNeighborsForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<{ stored: number; candidates: number }> {
  let userMap = await loadUserRatingsMap(admin, userId);

  if (Object.keys(userMap).length === 0) {
    const runId = crypto.randomUUID();
    const { data: cleared, error: rpcErr } = await admin.rpc("commit_user_neighbors_swap", {
      p_user_id: userId,
      p_run_id: runId,
    });
    if (rpcErr) throw rpcErr;
    return { stored: typeof cleared === "number" ? cleared : 0, candidates: 0 };
  }

  /** Subset for overlap + cosine — avoids statement_timeout on blockbuster titles × huge `ratings`. */
  userMap = capUserRatingsMapForOverlap(userMap);

  const movieIds: number[] = [];
  const tvIds: number[] = [];
  for (const key of Object.keys(userMap)) {
    const dash = key.indexOf("-");
    if (dash <= 0) continue;
    const mt = key.slice(0, dash);
    const id = parseInt(key.slice(dash + 1), 10);
    if (Number.isNaN(id)) continue;
    if (mt === "movie") movieIds.push(id);
    else if (mt === "tv") tvIds.push(id);
  }

  const rows: RatingRow[] = [];
  if (movieIds.length) {
    const movieOverlap = await fetchOverlapRowsForChunk(admin, userId, "movie", movieIds);
    for (const r of movieOverlap) rows.push(r);
  }
  if (tvIds.length) {
    const tvOverlap = await fetchOverlapRowsForChunk(admin, userId, "tv", tvIds);
    for (const r of tvOverlap) rows.push(r);
  }

  const candidateMap = buildCandidateMapsFromOverlap(userMap, rows);

  type Row = {
    similarity: number;
    overlap_count: number;
    neighbor_id: string;
  };
  const scored: Row[] = [];

  for (const [neighborId, candRatings] of candidateMap) {
    if (neighborId === userId) continue;
    const sim = cosineSimilarity(userMap, candRatings);
    if (sim < NOISE_FLOOR) continue;
    const overlap = Object.keys(userMap).filter((k) => k in candRatings).length;
    if (overlap < 1) continue;
    scored.push({ neighbor_id: neighborId, similarity: sim, overlap_count: overlap });
  }

  scored.sort((a, b) => b.similarity - a.similarity);

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const stagingRows = scored.map((n) => ({
    run_id: runId,
    user_id: userId,
    neighbor_id: n.neighbor_id,
    similarity: n.similarity,
    overlap_count: n.overlap_count,
    computed_at: now,
  }));

  try {
    for (let i = 0; i < stagingRows.length; i += NEIGHBOR_INSERT_BATCH) {
      const batch = stagingRows.slice(i, i + NEIGHBOR_INSERT_BATCH);
      const { error: insErr } = await admin.from("user_neighbors_staging").insert(batch);
      if (insErr) throw insErr;
    }

    const { data: inserted, error: rpcErr } = await admin.rpc("commit_user_neighbors_swap", {
      p_user_id: userId,
      p_run_id: runId,
    });
    if (rpcErr) throw rpcErr;

    const n = typeof inserted === "number" ? inserted : stagingRows.length;
    return { stored: n, candidates: candidateMap.size };
  } catch (e) {
    await cleanupStagingRun(admin, runId);
    throw e;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    const headerSecret = req.headers.get("x-compute-neighbors-secret") ?? "";
    const cronSecret = Deno.env.get("COMPUTE_NEIGHBORS_CRON_SECRET") ?? "";

    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const isService = timingSafeEqual(bearer, serviceKey);
    const isCronHeader = cronSecret.length > 0 &&
      (timingSafeEqual(headerSecret, cronSecret) ||
        (bearer.length > 0 && timingSafeEqual(bearer, cronSecret)));

    const trustedJob = isService || isCronHeader;

    const body = await req.json().catch(() => ({})) as {
      mode?: string;
      userId?: string;
      /** Only for mode "all" (trusted): 0-based index into sorted eligible user ids. */
      offset?: number;
      /**
       * Only for mode "all" (trusted): max users to process this invocation.
       * Omit for full list (may exceed Edge ~150s idle timeout on large graphs — use chunks).
       */
      limit?: number;
    };

    const mode = body.mode;
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";

    let targetIds: string[] = [];
    let chunkMeta:
      | { offset: number; limit: number | null; totalEligible: number }
      | undefined;

    if (mode === "all") {
      if (!trustedJob) {
        return jsonResponse({
          error: "Forbidden",
          hint: "Use service role Bearer, or set COMPUTE_NEIGHBORS_CRON_SECRET and pass it via Authorization Bearer or x-compute-neighbors-secret.",
        }, 403);
      }
      const allIds = (await fetchAllRealUserIds(admin)).sort();
      const rawOff = body.offset;
      const rawLim = body.limit;
      const chunkOffset =
        typeof rawOff === "number" && Number.isFinite(rawOff) && rawOff >= 0
          ? Math.floor(rawOff)
          : 0;
      const chunkLimit =
        typeof rawLim === "number" && Number.isFinite(rawLim) && rawLim > 0
          ? Math.floor(rawLim)
          : null;

      chunkMeta = {
        offset: chunkOffset,
        limit: chunkLimit,
        totalEligible: allIds.length,
      };

      targetIds =
        chunkLimit === null
          ? allIds
          : allIds.slice(chunkOffset, chunkOffset + chunkLimit);
    } else if (userId) {
      if (trustedJob) {
        if (await isSeedSubject(admin, userId)) {
          return jsonResponse({ error: "Seed users are not computed as subjects" }, 403);
        }
        targetIds = [userId];
      } else {
        const supabase = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user }, error: authErr } = await supabase.auth.getUser();
        if (authErr || !user || user.id !== userId) {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        if (await isSeedSubject(admin, userId)) {
          return jsonResponse({ error: "Seed users are not computed as subjects" }, 403);
        }
        targetIds = [userId];
      }
    } else {
      return jsonResponse({
        error: "Invalid body",
        hint:
          "Send { \"mode\": \"all\" } (trusted caller), optional { \"offset\": 0, \"limit\": 3 } to avoid Edge timeouts, or { \"userId\": \"<uuid>\" }.",
      }, 400);
    }

    const results: { userId: string; stored: number; candidates: number; ok: boolean; error?: string }[] = [];

    for (const uid of targetIds) {
      try {
        const { stored, candidates } = await computeNeighborsForUser(admin, uid);
        results.push({ userId: uid, stored, candidates, ok: true });
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        console.error(`compute-neighbors failed for ${uid}:`, msg);
        results.push({ userId: uid, stored: 0, candidates: 0, ok: false, error: msg });
      }
    }

    const failed = results.filter((r) => !r.ok).length;
    const failures = results.filter((r) => !r.ok);

    const payload: Record<string, unknown> = {
      ok: failed === 0,
      mode: mode === "all" ? "all" : "single",
      processedUsers: results.length,
      failedUsers: failed,
    };

    if (mode === "all" && chunkMeta) {
      payload.chunk = {
        ...chunkMeta,
        nextOffset:
          chunkMeta.limit === null
            ? null
            : chunkMeta.offset + results.length,
        hasMore:
          chunkMeta.limit === null
            ? false
            : chunkMeta.offset + results.length < chunkMeta.totalEligible,
      };
    }

    if (mode === "all" && results.length > 100) {
      payload.summaryOnly = true;
      payload.sample = results.slice(0, 25);
      payload.failures = failures;
    } else {
      payload.results = results;
    }

    return jsonResponse(payload);
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: (e as Error).message ?? "Server error" }, 500);
  }
});
