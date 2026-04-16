import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Match algorithm (server-only) ------------------------------------------

const MIN_NEIGHBOR_OVERLAP = 1;
const MIN_NEIGHBORS = 1;
const MIN_MOVIE_RATINGS = 1;

/**
 * v1 caps: keep edge CPU + DB reads bounded.
 *
 * Suggestion (only if CF still feels thin after catalogue + client work): raise one or more of
 * MAX_SEED_TITLE_KEYS, MAX_CANDIDATES_FROM_OVERLAP, MAX_NEIGHBORS_FULL_FETCH, MAX_ROWS_FULL_RATINGS
 * for richer neighbor overlap and fuller neighbor rating maps — at the cost of slower invocations and
 * more Supabase rows. Does not fix titles missing from the client `catalogue` payload.
 */
const MAX_SEED_TITLE_KEYS = 100;
const MAX_TMDB_IDS_PER_CHUNK = 120;
const MAX_ROWS_OVERLAP_PER_CHUNK = 6000;
const MAX_CANDIDATES_FROM_OVERLAP = 250;
const MAX_NEIGHBORS_FULL_FETCH = 40;
const MAX_ROWS_FULL_RATINGS = 15_000;
const RATINGS_PAGE_SIZE = 1000;
const MAX_SEED_TITLE_KEYS_PREDICT = 220;
const MAX_CANDIDATES_FROM_OVERLAP_PREDICT = 700;
const MAX_NEIGHBORS_FULL_FETCH_PREDICT = 140;
const PREDICTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PREDICTION_MODEL_VERSION = "cf-v2-seed-balanced-cache-v1";

type Movie = Record<string, unknown> & {
  id: string;
  tmdbRating?: number;
  popularity?: number;
  voteCount?: number;
};

type RatingsMap = Record<string, number>;
type OtherRatings = Record<string, RatingsMap>;
type ParsedMovieId = { mediaType: "movie" | "tv"; tmdbId: number };

function ratingRowKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}-${tmdbId}`;
}

function parseMovieId(movieId: string): ParsedMovieId | null {
  const dash = movieId.indexOf("-");
  if (dash <= 0) return null;
  const mediaType = movieId.slice(0, dash);
  const tmdbId = parseInt(movieId.slice(dash + 1), 10);
  if ((mediaType !== "movie" && mediaType !== "tv") || Number.isNaN(tmdbId)) return null;
  return { mediaType, tmdbId };
}

function cosineSimilarity(ratingsA: RatingsMap, ratingsB: RatingsMap): number {
  const shared = Object.keys(ratingsA).filter((id) => id in ratingsB);
  if (shared.length < MIN_NEIGHBOR_OVERLAP) return 0;
  const dot = shared.reduce((s, id) => s + ratingsA[id] * ratingsB[id], 0);
  const magA = Math.sqrt(shared.reduce((s, id) => s + ratingsA[id] ** 2, 0));
  const magB = Math.sqrt(shared.reduce((s, id) => s + ratingsB[id] ** 2, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}

type Neighbor = { uid: string; sim: number; ratings: RatingsMap };

function findNeighbors(userRatings: RatingsMap, otherRatings: OtherRatings): Neighbor[] {
  return Object.entries(otherRatings)
    .map(([uid, ratings]) => ({ uid, sim: cosineSimilarity(userRatings, ratings), ratings }))
    .filter((n) => n.sim > 0)
    .sort((a, b) => b.sim - a.sim);
}

type Pred = {
  predicted: number;
  low: number;
  high: number;
  confidence: string;
  neighborCount: number;
};

function predictRatingRange(movieId: string, neighbors: Neighbor[]): Pred | null {
  const contributing = neighbors.filter((n) => movieId in n.ratings);
  if (contributing.length < MIN_NEIGHBORS) return null;
  const weightedSum = contributing.reduce((s, n) => s + n.sim * n.ratings[movieId], 0);
  const totalWeight = contributing.reduce((s, n) => s + n.sim, 0);
  const predicted = weightedSum / totalWeight;
  const nRatings = contributing.map((n) => n.ratings[movieId]);
  const mean = nRatings.reduce((s, r) => s + r, 0) / nRatings.length;
  const stdDev = Math.sqrt(nRatings.reduce((s, r) => s + (r - mean) ** 2, 0) / nRatings.length);
  const margin = stdDev * 0.8;
  return {
    predicted: Math.round(predicted * 10) / 10,
    low: Math.max(1, Math.round((predicted - margin) * 10) / 10),
    high: Math.min(10, Math.round((predicted + margin) * 10) / 10),
    confidence: stdDev < 1 ? "high" : stdDev < 2 ? "medium" : "low",
    neighborCount: contributing.length,
  };
}

type Rec = Pred & { movie: Movie };

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, Math.floor((sortedAsc.length - 1) * p)));
  return sortedAsc[idx] ?? 0;
}

function rankMoodByVibe(items: Rec[], vibe: string[]): Rec[] {
  if (items.length === 0) return [];
  const wantsHidden = vibe.includes("hidden");
  const wantsAcclaimed = vibe.includes("acclaimed");
  const wantsClassic = vibe.includes("classic");
  if (!wantsHidden && !wantsAcclaimed && !wantsClassic) {
    return [...items].sort((a, b) => b.predicted - a.predicted);
  }

  const voteCounts = items
    .map((r) => Number(r.movie.voteCount ?? 0))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const tmdbRatings = items
    .map((r) => Number(r.movie.tmdbRating ?? r.predicted ?? 0))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const p90Votes = percentile(voteCounts, 0.9);
  const p30Votes = percentile(voteCounts, 0.3);
  const p70Votes = percentile(voteCounts, 0.7);
  const p85Tmdb = percentile(tmdbRatings, 0.85);

  const scored = items.map((r) => {
    const tmdb = Number(r.movie.tmdbRating ?? r.predicted ?? 0);
    const voteCount = Number(r.movie.voteCount ?? 0);
    const popularity = Number(r.movie.popularity ?? 0);
    const popTerm = Math.log1p(Math.max(1, popularity));
    const neighborCount = Number(r.neighborCount ?? 0);

    if (wantsClassic) {
      // Classic: old-title filtering is done in TMDB query (15+ years). Rank by quality consensus + broad validation.
      let s = r.predicted * 2.0 + tmdb * 1.2;
      // Quality gate: top ~15% TMDB rating in current candidate pool.
      if (tmdb >= p85Tmdb) s += 2.0;
      else s -= 1.0;
      // "Classic" should be broadly seen/validated (high vote count).
      if (voteCount >= p70Votes) s += 1.5;
      if (voteCount >= p90Votes) s += 0.8;
      // Foundational classic for this taste profile: many neighbors rate highly.
      if (neighborCount >= 4 && r.predicted >= 8) s += 2.0;
      else if (neighborCount >= 3 && r.predicted >= 7.5) s += 1.0;
      return { rec: r, score: s };
    }

    if (wantsHidden) {
      // Hidden gem: strong quality, low exposure, and ideally only 1-2 loving neighbors.
      let s = (r.predicted * 2.2 + tmdb) / popTerm;
      if (neighborCount >= 1 && neighborCount <= 2 && r.predicted >= 7.5) s += 2.0;
      if (neighborCount > 2) s -= 0.5;
      if (tmdb >= 7.5) s += 0.8;
      if (voteCount <= p30Votes) s += 1.1;
      if (voteCount > p90Votes) s -= 0.8;
      return { rec: r, score: s };
    }

    // Critically acclaimed: broad validation + many neighbors.
    let s = (r.predicted * popTerm) + (tmdb * 0.8);
    if (neighborCount >= 3 && r.predicted >= 8) s += 1.5;
    if (tmdb >= 8.0) s += 1.0;
    if (voteCount >= p90Votes) s += 1.2;
    return { rec: r, score: s };
  });

  return scored
    .sort((a, b) => b.score - a.score || b.rec.predicted - a.rec.predicted)
    .map((x) => x.rec);
}

function buildRecWithPrediction(movie: Movie, neighbors: Neighbor[]): Rec {
  const pred = predictRatingRange(movie.id, neighbors);
  if (pred) return { movie, ...pred };
  const t = (movie.tmdbRating as number) ?? 7;
  return {
    movie,
    predicted: t,
    low: Math.max(1, Math.round((t - 1) * 10) / 10),
    high: Math.min(10, Math.round((t + 1) * 10) / 10),
    confidence: "low",
    neighborCount: 0,
  };
}

function getRecommendations(
  userRatings: RatingsMap,
  otherRatings: OtherRatings,
  catalogue: Movie[],
): Rec[] {
  const seen = new Set(Object.keys(userRatings));
  const movieMap = Object.fromEntries(catalogue.map((m) => [m.id, m]));
  const neighbors = findNeighbors(userRatings, otherRatings);
  const ratingCounts: Record<string, number> = {};
  Object.values(otherRatings).forEach((r) =>
    Object.keys(r).forEach((id) => {
      ratingCounts[id] = (ratingCounts[id] || 0) + 1;
    }),
  );
  const candidates = new Set(
    neighbors.flatMap((n) => Object.keys(n.ratings)).filter((id) => !seen.has(id)),
  );
  return [...candidates]
    .filter((id) => (ratingCounts[id] || 0) >= MIN_MOVIE_RATINGS && movieMap[id])
    .map((id) => {
      const pr = predictRatingRange(id, neighbors);
      return pr ? { movie: movieMap[id], ...pr } : null;
    })
    .filter((r): r is Rec => r !== null && r.predicted !== undefined)
    .sort((a, b) => b.predicted - a.predicted);
}

function computeWorthALook(
  catalogue: Movie[],
  recommendations: Rec[],
  topPickOffset: number,
  userRatings: RatingsMap,
  neighbors: Neighbor[],
): Rec[] {
  if (catalogue.length === 0) return [];
  const morePicks: Rec[] = [];
  if (recommendations.length > 0) {
    const n = recommendations.length;
    const start = topPickOffset % n;
    for (let i = 0; i < Math.min(9, n); i++) {
      morePicks.push(recommendations[(start + i) % n]);
    }
  }
  const moreIds = new Set(morePicks.map((r) => r.movie.id));
  const byPop = (a: Movie, b: Movie) =>
    ((b.popularity as number) || 0) - ((a.popularity as number) || 0);
  const unrated = catalogue
    .filter((m) => !moreIds.has(m.id) && !userRatings[m.id])
    .sort(byPop);
  const pool =
    unrated.length >= 6 ? unrated : catalogue.filter((m) => !moreIds.has(m.id)).sort(byPop);
  /** Buffer for client strips after de-dupe / streaming filters (was 30). */
  const WORTH_A_LOOK_SERVER_CAP = 48;
  return pool.slice(0, WORTH_A_LOOK_SERVER_CAP).map((m) => buildRecWithPrediction(m, neighbors));
}

function runFullMatch(
  userRatings: RatingsMap,
  otherRatings: OtherRatings,
  catalogue: Movie[],
  inTheaters: Movie[],
  streamingMovies: Movie[],
  streamingTV: Movie[],
  topPickOffset: number,
) {
  const neighbors = findNeighbors(userRatings, otherRatings);
  const recommendations =
    Object.keys(userRatings).length === 0 || catalogue.length === 0
      ? []
      : getRecommendations(userRatings, otherRatings, catalogue);
  const theaterRecs = [...inTheaters]
    .map((m) => buildRecWithPrediction(m, neighbors))
    .sort((a, b) => b.predicted - a.predicted);
  const streamingMovieRecs = [...streamingMovies]
    .map((m) => buildRecWithPrediction(m, neighbors))
    .sort((a, b) => b.predicted - a.predicted);
  const streamingTvRecs = [...streamingTV]
    .map((m) => buildRecWithPrediction(m, neighbors))
    .sort((a, b) => b.predicted - a.predicted);
  const worthALookRecs = computeWorthALook(
    catalogue,
    recommendations,
    topPickOffset,
    userRatings,
    neighbors,
  );
  return {
    recommendations,
    theaterRecs,
    streamingMovieRecs,
    streamingTvRecs,
    worthALookRecs,
  };
}

// --- Neighbour data (service role, Edge Function only) -----------------------
//
// Security:
// - JWT + getUser() on the anon client proves who is calling; never trust client user_id.
// - SUPABASE_SERVICE_ROLE_KEY bypasses RLS; it must exist only in Edge Function secrets
//   (Supabase hosted functions inject it automatically). Never expose it to the browser.
// - Responses stay aggregate (scores / confidence); raw neighbour user_ids are not returned.

type RatingRow = {
  user_id: string;
  media_type: string;
  tmdb_id: number;
  score: number;
};

async function fetchOverlapForMediaType(
  admin: SupabaseClient,
  excludeUserId: string,
  mediaType: string,
  tmdbIds: number[],
): Promise<RatingRow[]> {
  const unique = [...new Set(tmdbIds)];
  const out: RatingRow[] = [];
  for (let i = 0; i < unique.length; i += MAX_TMDB_IDS_PER_CHUNK) {
    const chunk = unique.slice(i, i + MAX_TMDB_IDS_PER_CHUNK);
    const { data, error } = await admin
      .from("ratings")
      .select("user_id, media_type, tmdb_id, score")
      .eq("media_type", mediaType)
      .in("tmdb_id", chunk)
      .neq("user_id", excludeUserId)
      .limit(MAX_ROWS_OVERLAP_PER_CHUNK);
    if (error) throw error;
    if (data?.length) out.push(...(data as RatingRow[]));
  }
  return out;
}

async function fetchFullMapsForUsers(
  admin: SupabaseClient,
  userIds: string[],
): Promise<OtherRatings> {
  const maps: OtherRatings = {};
  for (const id of userIds) maps[id] = {};
  if (userIds.length === 0) return maps;

  let from = 0;
  let fetched = 0;
  while (fetched < MAX_ROWS_FULL_RATINGS) {
    const to = from + RATINGS_PAGE_SIZE - 1;
    const { data, error } = await admin
      .from("ratings")
      .select("user_id, media_type, tmdb_id, score")
      .in("user_id", userIds)
      .order("user_id", { ascending: true })
      .order("media_type", { ascending: true })
      .order("tmdb_id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as RatingRow[];
    if (rows.length === 0) break;
    for (const r of rows) {
      const key = ratingRowKey(r.media_type, r.tmdb_id);
      maps[r.user_id]![key] = r.score;
    }
    fetched += rows.length;
    from += RATINGS_PAGE_SIZE;
    if (rows.length < RATINGS_PAGE_SIZE) break;
  }
  return maps;
}

async function loadNeighborRatingsFromDb(
  admin: SupabaseClient | null,
  currentUserId: string,
  userRatings: RatingsMap,
  opts?: { targetMovieId?: string },
): Promise<OtherRatings> {
  if (!admin || Object.keys(userRatings).length === 0) return {};
  const targetMovieId = opts?.targetMovieId;
  const isPredictTargeted = Boolean(targetMovieId);
  const seedTitleLimit = isPredictTargeted ? MAX_SEED_TITLE_KEYS_PREDICT : MAX_SEED_TITLE_KEYS;
  const overlapCandidateLimit = isPredictTargeted
    ? MAX_CANDIDATES_FROM_OVERLAP_PREDICT
    : MAX_CANDIDATES_FROM_OVERLAP;
  const neighborsFullFetchLimit = isPredictTargeted
    ? MAX_NEIGHBORS_FULL_FETCH_PREDICT
    : MAX_NEIGHBORS_FULL_FETCH;

  const scoreDelta = (score: number): number => Math.abs(score - 5.5);
  const scoredKeys = Object.entries(userRatings)
    .map(([key, score]) => ({ key, score: Number(score) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => {
      const d = scoreDelta(b.score) - scoreDelta(a.score);
      if (d !== 0) return d;
      if (b.score !== a.score) return b.score - a.score;
      return a.key.localeCompare(b.key);
    });
  const movieSeedKeys = scoredKeys
    .map((x) => x.key)
    .filter((key) => key.startsWith("movie-"));
  const tvSeedKeys = scoredKeys
    .map((x) => x.key)
    .filter((key) => key.startsWith("tv-"));
  const titleKeys: string[] = [];
  while (titleKeys.length < seedTitleLimit && (movieSeedKeys.length > 0 || tvSeedKeys.length > 0)) {
    if (movieSeedKeys.length > 0) titleKeys.push(movieSeedKeys.shift()!);
    if (titleKeys.length >= seedTitleLimit) break;
    if (tvSeedKeys.length > 0) titleKeys.push(tvSeedKeys.shift()!);
  }

  const movieIds: number[] = [];
  const tvIds: number[] = [];
  for (const k of titleKeys) {
    const dash = k.indexOf("-");
    if (dash <= 0) continue;
    const type = k.slice(0, dash);
    const id = parseInt(k.slice(dash + 1), 10);
    if (Number.isNaN(id)) continue;
    if (type === "movie") movieIds.push(id);
    else if (type === "tv") tvIds.push(id);
  }

  const rows: RatingRow[] = [];
  if (movieIds.length) {
    rows.push(...await fetchOverlapForMediaType(admin, currentUserId, "movie", movieIds));
  }
  if (tvIds.length) {
    rows.push(...await fetchOverlapForMediaType(admin, currentUserId, "tv", tvIds));
  }

  const partial: Record<string, RatingsMap> = {};
  const overlapCount: Record<string, number> = {};

  for (const r of rows) {
    const key = ratingRowKey(r.media_type, r.tmdb_id);
    if (!(key in userRatings)) continue;
    if (!partial[r.user_id]) partial[r.user_id] = {};
    partial[r.user_id]![key] = r.score;
    overlapCount[r.user_id] = (overlapCount[r.user_id] || 0) + 1;
  }

  const candidateIds = Object.entries(overlapCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, overlapCandidateLimit)
    .map(([uid]) => uid);

  if (candidateIds.length === 0) return {};

  let targetRaterIds = new Set<string>();
  const parsedTarget = targetMovieId ? parseMovieId(targetMovieId) : null;
  if (parsedTarget && candidateIds.length > 0) {
    const { data: targetRows, error: targetErr } = await admin
      .from("ratings")
      .select("user_id")
      .eq("media_type", parsedTarget.mediaType)
      .eq("tmdb_id", parsedTarget.tmdbId)
      .in("user_id", candidateIds)
      .limit(Math.max(2000, overlapCandidateLimit * 2));
    if (targetErr) {
      console.warn("match: target-raters fetch failed", targetErr.message);
    } else {
      targetRaterIds = new Set(((targetRows ?? []) as { user_id: string }[]).map((r) => r.user_id));
    }
  }

  const rankedBySim = candidateIds
    .map((uid) => ({
      uid,
      sim: cosineSimilarity(userRatings, partial[uid]!),
      targetBoost: targetRaterIds.has(uid) ? 1 : 0,
    }))
    .filter((x) => x.sim > 0)
    .sort((a, b) => b.targetBoost - a.targetBoost || b.sim - a.sim);

  const topIds = rankedBySim.slice(0, neighborsFullFetchLimit).map((x) => x.uid);
  if (topIds.length === 0) return {};

  return await fetchFullMapsForUsers(admin, topIds);
}

type CachedPredictionRow = {
  user_id: string;
  media_type: "movie" | "tv";
  tmdb_id: number;
  predicted: number;
  low: number;
  high: number;
  confidence: string;
  neighbor_count: number;
  computed_at: string;
  model_version: string;
};

function toPredFromCache(row: CachedPredictionRow): Pred {
  return {
    predicted: Number(row.predicted),
    low: Number(row.low),
    high: Number(row.high),
    confidence: String(row.confidence),
    neighborCount: Number(row.neighbor_count),
  };
}

function isFreshCachedPrediction(row: CachedPredictionRow): boolean {
  const computedAtMs = Date.parse(row.computed_at);
  if (!Number.isFinite(computedAtMs)) return false;
  return Date.now() - computedAtMs <= PREDICTION_CACHE_TTL_MS;
}

async function readCachedPrediction(
  admin: SupabaseClient | null,
  userId: string,
  movieId: string,
): Promise<CachedPredictionRow | null> {
  if (!admin) return null;
  const parsed = parseMovieId(movieId);
  if (!parsed) return null;
  const { data, error } = await admin
    .from("user_title_predictions")
    .select("user_id, media_type, tmdb_id, predicted, low, high, confidence, neighbor_count, computed_at, model_version")
    .eq("user_id", userId)
    .eq("media_type", parsed.mediaType)
    .eq("tmdb_id", parsed.tmdbId)
    .maybeSingle();
  if (error) {
    console.warn("match: cached prediction read failed", error.message);
    return null;
  }
  return (data as CachedPredictionRow | null) ?? null;
}

async function writeCachedPrediction(
  admin: SupabaseClient | null,
  userId: string,
  movieId: string,
  prediction: Pred,
): Promise<void> {
  if (!admin) return;
  const parsed = parseMovieId(movieId);
  if (!parsed) return;
  const { error } = await admin.from("user_title_predictions").upsert({
    user_id: userId,
    media_type: parsed.mediaType,
    tmdb_id: parsed.tmdbId,
    predicted: prediction.predicted,
    low: prediction.low,
    high: prediction.high,
    confidence: prediction.confidence,
    neighbor_count: prediction.neighborCount,
    computed_at: new Date().toISOString(),
    model_version: PREDICTION_MODEL_VERSION,
  }, { onConflict: "user_id,media_type,tmdb_id" });
  if (error) {
    console.warn("match: cached prediction write failed", error.message);
  }
}

// --- HTTP -------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = serviceKey
      ? createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      : null;
    if (!serviceKey) {
      console.warn("match: SUPABASE_SERVICE_ROLE_KEY missing — neighbour CF disabled (cold-start only)");
    }

    const body = await req.json();
    const action = (body.action as string) || "full";
    const userRatings = (body.userRatings as RatingsMap) || {};
    const catalogue = (body.catalogue as Movie[]) || [];

    if (action === "predict" || action === "predict_cached") {
      const movieId = body.movieId as string;
      if (!movieId) {
        return new Response(JSON.stringify({ error: "movieId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const otherRatings = await loadNeighborRatingsFromDb(admin, user.id, userRatings, {
        targetMovieId: movieId,
      });
      const neighbors = findNeighbors(userRatings, otherRatings);
      const cached = await readCachedPrediction(admin, user.id, movieId);
      const isSameModel = cached?.model_version === PREDICTION_MODEL_VERSION;
      if (cached && isSameModel && isFreshCachedPrediction(cached)) {
        return new Response(JSON.stringify({ prediction: toPredFromCache(cached), cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const prediction = predictRatingRange(movieId, neighbors);
      if (prediction) {
        await writeCachedPrediction(admin, user.id, movieId, prediction);
        return new Response(JSON.stringify({ prediction }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (cached && isSameModel) {
        return new Response(JSON.stringify({ prediction: toPredFromCache(cached), cached: true, stale: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ prediction: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "mood") {
      const otherRatings = await loadNeighborRatingsFromDb(admin, user.id, userRatings);
      const neighbors = findNeighbors(userRatings, otherRatings);
      const movies = (body.movies as Movie[]) || [];
      const vibe = Array.isArray(body.vibe)
        ? (body.vibe as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
      const seen = new Set(Object.keys(userRatings));
      const scoredPool = movies
        .filter((m) => !seen.has(m.id))
        .map((m) => {
          const pred = predictRatingRange(m.id, neighbors);
          return pred
            ? { movie: m, ...pred }
            : {
              movie: m,
              predicted: (m.tmdbRating as number) ?? 7,
              low: Math.max(1, ((m.tmdbRating as number) ?? 7) - 1),
              high: Math.min(10, ((m.tmdbRating as number) ?? 7) + 1),
              confidence: "low",
              neighborCount: 0,
            };
        })
      ;
      const scored = rankMoodByVibe(scoredPool, vibe).slice(0, 40);
      return new Response(JSON.stringify({ scored }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action !== "full") {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const inTheaters = (body.inTheaters as Movie[]) || [];
    const streamingMovies = (body.streamingMovies as Movie[]) || [];
    const streamingTV = (body.streamingTV as Movie[]) || [];
    const topPickOffset = typeof body.topPickOffset === "number" ? body.topPickOffset : 0;
    const otherRatings = await loadNeighborRatingsFromDb(admin, user.id, userRatings);

    const result = runFullMatch(
      userRatings,
      otherRatings,
      catalogue,
      inTheaters,
      streamingMovies,
      streamingTV,
      topPickOffset,
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message || "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
