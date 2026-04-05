import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Match algorithm (server-only) ------------------------------------------

const MIN_NEIGHBOR_OVERLAP = 1;
const MIN_NEIGHBORS = 1;
const MIN_MOVIE_RATINGS = 1;

type Movie = Record<string, unknown> & {
  id: string;
  tmdbRating?: number;
  popularity?: number;
};

type RatingsMap = Record<string, number>;
type OtherRatings = Record<string, RatingsMap>;

function hashStringToSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) || 1;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandomIds(ids: string[], count: number, rnd: () => number): string[] {
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

function buildMockRatings(catalogue: Movie[], userId: string): OtherRatings {
  if (catalogue.length < 10) return {};
  const ids = catalogue.map((m) => m.id);
  const seedStr = `${userId}|${[...ids].sort().join(",")}`;
  const rnd = mulberry32(hashStringToSeed(seedStr));
  const rand = () => Math.round((rnd() * 4 + 6) * 10) / 10;
  const pickRandom = (count: number) => {
    const picked = pickRandomIds(ids, Math.min(count, ids.length), rnd);
    return Object.fromEntries(picked.map((id) => [id, rand()]));
  };
  return {
    alice: pickRandom(20),
    bob: pickRandom(20),
    carol: pickRandom(20),
    dave: pickRandom(20),
    eve: pickRandom(20),
    frank: pickRandom(20),
    grace: pickRandom(20),
    henry: pickRandom(20),
    iris: pickRandom(20),
    jake: pickRandom(20),
    kate: pickRandom(20),
    leo: pickRandom(20),
  };
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
  userId: string,
  userRatings: RatingsMap,
  catalogue: Movie[],
  inTheaters: Movie[],
  streamingMovies: Movie[],
  streamingTV: Movie[],
  topPickOffset: number,
) {
  const otherRatings = buildMockRatings(catalogue, userId);
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

    const body = await req.json();
    const action = (body.action as string) || "full";
    const userRatings = (body.userRatings as RatingsMap) || {};
    const catalogue = (body.catalogue as Movie[]) || [];

    const otherRatings = buildMockRatings(catalogue, user.id);
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
      user.id,
      userRatings,
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
