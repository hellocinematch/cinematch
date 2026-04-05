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

/** v1 caps: keep edge CPU + DB reads bounded. Tune as data grows. */
const MAX_SEED_TITLE_KEYS = 100;
const MAX_TMDB_IDS_PER_CHUNK = 120;
const MAX_ROWS_OVERLAP_PER_CHUNK = 6000;
const MAX_CANDIDATES_FROM_OVERLAP = 250;
const MAX_NEIGHBORS_FULL_FETCH = 40;
const MAX_ROWS_FULL_RATINGS = 15_000;
const RATINGS_PAGE_SIZE = 1000;

type Movie = Record<string, unknown> & {
  id: string;
  tmdbRating?: number;
  popularity?: number;
};

type RatingsMap = Record<string, number>;
type OtherRatings = Record<string, RatingsMap>;

function ratingRowKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}-${tmdbId}`;
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
  return pool.slice(0, 12).map((m) => buildRecWithPrediction(m, neighbors));
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
): Promise<OtherRatings> {
  if (!admin || Object.keys(userRatings).length === 0) return {};

  const titleKeys = Object.keys(userRatings).slice(0, MAX_SEED_TITLE_KEYS);
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
    .slice(0, MAX_CANDIDATES_FROM_OVERLAP)
    .map(([uid]) => uid);

  if (candidateIds.length === 0) return {};

  const rankedBySim = candidateIds
    .map((uid) => ({
      uid,
      sim: cosineSimilarity(userRatings, partial[uid]!),
    }))
    .filter((x) => x.sim > 0)
    .sort((a, b) => b.sim - a.sim);

  const topIds = rankedBySim.slice(0, MAX_NEIGHBORS_FULL_FETCH).map((x) => x.uid);
  if (topIds.length === 0) return {};

  return await fetchFullMapsForUsers(admin, topIds);
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

    const otherRatings = await loadNeighborRatingsFromDb(admin, user.id, userRatings);
    const neighbors = findNeighbors(userRatings, otherRatings);

    if (action === "predict") {
      const movieId = body.movieId as string;
      if (!movieId) {
        return new Response(JSON.stringify({ error: "movieId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const prediction = predictRatingRange(movieId, neighbors);
      return new Response(JSON.stringify({ prediction }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "mood") {
      const movies = (body.movies as Movie[]) || [];
      const seen = new Set(Object.keys(userRatings));
      const scored = movies
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
        .sort((a, b) => b.predicted - a.predicted)
        .slice(0, 5);
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
