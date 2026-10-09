import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// ------------------------------------------------------------------------------------------------
// Pulse — shared daily catalog (UTC date × region)
// ------------------------------------------------------------------------------------------------
//
// POST body: { utc_date?: string, region?: "US" | "IN" | "CA" } — optional `YYYY-MM-DD` (UTC); default today UTC.
//   `region` defaults to `US` (worldwide trending week + popular, 18 each).
//   `IN` = India-origin popularity pools (uncapped for display); the client applies Languages to show first
//   and the 18 cap when it reads the rows, so one India row serves every language preference.
//   `CA` = Canada-market popularity (released in Canada / on Canadian subscription), 18 each.
// Auth: JWT required (any signed-in user may trigger backfill for the missing day).
//
// 1) Read `pulse_catalog_daily` for (`utc_date`, `region`) (service role).
// 2) If missing: TMDB fetch (same composition as `App.jsx` Pulse strips), upsert row, return payload.
//    Before migration `20260924130000_pulse_catalog_daily_region.sql` (no `region` column): US uses the
//    one row per day; IN / CA are computed and returned without caching. Before
//    `20260924140000_pulse_catalog_daily_region_ca.sql` (check allows only US / IN), CA is returned uncached.
//
// Secrets: `TMDB_READ_ACCESS_TOKEN` (TMDB API read token — set in Supabase Edge secrets).
// ------------------------------------------------------------------------------------------------

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EDGE_FUNCTION_SLUG = "pulse-catalog";
const EDGE_FUNCTION_VERSION = "1.2.0";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_IMG_BACKDROP = "https://image.tmdb.org/t/p/w780";

const EXCLUDED_TRENDING_GENRE_IDS = new Set([10767, 10763]); // Talk + News
const DEFAULT_EXCLUDED_GENRE_IDS = [16]; // Animation

type PulseRegion = "US" | "IN" | "CA";

/** Indian original languages (matches `INDIA_THEATER_LANGS` in `App.jsx`). */
const INDIA_LANGS = ["hi", "ta", "te", "ml", "kn", "bn", "mr", "pa", "gu", "or", "as", "ur"];
/** Profile **Languages to show first** options (matches `ALL_INDIAN_LANGS` in `App.jsx`). */
const INDIA_PROFILE_LANGS = ["hi", "ta", "te", "ml", "kn", "bn", "mr"];
const PULSE_INDIA_MAIN_PER_TYPE = 18;
const PULSE_INDIA_LANG_SLICE = 6;
/** India **Popular**: established titles. Slices gate movies only — Indian TV vote counts are too thin. */
const PULSE_INDIA_POPULAR_MIN_VOTES = 50;
const PULSE_INDIA_POPULAR_SLICE_MIN_VOTES = 20;
/** Canada **Popular**: established titles (matches `PULSE_CANADA_POPULAR_MIN_VOTES` in `App.jsx`). */
const PULSE_CANADA_POPULAR_MIN_VOTES = 50;
const PULSE_STRIP_CAP = 18;

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

function parseRegionBody(raw: unknown): PulseRegion {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return code === "IN" || code === "CA" ? code : "US";
}

/** Postgres check violation — `region` value not allowed yet (CA before its migration). */
function isRegionCheckViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "23514" || /pulse_catalog_daily_region_check/i.test(String(err.message ?? ""));
}

function dateDaysAgoUtc(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** PostgREST errors when `region` (or its composite key) is not there yet. */
function isRegionSchemaMissing(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204" || err.code === "42P10") return true;
  return /region/i.test(String(err.message ?? ""));
}

function readCatalogRow(admin: SupabaseClient, utcDate: string, region: PulseRegion, legacySchema: boolean) {
  let q = admin.from("pulse_catalog_daily").select("trending, popular, fetched_at").eq("utc_date", utcDate);
  if (!legacySchema) q = q.eq("region", region);
  return q.maybeSingle();
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

function interleave(movies: NormItem[], shows: NormItem[]): NormItem[] {
  const mixed: NormItem[] = [];
  const max = Math.max(movies.length, shows.length);
  for (let i = 0; i < max; i++) {
    if (movies[i]) mixed.push(movies[i]);
    if (shows[i]) mixed.push(shows[i]);
  }
  return mixed;
}

function dedupeById(rows: NormItem[]): NormItem[] {
  return [...new Map(rows.map((m) => [m.id, m])).values()];
}

/**
 * One India Pulse strip pool: India-origin discover (`with_origin_country=IN`, Indian original languages,
 * popularity order, released, with poster), then the top {@link PULSE_INDIA_LANG_SLICE} per Profile language
 * and type. Mirrors `fetchPulseIndiaStripPool` in `App.jsx`.
 */
async function fetchPulseIndiaStripPool(
  token: string,
  { mainMinVotes = 0, sliceMovieMinVotes = 0 }: { mainMinVotes?: number; sliceMovieMinVotes?: number } = {},
): Promise<NormItem[]> {
  const today = utcDateToday();
  const collect = async (type: "movie" | "tv", langCodes: string[], minVotes: number, pages: number[]) => {
    const votes = minVotes > 0 ? `&vote_count.gte=${minVotes}` : "";
    const payloads = await Promise.all(
      pages.map((page) =>
        fetchTMDB(
          `/discover/${type}?language=en-US&sort_by=popularity.desc&page=${page}&with_origin_country=IN&watch_region=IN&region=IN&with_original_language=${langCodes.join("|")}${votes}`,
          token,
        )
      ),
    );
    const out: NormItem[] = [];
    for (const data of payloads) {
      if (isTmdbApiErrorPayload(data)) break;
      for (const item of resultsPayload(data)) {
        if (item?.id == null || !item.poster_path) continue;
        if (hasExcludedGenre(item)) continue;
        if (type === "tv" && hasExcludedGenre(item, [...EXCLUDED_TRENDING_GENRE_IDS])) continue;
        const date = String(item.release_date || item.first_air_date || "").slice(0, 10);
        if (date.length < 10 || date > today) continue;
        out.push(normalizeTMDBItem(item, type));
      }
    }
    return dedupeById(out);
  };
  const [mainMovies, mainShows, ...slices] = await Promise.all([
    collect("movie", INDIA_LANGS, mainMinVotes, [1, 2]),
    collect("tv", INDIA_LANGS, mainMinVotes, [1, 2]),
    ...INDIA_PROFILE_LANGS.flatMap((lang) => [
      collect("movie", [lang], sliceMovieMinVotes, [1]),
      collect("tv", [lang], 0, [1]),
    ]),
  ]);
  const sliceMovies = slices.filter((_, i) => i % 2 === 0).flatMap((rows) => rows.slice(0, PULSE_INDIA_LANG_SLICE));
  const sliceShows = slices.filter((_, i) => i % 2 === 1).flatMap((rows) => rows.slice(0, PULSE_INDIA_LANG_SLICE));
  return dedupeById([
    ...interleave(mainMovies.slice(0, PULSE_INDIA_MAIN_PER_TYPE), mainShows.slice(0, PULSE_INDIA_MAIN_PER_TYPE)),
    ...interleave(sliceMovies, sliceShows),
  ]);
}

async function fetchPulseIndiaCatalogFromTmdb(token: string): Promise<{ trending: NormItem[]; popular: NormItem[] }> {
  const [trending, popular] = await Promise.all([
    fetchPulseIndiaStripPool(token),
    fetchPulseIndiaStripPool(token, {
      mainMinVotes: PULSE_INDIA_POPULAR_MIN_VOTES,
      sliceMovieMinVotes: PULSE_INDIA_POPULAR_SLICE_MIN_VOTES,
    }),
  ]);
  return { trending, popular };
}

/**
 * Canada Pulse (Canada market, not Canadian-origin only): TMDB popularity, movies and TV interleaved, 18 each.
 * Trending = movies released in Canada in the last 90 days + series with an episode in the last 30 days on Canadian
 * subscription. Popular = movies released in Canada + series on Canadian subscription, `vote_count ≥ 50`.
 * Mirrors `fetchPulseCanadaCatalog` in `App.jsx`.
 */
async function fetchPulseCanadaCatalogFromTmdb(token: string): Promise<{ trending: NormItem[]; popular: NormItem[] }> {
  const today = utcDateToday();
  const collect = async (type: "movie" | "tv", query: string) => {
    const payloads = await Promise.all(
      [1, 2].map((page) =>
        fetchTMDB(`/discover/${type}?language=en-US&sort_by=popularity.desc&page=${page}${query}`, token)
      ),
    );
    const out: NormItem[] = [];
    for (const data of payloads) {
      if (isTmdbApiErrorPayload(data)) break;
      for (const item of resultsPayload(data)) {
        if (item?.id == null || !item.poster_path) continue;
        if (hasExcludedGenre(item)) continue;
        if (type === "tv" && hasExcludedGenre(item, [...EXCLUDED_TRENDING_GENRE_IDS])) continue;
        const date = String(item.release_date || item.first_air_date || "").slice(0, 10);
        if (date.length < 10 || date > today) continue;
        out.push(normalizeTMDBItem(item, type));
      }
    }
    return dedupeById(out);
  };
  const votes = `&vote_count.gte=${PULSE_CANADA_POPULAR_MIN_VOTES}`;
  const [trendMovies, trendShows, popMovies, popShows] = await Promise.all([
    collect("movie", `&region=CA&release_date.gte=${dateDaysAgoUtc(90)}&release_date.lte=${today}`),
    collect(
      "tv",
      `&watch_region=CA&with_watch_monetization_types=flatrate&air_date.gte=${dateDaysAgoUtc(30)}&air_date.lte=${today}`,
    ),
    collect("movie", `&region=CA&with_release_type=2|3|4|5&release_date.lte=${today}${votes}`),
    collect("tv", `&watch_region=CA&with_watch_monetization_types=flatrate${votes}`),
  ]);
  return {
    trending: interleave(trendMovies, trendShows).slice(0, PULSE_STRIP_CAP),
    popular: interleave(popMovies, popShows).slice(0, PULSE_STRIP_CAP),
  };
}

function fetchCatalogForRegion(region: PulseRegion, token: string) {
  if (region === "IN") return fetchPulseIndiaCatalogFromTmdb(token);
  if (region === "CA") return fetchPulseCanadaCatalogFromTmdb(token);
  return fetchPulseCatalogFromTmdb(token);
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
    const region = parseRegionBody(body.region);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let legacySchema = false;
    let { data: existing, error: readErr } = await readCatalogRow(admin, utcDate, region, false);
    if (readErr && isRegionSchemaMissing(readErr)) {
      legacySchema = true;
      if (region === "US") {
        ({ data: existing, error: readErr } = await readCatalogRow(admin, utcDate, region, true));
      } else {
        existing = null;
        readErr = null;
      }
    }

    if (readErr) {
      console.error("pulse-catalog: read failed", readErr);
      return jsonResponse({ error: "Could not load Pulse cache." }, 500);
    }

    if (existing && Array.isArray(existing.trending) && Array.isArray(existing.popular)) {
      return jsonResponse({
        ok: true,
        cached: true,
        utc_date: utcDate,
        region,
        trending: existing.trending,
        popular: existing.popular,
        fetched_at: existing.fetched_at ?? null,
      });
    }

    const { trending, popular } = await fetchCatalogForRegion(region, tmdbToken);

    if (legacySchema && region !== "US") {
      console.warn(`pulse-catalog: region column missing — ${region} catalog not cached`);
      return jsonResponse({
        ok: true,
        cached: false,
        utc_date: utcDate,
        region,
        trending,
        popular,
        fetched_at: null,
      });
    }

    const row: Record<string, unknown> = {
      utc_date: utcDate,
      trending,
      popular,
      fetched_at: new Date().toISOString(),
    };
    if (!legacySchema) row.region = region;

    const { data: upserted, error: upErr } = await admin
      .from("pulse_catalog_daily")
      .upsert(row, { onConflict: legacySchema ? "utc_date" : "utc_date,region" })
      .select("trending, popular, fetched_at")
      .maybeSingle();

    if (upErr && isRegionCheckViolation(upErr)) {
      console.warn(`pulse-catalog: region ${region} not allowed by pulse_catalog_daily_region_check — not cached`);
      return jsonResponse({
        ok: true,
        cached: false,
        utc_date: utcDate,
        region,
        trending,
        popular,
        fetched_at: null,
      });
    }

    if (upErr) {
      console.error("pulse-catalog: upsert failed", upErr);
      return jsonResponse({ error: "Could not save Pulse catalog." }, 500);
    }

    if (upserted && Array.isArray(upserted.trending) && Array.isArray(upserted.popular)) {
      return jsonResponse({
        ok: true,
        cached: false,
        utc_date: utcDate,
        region,
        trending: upserted.trending,
        popular: upserted.popular,
        fetched_at: upserted.fetched_at ?? null,
      });
    }

    // Race: another request inserted first — read again.
    const { data: again, error: againErr } = await readCatalogRow(admin, utcDate, region, legacySchema);

    if (againErr || !again || !Array.isArray(again.trending) || !Array.isArray(again.popular)) {
      return jsonResponse({
        ok: true,
        cached: false,
        utc_date: utcDate,
        region,
        trending,
        popular,
        fetched_at: null,
      });
    }

    return jsonResponse({
      ok: true,
      cached: true,
      utc_date: utcDate,
      region,
      trending: again.trending,
      popular: again.popular,
      fetched_at: again.fetched_at ?? null,
    });
  } catch (e) {
    console.error("pulse-catalog:", e);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
