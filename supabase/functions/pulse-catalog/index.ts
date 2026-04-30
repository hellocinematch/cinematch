import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ------------------------------------------------------------------------------------------------
// Pulse — shared daily catalog (UTC date)
// ------------------------------------------------------------------------------------------------
//
// POST body: { utc_date?: string } — optional `YYYY-MM-DD` (UTC); default today UTC.
// Auth: JWT required (any signed-in user may trigger backfill for the missing day).
//
// 1) Read `pulse_catalog_daily` for `utc_date` (service role).
// 2) If missing: TMDB fetch (same composition as `App.jsx` Pulse strips), upsert row, return payload.
//
// Secrets: `TMDB_READ_ACCESS_TOKEN` (TMDB API read token — set in Supabase Edge secrets).
// ------------------------------------------------------------------------------------------------

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EDGE_FUNCTION_SLUG = "pulse-catalog";
const EDGE_FUNCTION_VERSION = "1.0.0";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_IMG_BACKDROP = "https://image.tmdb.org/t/p/w780";

const EXCLUDED_TRENDING_GENRE_IDS = new Set([10767, 10763]); // Talk + News
const DEFAULT_EXCLUDED_GENRE_IDS = [16]; // Animation

type NormItem = {
  id: string;
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  year: string;
  releaseDate: string | null;
  genre: string;
  genreIds: number[];
  synopsis: string;
  poster: string | null;
  backdrop: string | null;
  tmdbRating: number;
  popularity: unknown;
  language: string;
  originCountries: string[];
};

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

function isTmdbApiErrorPayload(json: unknown): boolean {
  return Boolean(json && typeof json === "object" && (json as { success?: boolean }).success === false);
}

function utcDateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseUtcDateBody(raw: unknown): string | null {
  if (raw == null || typeof raw !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function tmdbReleaseDateString(item: Record<string, unknown>): string | null {
  const r = item.release_date || item.first_air_date;
  const raw = typeof r === "string" ? r : "";
  return raw.length >= 10 ? raw.slice(0, 10) : null;
}

function normalizeTMDBItem(item: Record<string, unknown>, type: "movie" | "tv"): NormItem {
  const tid = Number(item.id);
  const oc = item.origin_country;
  const originCountries = Array.isArray(oc)
    ? (oc as unknown[]).filter((c): c is string => typeof c === "string").map((c) => c.toUpperCase())
    : Array.isArray(item.production_countries)
      ? (item.production_countries as { iso_3166_1?: string }[])
        .map((c) => c?.iso_3166_1)
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.toUpperCase())
      : [];
  const gid = item.genre_ids;
  return {
    id: `${type}-${tid}`,
    tmdbId: tid,
    type,
    title: String(item.title || item.name || ""),
    year: String(item.release_date || item.first_air_date || "").slice(0, 4),
    releaseDate: tmdbReleaseDateString(item),
    genre: type === "movie" ? "Movie" : "TV Show",
    genreIds: Array.isArray(gid) ? (gid as number[]) : [],
    synopsis: String(item.overview || ""),
    poster: typeof item.poster_path === "string" && item.poster_path
      ? `${TMDB_IMG}${item.poster_path}`
      : null,
    backdrop: typeof item.backdrop_path === "string" && item.backdrop_path
      ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}`
      : null,
    tmdbRating: Math.round(Number(item.vote_average) * 10) / 10,
    popularity: item.popularity,
    language: String(item.original_language || "en"),
    originCountries,
  };
}

function hasExcludedGenre(item: Record<string, unknown>, excluded: number[] = DEFAULT_EXCLUDED_GENRE_IDS): boolean {
  const raw = item.genre_ids;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  const ids = new Set(raw.map((g) => Number(g)).filter((n) => Number.isFinite(n)));
  return excluded.some((id) => ids.has(id));
}

function filterDefaultExcludedGenres(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return items.filter((item) => !hasExcludedGenre(item));
}

async function fetchTMDB(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${TMDB_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  return res.json();
}

function resultsPayload(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const r = (json as { results?: unknown }).results;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function buildPulseTrending(m1: unknown, m2: unknown, t1: unknown, t2: unknown): NormItem[] {
  if ([m1, m2, t1, t2].some(isTmdbApiErrorPayload)) return [];
  const movieRaw = filterDefaultExcludedGenres([
    ...resultsPayload(m1),
    ...resultsPayload(m2),
  ]);
  const tvRaw = filterDefaultExcludedGenres([
    ...resultsPayload(t1),
    ...resultsPayload(t2),
  ]).filter((item) => {
    const genreIds = Array.isArray(item.genre_ids) ? item.genre_ids as number[] : [];
    return !genreIds.some((g) => EXCLUDED_TRENDING_GENRE_IDS.has(Number(g)));
  });
  const dedupeNorm = (normList: NormItem[]) => [...new Map(normList.map((m) => [m.tmdbId, m])).values()];
  const movies = dedupeNorm(movieRaw.map((item) => normalizeTMDBItem(item, "movie")));
  const shows = dedupeNorm(tvRaw.map((item) => normalizeTMDBItem(item, "tv")));
  const mixed: NormItem[] = [];
  const max = Math.max(movies.length, shows.length);
  const cap = 18;
  for (let i = 0; i < max && mixed.length < cap; i++) {
    if (movies[i]) mixed.push(movies[i]);
    if (mixed.length >= cap) break;
    if (shows[i]) mixed.push(shows[i]);
  }
  return mixed;
}

async function fetchPulseCatalogFromTmdb(token: string): Promise<{ trending: NormItem[]; popular: NormItem[] }> {
  const [m1, m2, t1, t2, p1, p2, pt1, pt2] = await Promise.all([
    fetchTMDB("/trending/movie/week?language=en-US", token),
    fetchTMDB("/trending/movie/week?language=en-US&page=2", token),
    fetchTMDB("/trending/tv/week?language=en-US", token),
    fetchTMDB("/trending/tv/week?language=en-US&page=2", token),
    fetchTMDB("/movie/popular?language=en-US&page=1", token),
    fetchTMDB("/movie/popular?language=en-US&page=2", token),
    fetchTMDB("/tv/popular?language=en-US&page=1", token),
    fetchTMDB("/tv/popular?language=en-US&page=2", token),
  ]);
  const trending = buildPulseTrending(m1, m2, t1, t2);
  const popular = buildPulseTrending(p1, p2, pt1, pt2);
  return { trending, popular };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const tmdbToken = Deno.env.get("TMDB_READ_ACCESS_TOKEN");
    if (!supabaseUrl || !supabaseAnonKey || !serviceKey) {
      console.error("pulse-catalog: missing Supabase env");
      return jsonResponse({ error: "Server misconfigured." }, 500);
    }
    if (!tmdbToken) {
      console.error("pulse-catalog: missing TMDB_READ_ACCESS_TOKEN");
      return jsonResponse({ error: "Server misconfigured." }, 500);
    }

    const authed = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await authed.auth.getUser();
    if (userErr || !userRes?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let body: Record<string, unknown> = {};
    try {
      const txt = await req.text();
      if (txt.trim()) body = JSON.parse(txt) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const utcDate = parseUtcDateBody(body.utc_date) ?? utcDateToday();

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existing, error: readErr } = await admin
      .from("pulse_catalog_daily")
      .select("trending, popular, fetched_at")
      .eq("utc_date", utcDate)
      .maybeSingle();

    if (readErr) {
      console.error("pulse-catalog: read failed", readErr);
      return jsonResponse({ error: "Could not load Pulse cache." }, 500);
    }

    if (existing && Array.isArray(existing.trending) && Array.isArray(existing.popular)) {
      return jsonResponse({
        ok: true,
        cached: true,
        utc_date: utcDate,
        trending: existing.trending,
        popular: existing.popular,
        fetched_at: existing.fetched_at ?? null,
      });
    }

    const { trending, popular } = await fetchPulseCatalogFromTmdb(tmdbToken);

    const { data: upserted, error: upErr } = await admin
      .from("pulse_catalog_daily")
      .upsert(
        {
          utc_date: utcDate,
          trending,
          popular,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "utc_date" },
      )
      .select("trending, popular, fetched_at")
      .maybeSingle();

    if (upErr) {
      console.error("pulse-catalog: upsert failed", upErr);
      return jsonResponse({ error: "Could not save Pulse catalog." }, 500);
    }

    if (upserted && Array.isArray(upserted.trending) && Array.isArray(upserted.popular)) {
      return jsonResponse({
        ok: true,
        cached: false,
        utc_date: utcDate,
        trending: upserted.trending,
        popular: upserted.popular,
        fetched_at: upserted.fetched_at ?? null,
      });
    }

    // Race: another request inserted first — read again.
    const { data: again, error: againErr } = await admin
      .from("pulse_catalog_daily")
      .select("trending, popular, fetched_at")
      .eq("utc_date", utcDate)
      .maybeSingle();

    if (againErr || !again || !Array.isArray(again.trending) || !Array.isArray(again.popular)) {
      return jsonResponse({
        ok: true,
        cached: false,
        utc_date: utcDate,
        trending,
        popular,
        fetched_at: null,
      });
    }

    return jsonResponse({
      ok: true,
      cached: true,
      utc_date: utcDate,
      trending: again.trending,
      popular: again.popular,
      fetched_at: again.fetched_at ?? null,
    });
  } catch (e) {
    console.error("pulse-catalog:", e);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
