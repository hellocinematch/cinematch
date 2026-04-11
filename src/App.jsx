import { useState, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import packageJson from "../package.json";
import { AppFooter } from "./appFooter.jsx";
import { supabase } from "./supabase";

const LegalPagePrivacy = lazy(() => import("./legal.jsx").then((m) => ({ default: m.LegalPagePrivacy })));
const LegalPageTerms = lazy(() => import("./legal.jsx").then((m) => ({ default: m.LegalPageTerms })));
const LegalPageAbout = lazy(() => import("./legal.jsx").then((m) => ({ default: m.LegalPageAbout })));

// Shown on Profile as "Cinemastro v…". See CHANGELOG.md (v1.3.11 = Your picks: stable strip pool, no flash-shrink).
const APP_VERSION = packageJson.version;

const TMDB_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiOThhYjJlMThiODdjZmQyODFhY2JlYWZmNDhkMjE0ZSIsIm5iZiI6MTc3NDY0MTcxMS4yNDYsInN1YiI6IjY5YzZlMjJmYWRkOGNkNzhkMTUzNzgyOSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.jJhQu5G7iVJyW4MqDttCqiGestEHZjsrUKe73baRO7A";
const TMDB_BASE = "https://api.themoviedb.org/3";
/** Direct TMDB CDN URLs work on Vercel; `/tmdb-images` only works via Vite dev proxy. */
const TMDB_IMG_HOST = "https://image.tmdb.org";
const TMDB_IMG = `${TMDB_IMG_HOST}/t/p/w500`;
const TMDB_IMG_BACKDROP = `${TMDB_IMG_HOST}/t/p/w780`;
const DEFAULT_EXCLUDED_GENRE_IDS = [16]; // Animation

const TMDB_HEADERS = {
  Authorization: `Bearer ${TMDB_TOKEN}`,
  "Content-Type": "application/json",
};

/** TMDB watch provider IDs (US, subscription / major services). Used with Where to Watch data. */
const STREAMING_SERVICES = [
  { id: 8, label: "Netflix" },
  { id: 9, label: "Prime Video" },
  { id: 15, label: "Hulu" },
  { id: 337, label: "Disney+" },
  { id: 350, label: "Apple TV+" },
  { id: 386, label: "Peacock" },
  { id: 531, label: "Paramount+" },
  { id: 1899, label: "Max" },
  { id: 43, label: "Starz" },
  { id: 34, label: "AMC+" },
];

async function fetchTMDB(path) {
  const res = await fetch(`${TMDB_BASE}${path}`, { headers: TMDB_HEADERS });
  return res.json();
}

/** TMDB search returns ~20 hits per page; preserve order, drop duplicate ids across pages. */
function dedupeTmdbSearchRows(ordered) {
  const seen = new Set();
  const out = [];
  for (const item of ordered) {
    if (item == null || item.id == null) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function isTmdbApiErrorPayload(json) {
  return Boolean(json && json.success === false);
}

async function fetchTmdbSearchPages(mediaType, query, pageCount) {
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) =>
      fetchTMDB(`/search/${mediaType}?query=${encodeURIComponent(query)}&page=${i + 1}`),
    ),
  );
  if (pages.some(isTmdbApiErrorPayload)) return { ok: false, rows: [] };
  const rows = dedupeTmdbSearchRows(pages.flatMap((p) => p?.results || []));
  return { ok: true, rows };
}

/** Avoid `?? []` on match payloads — a new array every render retriggers memos/effects and can flash strips. */
const EMPTY_MATCH_RECS = [];

/** Discover: how many TMDB search pages to merge (broader tail than website #2 ≠ API #2). */
const DISCOVER_SEARCH_PAGES = 2;
const DISCOVER_ALL_CAP_MOVIES = 40;
const DISCOVER_ALL_CAP_TV = 40;
const DISCOVER_SINGLE_TYPE_CAP = 40;

/** More tab: CF picks on selected streaming apps vs strong CF picks not on those apps. */
const MORE_TAB_ON_SERVICE_MAX = 15;
const MORE_TAB_OFF_SERVICE_MAX = 20;
/** Strip 2 floor; also used to backfill strip 1 from scored theater / streaming / worth-a-look rows. */
const MORE_TAB_OFF_SERVICE_PRED_MIN = 6.5;

/**
 * When CF `recommendations` is short, strip 2 would be empty after taking strip 1. The Edge function
 * already returns `worthALookRecs` (catalogue + predictions); merge those in up to MORE_TAB_OFF_SERVICE_MAX.
 */
function fillWorthLookStripFromPool(strip1Ids, strip2, pool) {
  const used = new Set([...strip1Ids, ...strip2.map((r) => r.movie.id)]);
  const out = [...strip2];
  const rest = pool
    .filter((r) => r?.movie?.id && !used.has(r.movie.id) && r.predicted >= MORE_TAB_OFF_SERVICE_PRED_MIN)
    .sort((a, b) => b.predicted - a.predicted);
  for (const r of rest) {
    if (out.length >= MORE_TAB_OFF_SERVICE_MAX) break;
    out.push(r);
    used.add(r.movie.id);
  }
  return out;
}

/** Grow strips toward row caps from the scored pool (predictions only). Fills partial rows, not only empty strips. */
function topUpYourPicksStrips(strip1, strip2, pool) {
  const used = new Set([...strip1, ...strip2].map((r) => r.movie.id));
  let out1 = [...strip1];
  let out2 = [...strip2];
  for (const r of pool) {
    if (out1.length >= MORE_TAB_ON_SERVICE_MAX) break;
    if (!used.has(r.movie.id)) {
      out1.push(r);
      used.add(r.movie.id);
    }
  }
  for (const r of pool) {
    if (out2.length >= MORE_TAB_OFF_SERVICE_MAX) break;
    if (!used.has(r.movie.id)) {
      out2.push(r);
      used.add(r.movie.id);
    }
  }
  if (out2.length === 0 && out1.length > 1) {
    const weakest = [...out1].sort((a, b) => a.predicted - b.predicted)[0];
    out1 = out1.filter((r) => r.movie.id !== weakest.movie.id);
    out2 = [weakest];
  }
  return [out1, out2];
}

function toPickRows(recs) {
  return recs.map((r) => ({ rec: r, kind: "pick" }));
}

/** Home secondary nav: internal ids align with tab labels (Now Playing / Your picks / Friends). */
const HOME_SEGMENT_NOW_PLAYING = "nowPlaying";
const HOME_SEGMENT_YOUR_PICKS = "yourPicks";
const HOME_SEGMENT_FRIENDS = "friends";

/** First TMDB catalogue fetch: post-login routing waits for this (or safety timeout), not for catalogue.length > 0. */
const CATALOGUE_BOOTSTRAP_SAFETY_MS = 22_000;
/** Defer non-critical home fetches so first paint / post-login routing wins on slow mobile networks. */
const WHATS_HOT_FETCH_DEFER_MS = 450;
const SECONDARY_STRIP_FETCH_DEFER_MS = 550;
/** Primary home streaming strip: defer so TMDB catalogue + theaters win the first bytes on cellular. */
const STREAMING_HOME_FETCH_DEFER_MS = 200;

function getRegionLanguageCodes(regionKeys) {
  if (!Array.isArray(regionKeys) || regionKeys.length === 0) return [];
  return [...new Set(
    PROFILE_REGION_OPTIONS
      .filter(option => regionKeys.includes(option.id))
      .flatMap(option => option.languages || [])
      .map(code => String(code).toLowerCase()),
  )];
}

/** /discover/tv uses first_air_date.* — movie uses primary_release_date.* */
function tmdbTvParamsFromMovieParams(movieOriented) {
  const tv = new URLSearchParams(movieOriented.toString());
  const gte = tv.get("primary_release_date.gte");
  const lte = tv.get("primary_release_date.lte");
  tv.delete("primary_release_date.gte");
  tv.delete("primary_release_date.lte");
  if (gte) tv.set("first_air_date.gte", gte);
  if (lte) tv.set("first_air_date.lte", lte);
  return tv;
}

/** Legacy rows used `/tmdb-images/...` (dev proxy); DB may store bare paths. */
function normalizeWatchlistPosterUrl(poster) {
  if (poster == null || poster === "") return null;
  const s = String(poster).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/tmdb-images")) {
    return `${TMDB_IMG_HOST}${s.slice("/tmdb-images".length)}`;
  }
  const path = s.startsWith("/") ? s : `/${s}`;
  return `${TMDB_IMG}${path}`;
}

function buildWatchlistFromRows(watchlistData, catalogue) {
  if (!watchlistData?.length) return [];
  const movieMap = Object.fromEntries(catalogue.map(m => [m.id, m]));
  return watchlistData.map(w => {
    const id = `${w.media_type}-${w.tmdb_id}`;
    const base = movieMap[id] || { id, tmdbId: w.tmdb_id, type: w.media_type, title: w.title, poster: w.poster };
    const poster = normalizeWatchlistPosterUrl(base.poster);
    return { ...base, poster: poster ?? base.poster };
  }).filter(Boolean);
}

/** YYYY-MM-DD from TMDB when present (movies: release_date; TV: first_air_date). */
function tmdbReleaseDateString(item) {
  const raw = item?.release_date || item?.first_air_date || "";
  return raw.length >= 10 ? raw.slice(0, 10) : null;
}

function normalizeTMDBItem(item, type) {
  const originCountries = Array.isArray(item.origin_country)
    ? item.origin_country.filter(c => typeof c === "string").map(c => c.toUpperCase())
    : Array.isArray(item.production_countries)
      ? item.production_countries.map(c => c?.iso_3166_1).filter(c => typeof c === "string").map(c => c.toUpperCase())
      : [];
  return {
    id: `${type}-${item.id}`,
    tmdbId: item.id,
    type,
    title: item.title || item.name,
    year: (item.release_date || item.first_air_date || "").slice(0, 4),
    releaseDate: tmdbReleaseDateString(item),
    genre: type === "movie" ? "Movie" : "TV Show",
    genreIds: item.genre_ids || [],
    synopsis: item.overview || "",
    poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
    backdrop: item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : null,
    tmdbRating: Math.round(item.vote_average * 10) / 10,
    popularity: item.popularity,
    language: item.original_language || "en",
    originCountries,
  };
}

function hasExcludedGenre(item, excludedGenreIds = DEFAULT_EXCLUDED_GENRE_IDS) {
  const raw = item?.genre_ids ?? item?.genreIds ?? [];
  if (!Array.isArray(raw) || raw.length === 0) return false;
  const ids = new Set(raw.map((g) => Number(g)).filter((n) => Number.isFinite(n)));
  return excludedGenreIds.some((id) => ids.has(id));
}

function filterDefaultExcludedGenres(items, allowAnimation = false) {
  if (allowAnimation) return items;
  return (items || []).filter((item) => !hasExcludedGenre(item));
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return formatIsoDate(d);
}

function withinPastDays(dateString, days) {
  if (!dateString) return false;
  const thenMs = Date.parse(dateString);
  if (!Number.isFinite(thenMs)) return false;
  const ageMs = Date.now() - thenMs;
  return ageMs >= 0 && ageMs <= days * 24 * 60 * 60 * 1000;
}

/**
 * V1.3.1: “In theaters” pill guard — TMDB `now_playing` can include legacy titles (re-runs, data quirks)
 * while `movie.year` / `releaseDate` stay the original theatrical date. Hide the pill when that metadata
 * is clearly not a current run.
 */
function qualifiesForTheatricalPillMovie(movie) {
  const cy = new Date().getFullYear();
  const y = Number.parseInt(String(movie?.year ?? ""), 10);
  if (Number.isFinite(y) && y < cy - 2) return false;
  const rd = movie?.releaseDate;
  if (typeof rd === "string" && rd.length >= 10) {
    const t = Date.parse(rd.slice(0, 10));
    if (Number.isFinite(t)) {
      const twoYearsMs = 730 * 24 * 60 * 60 * 1000;
      if (Date.now() - t > twoYearsMs) return false;
    }
  }
  return true;
}

async function fetchTvDetailsById(ids = []) {
  const uniqueIds = [...new Set((ids || []).filter((id) => Number.isFinite(Number(id))))].slice(0, 30);
  const detailRows = await Promise.all(uniqueIds.map(async (id) => {
    try {
      const d = await fetchTMDB(`/tv/${id}?language=en-US`);
      return [id, d];
    } catch {
      return [id, null];
    }
  }));
  return new Map(detailRows);
}

async function fetchMovieReleaseDatesById(ids = []) {
  const uniqueIds = [...new Set((ids || []).filter((id) => Number.isFinite(Number(id))))].slice(0, 40);
  const rows = await Promise.all(uniqueIds.map(async (id) => {
    try {
      const d = await fetchTMDB(`/movie/${id}/release_dates`);
      return [id, d];
    } catch {
      return [id, null];
    }
  }));
  return new Map(rows);
}

function isAnimationIntentQuery(query) {
  return /(animation|animated|anime|cartoon|pixar|ghibli|disney)/i.test(String(query || ""));
}

function isDocumentaryLike(item) {
  const text = `${item?.title || item?.name || ""} ${item?.synopsis || item?.overview || ""}`.toLowerCase();
  return /(documentary|docuseries|docu-series|docu series|true story documentary|nature series|travel documentary)/i.test(text);
}

function passesMoodRegionFilter(item, selectedRegions) {
  if (!Array.isArray(selectedRegions) || selectedRegions.length === 0 || selectedRegions.includes("any")) return true;
  const lang = String(item?.language || "").toLowerCase();
  const originCountries = Array.isArray(item?.originCountries)
    ? item.originCountries.map((c) => String(c).toUpperCase())
    : [];
  const hasOrigin = originCountries.length > 0;

  const HOLLYWOOD_COUNTRIES = new Set(["US", "GB", "CA", "AU", "NZ"]);
  const INDIAN_COUNTRIES = new Set(["IN"]);
  const regionLanguages = new Map(MOOD_CARDS[0].options.map((o) => [o.id, o.languages || []]));

  const languageMatch = selectedRegions.some((r) => (regionLanguages.get(r) || []).includes(lang));
  const hollywoodSelected = selectedRegions.includes("en");
  const indianSelected = selectedRegions.includes("indian");
  const hollywoodCountryMatch = originCountries.length > 0 && originCountries.every((c) => HOLLYWOOD_COUNTRIES.has(c));
  const indianCountryMatch = originCountries.some((c) => INDIAN_COUNTRIES.has(c));
  const nonCountryRegionSelected = selectedRegions.some((r) => !["en", "indian", "any"].includes(r));

  // For hollywood/indian, enforce origin-country when present; otherwise allow language fallback.
  if (hollywoodSelected || indianSelected) {
    if (hasOrigin) {
      if (hollywoodSelected && hollywoodCountryMatch) return true;
      if (indianSelected && indianCountryMatch) return true;
      return nonCountryRegionSelected ? languageMatch : false;
    }
    return nonCountryRegionSelected ? languageMatch : false;
  }
  return languageMatch;
}

async function fetchInTheaters(regionKeys = []) {
  try {
    const TARGET_COUNT = 15;
    const LIMITED_THEATRICAL_MAX_DAYS = 14;
    const langCodes = getRegionLanguageCodes(regionKeys);
    const now = formatIsoDate(new Date());
    const [p1, p2] = await Promise.all([
      fetchTMDB("/movie/now_playing?language=en-US&region=US&page=1"),
      fetchTMDB("/movie/now_playing?language=en-US&region=US&page=2"),
    ]);

    const sortByPopularityVotesDate = (items) => [...items].sort((a, b) => {
      const popDiff = Number(b?.popularity ?? 0) - Number(a?.popularity ?? 0);
      if (popDiff !== 0) return popDiff;
      const votesDiff = Number(b?.vote_count ?? 0) - Number(a?.vote_count ?? 0);
      if (votesDiff !== 0) return votesDiff;
      return Date.parse(b?.release_date || "1970-01-01") - Date.parse(a?.release_date || "1970-01-01");
    });

    const merged = filterDefaultExcludedGenres([...(p1.results || []), ...(p2.results || [])])
      // Exclude soon-to-release titles that TMDB may include in now_playing payloads.
      .filter((item) => item?.release_date && item.release_date <= now)
      .filter((item) => (langCodes.length > 0 ? langCodes.includes(String(item?.original_language || "").toLowerCase()) : true));

    const deduped = [...new Map(merged.map((item) => [item.id, item])).values()];
    const releaseDatesMap = await fetchMovieReleaseDatesById(deduped.map((item) => item.id));
    const withLimitedWindowGate = deduped.filter((item) => {
      const releasePayload = releaseDatesMap.get(item.id);
      const usDates = Array.isArray(releasePayload?.results)
        ? releasePayload.results.find((r) => r?.iso_3166_1 === "US")?.release_dates || []
        : [];
      const limitedDates = usDates
        .filter((r) => Number(r?.type) === 2 && typeof r?.release_date === "string")
        .map((r) => r.release_date.slice(0, 10))
        .filter(Boolean)
        .sort();
      if (limitedDates.length === 0) return true;
      const newestLimited = limitedDates[limitedDates.length - 1];
      return withinPastDays(newestLimited, LIMITED_THEATRICAL_MAX_DAYS);
    });
    return sortByPopularityVotesDate(withLimitedWindowGate).slice(0, TARGET_COUNT).map((m) => normalizeTMDBItem(m, "movie"));
  } catch {
    return [];
  }
}

/** Now Playing — trending movies + TV (day), interleaved; not deduped against other strips. */
async function fetchWhatsHotCatalog() {
  try {
    const excludedTrendingGenres = new Set([10767, 10763]); // Talk + News
    const [m1, m2, t1, t2] = await Promise.all([
      fetchTMDB("/trending/movie/day?language=en-US"),
      fetchTMDB("/trending/movie/day?language=en-US&page=2"),
      fetchTMDB("/trending/tv/day?language=en-US"),
      fetchTMDB("/trending/tv/day?language=en-US&page=2"),
    ]);
    if ([m1, m2, t1, t2].some(isTmdbApiErrorPayload)) return [];
    const movieRaw = filterDefaultExcludedGenres([...(m1.results || []), ...(m2.results || [])]);
    const tvRaw = filterDefaultExcludedGenres([...(t1.results || []), ...(t2.results || [])]).filter((item) => {
      const genreIds = Array.isArray(item?.genre_ids) ? item.genre_ids : [];
      return !genreIds.some((g) => excludedTrendingGenres.has(Number(g)));
    });
    const dedupeNorm = (normList) => [...new Map(normList.map((m) => [m.id, m])).values()];
    const movies = dedupeNorm(movieRaw.map((item) => normalizeTMDBItem(item, "movie")));
    const shows = dedupeNorm(tvRaw.map((item) => normalizeTMDBItem(item, "tv")));
    const mixed = [];
    const max = Math.max(movies.length, shows.length);
    const cap = 18;
    for (let i = 0; i < max && mixed.length < cap; i++) {
      if (movies[i]) mixed.push(movies[i]);
      if (mixed.length >= cap) break;
      if (shows[i]) mixed.push(shows[i]);
    }
    return mixed;
  } catch {
    return [];
  }
}

/**
 * Home Picks — subscription-style streaming (US TMDB). Not filtered by user-selected providers (faster, stable).
 * Phase 1: digital-release movies only (fast).
 */
async function fetchStreamingMoviesOnly(regionKeys) {
  try {
    const langCodes = getRegionLanguageCodes(regionKeys);
    const langQuery = langCodes.length > 0 ? `&with_original_language=${langCodes.join("|")}` : "";
    const digitalStart = dateDaysAgo(90);
    const digitalEnd = formatIsoDate(new Date());
    const digitalDiscoverBase =
      `/discover/movie?language=en-US&region=US&sort_by=popularity.desc&with_release_type=4&primary_release_date.gte=${digitalStart}&primary_release_date.lte=${digitalEnd}`;
    const broadDateDiscoverBase =
      `/discover/movie?language=en-US&region=US&sort_by=popularity.desc&primary_release_date.gte=${digitalStart}&primary_release_date.lte=${digitalEnd}`;

    const dedupeByTmdbId = (arr) => [...new Map(arr.map((item) => [item.id, item])).values()];

    const discoverToMovies = async (pathNoPage) => {
      const moviePages = await Promise.all([1, 2].map((page) => fetchTMDB(`${pathNoPage}&page=${page}`)));
      if (moviePages.some(isTmdbApiErrorPayload)) return [];
      const movieResults = filterDefaultExcludedGenres(moviePages.flatMap((page) => page.results || []));
      return dedupeByTmdbId(movieResults).slice(0, 16).map((m) => normalizeTMDBItem(m, "movie"));
    };

    const trendingToMovies = async () => {
      const trendPages = await Promise.all([1, 2].map((page) => fetchTMDB(`/trending/movie/week?language=en-US&page=${page}`)));
      if (trendPages.some(isTmdbApiErrorPayload)) return [];
      const rows = filterDefaultExcludedGenres(trendPages.flatMap((p) => p.results || []));
      return dedupeByTmdbId(rows).slice(0, 16).map((m) => normalizeTMDBItem(m, "movie"));
    };

    // 1) US digital-release window (primary intent for this strip).
    let out = await discoverToMovies(`${digitalDiscoverBase}${langQuery}`);
    if (out.length > 0) return out;

    // 2) Profile language filters often return zero rows for US digital discover; strip is labeled "broad picks".
    if (langQuery) {
      out = await discoverToMovies(`${digitalDiscoverBase}`);
      if (out.length > 0) return out;
    }

    // 3) Same date window without release-type gate (TMDB digital typing can be sparse in discover).
    out = await discoverToMovies(`${broadDateDiscoverBase}${langQuery}`);
    if (out.length > 0) return out;
    if (langQuery) {
      out = await discoverToMovies(`${broadDateDiscoverBase}`);
      if (out.length > 0) return out;
    }

    // 4) Last resort so the row is never permanently empty when TMDB discover is thin.
    return await trendingToMovies();
  } catch {
    return [];
  }
}

/** Phase 2: TV discover + trending + per-show /tv/{id} details (slower). Not provider-filtered. */
async function fetchStreamingTVOnly(regionKeys) {
  try {
    const langCodes = getRegionLanguageCodes(regionKeys);
    const langQuery = langCodes.length > 0 ? `&with_original_language=${langCodes.join("|")}` : "";
    const tvNewSeriesStart = dateDaysAgo(180);
    const excludedTrendingGenres = new Set([10767, 10763]); // Talk + News
    const tvNewSeriesBase = `/discover/tv?language=en-US&sort_by=popularity.desc&first_air_date.gte=${tvNewSeriesStart}&first_air_date.lte=${formatIsoDate(new Date())}${langQuery}`;
    const trendingTvBase = "/trending/tv/day?language=en-US";

    const [tvSeriesPages, tvTrendingPages] = await Promise.all([
      Promise.all([1, 2].map((page) => fetchTMDB(`${tvNewSeriesBase}&page=${page}`))),
      Promise.all([1, 2].map((page) => fetchTMDB(`${trendingTvBase}&page=${page}`))),
    ]);

    const tvNewSeriesCandidates = tvSeriesPages.flatMap((page) => page.results || []);
    const tvTrendingCandidates = tvTrendingPages
      .flatMap((page) => page.results || [])
      .filter((item) => {
        const genreIds = Array.isArray(item?.genre_ids) ? item.genre_ids : [];
        return !genreIds.some((g) => excludedTrendingGenres.has(Number(g)));
      });

    const tvCandidates = [...new Map(
      [...tvNewSeriesCandidates, ...tvTrendingCandidates].map((item) => [item.id, item]),
    ).values()];

    const tvDetailsMap = await fetchTvDetailsById(tvCandidates.map((item) => item.id));
    const tvResults = tvCandidates.filter((item) => {
      const detail = tvDetailsMap.get(item.id);
      const seasons = Number(detail?.number_of_seasons ?? 0);
      const isNewSeries = seasons === 1 && withinPastDays(item?.first_air_date, 180);
      const isNewSeason = seasons > 1 && withinPastDays(detail?.last_air_date, 7);
      const trendingEligible = tvTrendingCandidates.some((t) => t.id === item.id);
      return isNewSeries || isNewSeason || trendingEligible;
    });

    const dedupeByTmdbId = (arr) => [...new Map(arr.map((item) => [item.id, item])).values()];
    return filterDefaultExcludedGenres(dedupeByTmdbId(tvResults)).slice(0, 16).map((m) => normalizeTMDBItem(m, "tv"));
  } catch {
    return [];
  }
}

/* ─── V1.3.0: Secondary “Region” home strip (Hollywood / US remains primary Now Playing + Streaming). ─── */

/** V1.3.3: Max titles per Region-block tab (no “Load more”; tabs scope the list). */
const SECONDARY_STRIP_TAB_CAP = 25;
/** V1.3.0: Profile keys allowed for {@link profiles.secondary_region_key}; excludes hollywood (primary). */
const V130_SECONDARY_REGION_IDS = ["indian", "asian", "latam", "european"];

/** V1.3.0: Home section title — plain region words (friend-testing copy). */
const V130_SECONDARY_HOME_TITLE = {
  indian: "Indian",
  asian: "Asian",
  latam: "Latin / Iberian",
  european: "European",
};

/**
 * V1.3.0: Map profile secondary key → TMDB theatrical / discover `region` (single ISO market anchor per bucket).
 * Asian→KR, Latin→MX, European→GB are pragmatic defaults; refine per market after user research.
 */
function secondaryMarketTmdbRegion(regionKey) {
  const map = { indian: "IN", asian: "KR", latam: "MX", european: "GB" };
  return map[regionKey] || "US";
}

/** V1.3.2: Dedupe normalized catalogue rows by `id` (secondary block catalogue union). */
function dedupeMediaRowsById(rows) {
  return [...new Map((rows || []).map((m) => [m.id, m])).values()];
}

/** V1.3.2: Top-level tabs on the secondary Region home block. */
const SECONDARY_BLOCK_THEATERS = "theaters";
const SECONDARY_BLOCK_STREAMING = "streaming";

/** V1.3.0: Now playing for a non-US TMDB region (mirrors primary US theatrical flow; limited window uses that region’s release rows). */
async function fetchInTheatersForMarket(tmdbRegionIso, langCodes = []) {
  try {
    const TARGET_COUNT = SECONDARY_STRIP_TAB_CAP;
    const LIMITED_THEATRICAL_MAX_DAYS = 14;
    const now = formatIsoDate(new Date());
    const reg = encodeURIComponent(tmdbRegionIso);
    const [p1, p2] = await Promise.all([
      fetchTMDB(`/movie/now_playing?language=en-US&region=${reg}&page=1`),
      fetchTMDB(`/movie/now_playing?language=en-US&region=${reg}&page=2`),
    ]);

    const sortByPop = (items) => [...items].sort((a, b) => {
      const popDiff = Number(b?.popularity ?? 0) - Number(a?.popularity ?? 0);
      if (popDiff !== 0) return popDiff;
      const votesDiff = Number(b?.vote_count ?? 0) - Number(a?.vote_count ?? 0);
      if (votesDiff !== 0) return votesDiff;
      return Date.parse(b?.release_date || "1970-01-01") - Date.parse(a?.release_date || "1970-01-01");
    });

    const merged = filterDefaultExcludedGenres([...(p1.results || []), ...(p2.results || [])])
      .filter((item) => item?.release_date && item.release_date <= now)
      .filter((item) =>
        langCodes.length > 0 ? langCodes.includes(String(item?.original_language || "").toLowerCase()) : true,
      );

    const deduped = [...new Map(merged.map((item) => [item.id, item])).values()];
    const releaseDatesMap = await fetchMovieReleaseDatesById(deduped.map((item) => item.id));
    const withLimitedWindowGate = deduped.filter((item) => {
      const releasePayload = releaseDatesMap.get(item.id);
      const regionRows = Array.isArray(releasePayload?.results)
        ? releasePayload.results.find((r) => r?.iso_3166_1 === tmdbRegionIso)?.release_dates || []
        : [];
      const limitedDates = regionRows
        .filter((r) => Number(r?.type) === 2 && typeof r?.release_date === "string")
        .map((r) => r.release_date.slice(0, 10))
        .filter(Boolean)
        .sort();
      if (limitedDates.length === 0) return true;
      const newestLimited = limitedDates[limitedDates.length - 1];
      return withinPastDays(newestLimited, LIMITED_THEATRICAL_MAX_DAYS);
    });
    return sortByPop(withLimitedWindowGate).slice(0, TARGET_COUNT).map((m) => normalizeTMDBItem(m, "movie"));
  } catch {
    return [];
  }
}

/** V1.3.0: Streaming movies discover for secondary TMDB region (same fallbacks as US, different `region=`). */
async function fetchStreamingMoviesForMarket(tmdbRegionIso, langQuery) {
  try {
    const reg = encodeURIComponent(tmdbRegionIso);
    const digitalStart = dateDaysAgo(90);
    const digitalEnd = formatIsoDate(new Date());
    const digitalDiscoverBase =
      `/discover/movie?language=en-US&region=${reg}&sort_by=popularity.desc&with_release_type=4&primary_release_date.gte=${digitalStart}&primary_release_date.lte=${digitalEnd}`;
    const broadDateDiscoverBase =
      `/discover/movie?language=en-US&region=${reg}&sort_by=popularity.desc&primary_release_date.gte=${digitalStart}&primary_release_date.lte=${digitalEnd}`;

    const dedupeByTmdbId = (arr) => [...new Map(arr.map((item) => [item.id, item])).values()];

    const discoverToMovies = async (pathNoPage) => {
      const moviePages = await Promise.all([1, 2].map((page) => fetchTMDB(`${pathNoPage}&page=${page}`)));
      if (moviePages.some(isTmdbApiErrorPayload)) return [];
      const movieResults = filterDefaultExcludedGenres(moviePages.flatMap((page) => page.results || []));
      return dedupeByTmdbId(movieResults).slice(0, SECONDARY_STRIP_TAB_CAP).map((m) => normalizeTMDBItem(m, "movie"));
    };

    const trendingToMovies = async () => {
      const trendPages = await Promise.all([1, 2].map((page) => fetchTMDB(`/trending/movie/week?language=en-US&page=${page}`)));
      if (trendPages.some(isTmdbApiErrorPayload)) return [];
      const rows = filterDefaultExcludedGenres(trendPages.flatMap((p) => p.results || []));
      return dedupeByTmdbId(rows).slice(0, SECONDARY_STRIP_TAB_CAP).map((m) => normalizeTMDBItem(m, "movie"));
    };

    let out = await discoverToMovies(`${digitalDiscoverBase}${langQuery}`);
    if (out.length > 0) return out;
    if (langQuery) {
      out = await discoverToMovies(`${digitalDiscoverBase}`);
      if (out.length > 0) return out;
    }
    out = await discoverToMovies(`${broadDateDiscoverBase}${langQuery}`);
    if (out.length > 0) return out;
    if (langQuery) {
      out = await discoverToMovies(`${broadDateDiscoverBase}`);
      if (out.length > 0) return out;
    }
    return await trendingToMovies();
  } catch {
    return [];
  }
}

/** V1.3.0: Streaming TV for secondary region — regional discover + global trending day (same shape as primary strip). */
async function fetchStreamingTVForMarket(tmdbRegionIso, langQuery) {
  try {
    const reg = encodeURIComponent(tmdbRegionIso);
    const tvNewSeriesStart = dateDaysAgo(180);
    const excludedTrendingGenres = new Set([10767, 10763]);
    const tvNewSeriesBase = `/discover/tv?language=en-US&region=${reg}&sort_by=popularity.desc&first_air_date.gte=${tvNewSeriesStart}&first_air_date.lte=${formatIsoDate(new Date())}${langQuery}`;
    const trendingTvBase = "/trending/tv/day?language=en-US";

    const [tvSeriesPages, tvTrendingPages] = await Promise.all([
      Promise.all([1, 2].map((page) => fetchTMDB(`${tvNewSeriesBase}&page=${page}`))),
      Promise.all([1, 2].map((page) => fetchTMDB(`${trendingTvBase}&page=${page}`))),
    ]);

    const tvNewSeriesCandidates = tvSeriesPages.flatMap((page) => page.results || []);
    const tvTrendingCandidates = tvTrendingPages
      .flatMap((page) => page.results || [])
      .filter((item) => {
        const genreIds = Array.isArray(item?.genre_ids) ? item.genre_ids : [];
        return !genreIds.some((g) => excludedTrendingGenres.has(Number(g)));
      });

    const tvCandidates = [...new Map(
      [...tvNewSeriesCandidates, ...tvTrendingCandidates].map((item) => [item.id, item]),
    ).values()];

    const tvDetailsMap = await fetchTvDetailsById(tvCandidates.map((item) => item.id));
    const tvResults = tvCandidates.filter((item) => {
      const detail = tvDetailsMap.get(item.id);
      const seasons = Number(detail?.number_of_seasons ?? 0);
      const isNewSeries = seasons === 1 && withinPastDays(item?.first_air_date, 180);
      const isNewSeason = seasons > 1 && withinPastDays(detail?.last_air_date, 7);
      const trendingEligible = tvTrendingCandidates.some((t) => t.id === item.id);
      return isNewSeries || isNewSeason || trendingEligible;
    });

    const dedupeByTmdbId = (arr) => [...new Map(arr.map((item) => [item.id, item])).values()];
    return filterDefaultExcludedGenres(dedupeByTmdbId(tvResults)).slice(0, SECONDARY_STRIP_TAB_CAP).map((m) => normalizeTMDBItem(m, "tv"));
  } catch {
    return [];
  }
}

function normalizeCatalogueItem(item, type) {
  return {
    id: `${type}-${item.id}`, tmdbId: item.id, type,
    title: item.title || item.name,
    year: (item.release_date || item.first_air_date || "").slice(0, 4),
    releaseDate: tmdbReleaseDateString(item),
    genre: type === "movie" ? "Movie" : "TV Show",
    genreIds: item.genre_ids || [],
    synopsis: item.overview || "",
    poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
    backdrop: item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : null,
    tmdbRating: Math.round(item.vote_average * 10) / 10,
    popularity: item.popularity,
    language: item.original_language || "en",
    originCountries: Array.isArray(item.origin_country)
      ? item.origin_country.filter(c => typeof c === "string").map(c => c.toUpperCase())
      : Array.isArray(item.production_countries)
        ? item.production_countries.map(c => c?.iso_3166_1).filter(c => typeof c === "string").map(c => c.toUpperCase())
        : [],
  };
}

/** Build interleaved catalogue from any subset of TMDB list responses (missing lists treated as empty). */
function catalogueFromTmdbPages(popMovies, topMovies, popTV, topTV) {
  const movies = [
    ...filterDefaultExcludedGenres(popMovies?.results || []).map(m => normalizeCatalogueItem(m, "movie")),
    ...filterDefaultExcludedGenres(topMovies?.results || []).map(m => normalizeCatalogueItem(m, "movie")),
  ];
  const shows = [
    ...filterDefaultExcludedGenres(popTV?.results || []).map(m => normalizeCatalogueItem(m, "tv")),
    ...filterDefaultExcludedGenres(topTV?.results || []).map(m => normalizeCatalogueItem(m, "tv")),
  ];
  const unique = (arr) => [...new Map(arr.map(m => [m.id, m])).values()].slice(0, 40);
  const allMovies = unique(movies), allShows = unique(shows);
  const combined = [];
  const max = Math.max(allMovies.length, allShows.length);
  for (let i = 0; i < max && combined.length < 60; i++) {
    if (allMovies[i]) combined.push(allMovies[i]);
    if (allShows[i]) combined.push(allShows[i]);
  }
  return combined;
}

function mergeUniqueCatalogueRows(base, extras) {
  const seen = new Set(base.map((m) => m.id));
  const out = [...base];
  for (const m of extras) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** Fast path: 2 TMDB calls (popular only) — unblocks bootstrap on slow mobile networks. */
async function fetchCataloguePhasePopular() {
  const [popMovies, popTV] = await Promise.all([
    fetchTMDB("/movie/popular?language=en-US&page=1"),
    fetchTMDB("/tv/popular?language=en-US&page=1"),
  ]);
  return catalogueFromTmdbPages(popMovies, null, popTV, null);
}

/** Background enrichment: top_rated lists (2 more TMDB calls). */
async function fetchCataloguePhaseTopRated() {
  const [topMovies, topTV] = await Promise.all([
    fetchTMDB("/movie/top_rated?language=en-US&page=1"),
    fetchTMDB("/tv/top_rated?language=en-US&page=1"),
  ]);
  return catalogueFromTmdbPages(null, topMovies, null, topTV);
}

/** One-shot full catalogue (e.g. manual retry). */
async function fetchCatalogue() {
  const [popMovies, topMovies, popTV, topTV] = await Promise.all([
    fetchTMDB("/movie/popular?language=en-US&page=1"),
    fetchTMDB("/movie/top_rated?language=en-US&page=1"),
    fetchTMDB("/tv/popular?language=en-US&page=1"),
    fetchTMDB("/tv/top_rated?language=en-US&page=1"),
  ]);
  return catalogueFromTmdbPages(popMovies, topMovies, popTV, topTV);
}

// Fetch regional titles for onboarding
async function fetchRegionalTitles(langCode) {
  try {
    const [movies, shows] = await Promise.all([
      fetchTMDB(`/discover/movie?with_original_language=${langCode}&sort_by=popularity.desc&page=1`),
      fetchTMDB(`/discover/tv?with_original_language=${langCode}&sort_by=popularity.desc&page=1`),
    ]);
    const normalize = (item, type) => ({
      id: `${type}-${item.id}`, tmdbId: item.id, type,
      title: item.title || item.name,
      year: (item.release_date || item.first_air_date || "").slice(0, 4),
      releaseDate: tmdbReleaseDateString(item),
      genre: type === "movie" ? "Movie" : "TV Show",
      genreIds: item.genre_ids || [],
      synopsis: item.overview || "",
      poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
      backdrop: item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : null,
      tmdbRating: Math.round(item.vote_average * 10) / 10,
      popularity: item.popularity,
      language: item.original_language || langCode,
      originCountries: Array.isArray(item.origin_country)
        ? item.origin_country.filter(c => typeof c === "string").map(c => c.toUpperCase())
        : Array.isArray(item.production_countries)
          ? item.production_countries.map(c => c?.iso_3166_1).filter(c => typeof c === "string").map(c => c.toUpperCase())
          : [],
    });
    return [
      ...filterDefaultExcludedGenres(movies.results || []).slice(0, 15).map(m => normalize(m, "movie")),
      ...filterDefaultExcludedGenres(shows.results || []).slice(0, 10).map(m => normalize(m, "tv")),
    ];
  } catch { return []; }
}

async function fetchWatchProviders(tmdbId, type) {
  try {
    const data = await fetchTMDB(`/${type}/${tmdbId}/watch/providers`);
    const results = data.results || {};
    const region = results.US || results[Object.keys(results)[0]];
    if (!region) return null;
    return { flatrate: region.flatrate || [], rent: region.rent || [], buy: region.buy || [], free: region.free || [], link: region.link || null };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Cinema preference options
// ---------------------------------------------------------------------------
const OTHER_CINEMA_OPTIONS = [
  { id: "hi", label: "🎭 Indian Cinema", lang: "hi", flag: "🇮🇳" },
  { id: "ko", label: "🎌 Korean", lang: "ko", flag: "🇰🇷" },
  { id: "es", label: "🌮 Spanish / Latin", lang: "es", flag: "🌎" },
  { id: "ja", label: "🇯🇵 Japanese", lang: "ja", flag: "🇯🇵" },
  { id: "fr", label: "🇫🇷 European", lang: "fr", flag: "🇪🇺" },
];

// ---------------------------------------------------------------------------
// Mood config
// ---------------------------------------------------------------------------
const ALL_INDIAN_LANGS = ["hi", "ta", "te", "ml", "kn", "bn", "mr"];

/**
 * Region buckets for profile recommendations settings.
 * Empty profile array = no region filter (all languages/regions).
 */
const PROFILE_REGION_OPTIONS = [
  { id: "hollywood", label: "🌍 Hollywood", languages: ["en"] },
  { id: "indian", label: "🎭 Indian", languages: ALL_INDIAN_LANGS },
  { id: "asian", label: "🎌 Asian", languages: ["ko", "ja", "zh", "th", "vi", "id", "ms", "tl"] },
  { id: "latam", label: "🌮 Latin / Iberian", languages: ["es", "pt"] },
  { id: "european", label: "🇫🇷 European", languages: ["fr", "de", "it", "nl", "sv", "no", "da", "fi", "pl"] },
];

/** TMDB genre ids for “Genres to show” in Settings. Empty profile array = all genres. Title matches if it has ≥1 of these ids. */
const PROFILE_GENRE_OPTIONS = [
  { id: 28, label: "🔥 Action" },
  { id: 12, label: "🗺️ Adventure" },
  { id: 16, label: "🎨 Animation" },
  { id: 35, label: "😂 Comedy" },
  { id: 80, label: "🕵️ Crime" },
  { id: 99, label: "📖 Documentary" },
  { id: 18, label: "😢 Drama" },
  { id: 10751, label: "👨‍👩‍👧 Family" },
  { id: 14, label: "🧙 Fantasy" },
  { id: 36, label: "📜 History" },
  { id: 27, label: "👻 Horror" },
  { id: 10402, label: "🎵 Music" },
  { id: 9648, label: "🔍 Mystery" },
  { id: 10749, label: "💕 Romance" },
  { id: 878, label: "🚀 Sci-Fi" },
  { id: 53, label: "😱 Thriller" },
  { id: 10752, label: "⚔️ War" },
  { id: 37, label: "🤠 Western" },
];

function passesShowGenresFilter(movie, showGenreIds) {
  if (!showGenreIds || showGenreIds.length === 0) return true;
  const ids = movie.genreIds || [];
  return ids.some(gid => showGenreIds.includes(gid));
}

function passesShowRegionsFilter(movie, showRegionKeys) {
  if (!showRegionKeys || showRegionKeys.length === 0) return true;
  const lang = String(movie?.language || "").toLowerCase();
  const originCountries = Array.isArray(movie?.originCountries)
    ? movie.originCountries.map(c => String(c).toUpperCase())
    : [];
  const selected = PROFILE_REGION_OPTIONS.filter(option => showRegionKeys.includes(option.id));
  if (selected.length === 0) return true;
  const languageMatch = lang
    ? selected.some(option => option.languages.includes(lang))
    : false;

  // Country gates tighten ambiguous metadata (e.g., English-language titles outside Hollywood markets).
  const HOLLYWOOD_COUNTRIES = new Set(["US", "GB", "CA", "AU", "NZ"]);
  const INDIAN_COUNTRIES = new Set(["IN"]);
  const hasCountry = originCountries.length > 0;
  const countryMatch = selected.some(option => {
    if (option.id === "hollywood") return originCountries.length > 0 && originCountries.every(c => HOLLYWOOD_COUNTRIES.has(c));
    if (option.id === "indian") return originCountries.some(c => INDIAN_COUNTRIES.has(c));
    return false;
  });

  const selectedCountryGated = selected.filter(option => option.id === "hollywood" || option.id === "indian");
  const selectedNonCountryGated = selected.filter(option => option.id !== "hollywood" && option.id !== "indian");
  const languageMatchNonGated = lang
    ? selectedNonCountryGated.some(option => option.languages.includes(lang))
    : false;
  if (selectedCountryGated.length > 0) {
    // For hollywood/indian, unknown-country rows should not pass on language alone.
    // Only allow unknown-country rows when another non-country region selection matches by language.
    if (hasCountry) return countryMatch || languageMatchNonGated;
    // TMDB discover movie payloads often omit country-of-origin fields; allow movie fallback by language.
    if (movie?.type === "movie") return languageMatch;
    return languageMatchNonGated;
  }
  return languageMatch;
}

function passesProfileFilters(movie, showGenreIds, showRegionKeys) {
  return passesShowGenresFilter(movie, showGenreIds) && passesShowRegionsFilter(movie, showRegionKeys);
}

const MOOD_CARDS = [
  {
    id: "region",
    title: "Where in the world?",
    subtitle: "Pick the cinema you're in the mood for",
    options: [
      { id: "en", label: "🌍 Hollywood", languages: ["en"] },
      { id: "indian", label: "🎭 Indian Cinema", languages: ALL_INDIAN_LANGS },
      { id: "ko", label: "🎌 Korean", languages: ["ko"] },
      { id: "es", label: "🌮 Spanish / Latin", languages: ["es"] },
      { id: "ja", label: "🇯🇵 Japanese", languages: ["ja"] },
      { id: "fr", label: "🇫🇷 European", languages: ["fr", "de", "it"] },
      { id: "any", label: "🌏 Any region", languages: [] },
    ]
  },
  {
    id: "indian_lang",
    title: "Which language?",
    subtitle: "Pick one or more — or skip for all Indian cinema",
    options: [
      { id: "hi", label: "🎬 Hindi (Bollywood)", languages: ["hi"] },
      { id: "ta", label: "🌟 Tamil", languages: ["ta"] },
      { id: "te", label: "🎭 Telugu", languages: ["te"] },
      { id: "ml", label: "🌸 Malayalam", languages: ["ml"] },
      { id: "kn", label: "🎪 Kannada", languages: ["kn"] },
      { id: "bn", label: "📽️ Bengali", languages: ["bn"] },
      { id: "mr", label: "🎞️ Marathi", languages: ["mr"] },
      { id: "all_indian", label: "🌏 All Indian", languages: ALL_INDIAN_LANGS },
    ]
  },
  {
    id: "genre",
    title: "What's the vibe?",
    subtitle: "Pick one or more genres",
    options: [
      { id: 35, label: "😂 Comedy" },
      { id: 18, label: "😢 Drama" },
      { id: 28, label: "🔥 Action" },
      { id: 53, label: "😱 Thriller" },
      { id: 27, label: "👻 Horror" },
      { id: 10749, label: "💕 Romance" },
      { id: 878, label: "🚀 Sci-Fi" },
      { id: 99, label: "📖 Documentary" },
    ]
  },
  {
    id: "vibe",
    title: "Anything special?",
    subtitle: "Fine-tune your pick",
    options: [
      { id: "acclaimed", label: "🏆 Critically acclaimed" },
      { id: "hidden", label: "💎 Hidden gem" },
      { id: "family", label: "👨‍👩‍👧 Family friendly" },
      { id: "animation_anime", label: "🎨 Animation & Anime" },
      { id: "very_recent", label: "🆕 Just released" },
      { id: "recent", label: "📅 Last 3 years" },
      { id: "modern", label: "🗓️ Modern (3–15 years)" },
      { id: "classic", label: "🎬 Classic (15+ years)" },
      { id: "short", label: "⚡ Quick watch" },
    ]
  }
];

function BottomNav({ navTab, setNavTab, setScreen, setMoodStep, setMoodSelections, setMoodResults }) {
  const tabs = [["🏠", "Home", "home"], ["🔍", "Discover", "discover"], ["🎭", "Mood", "mood"], ["👤", "Profile", "profile"]];
  return (
    <div className="bottom-nav">
      {tabs.map(([icon, label, tab]) => (
        <div key={label}
          className={`nav-item ${navTab === tab ? "active" : ""}`}
          onClick={() => {
            setNavTab(tab);
            if (tab === "mood") {
              setMoodStep(0);
              setMoodSelections({ region: [], indian_lang: [], genre: [], vibe: [] });
              setMoodResults([]);
              setScreen("mood-picker");
            } else {
              setScreen(tab);
            }
          }}>
          <div className="nav-icon">{icon}</div>
          {navTab === tab && <div className="nav-label">{label}</div>}
        </div>
      ))}
    </div>
  );
}

// Match / collaborative filtering runs on the server (Supabase Edge Function `match`).
// When the function is unavailable, home strips fall back to TMDB-only scores (not the CF algorithm).

function tmdbOnlyRec(movie) {
  const t = movie.tmdbRating ?? 7;
  return {
    movie,
    predicted: t,
    low: Math.max(1, Math.round((t - 1) * 10) / 10),
    high: Math.min(10, Math.round((t + 1) * 10) / 10),
    confidence: "low",
    neighborCount: 0,
  };
}

/** Supabase recovery sessions: JWT `amr` includes recovery (string or { method }) until `updateUser({ password })` runs. */
function isPasswordRecoverySession(session) {
  if (!session?.access_token) return false;
  try {
    const part = session.access_token.split(".")[1];
    if (!part) return false;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    const amr = payload.amr;
    if (Array.isArray(amr)) {
      const isRec = amr.some(
        entry =>
          entry === "recovery" ||
          (typeof entry === "object" && entry !== null && entry.method === "recovery"),
      );
      if (isRec) return true;
    }
    // Fallback: some issuers stringify or nest differently
    const blob = JSON.stringify(payload);
    if (/\brecovery\b/.test(blob) && /"amr"/.test(blob)) return true;
    return false;
  } catch {
    return false;
  }
}

function urlIndicatesPasswordRecovery() {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get("recovery") === "1") return true;
  const h = window.location.hash;
  return /type=recovery(?:&|$|#|%26)/.test(h) || /type%3[Dd]recovery/.test(window.location.search + h);
}

/** `redirectTo` for reset emails — add ?recovery=1 so PKCE landings work even if JWT shape differs (whitelist this URL in Supabase). */
function passwordRecoveryRedirectTo() {
  const u = new URL(window.location.origin);
  u.searchParams.set("recovery", "1");
  return u.toString();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  /* iOS focus hardening: keep Safari from inflating text/zooming inputs on focus. */
  html, body { -webkit-text-size-adjust:100%; text-size-adjust:100%; }
  input, textarea, select { font-size:16px; }
  body { background: #0a0a0a; }
  /* Fixed clipping shell: visual viewport shifts stay inside app bounds and cannot expand page width. */
  .viewport-shell { position:fixed; inset:0; width:100%; max-width:100%; overflow:hidden; display:flex; justify-content:center; align-items:stretch; background:#0a0a0a; }
  /* Shell: use % not 100vw — iOS Safari can treat 100vw wider than the paint area and allow sideways pan */
  .app { --shell:480px; font-family:'DM Sans',sans-serif; background:#0a0a0a; color:#f0ebe0; height:100%; min-height:0; max-height:100%; width:100%; max-width:min(100%,var(--shell)); margin:0 auto; overflow-x:hidden; overflow-x:clip; overflow-y:hidden; min-width:0; position:relative; touch-action:pan-y; display:flex; flex-direction:column; }

  .splash { height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; animation:fadeIn 0.8s ease; }
  .splash-logo { line-height:0; display:flex; justify-content:center; align-items:center; margin-bottom:32px; width:100%; }
  .app-brand.brand-logo { display:block; max-width:100%; object-fit:contain; object-position:left center; }
  .app-brand-button { display:block; line-height:0; padding:0; margin:0; border:none; background:none; cursor:pointer; font:inherit; color:inherit; text-align:left; max-width:100%; min-width:0; }
  .app-brand-button:focus-visible { outline:2px solid #e8c96a; outline-offset:3px; border-radius:4px; }
  /* Use % of grid cell — 100vw on iOS can be wider than the layout and reintroduces horizontal pan. */
  .app-brand.brand-logo--header { width:min(220px, 100%); max-width:100%; height:auto; }
  /* Taller on splash so wordmark + tagline stay readable (full logo viewBox 400×120). */
  .app-brand.brand-logo--splash { width:min(86%, 380px); max-width:100%; height:auto; object-position:center center; }
  .home-header .app-brand { margin-bottom:10px; }
  .discover-header { padding:16px 24px 12px; }
  .mood-header { padding:16px 24px 16px; }
  .mood-results-header { padding:0 24px 20px; display:flex; align-items:center; gap:12px; }
  .btn-primary { background:#e8c96a; color:#0a0a0a; border:none; padding:16px 48px; font-family:'DM Sans',sans-serif; font-size:15px; font-weight:500; letter-spacing:1px; cursor:pointer; border-radius:2px; transition:all 0.2s; width:220px; }
  .btn-primary:hover { background:#f0d880; transform:translateY(-1px); }
  .btn-ghost { background:transparent; color:#888; border:1px solid #333; padding:14px 48px; font-family:'DM Sans',sans-serif; font-size:14px; cursor:pointer; border-radius:2px; margin-top:12px; transition:all 0.2s; width:220px; }
  .btn-ghost:hover { border-color:#666; color:#ccc; }

  .auth { height:100vh; min-height:100dvh; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:0 32px; animation:fadeIn 0.5s ease; box-sizing:border-box; width:100%; max-width:100%; min-width:0; overflow-x:hidden; overflow-x:clip; }
  .auth-inner { width:100%; max-width:min(100%, 400px); min-width:0; }
  .auth-back { position:absolute; top:52px; left:24px; background:none; border:none; color:#666; font-size:14px; cursor:pointer; font-family:'DM Sans',sans-serif; }
  .auth-back:hover { color:#ccc; }
  .auth-title { font-family:'DM Serif Display',serif; font-size:32px; color:#f0ebe0; margin-bottom:8px; }
  .auth-sub { font-size:14px; color:#666; margin-bottom:36px; overflow-wrap:anywhere; }
  .auth-field { margin-bottom:16px; }
  .auth-label { font-size:12px; color:#888; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px; display:block; }
  .auth-input { width:100%; background:#141414; border:1px solid #2a2a2a; border-radius:8px; padding:13px 16px; font-family:'DM Sans',sans-serif; font-size:16px; color:#f0ebe0; outline:none; transition:border-color 0.2s; min-width:0; }
  .auth-input:focus { border-color:#e8c96a; }
  .auth-input::placeholder { color:#444; }
  .auth-error { font-size:13px; color:#cc4444; margin-bottom:16px; padding:10px 14px; background:#1a0808; border:1px solid #441111; border-radius:8px; overflow-wrap:anywhere; }
  .auth-note { font-size:13px; color:#8bc58f; margin-bottom:16px; padding:10px 14px; background:#0f1a11; border:1px solid #29432d; border-radius:8px; overflow-wrap:anywhere; }
  .auth-btn { width:100%; background:#e8c96a; color:#0a0a0a; border:none; padding:15px; font-family:'DM Sans',sans-serif; font-size:15px; font-weight:500; cursor:pointer; border-radius:2px; transition:all 0.2s; margin-top:8px; }
  .auth-btn:hover { background:#f0d880; }
  .auth-btn:disabled { opacity:0.5; cursor:default; }
  .auth-link-row { display:flex; justify-content:flex-end; margin-top:-4px; margin-bottom:8px; }
  .auth-link-btn { background:none; border:none; color:#e8c96a; cursor:pointer; font-size:12px; font-family:'DM Sans',sans-serif; padding:0; }
  .auth-link-btn:hover { text-decoration:underline; }
  .auth-switch { text-align:center; margin-top:20px; font-size:13px; color:#666; overflow-wrap:anywhere; }
  .auth-switch span { color:#e8c96a; cursor:pointer; }
  .auth-switch span:hover { text-decoration:underline; }

  .loading { height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; animation:fadeIn 0.5s ease; }
  .loading-ring { width:56px; height:56px; border:2px solid #222; border-top-color:#e8c96a; border-radius:50%; animation:spin 1s linear infinite; }
  .loading-title { font-family:'DM Serif Display',serif; font-size:22px; color:#f0ebe0; }
  .loading-sub { font-size:13px; color:#555; }

  /* CINEMA PREFERENCE */
  .pref { height:100vh; display:flex; flex-direction:column; justify-content:center; padding:0 32px; animation:fadeIn 0.5s ease; }
  .pref-step { font-size:11px; letter-spacing:3px; text-transform:uppercase; color:#e8c96a; margin-bottom:12px; }
  .pref-title { font-family:'DM Serif Display',serif; font-size:30px; color:#f0ebe0; line-height:1.2; margin-bottom:8px; }
  .pref-sub { font-size:14px; color:#666; margin-bottom:36px; }
  .pref-options { display:flex; flex-direction:column; gap:12px; margin-bottom:32px; }
  .pref-option { padding:18px 20px; border-radius:12px; border:1px solid #2a2a2a; background:#141414; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; gap:14px; }
  .pref-option:hover { border-color:#555; }
  .pref-option.selected { border-color:#e8c96a; background:#1a1600; }
  .pref-option-icon { font-size:28px; }
  .pref-option-text {}
  .pref-option-label { font-family:'DM Serif Display',serif; font-size:18px; color:#f0ebe0; }
  .pref-option-desc { font-size:12px; color:#666; margin-top:2px; }
  .pref-option.selected .pref-option-label { color:#e8c96a; }
  .pref-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:32px; }
  .pref-grid-option { padding:16px 12px; border-radius:12px; border:1px solid #2a2a2a; background:#141414; cursor:pointer; transition:all 0.2s; text-align:center; }
  .pref-grid-option:hover { border-color:#555; }
  .pref-grid-option.selected { border-color:#e8c96a; background:#1a1600; }
  .pref-grid-icon { font-size:24px; margin-bottom:6px; }
  .pref-grid-label { font-size:13px; color:#aaa; line-height:1.3; }
  .pref-grid-option.selected .pref-grid-label { color:#e8c96a; }
  .pref-btn { width:100%; background:#e8c96a; color:#0a0a0a; border:none; padding:15px; font-family:'DM Sans',sans-serif; font-size:15px; font-weight:500; cursor:pointer; border-radius:2px; transition:all 0.2s; }
  .pref-btn:hover { background:#f0d880; }
  .pref-btn:disabled { opacity:0.4; cursor:default; }

  .onboarding { height:100%; min-height:0; display:flex; flex-direction:column; background:#0a0a0a; animation:fadeIn 0.5s ease; overflow-x:hidden; overflow-x:clip; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain; }
  .ob-header { padding:max(48px, env(safe-area-inset-top, 0px)) 20px 12px; display:flex; flex-direction:column; gap:6px; width:100%; max-width:min(100%, 440px); margin:0 auto; box-sizing:border-box; }
  .ob-header .topbar-brand-cluster { align-self:flex-start; }
  .ob-step { font-size:11px; letter-spacing:3px; text-transform:uppercase; color:#e8c96a; }
  .ob-title { font-family:'DM Serif Display',serif; font-size:clamp(22px, 4.2vw, 28px); color:#f0ebe0; line-height:1.2; }
  .ob-subtitle { font-size:13px; color:#666; margin-top:2px; }
  .ob-dots { display:flex; gap:6px; padding:0 20px; margin:0 auto 12px; width:100%; max-width:min(100%, 440px); box-sizing:border-box; }
  .ob-dot { height:3px; border-radius:2px; transition:all 0.3s; background:#222; flex:1; }
  .ob-dot.active { background:#e8c96a; }
  .ob-dot.done { background:#666; }
  .card-area { flex:0 1 auto; padding:0 20px; display:flex; flex-direction:column; align-items:center; width:100%; min-height:0; box-sizing:border-box; }
  .movie-card { width:100%; max-width:min(100%, 400px); background:#141414; border-radius:16px; overflow:hidden; border:1px solid #222; flex:none; display:flex; flex-direction:column; animation:slideUp 0.4s ease; box-sizing:border-box; }
  .card-poster { flex:none; position:relative; overflow:hidden; width:100%; aspect-ratio:16/9; max-height:min(48vh, 260px); }
  .card-poster img { width:100%; height:100%; object-fit:cover; }
  .card-poster-fallback { width:100%; height:100%; min-height:120px; display:flex; align-items:center; justify-content:center; font-size:clamp(40px, 12vw, 64px); background:#1a1a1a; }
  .card-type-badge { position:absolute; top:10px; left:10px; background:rgba(0,0,0,0.75); border:1px solid #333; padding:3px 8px; border-radius:10px; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#aaa; }
  .card-lang-badge { position:absolute; top:10px; right:10px; background:rgba(0,0,0,0.75); border:1px solid #555; padding:3px 8px; border-radius:10px; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#e8c96a; }
  .card-info { padding:12px 16px; }
  .card-title { font-family:'DM Serif Display',serif; font-size:clamp(18px, 3.8vw, 22px); color:#f0ebe0; line-height:1.1; }
  .card-year { font-size:12px; color:#555; margin-top:2px; }
  .rating-area { width:100%; max-width:min(100%, 400px); margin:0 auto; padding:12px 20px max(20px, env(safe-area-inset-bottom, 0px)); flex-shrink:0; box-sizing:border-box; }
  .rating-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
  .rating-q { font-size:13px; color:#aaa; }
  .rating-val { font-family:'DM Serif Display',serif; font-size:28px; color:#e8c96a; min-width:36px; text-align:right; }
  .rating-val.unset { color:#444; font-size:18px; }
  .slider { width:100%; -webkit-appearance:none; appearance:none; height:4px; border-radius:2px; background:#222; outline:none; cursor:pointer; }
  .slider::-webkit-slider-thumb { -webkit-appearance:none; width:22px; height:22px; border-radius:50%; background:#e8c96a; cursor:pointer; box-shadow:0 0 12px rgba(232,201,106,0.5); }
  .ob-actions { display:flex; gap:10px; margin-top:12px; }
  .btn-confirm { flex:1; background:#e8c96a; color:#0a0a0a; border:none; padding:13px; font-family:'DM Sans',sans-serif; font-size:14px; font-weight:500; cursor:pointer; border-radius:2px; transition:all 0.2s; }
  .btn-confirm:disabled { opacity:0.4; cursor:default; }
  .btn-confirm:not(:disabled):hover { background:#f0d880; }
  .btn-skip { background:#1a1a1a; color:#666; border:1px solid #2a2a2a; padding:13px 16px; font-family:'DM Sans',sans-serif; font-size:13px; cursor:pointer; border-radius:2px; transition:all 0.2s; white-space:nowrap; }
  .btn-skip:hover { border-color:#444; color:#aaa; }

  @media (min-width: 600px) {
    .ob-header { max-width: 480px; padding-left: 24px; padding-right: 24px; }
    .ob-dots { max-width: 480px; padding-left: 24px; padding-right: 24px; }
    .card-area { padding: 0 24px; }
    .movie-card { max-width: 440px; }
    .card-poster { max-height: min(34vh, 340px); }
    .rating-area { max-width: 440px; padding-left: 24px; padding-right: 24px; }
  }
  @media (min-width: 900px) {
    .card-poster { max-height: min(28vh, 360px); }
  }

  .home { flex:1 1 0; min-height:0; background:#0a0a0a; padding-bottom:80px; animation:fadeIn 0.5s ease; overflow-x:hidden; overflow-x:clip; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain; min-width:0; width:100%; max-width:100%; }
  .home-topbar { display:none; }
  .home-desktop-nav-row { display:none; }
  /* Shared top chrome on Discover / Mood / Profile / Detail / Rated (not on Home — Home uses home-header + tagline). */
  .page-topbar {
    display:grid;
    grid-template-columns:minmax(0, auto) 1fr auto;
    align-items:center;
    gap:20px;
    padding:14px 20px;
    padding-top:max(14px, env(safe-area-inset-top, 0px));
    border-bottom:1px solid #1a1a1a;
    background:#0a0a0a;
    position:sticky;
    top:0;
    z-index:50;
  }
  .page-topbar .app-brand { margin:0; }
  .page-topbar .avatar-wrap { justify-self:end; align-self:center; }
  .topbar-brand-cluster { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:nowrap; }
  .topbar-brand-cluster .app-brand-button { flex-shrink:1; }
  .public-site-stats { display:flex; flex-direction:column; gap:1px; justify-content:center; flex-shrink:0; line-height:1.12; padding:2px 0; }
  .public-site-stats-row { display:flex; align-items:baseline; gap:5px; white-space:nowrap; }
  .public-site-stats-val { font-family:'DM Sans',sans-serif; font-size:11px; font-weight:600; color:#c4a85a; letter-spacing:0.02em; }
  .public-site-stats-lbl { font-family:'DM Sans',sans-serif; font-size:8px; font-weight:500; letter-spacing:0.55px; text-transform:uppercase; color:#555; }
  .home-topnav { display:flex; gap:3px; padding:4px; background:#141414; border-radius:11px; border:1px solid #222; width:100%; max-width:620px; }
  .home-topnav .home-segment { flex:1; }
  .home-header { padding:48px 24px 16px; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start; column-gap:12px; min-width:0; }
  /* More / Friends: tighter mobile hero without tagline (wordmark + avatar only). */
  .home-header--no-hero-tagline { padding-top:28px; padding-bottom:12px; }
  .home-hero { min-width:0; display:flex; flex-direction:column; gap:10px; align-items:flex-start; }
  .home-hero-copy { padding:0; display:block; max-width:100%; min-width:0; }
  .home-greeting { font-family:'DM Sans',sans-serif; font-size:52px; font-weight:600; color:#f0ebe0; margin-top:2px; line-height:1.02; letter-spacing:-0.6px; overflow-wrap:anywhere; }
  .home-subtitle { font-family:'DM Serif Display',serif; font-size:42px; font-weight:400; color:#cdcdc8; margin-top:8px; line-height:1.1; max-width:100%; letter-spacing:-0.2px; overflow-wrap:anywhere; }
  .home-segments { display:flex; margin:0 24px 22px; padding:4px; background:#141414; border-radius:11px; border:1px solid #222; gap:3px; }
  .home-segment { flex:1; text-align:center; padding:11px 6px; font-size:13px; font-family:'DM Sans',sans-serif; color:#888; cursor:pointer; border-radius:8px; border:none; background:transparent; transition:all 0.2s; }
  .home-segment:hover { color:#bbb; }
  .home-segment.active { background:#2a2610; color:#e8c96a; font-weight:500; }
  .friends-placeholder { margin:24px; padding:32px 20px; border:1px dashed #2a2a2a; border-radius:12px; text-align:center; }
  .friends-placeholder-title { font-family:'DM Serif Display',serif; font-size:20px; color:#f0ebe0; margin-bottom:8px; }
  .friends-placeholder-text { font-size:13px; color:#666; line-height:1.6; }
  .avatar { width:44px; height:44px; border-radius:50%; background:#e8c96a; display:flex; align-items:center; justify-content:center; font-size:17px; font-weight:600; color:#0a0a0a; cursor:pointer; font-family:'DM Sans',sans-serif; flex-shrink:0; }
  .avatar-wrap { position:relative; flex-shrink:0; }
  .avatar-menu { position:absolute; top:52px; right:0; min-width:150px; background:#141414; border:1px solid #2a2a2a; border-radius:10px; box-shadow:0 10px 28px rgba(0,0,0,0.45); padding:6px; z-index:120; }
  .avatar-menu-btn { width:100%; text-align:left; background:transparent; border:none; color:#ccc; padding:10px 12px; border-radius:8px; font-family:'DM Sans',sans-serif; font-size:13px; cursor:pointer; }
  .avatar-menu-btn:hover { background:#1f1f1f; }
  .avatar-menu-btn.danger { color:#f09a9a; }
  .avatar-menu-btn.danger:hover { background:#2a1818; }
  .section { padding:0 0 30px; min-width:0; }
  .section-header { padding:0 24px; display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:12px; min-width:0; }
  .section-title { font-family:'DM Serif Display',serif; font-size:22px; color:#ddd7cd; min-width:0; flex:1 1 auto; }
  .section-meta { font-size:12px; color:#555; letter-spacing:1px; text-transform:uppercase; min-width:0; flex:0 1 auto; overflow-wrap:anywhere; text-align:right; }
  .top-picks-block { margin-top:24px; min-width:0; max-width:100%; }
  .top-picks-block:first-of-type { margin-top:0; }
  .top-picks-block .section-header { margin-bottom:10px; }
  .top-picks-block .section-title { font-size:22px; }

  /* Explicit width + min-width:0 so the row of cards cannot widen the page (iOS / flex min-content bug). */
  .strip {
    width:100%;
    max-width:100%;
    padding-left:24px;
    padding-right:24px;
    display:flex;
    gap:14px;
    overflow-x:auto;
    overflow-y:hidden;
    scrollbar-width:none;
    -webkit-overflow-scrolling:touch;
    overscroll-behavior-x:contain;
    min-width:0;
    scroll-padding-left:24px;
    box-sizing:border-box;
    touch-action:pan-x;
  }
  .strip::-webkit-scrollbar { display:none; }
  .strip-card { flex-shrink:0; width:152px; cursor:pointer; transition:transform 0.2s; }
  .strip-card:hover { transform:translateY(-3px); }
  .strip-poster { width:152px; height:212px; border-radius:12px; overflow:hidden; position:relative; border:1px solid #1e1e1e; background:#1a1a1a; }
  .strip-poster img { width:100%; height:100%; object-fit:cover; }
  .strip-poster-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:40px; }
  .strip-badge { position:absolute; bottom:6px; right:6px; background:rgba(0,0,0,0.82); padding:4px 8px; border-radius:10px; font-size:12px; color:#e8c96a; font-family:'DM Serif Display',serif; z-index:2; }
  .strip-hot-theater-pill { position:absolute; top:6px; left:6px; background:rgba(0,0,0,0.78); color:#c9b87c; font-size:10px; font-weight:500; padding:3px 7px; border-radius:8px; z-index:2; font-family:'DM Sans',sans-serif; letter-spacing:0.02em; }
  .strip-title { font-size:14px; color:#ccc; margin-top:9px; line-height:1.35; }
  .strip-genre { font-size:11px; color:#555; margin-top:2px; }
  .strip-range { font-size:10px; color:#666; margin-top:1px; }
  .strip-row-kind { font-size:11px; margin-top:5px; letter-spacing:0.02em; }
  .strip-row-kind--pick { color:#c9a227; }
  .strip-row-kind--pop { color:#666; }
  .strip-card-skeleton { flex-shrink:0; width:152px; }
  .skel-poster { width:152px; height:212px; border-radius:12px; border:1px solid #1e1e1e; position:relative; overflow:hidden; background:#141414; }
  .skel-line { height:11px; border-radius:6px; margin-top:8px; position:relative; overflow:hidden; background:#191919; }
  .skel-line-title { width:88%; margin-top:9px; }
  .skel-line-meta { width:62%; }
  .skel-line-kind { width:46%; }
  .skel-poster::before, .skel-line::before {
    content:"";
    position:absolute;
    inset:0;
    transform:translateX(-100%);
    background:linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 45%, transparent 100%);
    animation:shimmer 1.35s ease-in-out infinite;
    pointer-events:none;
  }

  .wl-card { flex-shrink:0; width:100px; cursor:pointer; transition:transform 0.2s; }
  .wl-card:hover { transform:translateY(-3px); }
  .wl-poster { width:100px; height:140px; border-radius:10px; overflow:hidden; position:relative; border:1px solid #1e1e1e; background:#1a1a1a; }
  .wl-poster img { width:100%; height:100%; object-fit:cover; }
  .empty-box { margin:0 24px; padding:24px; border:1px dashed #222; border-radius:10px; text-align:center; }
  .empty-text { font-size:13px; color:#444; }

  .bottom-nav { position:fixed; bottom:0; left:0; right:0; margin-left:auto; margin-right:auto; width:100%; max-width:var(--shell); box-sizing:border-box; background:rgba(10,10,10,0.95); border-top:1px solid #1a1a1a; display:flex; padding:12px 0 calc(20px + env(safe-area-inset-bottom,0px)); padding-left:env(safe-area-inset-left,0px); padding-right:env(safe-area-inset-right,0px); backdrop-filter:blur(20px); z-index:100; }
  .nav-item { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; cursor:pointer; opacity:0.4; transition:opacity 0.2s; }
  .nav-item.active { opacity:1; }
  .nav-icon { font-size:20px; }
  .nav-label { font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#e8c96a; }

  .app-footer { padding:20px 24px 28px; border-top:1px solid #1a1a1a; margin-top:8px; }
  .app-footer-links { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:6px 10px; margin-bottom:12px; }
  .app-footer-link { background:none; border:none; color:#888; font-size:12px; font-family:'DM Sans',sans-serif; cursor:pointer; text-decoration:underline; padding:0; }
  .app-footer-link:hover { color:#ccc; }
  a.app-footer-link { display:inline; }
  .app-footer-dot { color:#444; font-size:12px; }
  .app-footer-line { font-size:11px; color:#555; text-align:center; line-height:1.5; margin-bottom:6px; }
  .app-footer-muted { color:#444; }
  .app-footer-tmdb { font-size:10px; color:#444; text-align:center; line-height:1.45; margin-top:10px; max-width:520px; margin-left:auto; margin-right:auto; }
  .app-footer-tmdb a { color:#6a7a8a; }
  .legal-shell { height:100%; min-height:0; background:#0a0a0a; padding-bottom:calc(24px + env(safe-area-inset-bottom,0px)); animation:fadeIn 0.3s ease; overflow-x:hidden; overflow-x:clip; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain; min-width:0; width:100%; max-width:100%; }
  .legal-topbar { display:grid; grid-template-columns:minmax(0, auto) 1fr auto; align-items:center; gap:12px; padding:14px 20px; padding-top:max(14px, env(safe-area-inset-top,0px)); border-bottom:1px solid #1a1a1a; position:sticky; top:0; background:#0a0a0a; z-index:40; }
  .legal-back { background:none; border:none; color:#888; font-size:14px; cursor:pointer; font-family:'DM Sans',sans-serif; padding:6px 0; }
  .legal-back:hover { color:#ccc; }
  .legal-topbar-title { font-family:'DM Serif Display',serif; font-size:18px; color:#ddd7cd; text-align:center; }
  .legal-body { padding:20px 24px 32px; max-width:640px; margin:0 auto; }
  .legal-meta { font-size:11px; color:#555; margin-bottom:16px; }
  .legal-h2 { font-family:'DM Serif Display',serif; font-size:20px; color:#ddd7cd; margin:22px 0 10px; }
  .legal-p { font-size:14px; color:#888; line-height:1.65; margin-bottom:12px; }
  .legal-p a { color:#e8c96a; }
  .legal-muted { color:#666; font-size:13px; }

  .discover { height:100%; min-height:0; background:#0a0a0a; padding-bottom:80px; animation:fadeIn 0.4s ease; overflow-x:hidden; overflow-x:clip; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain; min-width:0; width:100%; max-width:100%; }
  .discover-title { font-family:'DM Serif Display',serif; font-size:30px; color:#ddd7cd; }
  .search-box { position:relative; margin-top:12px; min-width:0; }
  .search-submit-btn { position:absolute; left:8px; top:50%; transform:translateY(-50%); width:28px; height:28px; border:none; background:transparent; color:#888; padding:0; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2; }
  .search-submit-btn:active { opacity:0.8; }
  .search-submit-btn .search-icon { position:static; transform:none; font-size:16px; }
  /* Discover/Rated search keeps 16px + native reset to avoid iOS focus expansion. */
  .search-input { width:100%; min-width:0; background:#141414; border:1px solid #2a2a2a; border-radius:10px; padding:12px 16px 12px 42px; font-family:'DM Sans',sans-serif; font-size:16px; line-height:1.2; color:#f0ebe0; outline:none; transition:border-color 0.2s; -webkit-appearance:none; appearance:none; }
  .search-input::placeholder { color:#444; }
  .search-input:focus { border-color:#555; }
  .search-icon { position:absolute; left:14px; top:50%; transform:translateY(-50%); font-size:16px; pointer-events:none; }
  .filter-row { display:flex; gap:8px; padding:10px 24px 14px; overflow-x:auto; overflow-y:hidden; scrollbar-width:none; -webkit-overflow-scrolling:touch; overscroll-behavior-x:contain; width:100%; max-width:100%; min-width:0; box-sizing:border-box; touch-action:pan-x; }
  .filter-row::-webkit-scrollbar { display:none; }
  .filter-pill { flex-shrink:0; padding:7px 14px; border-radius:20px; font-size:12px; font-family:'DM Sans',sans-serif; cursor:pointer; border:1px solid #2a2a2a; background:transparent; color:#888; transition:all 0.2s; white-space:nowrap; }
  .filter-pill.active { background:#e8c96a; color:#0a0a0a; border-color:#e8c96a; font-weight:500; }
  .filter-pill:not(.active):hover { border-color:#555; color:#ccc; }
  .search-status { padding:8px 24px; font-size:12px; color:#666; overflow-wrap:anywhere; word-break:break-word; }
  .disc-grid { padding:0 24px; display:grid; grid-template-columns:1fr 1fr; gap:14px; width:100%; max-width:100%; min-width:0; box-sizing:border-box; }
  .disc-card { cursor:pointer; transition:transform 0.2s; min-width:0; }
  .disc-card:hover { transform:translateY(-3px); }
  .disc-poster { width:100%; aspect-ratio:2/3; border-radius:12px; overflow:hidden; position:relative; border:1px solid #1e1e1e; background:#1a1a1a; }
  .disc-poster img { width:100%; height:100%; object-fit:cover; }
  .disc-poster-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:48px; }
  .disc-badge { position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.82); padding:4px 8px; border-radius:10px; font-size:11px; font-family:'DM Serif Display',serif; z-index:2; }
  .disc-type { position:absolute; top:8px; left:8px; background:rgba(0,0,0,0.75); border:1px solid #333; padding:2px 7px; border-radius:8px; font-size:9px; letter-spacing:1px; text-transform:uppercase; color:#aaa; }
  .disc-rated-badge { color:#88cc88; }
  .disc-pred-badge { color:#e8c96a; }
  .disc-unseen-badge { color:#555; font-size:10px; font-family:'DM Sans',sans-serif; }
  .disc-title { font-size:13px; color:#ccc; margin-top:8px; line-height:1.3; font-weight:500; overflow-wrap:anywhere; word-break:break-word; }
  .disc-meta { font-size:11px; color:#555; margin-top:2px; overflow-wrap:anywhere; word-break:break-word; }
  .disc-empty { padding:48px 24px; text-align:center; }
  .disc-empty-text { font-size:14px; color:#444; }

  .mood { height:100%; min-height:0; background:#0a0a0a; padding-bottom:80px; animation:fadeIn 0.4s ease; overflow-x:hidden; overflow-x:clip; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain; min-width:0; width:100%; max-width:100%; }
  .mood-back { background:none; border:none; color:#666; font-size:14px; cursor:pointer; font-family:'DM Sans',sans-serif; margin-bottom:16px; display:block; padding:0; }
  .mood-back:hover { color:#ccc; }
  .mood-step { font-size:11px; letter-spacing:3px; text-transform:uppercase; color:#e8c96a; margin-bottom:8px; }
  .mood-title { font-family:'DM Serif Display',serif; font-size:28px; color:#ddd7cd; line-height:1.2; }
  .mood-subtitle { font-size:13px; color:#666; margin-top:6px; }
  .mood-dots { display:flex; gap:6px; padding:0 24px; margin-bottom:20px; }
  .mood-dot { height:3px; border-radius:2px; flex:1; transition:all 0.3s; background:#222; }
  .mood-dot.active { background:#e8c96a; }
  .mood-dot.done { background:#555; }
  .mood-options { padding:0 24px; display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:24px; }
  .mood-option { padding:14px 12px; border-radius:12px; border:1px solid #2a2a2a; background:#141414; cursor:pointer; transition:all 0.2s; text-align:center; font-size:13px; color:#888; font-family:'DM Sans',sans-serif; line-height:1.3; }
  .mood-option:hover { border-color:#555; color:#ccc; }
  .mood-option.selected { border-color:#e8c96a; background:#1a1600; color:#e8c96a; }
  .mood-actions { padding:0 24px; display:flex; flex-direction:column; gap:10px; }
  .mood-next { background:#e8c96a; color:#0a0a0a; border:none; padding:15px; font-family:'DM Sans',sans-serif; font-size:15px; font-weight:500; cursor:pointer; border-radius:2px; transition:all 0.2s; }
  .mood-next:hover { background:#f0d880; }
  .mood-skip { background:transparent; color:#666; border:1px solid #2a2a2a; padding:13px; font-family:'DM Sans',sans-serif; font-size:14px; cursor:pointer; border-radius:2px; transition:all 0.2s; }
  .mood-skip:hover { border-color:#555; color:#aaa; }

  .mood-results { height:100%; min-height:0; background:#0a0a0a; padding-bottom:80px; animation:fadeIn 0.4s ease; overflow-x:hidden; overflow-x:clip; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain; min-width:0; width:100%; max-width:100%; }
  .mood-results-back { background:none; border:none; color:#666; font-size:20px; cursor:pointer; padding:0; }
  .mood-results-title { font-family:'DM Serif Display',serif; font-size:26px; color:#f0ebe0; }
  /* Shared Mood results container; desktop layout is upgraded in the >=900px media query. */
  .mood-results-grid { display:grid; grid-template-columns:1fr; gap:16px; padding:0 24px 16px; }
  .mood-result-card { margin:0; border-radius:16px; overflow:hidden; border:1px solid #1e1e1e; background:#141414; }
  .mood-result-poster { height:180px; position:relative; overflow:hidden; }
  .mood-result-poster img { width:100%; height:100%; object-fit:cover; }
  .mood-result-poster-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:64px; background:#1a1a1a; }
  .mood-result-overlay { position:absolute; inset:0; background:linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 60%); }
  .mood-result-badge { position:absolute; top:12px; right:12px; background:rgba(0,0,0,0.75); border:1px solid #e8c96a; padding:5px 10px; border-radius:16px; font-family:'DM Serif Display',serif; font-size:16px; color:#e8c96a; }
  .mood-result-type { position:absolute; top:12px; left:12px; background:rgba(0,0,0,0.7); border:1px solid #333; padding:3px 8px; border-radius:8px; font-size:9px; text-transform:uppercase; letter-spacing:1px; color:#aaa; }
  .mood-result-info { padding:14px 16px; }
  .mood-result-title { font-family:'DM Serif Display',serif; font-size:20px; color:#f0ebe0; line-height:1.1; }
  .mood-result-meta { font-size:12px; color:#666; margin-top:4px; }
  .mood-result-synopsis { font-size:12px; color:#777; margin-top:8px; line-height:1.5; }
  .mood-result-actions { display:flex; gap:8px; margin-top:12px; }
  .btn-select-watch { flex:2; background:#e8c96a; color:#0a0a0a; border:none; padding:12px; font-family:'DM Sans',sans-serif; font-size:13px; font-weight:500; cursor:pointer; border-radius:2px; transition:all 0.2s; }
  .btn-select-watch:hover { background:#f0d880; }
  .btn-select-watch.selected { background:#2a4a1a; color:#6aaa6a; border:1px solid #2a4a2a; }
  .btn-detail { flex:1; background:transparent; color:#888; border:1px solid #2a2a2a; padding:12px; font-family:'DM Sans',sans-serif; font-size:13px; cursor:pointer; border-radius:2px; transition:all 0.2s; }
  .btn-detail:hover { border-color:#555; color:#ccc; }
  .mood-no-results { padding:48px 24px; text-align:center; }
  .mood-no-results-text { font-size:14px; color:#444; line-height:1.7; }

  .wtw-section { margin-top:16px; }
  .wtw-title { font-size:12px; color:#666; letter-spacing:1px; text-transform:uppercase; margin-bottom:10px; }
  .wtw-loading { font-size:12px; color:#444; }
  .wtw-group { margin-bottom:12px; }
  .wtw-group-label { font-size:10px; color:#555; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px; }
  .wtw-providers { display:flex; flex-wrap:wrap; gap:8px; }
  .wtw-provider { display:flex; align-items:center; gap:6px; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:8px; padding:6px 10px; }
  .wtw-provider img { width:20px; height:20px; border-radius:4px; }
  .wtw-provider-name { font-size:12px; color:#ccc; }
  .wtw-none { font-size:12px; color:#444; font-style:italic; }
  .wtw-link { display:block; margin-top:10px; font-size:12px; color:#e8c96a; text-decoration:none; }
  .wtw-link:hover { text-decoration:underline; }

  .detail { height:100%; min-height:0; background:#0a0a0a; animation:fadeIn 0.3s ease; padding-bottom:80px; overflow-x:hidden; overflow-x:clip; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain; min-width:0; position:relative; width:100%; max-width:100%; }
  /* Poster column (desktop): one Discover card width. Content column: wider; rate controls capped separately. */
  .detail-poster-wrap { width:100%; max-width:100%; margin:0 auto; box-sizing:border-box; }
  .detail-content-wrap { width:100%; max-width:100%; margin:0 auto; box-sizing:border-box; }
  .detail-rate-section { width:100%; }
  .d-poster { height:320px; position:relative; overflow:hidden; }
  .d-poster img { width:100%; height:100%; object-fit:cover; }
  .d-poster-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:100px; background:#141414; }
  .d-overlay { position:absolute; inset:0; background:linear-gradient(to top, #0a0a0a 0%, transparent 50%); }
  .d-body { padding:20px 24px 24px; }
  .d-type-genre { display:flex; align-items:center; gap:8px; }
  .d-type-pill { background:#222; border:1px solid #333; padding:3px 8px; border-radius:8px; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#888; }
  .d-genre-text { font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#666; }
  .d-title { font-family:'DM Serif Display',serif; font-size:32px; color:#f0ebe0; line-height:1.1; margin-top:6px; }
  .d-pred-box { background:#141414; border:1px solid #222; border-radius:12px; padding:16px 20px; margin:18px 0; display:flex; justify-content:space-between; align-items:center; }
  .d-pred-box-low { border-style:dashed; border-color:#6c5a2c; }
  .d-pred-box-medium { border-style:solid; border-color:#7e6931; }
  .d-pred-box-high { border-style:solid; border-color:#b18f36; }
  .d-pred-label { font-size:12px; color:#666; }
  .d-pred-sub { font-size:11px; color:#444; margin-top:3px; }
  .d-pred-val { font-family:'DM Serif Display',serif; font-size:38px; color:#e8c96a; line-height:1; text-align:right; }
  .d-pred-val-low { color:#b89f5a; }
  .d-pred-val-medium { color:#d8ba63; }
  .d-pred-val-high { color:#f1cf70; }
  .d-pred-range { font-size:12px; color:#a89040; margin-top:2px; text-align:right; }
  .d-pred-range-low { color:#b39b53; }
  .d-pred-range-medium { color:#ad964d; }
  .d-pred-range-high { color:#8e7b44; }
  .d-tmdb { font-size:11px; color:#555; margin-top:3px; text-align:right; }
  .d-pred-improve { margin-top:8px; font-size:11px; color:#7f7352; }
  .d-rate-now-btn { margin-top:8px; background:#1b1b1b; border:1px solid #4f4324; color:#d4b761; border-radius:8px; padding:6px 10px; font-size:11px; font-family:'DM Sans',sans-serif; cursor:pointer; transition:all 0.2s; }
  .d-rate-now-btn:hover:not(:disabled) { border-color:#8e7536; color:#e6c86a; }
  .d-rate-now-btn:disabled { opacity:0.55; cursor:default; }
  .d-pred-improve-err { margin-top:6px; font-size:10px; color:#aa6a6a; }
  .d-synopsis { font-size:14px; color:#888; line-height:1.7; margin-bottom:22px; }
  .d-rate-label { font-size:13px; color:#aaa; margin-bottom:10px; }
  .d-rate-row { display:flex; align-items:center; gap:14px; margin-bottom:18px; }
  .d-rate-val { font-family:'DM Serif Display',serif; font-size:32px; min-width:40px; }
  .d-actions { display:flex; gap:10px; }
  .btn-full { flex:1; padding:14px; font-family:'DM Sans',sans-serif; font-size:14px; font-weight:500; cursor:pointer; border-radius:2px; transition:all 0.2s; }
  .btn-full-gold { background:#e8c96a; color:#0a0a0a; border:none; }
  .btn-full-gold:disabled { opacity:0.4; cursor:default; }
  .btn-full-gold:not(:disabled):hover { background:#f0d880; }
  .btn-full-dark { background:#1a1a1a; color:#ccc; border:1px solid #2a2a2a; }
  .btn-full-dark:hover { border-color:#555; }
  .saved-style { background:#1a2a1a !important; color:#6aaa6a !important; border-color:#2a4a2a !important; }
  .rated-box { background:#141414; border:1px solid #2a4a2a; border-radius:12px; padding:20px; text-align:center; }
  .rated-score { font-family:'DM Serif Display',serif; font-size:48px; color:#e8c96a; }
  .rated-label { font-size:13px; color:#6aaa6a; margin-top:4px; }
  .rated-pred { font-size:12px; color:#444; margin-top:6px; }
  .no-recs { margin:0 24px; padding:28px; border:1px dashed #222; border-radius:12px; text-align:center; }
  .no-recs-text { font-size:13px; color:#444; line-height:1.6; }

  .profile { height:100%; min-height:0; background:#0a0a0a; padding-bottom:80px; animation:fadeIn 0.4s ease; overflow-x:hidden; overflow-x:clip; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain; min-width:0; width:100%; max-width:100%; }
  .profile-top { display:flex; gap:16px; align-items:flex-start; padding:52px 24px 20px; }
  .profile .profile-top { padding:8px 24px 20px; }
  .profile-top-text { min-width:0; }
  .profile-avatar { width:64px; height:64px; border-radius:50%; background:#e8c96a; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:700; color:#0a0a0a; font-family:'DM Sans',sans-serif; flex-shrink:0; }
  .profile-top-text { flex:1; min-width:0; }
  .profile-name { font-family:'DM Serif Display',serif; font-size:24px; color:#f0ebe0; line-height:1.2; }
  .profile-stats-inline { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; align-items:center; }
  .profile-stat-chip { font-size:12px; color:#888; background:#141414; border:1px solid #252525; padding:6px 10px; border-radius:20px; font-family:'DM Sans',sans-serif; }
  button.profile-stat-chip { cursor:pointer; transition:all 0.2s; border-color:#2a2a2a; }
  button.profile-stat-chip:hover { border-color:#555; color:#ccc; }
  .profile-settings { padding:8px 24px 24px; }
  .profile-settings-title { font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#555; margin-bottom:12px; }
  .profile-settings-card { background:#141414; border:1px solid #1e1e1e; border-radius:12px; padding:16px 18px; }
  .profile-settings-email { font-size:13px; color:#888; word-break:break-all; margin-bottom:16px; line-height:1.4; }
  .profile-app-version { font-size:11px; color:#444; margin-top:14px; letter-spacing:0.02em; }
  .profile-settings-label { font-size:11px; color:#555; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px; }
  .settings-providers-hint { font-size:12px; color:#555; line-height:1.45; margin-bottom:14px; }
  .settings-provider-grid { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px; }
  .settings-provider-pill { padding:8px 12px; border-radius:20px; font-size:12px; font-family:'DM Sans',sans-serif; cursor:pointer; border:1px solid #2a2a2a; background:#0f0f0f; color:#888; transition:all 0.2s; }
  .settings-provider-pill:hover { border-color:#444; color:#bbb; }
  .settings-provider-pill.selected { border-color:#e8c96a; background:#1a1600; color:#e8c96a; }
  .settings-genre-actions { display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap; }
  .settings-genre-action-btn { background:#1a1a1a; color:#888; border:1px solid #2a2a2a; padding:8px 14px; font-size:12px; border-radius:8px; cursor:pointer; font-family:'DM Sans',sans-serif; transition:all 0.2s; }
  .settings-genre-action-btn:hover { border-color:#555; color:#ccc; }
  .profile-watchlist-section { padding:0 0 8px; }
  .stat-box { background:#141414; border:1px solid #1e1e1e; border-radius:12px; padding:16px; text-align:center; }
  .stat-box-clickable { cursor:pointer; transition:border-color 0.2s, background 0.2s; }
  .stat-box-clickable:hover { border-color:#333; background:#181818; }
  .stat-val { font-family:'DM Serif Display',serif; font-size:32px; color:#e8c96a; }
  .stat-label { font-size:11px; color:#666; margin-top:4px; letter-spacing:1px; text-transform:uppercase; }
  .rated-list-item { display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid #1a1a1a; cursor:pointer; }
  .rated-list-item:last-child { border-bottom:none; }
  .rated-thumb { width:40px; height:56px; border-radius:6px; overflow:hidden; background:#1a1a1a; flex-shrink:0; }
  .rated-thumb img { width:100%; height:100%; object-fit:cover; }
  .rated-info { flex:1; }
  .rated-info-title { font-size:14px; color:#ccc; line-height:1.3; }
  .rated-info-meta { font-size:11px; color:#555; margin-top:2px; }
  .rated-score-pill { font-family:'DM Serif Display',serif; font-size:18px; color:#e8c96a; }
  .rated-row-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
  .rated-rerate-btn { background:#1a1a1a; color:#e8c96a; border:1px solid #3a3520; padding:6px 10px; font-family:'DM Sans',sans-serif; font-size:11px; cursor:pointer; border-radius:6px; transition:all 0.2s; }
  .rated-rerate-btn:hover { border-color:#e8c96a; background:#221e10; }
  .rated-search-wrap { padding:0 24px 12px; }
  .signout-btn { width:100%; background:#1a1a1a; color:#888; border:1px solid #2a2a2a; padding:14px; font-family:'DM Sans',sans-serif; font-size:14px; cursor:pointer; border-radius:2px; transition:all 0.2s; }
  .signout-btn:hover { border-color:#555; color:#ccc; }
  .profile-section { padding:0 24px; margin-bottom:24px; }

  .conf-high { background:#1a2a1a; color:#6aaa6a; display:inline-block; font-size:10px; padding:3px 8px; border-radius:10px; margin-top:6px; }
  .conf-medium { background:#2a2000; color:#aaaa50; display:inline-block; font-size:10px; padding:3px 8px; border-radius:10px; margin-top:6px; }
  .conf-low { background:#2a1a1a; color:#aa6a6a; display:inline-block; font-size:10px; padding:3px 8px; border-radius:10px; margin-top:6px; }

  @media (max-width: 899px) {
    /* Keep branded header fully within viewport on narrow screens. */
    .home-header { padding-left:max(20px, env(safe-area-inset-left, 0px)); padding-right:max(20px, env(safe-area-inset-right, 0px)); }
    .home-hero-copy { padding:0; }
    .home-greeting { font-size:40px; letter-spacing:-0.4px; }
    /* Fluid size on phones so the tagline can stay one line on wider mobiles; shrinks on narrow widths. Desktop unchanged. */
    .home-subtitle { font-size:clamp(15px, 2.75vw + 11px, 23px); max-width:none; line-height:1.12; letter-spacing:-0.35px; }
    .strip { padding-left:max(20px, env(safe-area-inset-left, 0px)); padding-right:max(20px, env(safe-area-inset-right, 0px)); scroll-padding-left:max(20px, env(safe-area-inset-left, 0px)); }
    .strip-card { width:144px; }
    .strip-poster { width:144px; height:200px; }
    .section-header {
      padding-left:max(20px, env(safe-area-inset-left, 0px));
      padding-right:max(20px, env(safe-area-inset-right, 0px));
      flex-direction:column;
      align-items:stretch;
      gap:6px;
      width:100%;
      max-width:100%;
      box-sizing:border-box;
    }
    /* Stretch + right-align so labels stay inside the shell (flex-end + wide ancestor was clipping on the right). */
    .section-header .section-meta {
      align-self:stretch;
      width:100%;
      max-width:100%;
      text-align:right;
      line-height:1.35;
      letter-spacing:0.5px;
      font-size:11px;
    }
    .home-segments { margin-left:max(20px, env(safe-area-inset-left, 0px)); margin-right:max(20px, env(safe-area-inset-right, 0px)); }
    /* Home login path: logo+stats in hero can overflow on narrow Safari widths. Keep logo only on mobile. */
    .home-header .public-site-stats { display:none; }
    .discover-header { padding-left:max(20px, env(safe-area-inset-left, 0px)); padding-right:max(20px, env(safe-area-inset-right, 0px)); min-width:0; }
    .filter-row { padding-left:max(20px, env(safe-area-inset-left, 0px)); padding-right:max(20px, env(safe-area-inset-right, 0px)); }
    .disc-grid { padding-left:max(20px, env(safe-area-inset-left, 0px)); padding-right:max(20px, env(safe-area-inset-right, 0px)); }
    .discover { width:100%; max-width:100%; }
    .profile { width:100%; max-width:100%; }
    .page-topbar {
      grid-template-columns:minmax(0, 1fr) auto;
      gap:10px;
      padding-left:max(14px, env(safe-area-inset-left, 0px));
      padding-right:max(14px, env(safe-area-inset-right, 0px));
    }
    .page-topbar > div:nth-child(2) { display:none; }
    .page-topbar .topbar-brand-cluster { gap:6px; min-width:0; }
    .page-topbar .app-brand.brand-logo--header { width:min(176px, 100%); }
    /* Mobile stability: stats beside logo can reintroduce tiny horizontal pan on some Safari widths. */
    .page-topbar .public-site-stats { display:none; }
  }

  /* Desktop/tablet: let app breathe beyond the mobile shell while keeping phone UX unchanged. */
  @media (min-width: 900px) {
    .app { --shell:1120px; }
    .app-brand.brand-logo--header { width:320px; }
    .topbar-brand-cluster { gap:14px; }
    .public-site-stats-val { font-size:12px; }
    .public-site-stats-lbl { font-size:9px; }
    .home-topbar { display:grid; grid-template-columns:minmax(0, auto) 1fr auto; align-items:center; gap:20px; padding:14px 32px; border-bottom:1px solid #1a1a1a; }
    .home-topbar .app-brand { margin:0; }
    .home-topbar .avatar-wrap { justify-self:end; align-self:center; }
    .page-topbar { padding:14px 32px; padding-top:max(14px, env(safe-area-inset-top, 0px)); }
    .app-footer { padding-left:32px; padding-right:32px; }
    .legal-body { padding-left:32px; padding-right:32px; }
    .home-desktop-nav-row { display:flex; justify-content:center; padding:8px 32px 8px; }
    .home .section-divider { margin:0 32px 10px !important; }
    .home-desktop-nav-row .home-topnav { max-width:620px; }
    .home-header { padding:18px 32px 10px; display:block; }
    /* Desktop: tagline-only strip hidden on More/Friends (logo + avatar stay in home-topbar). */
    .home-header--no-hero-tagline { display:none; }
    /* Logo + community stats live in home-topbar; hide duplicate cluster here (stats are siblings of .app-brand). */
    .home-header .topbar-brand-cluster { display:none; }
    .home-header .app-brand,
    .home-header .avatar-wrap { display:none; }
    .home-greeting { font-size:56px; }
    .home-subtitle { font-size:36px; max-width:none; white-space:nowrap; }
    .discover-header,
    .mood-header { padding-left:32px; padding-right:32px; }
    .home-segments { display:none; }
    .section-header { padding:0 32px; }
    .strip { padding-left:32px; padding-right:32px; gap:18px; }
    .strip-card { width:184px; }
    .strip-poster { width:184px; height:256px; }
    .strip-title { font-size:15px; line-height:1.32; }
    .strip-genre { font-size:12px; }
    .filter-row { padding-left:32px; padding-right:32px; }
    .disc-grid { padding:0 32px; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:16px; }
    /* Match Discover: one card wide, two cards + gap for copy (readable line length). */
    .detail-poster-wrap {
      max-width:calc((min(100%, var(--shell)) - 64px - 48px) / 4);
    }
    .detail-poster-wrap .d-poster {
      height:auto;
      aspect-ratio:2/3;
      border-radius:12px;
      border:1px solid #1e1e1e;
      box-sizing:border-box;
    }
    .detail-content-wrap {
      max-width:calc((min(100%, var(--shell)) - 112px) / 2 + 16px);
    }
    .detail-content-wrap .d-body { padding-left:20px; padding-right:20px; }
    .detail-rate-section { max-width:380px; margin-left:auto; margin-right:auto; }
    .profile-top,
    .profile-settings,
    .profile-section,
    .rated-search-wrap,
    .mood-results-header { padding-left:32px; padding-right:32px; }
    /* Desktop Mood: denser two-column cards to reduce vertical scrolling without changing mobile UX. */
    .mood-results-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); gap:18px; max-width:1120px; margin:0 auto; padding:10px 32px 18px; }
    .mood-result-card { display:grid; grid-template-columns:minmax(0, 44%) minmax(0, 56%); min-height:220px; }
    .mood-result-poster { height:100%; min-height:220px; }
    .mood-result-info { display:flex; flex-direction:column; padding:14px 16px 12px; }
    .mood-result-title { font-size:24px; }
    .mood-result-synopsis { margin-top:7px; display:-webkit-box; -webkit-line-clamp:3; line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    .mood-result-actions { margin-top:auto; padding-top:10px; }
    .empty-box,
    .no-recs { margin-left:32px; margin-right:32px; }
    /* Keep Home picks stacked (In Theaters then Streaming) to preserve original flow. */
  }

  @media (min-width: 1200px) {
    .app { --shell:1240px; }
    .home-segments { max-width:680px; }
    .strip-card { width:198px; }
    .strip-poster { width:198px; height:276px; }
    .disc-grid { grid-template-columns:repeat(5, minmax(0, 1fr)); gap:18px; }
    .detail-poster-wrap {
      max-width:calc((min(100%, var(--shell)) - 64px - 72px) / 5);
    }
    .detail-content-wrap {
      max-width:calc(2 * (min(100%, var(--shell)) - 64px - 72px) / 5 + 18px);
    }
  }

  @keyframes fadeIn { from{opacity:0} to{opacity:1} }
  @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spin { to{transform:rotate(360deg)} }
  @keyframes shimmer { 100% { transform:translateX(100%); } }
`;

// ---------------------------------------------------------------------------
// Where to Watch
// ---------------------------------------------------------------------------
function WhereToWatch({ tmdbId, type }) {
  const [providers, setProviders] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchWatchProviders(tmdbId, type).then(data => { setProviders(data); setLoading(false); });
  }, [tmdbId, type]);
  if (loading) return <div className="wtw-section"><div className="wtw-title">Where to Watch</div><div className="wtw-loading">Checking availability…</div></div>;
  if (!providers) return <div className="wtw-section"><div className="wtw-title">Where to Watch</div><div className="wtw-none">Availability not found</div></div>;
  const groups = [
    { label: "Free", data: providers.free },
    { label: "Subscription", data: providers.flatrate },
    { label: "Rent", data: providers.rent },
    { label: "Buy", data: providers.buy },
  ].filter(g => g.data.length > 0);
  return (
    <div className="wtw-section">
      <div className="wtw-title">Where to Watch</div>
      {groups.length === 0 ? <div className="wtw-none">Not currently available for streaming</div> : groups.map(g => (
        <div className="wtw-group" key={g.label}>
          <div className="wtw-group-label">{g.label}</div>
          <div className="wtw-providers">
            {g.data.slice(0, 4).map(p => (
              <div className="wtw-provider" key={p.provider_id}>
                {p.logo_path && <img src={`https://image.tmdb.org/t/p/original${p.logo_path}`} alt={p.provider_name} />}
                <span className="wtw-provider-name">{p.provider_name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {providers.link && <a className="wtw-link" href={providers.link} target="_blank" rel="noopener noreferrer">View all options →</a>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------
/** Wordmark: `public/cinemastro-logo.svg` — replace file with your export (same path). */
function AppBrand({ variant = "header", onPress }) {
  const splash = variant === "splash";
  const img = (
    <img
      className={`app-brand brand-logo ${splash ? "brand-logo--splash" : "brand-logo--header"}`}
      src="/cinemastro-logo.svg"
      alt="Cinemastro"
      decoding="async"
    />
  );
  if (onPress && !splash) {
    return (
      <button type="button" className="app-brand-button" onClick={onPress} aria-label="Go to home">
        {img}
      </button>
    );
  }
  return img;
}

function formatPublicStat(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const x = Math.floor(n);
  if (x < 1000) return String(x);
  if (x < 10000) return `${(x / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (x < 1_000_000) return `${Math.round(x / 1000)}k`;
  return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function formatScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return (Math.round(x * 10) / 10).toFixed(1);
}

function formatMovieReleaseLine(movie) {
  const rd = movie?.releaseDate;
  if (rd && /^\d{4}-\d{2}-\d{2}$/.test(rd)) {
    const d = new Date(`${rd}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
  }
  return movie?.year || "—";
}

function formatStripMediaMeta(movie, tvMetaByTmdbId) {
  if (movie?.type !== "tv") return `Movie · ${formatMovieReleaseLine(movie)}`;
  const meta = movie?.tmdbId != null ? tvMetaByTmdbId?.[movie.tmdbId] : null;
  const latestYear = meta?.latestYear || movie?.year || "—";
  if (Number.isFinite(Number(meta?.seasonCount)) && Number(meta.seasonCount) > 0) {
    return `TV · ${latestYear} · S${Number(meta.seasonCount)}`;
  }
  return `TV · ${latestYear}`;
}

function pickMoodMix(results, movieTarget = 7, tvTarget = 3) {
  const list = Array.isArray(results) ? results : [];
  if (list.length === 0) return [];
  const movies = list.filter((r) => r?.movie?.type === "movie");
  const tv = list.filter((r) => r?.movie?.type === "tv");
  const picked = [...movies.slice(0, movieTarget), ...tv.slice(0, tvTarget)];
  const used = new Set(picked.map((r) => r?.movie?.id).filter(Boolean));
  const totalTarget = movieTarget + tvTarget;
  if (picked.length >= totalTarget) return picked.slice(0, totalTarget);
  for (const rec of list) {
    const id = rec?.movie?.id;
    if (!id || used.has(id)) continue;
    picked.push(rec);
    used.add(id);
    if (picked.length >= totalTarget) break;
  }
  return picked;
}

/** Site-wide counts (not the signed-in user). Fetched via public RPC. */
function PublicSiteStats({ community, ratings }) {
  if (community === undefined && ratings === undefined) return null;
  return (
    <div className="public-site-stats" aria-label="Cinemastro community stats">
      <div className="public-site-stats-row">
        <span className="public-site-stats-val">{formatPublicStat(community)}</span>
        <span className="public-site-stats-lbl">community</span>
      </div>
      <div className="public-site-stats-row">
        <span className="public-site-stats-val">{formatPublicStat(ratings)}</span>
        <span className="public-site-stats-lbl">ratings</span>
      </div>
    </div>
  );
}

function TopbarBrandCluster({ onPress, community, ratings }) {
  return (
    <div className="topbar-brand-cluster">
      <AppBrand onPress={onPress} />
      <PublicSiteStats community={community} ratings={ratings} />
    </div>
  );
}

function LegalLazyFallback() {
  return (
    <div className="loading" style={{ height: "100%", minHeight: "100dvh" }}>
      <div className="loading-ring" />
      <div className="loading-sub" style={{ marginTop: 12 }}>Loading…</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [screen, setScreen] = useState("splash");
  const [navTab, setNavTab] = useState("home");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("signup");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [catalogue, setCatalogue] = useState([]);
  /** After first bootstrap attempt finishes or safety timeout — avoids infinite "Loading Cinemastro…" when TMDB hangs. */
  const [catalogueBootstrapDone, setCatalogueBootstrapDone] = useState(false);
  const [catalogueRetryBusy, setCatalogueRetryBusy] = useState(false);
  const [loadingCatalogueSlowHint, setLoadingCatalogueSlowHint] = useState(false);
  const [matchData, setMatchData] = useState(null);
  /** True while a `match` invoke is in flight (after debounce). Avoids “rate more” empty state during load. */
  const [matchLoading, setMatchLoading] = useState(false);
  const [obStep, setObStep] = useState(0);
  const [sliderVal, setSliderVal] = useState(7);
  const [sliderTouched, setSliderTouched] = useState(false);
  const [userRatings, setUserRatings] = useState({});
  const [watchlist, setWatchlist] = useState([]);
  const [selectedToWatch, setSelectedToWatch] = useState({});
  const [selectedMovie, setSelected] = useState(null);
  const [detailRating, setDetailRating] = useState(7);
  const [detailTouched, setDetailTouched] = useState(false);
  const [detailEditRating, setDetailEditRating] = useState(false);
  const [rateMoreMovies, setRateMoreMovies] = useState([]);
  const [rateMoreContextMovieId, setRateMoreContextMovieId] = useState(null);
  const [rateSimilarLoading, setRateSimilarLoading] = useState(false);
  const [rateSimilarError, setRateSimilarError] = useState("");
  const [ratedSearchQuery, setRatedSearchQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearchQuery, setAppliedSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [moodStep, setMoodStep] = useState(0);
  const [moodSelections, setMoodSelections] = useState({ region: [], indian_lang: [], genre: [], vibe: [] });
  const [moodResults, setMoodResults] = useState([]);
  const [topPickOffset, setTopPickOffset] = useState(0);
  const [inTheaters, setInTheaters] = useState([]);
  const [streamingMovies, setStreamingMovies] = useState([]);
  const [streamingTV, setStreamingTV] = useState([]);
  /** Two-phase streaming fetch: movies first, then TV (+ /tv/{id} details). */
  const [streamingMoviesReady, setStreamingMoviesReady] = useState(false);
  const [streamingTvReady, setStreamingTvReady] = useState(false);
  const [whatsHot, setWhatsHot] = useState([]);
  const [whatsHotReady, setWhatsHotReady] = useState(false);
  const [streamingTab, setStreamingTab] = useState("tv"); // "movie" | "tv"
  const [selectedStreamingProviderIds, setSelectedStreamingProviderIds] = useState([]);
  const [homeSegment, setHomeSegment] = useState(HOME_SEGMENT_NOW_PLAYING);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [profileSettingsError, setProfileSettingsError] = useState("");
  /** TMDB genre ids to include (Settings). Empty = all genres. Logged-out users ignore. */
  const [showGenreIds, setShowGenreIds] = useState([]);
  /** Region buckets to include (Settings). Empty = all regions. Logged-out users ignore. */
  const [showRegionKeys, setShowRegionKeys] = useState([]);
  /**
   * V1.3.0: Optional single secondary market for the home “Region” strip (below Streaming).
   * Persisted in `profiles.secondary_region_key`. Hollywood / US stays primary for main strips.
   */
  const [secondaryRegionKey, setSecondaryRegionKey] = useState(null);
  /** V1.3.2: Secondary market — split pools (tabs); union goes to catalogue via {@link dedupeMediaRowsById}. */
  const [secondaryTheaterRows, setSecondaryTheaterRows] = useState([]);
  const [secondaryStreamingMovieRows, setSecondaryStreamingMovieRows] = useState([]);
  const [secondaryStreamingTvRows, setSecondaryStreamingTvRows] = useState([]);
  /** V1.3.2: “In theaters” | “Streaming” on the Region block (below primary Streaming). */
  const [secondaryBlockSegment, setSecondaryBlockSegment] = useState(SECONDARY_BLOCK_THEATERS);
  /** V1.3.2: Under Streaming: “Movies” | “Series” (same pattern as primary Streaming strip). */
  const [secondaryBlockStreamingTab, setSecondaryBlockStreamingTab] = useState("tv");
  const [secondaryStripReady, setSecondaryStripReady] = useState(true);
  /** Public marketing counts (RPC). Undefined until first successful fetch. */
  const [siteStats, setSiteStats] = useState(null);

  /** Browser Back should return to the in-app screen that opened detail, not leave the site (SPA history). */
  const detailReturnScreenRef = useRef(null);
  const detailHistoryPushedRef = useRef(false);
  const legalReturnScreenRef = useRef(null);
  const legalHistoryPushedRef = useRef(false);
  const screenRef = useRef(screen);
  const attemptedRatedHydrationRef = useRef(new Set());
  const worthProviderCacheRef = useRef(new Map());
  const tvStripMetaCacheRef = useRef(new Map());
  const [tvStripMetaByTmdbId, setTvStripMetaByTmdbId] = useState({});
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  // iOS Safari can keep horizontal viewport drift even when overflow-x is hidden.
  // Guard in two layers:
  // 1) prevent page-level horizontal gestures (except intended x-scrollers)
  // 2) aggressively clamp viewport/document x back to 0 after touch/scroll/layout events
  useEffect(() => {
    const ALLOW_PAN_X_SELECTOR = ".strip, .filter-row";
    let startX = 0;
    let startY = 0;
    let allowPanX = false;
    let clampRaf = null;

    const toElement = (target) => (target && target.nodeType === 1 ? target : target?.parentElement) ?? null;
    const hasViewportDrift = () =>
      Math.abs(window.scrollX || 0) > 0 ||
      Math.abs(window.pageXOffset || 0) > 0 ||
      Math.abs(document.documentElement.scrollLeft || 0) > 0 ||
      Math.abs(document.body?.scrollLeft || 0) > 0;

    const clampXOnce = () => {
      if (!hasViewportDrift()) return;
      const y = window.scrollY || window.pageYOffset || 0;
      window.scrollTo(0, y);
      document.documentElement.scrollLeft = 0;
      if (document.body) document.body.scrollLeft = 0;
    };

    const scheduleClampBurst = () => {
      if (clampRaf != null) return;
      let tries = 6;
      const tick = () => {
        clampXOnce();
        tries -= 1;
        if (tries > 0 && hasViewportDrift()) {
          clampRaf = requestAnimationFrame(tick);
        } else {
          clampRaf = null;
        }
      };
      clampRaf = requestAnimationFrame(tick);
    };

    const onTouchStart = (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      const el = toElement(e.target);
      allowPanX = Boolean(el?.closest(ALLOW_PAN_X_SELECTOR));
    };

    const onTouchMove = (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) <= Math.abs(dy)) return; // primarily vertical gesture
      if (allowPanX) return; // keep intended horizontal strips working
      e.preventDefault(); // block page-level sideways pan
      scheduleClampBurst();
    };

    const onTouchEnd = () => scheduleClampBurst();
    const onScroll = () => scheduleClampBurst();
    const onResize = () => scheduleClampBurst();
    const onPageShow = () => scheduleClampBurst();

    scheduleClampBurst();
    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("touchstart", onTouchStart, { capture: true });
      document.removeEventListener("touchmove", onTouchMove, { capture: true });
      document.removeEventListener("touchend", onTouchEnd, { capture: true });
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("pageshow", onPageShow);
      if (clampRaf != null) cancelAnimationFrame(clampRaf);
    };
  }, [screen, searching, appliedSearchQuery, homeSegment]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_public_site_stats");
      if (cancelled || error) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return;
      setSiteStats({
        community: Number(row.community_count),
        ratings: Number(row.ratings_count),
      });
    })();
    return () => { cancelled = true; };
  }, []);

  // Pre-onboarding cinema preference state
  const [cinemaPreference, setCinemaPreference] = useState(null); // "hollywood" | "mix"
  const [otherCinema, setOtherCinema] = useState(null); // cinema option id
  const [obCatalogue, setObCatalogue] = useState([]);   // merged catalogue for onboarding

  const indianSelected = (moodSelections.region || []).includes("indian");
  const cardOrder = indianSelected
    ? ["region", "indian_lang", "genre", "vibe"]
    : ["region", "genre", "vibe"];
  const currentMoodCard = MOOD_CARDS.find(c => c.id === cardOrder[moodStep]);
  const moodCardKey = currentMoodCard?.id;
  const totalCards = cardOrder.length;

  useEffect(() => {
    function routeRecovery() {
      setScreen("auth");
      setAuthMode("reset");
      setAuthError("");
      setAuthNotice("Recovery link verified. Set a new password to continue.");
    }
    function goAppFromSplash() {
      setScreen(prev => (prev === "splash" || prev === "auth" ? "loading-catalogue" : prev));
    }
    // Hydrate user; do not navigate to home here — avoids racing PASSWORD_RECOVERY (PKCE) and overwriting the reset screen.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUser(session.user);
      if (session?.user && (urlIndicatesPasswordRecovery() || isPasswordRecoverySession(session))) {
        routeRecovery();
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        routeRecovery();
        setUser(session?.user ?? null);
        return;
      }
      if (session?.user && (urlIndicatesPasswordRecovery() || isPasswordRecoverySession(session)) && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        routeRecovery();
        setUser(session.user);
        return;
      }
      if (session?.user && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        setUser(session.user);
        goAppFromSplash();
        return;
      }
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const safety = setTimeout(() => {
      if (!cancelled) setCatalogueBootstrapDone(true);
    }, CATALOGUE_BOOTSTRAP_SAFETY_MS);
    (async () => {
      try {
        const [data, theaters] = await Promise.all([fetchCataloguePhasePopular(), fetchInTheaters([])]);
        if (cancelled) return;
        const seen = new Set(data.map(m => m.id));
        const addedTheaters = theaters.filter(m => !seen.has(m.id));
        const merged = [...data, ...addedTheaters];
        setCatalogue(merged);
        setObCatalogue(data);
        setInTheaters(theaters);
        void (async () => {
          try {
            const enrich = await fetchCataloguePhaseTopRated();
            if (cancelled || enrich.length === 0) return;
            setCatalogue((prev) => mergeUniqueCatalogueRows(prev, enrich));
            setObCatalogue((prev) => mergeUniqueCatalogueRows(prev, enrich));
          } catch (e) {
            console.error(e);
          }
        })();
      } catch (e) {
        console.error(e);
      } finally {
        clearTimeout(safety);
        if (!cancelled) setCatalogueBootstrapDone(true);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(safety);
    };
  }, []);

  /**
   * In Theaters should react to region settings (e.g., Indian languages in US theatrical release window).
   * We keep the data source US-specific and enrich candidates via discover movie when regions are selected.
   */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const theaters = await fetchInTheaters(showRegionKeys);
        if (cancelled) return;
        setInTheaters(theaters);
        setCatalogue(prev => {
          const seen = new Set(prev.map(m => m.id));
          const added = theaters.filter(m => !seen.has(m.id));
          if (added.length === 0) return prev;
          return [...prev, ...added];
        });
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, [user, showRegionKeys]);

  /** Home streaming strip: phase 1 = movies (fast), phase 2 = TV + detail calls (slower). Ignores profile streaming provider selection (see More tab). */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setStreamingMoviesReady(false);
    setStreamingTvReady(false);
    const defer = setTimeout(() => {
      (async () => {
        let sm = [];
        try {
          sm = await fetchStreamingMoviesOnly(showRegionKeys);
        } catch (e) {
          console.error(e);
        }
        if (cancelled) return;
        setStreamingMovies(sm);
        setStreamingMoviesReady(true);
        setCatalogue((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const added = sm.filter((m) => !seen.has(m.id));
          if (added.length === 0) return prev;
          return [...prev, ...added];
        });

        let st = [];
        try {
          st = await fetchStreamingTVOnly(showRegionKeys);
        } catch (e) {
          console.error(e);
        }
        if (cancelled) return;
        setStreamingTV(st);
        setStreamingTvReady(true);
        setCatalogue((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const added = st.filter((m) => !seen.has(m.id));
          if (added.length === 0) return prev;
          return [...prev, ...added];
        });
      })();
    }, STREAMING_HOME_FETCH_DEFER_MS);
    return () => {
      cancelled = true;
      clearTimeout(defer);
    };
  }, [user, showRegionKeys]);

  useEffect(() => {
    if (!user) {
      setWhatsHot([]);
      setWhatsHotReady(false);
      return;
    }
    let cancelled = false;
    setWhatsHotReady(false);
    const defer = setTimeout(() => {
      (async () => {
        const rows = await fetchWhatsHotCatalog();
        if (cancelled) return;
        setWhatsHot(rows);
        setCatalogue((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const added = rows.filter((m) => !seen.has(m.id));
          if (added.length === 0) return prev;
          return [...prev, ...added];
        });
        setWhatsHotReady(true);
      })();
    }, WHATS_HOT_FETCH_DEFER_MS);
    return () => {
      cancelled = true;
      clearTimeout(defer);
    };
  }, [user]);

  /** V1.3.0: Fetch secondary-market theaters + streaming (parallel); V1.3.2: keep pools separate for tabs. */
  useEffect(() => {
    if (!user || !secondaryRegionKey || !V130_SECONDARY_REGION_IDS.includes(secondaryRegionKey)) {
      setSecondaryTheaterRows([]);
      setSecondaryStreamingMovieRows([]);
      setSecondaryStreamingTvRows([]);
      setSecondaryBlockSegment(SECONDARY_BLOCK_THEATERS);
      setSecondaryBlockStreamingTab("tv");
      setSecondaryStripReady(true);
      return;
    }
    let cancelled = false;
    setSecondaryStripReady(false);
    const defer = setTimeout(() => {
      (async () => {
        const tmdbReg = secondaryMarketTmdbRegion(secondaryRegionKey);
        const langCodes = getRegionLanguageCodes([secondaryRegionKey]);
        const langQuery = langCodes.length > 0 ? `&with_original_language=${langCodes.join("|")}` : "";
        const [theaters, sm, st] = await Promise.all([
          fetchInTheatersForMarket(tmdbReg, langCodes),
          fetchStreamingMoviesForMarket(tmdbReg, langQuery),
          fetchStreamingTVForMarket(tmdbReg, langQuery),
        ]);
        if (cancelled) return;
        const mergedCatalog = dedupeMediaRowsById([...theaters, ...sm, ...st]);
        setSecondaryTheaterRows(theaters);
        setSecondaryStreamingMovieRows(sm);
        setSecondaryStreamingTvRows(st);
        setCatalogue((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const added = mergedCatalog.filter((m) => !seen.has(m.id));
          if (added.length === 0) return prev;
          return [...prev, ...added];
        });
        setSecondaryStripReady(true);
      })();
    }, SECONDARY_STRIP_FETCH_DEFER_MS);
    return () => {
      cancelled = true;
      clearTimeout(defer);
    };
  }, [user, secondaryRegionKey]);

  const inTheatersForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return inTheaters;
    return inTheaters.filter(m => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [inTheaters, user, showGenreIds, showRegionKeys]);

  const streamingMoviesForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return streamingMovies;
    return streamingMovies.filter(m => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [streamingMovies, user, showGenreIds, showRegionKeys]);

  const streamingTVForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return streamingTV;
    return streamingTV.filter(m => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [streamingTV, user, showGenreIds, showRegionKeys]);

  const whatsHotForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return whatsHot;
    return whatsHot.filter(m => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [whatsHot, user, showGenreIds, showRegionKeys]);

  const whatsHotRecsResolved = useMemo(
    () => whatsHotForRecs.map(m => tmdbOnlyRec(m)),
    [whatsHotForRecs],
  );

  /** Movie ids also on the In Theaters row — small pill on What's hot cards only (no cross-strip dedupe). */
  const inTheaterIdsForWhatsHotPill = useMemo(
    () => new Set(inTheatersForRecs.map(m => m.id)),
    [inTheatersForRecs],
  );

  /** V1.3.2: All secondary-market titles (for recMap, TV meta, cold-start CTA). */
  const secondaryStripCatalogRows = useMemo(
    () => dedupeMediaRowsById([...secondaryTheaterRows, ...secondaryStreamingMovieRows, ...secondaryStreamingTvRows]),
    [secondaryTheaterRows, secondaryStreamingMovieRows, secondaryStreamingTvRows],
  );

  /**
   * V1.3.4: When `secondary_region_key` is set, merge secondary shelf titles into the CF catalogue even if
   * “Regions to show” would exclude them (e.g. Hollywood-only + Indian secondary). Genre filter still applies.
   */
  const catalogueForRecs = useMemo(() => {
    if (!user) return catalogue;
    const baseFiltered =
      !showGenreIds.length && !showRegionKeys.length
        ? catalogue
        : catalogue.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));

    if (!secondaryRegionKey || !V130_SECONDARY_REGION_IDS.includes(secondaryRegionKey)) {
      return baseFiltered;
    }

    const seen = new Set(baseFiltered.map((m) => m.id));
    const extras = [];
    for (const m of secondaryStripCatalogRows) {
      if (seen.has(m.id)) continue;
      if (showGenreIds.length > 0 && !passesShowGenresFilter(m, showGenreIds)) continue;
      seen.add(m.id);
      extras.push(m);
    }
    return extras.length === 0 ? baseFiltered : [...baseFiltered, ...extras];
  }, [catalogue, user, showGenreIds, showRegionKeys, secondaryRegionKey, secondaryStripCatalogRows]);

  const secondaryStripRecsAll = useMemo(
    () => secondaryStripCatalogRows.map((m) => tmdbOnlyRec(m)),
    [secondaryStripCatalogRows],
  );
  /** V1.3.2: Raw rows for the active In theaters / Streaming → Movies|Series tab. */
  const secondaryActiveRawRows = useMemo(() => {
    if (secondaryBlockSegment === SECONDARY_BLOCK_THEATERS) return secondaryTheaterRows;
    return secondaryBlockStreamingTab === "movie" ? secondaryStreamingMovieRows : secondaryStreamingTvRows;
  }, [secondaryBlockSegment, secondaryBlockStreamingTab, secondaryTheaterRows, secondaryStreamingMovieRows, secondaryStreamingTvRows]);
  /** V1.3.3: Fixed cap per tab — no Load more (tabs replace pagination). */
  const secondaryStripRecsVisible = useMemo(
    () => secondaryActiveRawRows.slice(0, SECONDARY_STRIP_TAB_CAP).map((m) => tmdbOnlyRec(m)),
    [secondaryActiveRawRows],
  );

  /** Collaborative filtering runs in Edge Function `match` (neighbour ratings loaded server-side; not in the client bundle). */
  useEffect(() => {
    if (!user) {
      setMatchData(null);
      setMatchLoading(false);
      return;
    }
    let cancelled = false;
    setMatchLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data, error } = await invokeMatch({
          action: "full",
          userRatings,
          catalogue: catalogueForRecs,
          inTheaters: inTheatersForRecs,
          streamingMovies: streamingMoviesForRecs,
          streamingTV: streamingTVForRecs,
          topPickOffset,
        });
        if (cancelled) return;
        if (error) {
          console.warn("match function:", error.message);
          setMatchData(null);
          return;
        }
        setMatchData(data);
      } catch (e) {
        if (!cancelled) console.error(e);
      } finally {
        if (!cancelled) setMatchLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
      setMatchLoading(false);
    };
  }, [user, userRatings, catalogueForRecs, inTheatersForRecs, streamingMoviesForRecs, streamingTVForRecs, topPickOffset]);

  useEffect(() => {
    if (screen !== "loading-catalogue" || !user || !catalogueBootstrapDone) return;
    let cancelled = false;
    (async () => {
      try {
        const { ratingCount } = await loadUserData();
        if (cancelled) return;
        const { data: authData } = await supabase.auth.getUser();
        const { data: sess } = await supabase.auth.getSession();
        const meta = authData?.user?.user_metadata ?? sess?.session?.user?.user_metadata;
        const raw = meta?.onboarding_complete;
        const flaggedDone = raw === true || raw === "true";
        const onboardingDone = flaggedDone || ratingCount > 0; /* ratings = legacy accounts */
        if (!onboardingDone) {
          setObStep(0);
          setCinemaPreference(null);
          setOtherCinema(null);
          setObCatalogue(catalogue);
          setScreen("pref-primary");
          return;
        }
        setScreen("home");
        setNavTab("home");
      } catch (e) {
        console.warn("Post-login routing failed:", e);
        if (!cancelled) {
          setObCatalogue(catalogue);
          setScreen("pref-primary");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [screen, catalogue, user, catalogueBootstrapDone]);

  useEffect(() => {
    if (screen !== "loading-catalogue") {
      setLoadingCatalogueSlowHint(false);
      return;
    }
    const t = setTimeout(() => setLoadingCatalogueSlowHint(true), 10_000);
    return () => clearTimeout(t);
  }, [screen]);

  /** Re-merge watchlist when catalogue grows (streaming, search) so posters resolve from full movie rows. */
  useEffect(() => {
    if (!user || catalogue.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data: watchlistData } = await supabase.from("watchlist").select("*").eq("user_id", user.id);
      if (cancelled || !watchlistData?.length) return;
      setWatchlist(buildWatchlistFromRows(watchlistData, catalogue));
    })();
    return () => { cancelled = true; };
  }, [user, catalogue]);

  /**
   * Rated list uses `catalogue` metadata; hydrate missing rated ids from TMDB so
   * Profile "Rated N" and visible rated titles stay in sync across sessions.
   */
  useEffect(() => {
    if (!user) return;
    const known = new Set(catalogue.map((m) => m.id));
    const missing = Object.keys(userRatings).filter((id) => (
      !known.has(id) && !attemptedRatedHydrationRef.current.has(id)
    ));
    if (missing.length === 0) return;

    const targets = missing.slice(0, 60);
    targets.forEach((id) => attemptedRatedHydrationRef.current.add(id));

    let cancelled = false;
    (async () => {
      const settled = await Promise.allSettled(
        targets.map(async (id) => {
          const [type, tmdbRaw] = id.split("-");
          const tmdbId = Number(tmdbRaw);
          if ((type !== "movie" && type !== "tv") || !Number.isFinite(tmdbId)) return null;
          const data = await fetchTMDB(`/${type}/${tmdbId}?language=en-US`);
          if (!data || data.success === false || !Number.isFinite(Number(data.id))) return null;
          return normalizeTMDBItem(data, type);
        }),
      );
      if (cancelled) return;
      const fetched = settled
        .filter((r) => r.status === "fulfilled" && r.value)
        .map((r) => r.value);
      if (fetched.length === 0) return;
      setCatalogue((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const added = fetched.filter((m) => !seen.has(m.id));
        if (added.length === 0) return prev;
        return [...prev, ...added];
      });
    })();
    return () => { cancelled = true; };
  }, [user, userRatings, catalogue]);

  async function invokeMatch(body) {
    const { data: sessData } = await supabase.auth.getSession();
    const accessToken = sessData?.session?.access_token;
    if (!accessToken) {
      return { data: null, error: { message: "No auth session token available" } };
    }
    return supabase.functions.invoke("match", {
      headers: { Authorization: `Bearer ${accessToken}` },
      body,
    });
  }

  async function loadUserData() {
    if (!user) return { ratingCount: 0 };
    const [{ data: ratingsData }, { data: watchlistData }] = await Promise.all([
      supabase.from("ratings").select("*").eq("user_id", user.id),
      supabase.from("watchlist").select("*").eq("user_id", user.id),
    ]);
    if (ratingsData) {
      const ratingsMap = {};
      ratingsData.forEach(r => { ratingsMap[`${r.media_type}-${r.tmdb_id}`] = r.score; });
      setUserRatings(ratingsMap);
    }
    if (watchlistData && catalogue.length > 0) {
      setWatchlist(buildWatchlistFromRows(watchlistData, catalogue));
    }

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("streaming_provider_ids, show_genre_ids, show_region_keys, secondary_region_key")
      .eq("id", user.id)
      .maybeSingle();
    const allowedRegions = new Set(PROFILE_REGION_OPTIONS.map(o => o.id));
    setSelectedStreamingProviderIds(
      Array.isArray(profileRow?.streaming_provider_ids)
        ? profileRow.streaming_provider_ids.filter(n => typeof n === "number")
        : [],
    );
    setShowGenreIds(
      Array.isArray(profileRow?.show_genre_ids)
        ? profileRow.show_genre_ids.filter(n => typeof n === "number")
        : [],
    );
    setShowRegionKeys(
      Array.isArray(profileRow?.show_region_keys)
        ? profileRow.show_region_keys.filter(k => typeof k === "string" && allowedRegions.has(k))
        : [],
    );
    const sk = profileRow?.secondary_region_key;
    setSecondaryRegionKey(
      typeof sk === "string" && V130_SECONDARY_REGION_IDS.includes(sk) ? sk : null,
    );
    return { ratingCount: ratingsData?.length ?? 0 };
  }

  /** Persisted on auth user so sign-in / new tab can skip onboarding after first completion. */
  async function markOnboardingComplete() {
    if (!user) return;
    try {
      const { data, error } = await supabase.auth.updateUser({ data: { onboarding_complete: true } });
      if (error) {
        console.warn("Could not persist onboarding flag:", error.message);
        return;
      }
      const u = data?.user;
      if (u) setUser(u);
    } catch (e) {
      console.warn("Could not persist onboarding flag:", e);
    }
  }

  async function persistStreamingProviders(ids) {
    if (!user) return;
    const clean = [...new Set(ids.filter(n => typeof n === "number"))].sort((a, b) => a - b);
    setSelectedStreamingProviderIds(clean);
    setProfileSettingsError("");
    const { error } = await supabase
      .from("profiles")
      .update({ streaming_provider_ids: clean })
      .eq("id", user.id);
    if (error) {
      setProfileSettingsError(`Could not save "Where you watch": ${error.message}`);
      console.warn("Could not save streaming providers to profile:", error.message);
    }
  }

  async function persistShowGenreIds(ids) {
    if (!user) return;
    const clean = [...new Set(ids.filter(n => typeof n === "number"))].sort((a, b) => a - b);
    setShowGenreIds(clean);
    setProfileSettingsError("");
    const { error } = await supabase
      .from("profiles")
      .update({ show_genre_ids: clean })
      .eq("id", user.id);
    if (error) {
      setProfileSettingsError(`Could not save genres: ${error.message}`);
      console.warn("Could not save genre preferences:", error.message);
    }
  }

  async function persistShowRegionKeys(keys) {
    if (!user) return;
    const allowed = new Set(PROFILE_REGION_OPTIONS.map(o => o.id));
    const clean = [...new Set(keys.filter(k => typeof k === "string" && allowed.has(k)))].sort();
    setShowRegionKeys(clean);
    setProfileSettingsError("");
    const { error } = await supabase
      .from("profiles")
      .update({ show_region_keys: clean })
      .eq("id", user.id);
    if (error) {
      setProfileSettingsError(`Could not save regions: ${error.message}`);
      console.warn("Could not save region preferences:", error.message);
    }
  }

  /** V1.3.0: Single secondary market for home Region strip; `null` hides the strip. */
  async function persistSecondaryRegionKey(key) {
    if (!user) return;
    const clean = key != null && V130_SECONDARY_REGION_IDS.includes(key) ? key : null;
    setProfileSettingsError("");
    const { error } = await supabase
      .from("profiles")
      .update({ secondary_region_key: clean })
      .eq("id", user.id);
    if (error) {
      setProfileSettingsError(`Could not save secondary region: ${error.message}`);
      console.warn("Could not save secondary_region_key:", error.message);
      return;
    }
    setSecondaryRegionKey(clean);
  }

  function toggleShowGenre(genreId) {
    const has = showGenreIds.includes(genreId);
    const next = has ? showGenreIds.filter(id => id !== genreId) : [...showGenreIds, genreId].sort((a, b) => a - b);
    persistShowGenreIds(next);
  }

  function toggleShowRegion(regionKey) {
    const has = showRegionKeys.includes(regionKey);
    const next = has ? showRegionKeys.filter(id => id !== regionKey) : [...showRegionKeys, regionKey].sort();
    persistShowRegionKeys(next);
  }

  function toggleStreamingProvider(providerId) {
    const has = selectedStreamingProviderIds.includes(providerId);
    const next = has
      ? selectedStreamingProviderIds.filter(id => id !== providerId)
      : [...selectedStreamingProviderIds, providerId].sort((a, b) => a - b);
    persistStreamingProviders(next);
  }

  async function handleSignUp() {
    setAuthError(""); setAuthLoading(true);
    let data;
    let error;
    try {
      ({ data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { data: { name: authName } } }));
    } catch (e) {
      setAuthError(e?.message || "Sign up failed. Check your connection and try again.");
      return;
    } finally {
      setAuthLoading(false);
    }
    if (error) { setAuthError(error.message); return; }
    if (data.user) {
      await supabase.from("profiles").update({ name: authName }).eq("id", data.user.id);
    }
    // Email confirmation: no session yet — stay on auth and ask user to confirm, then sign in.
    if (!data.session) {
      setAuthNotice("Check your email to confirm your account, then sign in. Onboarding starts after your first login.");
      return;
    }
    setUser(data.user);
    // Same path as sign-in: wait for catalogue in loading-catalogue before pref/onboarding (avoids empty obMovies).
    setScreen("loading-catalogue");
  }

  async function handleSignIn() {
    setAuthError(""); setAuthLoading(true);
    let data;
    let error;
    try {
      ({ data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword }));
    } catch (e) {
      setAuthError(e?.message || "Sign in failed. Check your connection and try again.");
      return;
    } finally {
      setAuthLoading(false);
    }
    if (error) { setAuthError(error.message); return; }
    if (data.user) { setUser(data.user); setScreen("loading-catalogue"); }
  }

  async function handleForgotPassword() {
    const email = authEmail.trim();
    setAuthError("");
    setAuthNotice("");
    if (!email) {
      setAuthError("Enter your email first, then tap Forgot password.");
      return;
    }
    setAuthLoading(true);
    let error;
    try {
      ({ error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: passwordRecoveryRedirectTo(),
      }));
    } catch (e) {
      setAuthError(e?.message || "Could not send reset email. Check your connection and try again.");
      return;
    } finally {
      setAuthLoading(false);
    }
    if (error) {
      setAuthError(error.message);
      return;
    }
    setAuthNotice("Reset link sent. Open the email and continue from the link.");
  }

  async function handleUpdatePassword() {
    const nextPassword = authPassword.trim();
    setAuthError("");
    setAuthNotice("");
    if (nextPassword.length < 6) {
      setAuthError("Password must be at least 6 characters.");
      return;
    }
    setAuthLoading(true);
    let error;
    try {
      ({ error } = await supabase.auth.updateUser({ password: nextPassword }));
    } catch (e) {
      setAuthError(e?.message || "Could not update password. Check your connection and try again.");
      return;
    } finally {
      setAuthLoading(false);
    }
    if (error) {
      setAuthError(error.message);
      return;
    }
    setAuthNotice("");
    setAuthPassword("");
    setScreen("loading-catalogue");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setUser(null); setUserRatings({}); setWatchlist([]);
    setMatchData(null);
    setSelectedStreamingProviderIds([]);
    setShowGenreIds([]);
    setShowRegionKeys([]);
    setSecondaryRegionKey(null);
    setSecondaryTheaterRows([]);
    setSecondaryStreamingMovieRows([]);
    setSecondaryStreamingTvRows([]);
    setSecondaryBlockSegment(SECONDARY_BLOCK_THEATERS);
    setSecondaryBlockStreamingTab("tv");
    setStreamingMovies([]);
    setStreamingTV([]);
    setWhatsHot([]);
    setWhatsHotReady(false);
    setStreamingMoviesReady(true);
    setStreamingTvReady(true);
    setCinemaPreference(null); setOtherCinema(null);
    setScreen("splash"); setNavTab("home");
  }

  async function retryInitialCatalogueFetch() {
    setCatalogueRetryBusy(true);
    try {
      const [data, theaters] = await Promise.all([fetchCatalogue(), fetchInTheaters([])]);
      const seen = new Set(data.map(m => m.id));
      const addedTheaters = theaters.filter(m => !seen.has(m.id));
      const merged = [...data, ...addedTheaters];
      setCatalogue(merged);
      setObCatalogue(data);
      setInTheaters(theaters);
    } catch (e) {
      console.error(e);
    } finally {
      setCatalogueRetryBusy(false);
    }
  }

  // Handle cinema preference confirmation
  async function confirmPrimaryPreference() {
    if (catalogue.length === 0) return;
    if (cinemaPreference === "hollywood") {
      // Use English catalogue only for onboarding
      setObCatalogue(catalogue);
      setScreen("onboarding");
    } else {
      // Go to secondary screen to pick one other cinema
      setScreen("pref-secondary");
    }
  }

  // Handle secondary cinema selection and build mixed onboarding catalogue
  async function confirmSecondaryPreference() {
    if (!otherCinema) {
      if (catalogue.length === 0) return;
      setObCatalogue(catalogue);
      setScreen("onboarding");
      return;
    }
    setScreen("loading-recs"); // Show loading while fetching regional titles
    const option = OTHER_CINEMA_OPTIONS.find(o => o.id === otherCinema);
    if (option) {
      const regional = await fetchRegionalTitles(option.lang);
      // Merge: 6 English + 6 regional for onboarding
      const currentYear = new Date().getFullYear();
      const engMovies = catalogue.filter(m => m.language === "en" && m.type === "movie" && m.year >= currentYear - 20).slice(0, 10);
      const engShows = catalogue.filter(m => m.language === "en" && m.type === "tv" && m.year >= currentYear - 20).slice(0, 10);
      const regMovies = regional.filter(m => m.type === "movie").slice(0, 10);
      const regShows = regional.filter(m => m.type === "tv").slice(0, 10);
      // Interleave English and regional
      const mixed = [];
      for (let i = 0; i < 6; i++) {
        if (engMovies[i]) mixed.push(engMovies[i]);
        if (regMovies[i]) mixed.push(regMovies[i]);
        if (engShows[i]) mixed.push(engShows[i]);
        if (regShows[i]) mixed.push(regShows[i]);
      }
      // Add regional to main catalogue too
      const allIds = new Set(catalogue.map(m => m.id));
      const newRegional = regional.filter(m => !allIds.has(m.id));
      const mergedCatalogue = [...catalogue, ...newRegional];
      setCatalogue(mergedCatalogue);
      setObCatalogue(mixed);
    }
    setScreen("onboarding");
  }

  useEffect(() => {
    if (appliedSearchQuery.length < 2) {
      setSearchResults([]);
      setSearchError("");
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError("");
    (async () => {
      try {
        const normalize = (item, type) => ({
          id: `${type}-${item.id}`, tmdbId: item.id, type,
          title: item.title || item.name,
          year: (item.release_date || item.first_air_date || "").slice(0, 4),
          releaseDate: tmdbReleaseDateString(item),
          synopsis: item.overview || "",
          poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
          backdrop: item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : null,
          tmdbRating: Math.round(item.vote_average * 10) / 10,
          genreIds: item.genre_ids || [],
          language: item.original_language || "en",
          originCountries: Array.isArray(item.origin_country)
            ? item.origin_country.filter(c => typeof c === "string").map(c => c.toUpperCase())
            : Array.isArray(item.production_countries)
              ? item.production_countries.map(c => c?.iso_3166_1).filter(c => typeof c === "string").map(c => c.toUpperCase())
              : [],
        });
        const filterType = activeFilter === "Movies" ? "movie" : activeFilter === "TV Shows" ? "tv" : null;
        let combined;
        if (filterType) {
          const { ok, rows } = await fetchTmdbSearchPages(filterType, appliedSearchQuery, DISCOVER_SEARCH_PAGES);
          if (!ok) {
            setSearchResults([]);
            setSearchError("Could not search right now. Check your connection and try again.");
            return;
          }
          combined = rows.slice(0, DISCOVER_SINGLE_TYPE_CAP).map((m) => normalize(m, filterType));
        } else {
          const [movieR, tvR] = await Promise.all([
            fetchTmdbSearchPages("movie", appliedSearchQuery, DISCOVER_SEARCH_PAGES),
            fetchTmdbSearchPages("tv", appliedSearchQuery, DISCOVER_SEARCH_PAGES),
          ]);
          if (!movieR.ok || !tvR.ok) {
            setSearchResults([]);
            setSearchError("Could not search right now. Check your connection and try again.");
            return;
          }
          combined = [
            ...movieR.rows.slice(0, DISCOVER_ALL_CAP_MOVIES).map((m) => normalize(m, "movie")),
            ...tvR.rows.slice(0, DISCOVER_ALL_CAP_TV).map((m) => normalize(m, "tv")),
          ];
        }
        const wantsAnimationOnly = isAnimationIntentQuery(appliedSearchQuery);
        setSearchResults(
          wantsAnimationOnly
            ? combined.filter((item) => hasExcludedGenre(item))
            : filterDefaultExcludedGenres(combined),
        );
      } catch (e) {
        console.error(e);
        setSearchResults([]);
        setSearchError("Search failed. Try again.");
      } finally {
        setSearching(false);
      }
    })();
  }, [appliedSearchQuery, activeFilter]);

  const ONBOARDING_COUNT = 12;
  const obMovies = useMemo(() => {
    if (obCatalogue.length === 0) return [];
    const currentYear = new Date().getFullYear();
    // If mixed catalogue, use it directly (already curated)
    if (otherCinema) {
      return obCatalogue.filter(m => m.year >= currentYear - 20).slice(0, ONBOARDING_COUNT);
    }
    // English only
    const movies = obCatalogue.filter(m => m.type === "movie" && m.year >= currentYear - 20).slice(0, 30);
    const shows = obCatalogue.filter(m => m.type === "tv" && m.year >= currentYear - 20).slice(0, 30);
    const mixed = [];
    for (let i = 0; i < 6; i++) { if (movies[i]) mixed.push(movies[i]); if (shows[i]) mixed.push(shows[i]); }
    return mixed.slice(0, ONBOARDING_COUNT);
  }, [obCatalogue, otherCinema]);

  const recommendations = matchData?.recommendations ?? EMPTY_MATCH_RECS;

  const theaterRecs = useMemo(() => {
    const fromMatch = matchData?.theaterRecs;
    if (fromMatch?.length) return fromMatch;
    return inTheatersForRecs.map(m => tmdbOnlyRec(m)).sort((a, b) => b.predicted - a.predicted);
  }, [matchData?.theaterRecs, inTheatersForRecs]);

  const streamingMovieRecsResolved = useMemo(() => {
    const fromMatch = matchData?.streamingMovieRecs;
    if (fromMatch?.length) return fromMatch;
    return streamingMoviesForRecs.map(m => tmdbOnlyRec(m)).sort((a, b) => b.predicted - a.predicted);
  }, [matchData?.streamingMovieRecs, streamingMoviesForRecs]);

  const streamingTvRecsResolved = useMemo(() => {
    const fromMatch = matchData?.streamingTvRecs;
    if (fromMatch?.length) return fromMatch;
    return streamingTVForRecs.map(m => tmdbOnlyRec(m)).sort((a, b) => b.predicted - a.predicted);
  }, [matchData?.streamingTvRecs, streamingTVForRecs]);

  const streamingRecs = streamingTab === "movie" ? streamingMovieRecsResolved : streamingTvRecsResolved;

  /**
   * Movies fetch completes before TV; default streaming tab is Series. Users who switch to Movies often
   * already have streamingMoviesReady=true, so the old !streamingMoviesReady skeleton never ran — empty strip.
   * Also show skeleton while match is in flight and there are no movie rows yet (TMDB pool empty until match fills).
   */
  const showStreamingMovieSkeleton =
    streamingTab === "movie" &&
    (!streamingMoviesReady ||
      (matchLoading && streamingMovieRecsResolved.length === 0));

  /** All streaming phases finished and TMDB returned nothing (avoid “couldn’t load” while movies or TV still fetching). */
  const homePicksLoadFailed = useMemo(
    () =>
      theaterRecs.length === 0 &&
      streamingMoviesReady &&
      streamingTvReady &&
      streamingMovies.length === 0 &&
      streamingTV.length === 0,
    [theaterRecs.length, streamingMovies, streamingTV, streamingMoviesReady, streamingTvReady],
  );

  const worthALookRecs = matchData?.worthALookRecs ?? EMPTY_MATCH_RECS;

  /**
   * Unrated titles with Edge predictions when strict CF `recommendations` is empty (worth-a-look + home rows).
   * If results stay thin, prefer a larger client catalogue; optional last resort is raising neighbor/overlap caps in `match` (see comment there).
   */
  const mergedFallbackPool = useMemo(() => {
    const rated = new Set(Object.keys(userRatings));
    const byId = new Map();
    const add = (arr) => {
      for (const r of arr) {
        if (!r?.movie?.id || rated.has(r.movie.id)) continue;
        const prev = byId.get(r.movie.id);
        if (!prev || r.predicted > prev.predicted) byId.set(r.movie.id, r);
      }
    };
    add(worthALookRecs);
    add(theaterRecs);
    add(streamingMovieRecsResolved);
    add(streamingTvRecsResolved);
    return [...byId.values()].sort((a, b) => b.predicted - a.predicted);
  }, [userRatings, worthALookRecs, theaterRecs, streamingMovieRecsResolved, streamingTvRecsResolved]);

  /**
   * Scored rows for Your picks strips: **CF recommendations first**, then worth-a-look / theater / streaming extras
   * (deduped). Otherwise a short CF list replaces a fuller pre-match pool and strips **flash then shrink**.
   */
  const yourPicksStripSorted = useMemo(() => {
    const primary =
      recommendations.length > 0
        ? [...recommendations].sort((a, b) => b.predicted - a.predicted)
        : [];
    const seen = new Set(primary.map((r) => r.movie.id));
    const out = [...primary];
    for (const r of mergedFallbackPool) {
      if (!r?.movie?.id || seen.has(r.movie.id)) continue;
      seen.add(r.movie.id);
      out.push(r);
    }
    return out;
  }, [recommendations, mergedFallbackPool]);

  const hasYourPicksStripSource = yourPicksStripSorted.length > 0;

  /** Strip 1: CF picks on selected streaming apps; strip 2: strong CF picks not on those apps. */
  const [moreForYouStrip, setMoreForYouStrip] = useState([]);
  const [worthLookStrip, setWorthLookStrip] = useState([]);
  /** True while resolving TMDB watch providers for More strips (sequential fetches). */
  const [moreStripsLoading, setMoreStripsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const getFlatrateProviderIds = async (movie) => {
      const key = `${movie.type}-${movie.tmdbId}`;
      if (worthProviderCacheRef.current.has(key)) return worthProviderCacheRef.current.get(key);
      const data = await fetchWatchProviders(movie.tmdbId, movie.type);
      const ids = Array.isArray(data?.flatrate)
        ? data.flatrate.map((p) => Number(p?.provider_id)).filter((n) => Number.isFinite(n))
        : [];
      worthProviderCacheRef.current.set(key, ids);
      return ids;
    };

    const rebuildMoreTabStrips = async () => {
      const sorted = yourPicksStripSorted;
      if (sorted.length === 0) {
        if (!cancelled) {
          setMoreStripsLoading(false);
          setMoreForYouStrip([]);
          setWorthLookStrip([]);
        }
        return;
      }

      const n = sorted.length;
      const start = topPickOffset % n;
      const rotated = [...sorted.slice(start), ...sorted.slice(0, start)];

      if (selectedStreamingProviderIds.length === 0) {
        let strip1Recs = rotated.slice(0, MORE_TAB_ON_SERVICE_MAX);
        const strip1Ids = new Set(strip1Recs.map((r) => r.movie.id));
        let strip2Recs = sorted
          .filter((r) => !strip1Ids.has(r.movie.id) && r.predicted >= MORE_TAB_OFF_SERVICE_PRED_MIN)
          .slice(0, MORE_TAB_OFF_SERVICE_MAX);
        strip2Recs = fillWorthLookStripFromPool(strip1Ids, strip2Recs, worthALookRecs);
        ;[strip1Recs, strip2Recs] = topUpYourPicksStrips(strip1Recs, strip2Recs, sorted);
        const strip1Rows = toPickRows(strip1Recs);
        const strip2Rows = toPickRows(strip2Recs);
        if (!cancelled) {
          setMoreStripsLoading(false);
          setMoreForYouStrip(strip1Rows);
          setWorthLookStrip(strip2Rows);
        }
        return;
      }

      if (!cancelled) setMoreStripsLoading(true);
      try {
        let strip1 = [];
        for (const rec of rotated) {
          if (strip1.length >= MORE_TAB_ON_SERVICE_MAX) break;
          const ids = await getFlatrateProviderIds(rec.movie);
          if (cancelled) return;
          if (ids.some((id) => selectedStreamingProviderIds.includes(id))) strip1.push(rec);
        }
        if (strip1.length === 0 && sorted.length > 0) {
          strip1 = rotated.slice(0, MORE_TAB_ON_SERVICE_MAX);
        } else if (strip1.length < MORE_TAB_ON_SERVICE_MAX && strip1.length > 0) {
          const inStrip1 = new Set(strip1.map((r) => r.movie.id));
          const merged = [...theaterRecs, ...streamingMovieRecsResolved, ...streamingTvRecsResolved, ...worthALookRecs];
          const seen = new Set(inStrip1);
          const backfillPool = [];
          for (const rec of merged) {
            if (!rec?.movie?.id || seen.has(rec.movie.id)) continue;
            seen.add(rec.movie.id);
            if (rec.predicted < MORE_TAB_OFF_SERVICE_PRED_MIN) continue;
            backfillPool.push(rec);
          }
          backfillPool.sort((a, b) => b.predicted - a.predicted);
          for (const rec of backfillPool) {
            if (strip1.length >= MORE_TAB_ON_SERVICE_MAX) break;
            const ids = await getFlatrateProviderIds(rec.movie);
            if (cancelled) return;
            if (ids.some((id) => selectedStreamingProviderIds.includes(id))) strip1.push(rec);
          }
        }

        // On-service matches alone are often < row cap; append next-best predictions so "For you" still fills (may not stream on selected apps).
        const strip1IdsForPad = new Set(strip1.map((r) => r.movie.id));
        for (const rec of sorted) {
          if (strip1.length >= MORE_TAB_ON_SERVICE_MAX) break;
          if (strip1IdsForPad.has(rec.movie.id)) continue;
          strip1.push(rec);
          strip1IdsForPad.add(rec.movie.id);
        }

        if (cancelled) return;

        const strip1Ids = new Set(strip1.map((r) => r.movie.id));
        let strip2 = [];
        for (const rec of sorted) {
          if (strip2.length >= MORE_TAB_OFF_SERVICE_MAX) break;
          if (strip1Ids.has(rec.movie.id)) continue;
          if (rec.predicted < MORE_TAB_OFF_SERVICE_PRED_MIN) continue;
          const ids = await getFlatrateProviderIds(rec.movie);
          if (cancelled) return;
          const on = ids.some((id) => selectedStreamingProviderIds.includes(id));
          if (!on) strip2.push(rec);
        }
        if (strip2.length < MORE_TAB_OFF_SERVICE_MAX) {
          const used2 = new Set([...strip1Ids, ...strip2.map((r) => r.movie.id)]);
          const pool2 = worthALookRecs
            .filter((r) => r?.movie?.id && !used2.has(r.movie.id) && r.predicted >= MORE_TAB_OFF_SERVICE_PRED_MIN)
            .sort((a, b) => b.predicted - a.predicted);
          for (const rec of pool2) {
            if (strip2.length >= MORE_TAB_OFF_SERVICE_MAX) break;
            const ids = await getFlatrateProviderIds(rec.movie);
            if (cancelled) return;
            const on = ids.some((id) => selectedStreamingProviderIds.includes(id));
            if (!on) strip2.push(rec);
          }
        }

        ;[strip1, strip2] = topUpYourPicksStrips(strip1, strip2, sorted);
        const strip1Rows = strip1.map((r) => ({ rec: r, kind: "pick" }));
        const strip2Rows = strip2.map((r) => ({ rec: r, kind: "pick" }));

        if (!cancelled) {
          setMoreForYouStrip(strip1Rows);
          setWorthLookStrip(strip2Rows);
        }
      } finally {
        if (!cancelled) setMoreStripsLoading(false);
      }
    };

    void rebuildMoreTabStrips();
    return () => {
      cancelled = true;
      setMoreStripsLoading(false);
    };
  }, [
    yourPicksStripSorted,
    selectedStreamingProviderIds,
    topPickOffset,
    theaterRecs,
    streamingMovieRecsResolved,
    streamingTvRecsResolved,
    worthALookRecs,
  ]);

  useEffect(() => {
    let cancelled = false;
    const tvCandidates = [
      ...theaterRecs.map((r) => r.movie),
      ...streamingRecs.map((r) => r.movie),
      ...whatsHotRecsResolved.map((r) => r.movie),
      ...secondaryStripRecsAll.map((r) => r.movie),
      ...moreForYouStrip.map((row) => row.rec.movie),
      ...worthLookStrip.map((row) => row.rec.movie),
    ]
      .filter((m) => m?.type === "tv" && Number.isFinite(Number(m?.tmdbId)));
    const missingTmdbIds = [...new Set(tvCandidates.map((m) => Number(m.tmdbId)))]
      .filter((id) => !tvStripMetaCacheRef.current.has(id))
      .slice(0, 30);
    if (missingTmdbIds.length === 0) return;
    // Strip labels for long-running TV should show latest known year + season count, not first-air year only.
    const hydrateTvStripMeta = async () => {
      const details = await fetchTvDetailsById(missingTmdbIds);
      for (const id of missingTmdbIds) {
        const detail = details.get(id);
        const latestYear = String(detail?.last_air_date || detail?.first_air_date || "").slice(0, 4) || null;
        const seasonCount = Number(detail?.number_of_seasons || 0) || null;
        tvStripMetaCacheRef.current.set(id, { latestYear, seasonCount });
      }
      if (!cancelled) {
        const next = {};
        tvStripMetaCacheRef.current.forEach((v, k) => { next[k] = v; });
        setTvStripMetaByTmdbId(next);
      }
    };
    void hydrateTvStripMeta();
    return () => { cancelled = true; };
  }, [theaterRecs, streamingRecs, whatsHotRecsResolved, secondaryStripRecsAll, moreForYouStrip, worthLookStrip]);

  const recMap = useMemo(() => ({
    ...Object.fromEntries(worthALookRecs.map(r => [r.movie.id, r])),
    ...Object.fromEntries(streamingMovieRecsResolved.map(r => [r.movie.id, r])),
    ...Object.fromEntries(streamingTvRecsResolved.map(r => [r.movie.id, r])),
    ...Object.fromEntries(whatsHotRecsResolved.map(r => [r.movie.id, r])),
    ...Object.fromEntries(secondaryStripRecsAll.map((r) => [r.movie.id, r])),
    ...Object.fromEntries(theaterRecs.map(r => [r.movie.id, r])),
    ...Object.fromEntries(moreForYouStrip.map((row) => [row.rec.movie.id, row.rec])),
    ...Object.fromEntries(worthLookStrip.map((row) => [row.rec.movie.id, row.rec])),
    ...Object.fromEntries(recommendations.map(r => [r.movie.id, r])),
  }), [worthALookRecs, streamingMovieRecsResolved, streamingTvRecsResolved, whatsHotRecsResolved, secondaryStripRecsAll, theaterRecs, moreForYouStrip, worthLookStrip, recommendations]);
  const FILTERS = ["All", "Movies", "TV Shows"];
  const rateMoreQueue = rateMoreMovies.length > 0 ? rateMoreMovies : obMovies;
  const rateMoreMovie = rateMoreQueue[obStep] ?? null;
  const yourPicksLoading = matchLoading || moreStripsLoading;

  function SkeletonStrip({ count = 7, showKind = false }) {
    return (
      <div className="strip" aria-hidden="true">
        {Array.from({ length: count }).map((_, idx) => (
          <div className="strip-card-skeleton" key={`sk-${idx}`}>
            <div className="skel-poster" />
            <div className="skel-line skel-line-title" />
            <div className="skel-line skel-line-meta" />
            {showKind && <div className="skel-line skel-line-kind" />}
          </div>
        ))}
      </div>
    );
  }

  const discoverItems = useMemo(() => {
    let base;
    if (appliedSearchQuery.length >= 2) base = searchResults;
    else base = catalogue.filter(m => activeFilter === "All" ? true : activeFilter === "Movies" ? m.type === "movie" : m.type === "tv");
    // Discover should surface fresher releases first; undated rows stay at the tail.
    return [...base].sort((a, b) => {
      const ay = Number.parseInt(a?.year || "", 10);
      const by = Number.parseInt(b?.year || "", 10);
      const aValid = Number.isFinite(ay);
      const bValid = Number.isFinite(by);
      if (aValid && bValid) return by - ay; // latest first
      if (aValid) return -1;
      if (bValid) return 1;
      return 0;
    });
  }, [catalogue, appliedSearchQuery, searchResults, activeFilter]);

  async function addRating(movieId, score) {
    setUserRatings(prev => ({ ...prev, [movieId]: score }));
    setWatchlist(prev => prev.filter(m => m.id !== movieId));
    setSelectedToWatch(prev => { const n = { ...prev }; delete n[movieId]; return n; });
    if (user) {
      const [type, tmdbId] = movieId.split("-");
      const { error: ratingErr } = await supabase.from("ratings").upsert({ user_id: user.id, tmdb_id: parseInt(tmdbId), media_type: type, score }, { onConflict: "user_id,tmdb_id,media_type" });
      if (ratingErr) console.warn("Could not save rating:", ratingErr.message);
      await supabase.from("watchlist").delete().eq("user_id", user.id).eq("tmdb_id", parseInt(tmdbId)).eq("media_type", type);
    }
  }

  function startDefaultRateMore() {
    setRateMoreMovies([]);
    setRateMoreContextMovieId(null);
    setRateSimilarError("");
    setObStep(0);
    setSliderVal(7);
    setSliderTouched(false);
    setScreen("rate-more");
  }

  async function fetchNeighborOverlapTitlesFor(movie, limit = ONBOARDING_COUNT) {
    const tmdbId = Number(movie?.tmdbId);
    const mediaType = movie?.type === "tv" ? "tv" : "movie";
    if (!Number.isFinite(tmdbId)) return [];

    const { data: seedRatings, error: seedErr } = await supabase
      .from("ratings")
      .select("user_id")
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType)
      .limit(450);
    if (seedErr) throw new Error(seedErr.message || "Could not load overlap users");

    const overlapUserIds = [...new Set((seedRatings || []).map((r) => r.user_id).filter(Boolean))].slice(0, 300);
    if (overlapUserIds.length === 0) return [];

    const { data: overlapRatings, error: overlapErr } = await supabase
      .from("ratings")
      .select("user_id, tmdb_id, media_type, score")
      .in("user_id", overlapUserIds)
      .limit(20000);
    if (overlapErr) throw new Error(overlapErr.message || "Could not load overlap ratings");

    const ratedIds = new Set(Object.keys(userRatings));
    const blockedIds = new Set([
      ...ratedIds,
      ...watchlist.map((m) => m.id),
      `${mediaType}-${tmdbId}`,
    ]);
    const movieById = new Map(catalogueForRecs.map((m) => [m.id, m]));
    const agg = new Map();

    for (const row of overlapRatings || []) {
      const rid = `${row.media_type}-${row.tmdb_id}`;
      if (blockedIds.has(rid)) continue;
      const m = movieById.get(rid);
      if (!m || hasExcludedGenre(m)) continue;
      let rec = agg.get(rid);
      if (!rec) {
        rec = { movie: m, userIds: new Set(), scoreSum: 0, scoreCount: 0 };
        agg.set(rid, rec);
      }
      rec.userIds.add(row.user_id);
      const s = Number(row.score);
      if (Number.isFinite(s)) {
        rec.scoreSum += s;
        rec.scoreCount += 1;
      }
    }

    return [...agg.values()]
      .map((x) => {
        const overlap = x.userIds.size;
        const avgScore = x.scoreCount > 0 ? (x.scoreSum / x.scoreCount) : 0;
        const sameTypeBoost = x.movie.type === mediaType ? 1.15 : 1;
        const popularityBoost = Math.min(Number(x.movie.popularity) || 0, 100) * 0.015;
        const rank = (overlap * 1.9 + avgScore * 0.65 + popularityBoost) * sameTypeBoost;
        return { movie: x.movie, rank };
      })
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit)
      .map((x) => x.movie);
  }

  async function handleRateNowForPrediction(movie) {
    setRateSimilarLoading(true);
    setRateSimilarError("");
    try {
      let queue = await fetchNeighborOverlapTitlesFor(movie, ONBOARDING_COUNT);
      if (queue.length === 0) {
        const fallbackType = movie?.type === "tv" ? "tv" : "movie";
        const blockedIds = new Set([...Object.keys(userRatings), ...watchlist.map((m) => m.id), movie?.id].filter(Boolean));
        queue = catalogueForRecs
          .filter((m) => m.type === fallbackType && !blockedIds.has(m.id))
          .sort((a, b) => (Number(b.popularity) || 0) - (Number(a.popularity) || 0))
          .slice(0, ONBOARDING_COUNT);
      }
      if (queue.length === 0) {
        setRateSimilarError("No similar titles available right now.");
        return;
      }
      setRateMoreMovies(queue);
      setRateMoreContextMovieId(movie?.id || null);
      setObStep(0);
      setSliderVal(7);
      setSliderTouched(false);
      setScreen("rate-more");
    } catch (e) {
      console.error(e);
      setRateSimilarError("Could not load similar titles right now.");
    } finally {
      setRateSimilarLoading(false);
    }
  }

  function exitRateMoreFlow() {
    const contextMovieId = rateMoreContextMovieId;
    setRateMoreMovies([]);
    setRateMoreContextMovieId(null);
    setRateSimilarError("");
    if (contextMovieId) {
      const contextMovie = catalogue.find((m) => m.id === contextMovieId) || selectedMovie?.movie;
      if (contextMovie) {
        setDetailEditRating(false);
        setDetailTouched(false);
        setDetailRating(7);
        setSelected((prev) => {
          if (prev?.movie?.id === contextMovieId) return prev;
          return { movie: contextMovie, prediction: recMap[contextMovieId] || null };
        });
        setScreen("detail");
        return;
      }
    }
    setNavTab("home");
    setScreen("home");
  }

  function advanceOb() {
    setSliderVal(7); setSliderTouched(false);
    if (obStep < rateMoreQueue.length - 1) {
      setObStep(s => s + 1);
    } else {
      void markOnboardingComplete();
      if (screen === "rate-more") {
        exitRateMoreFlow();
      }
      else { setScreen("loading-recs"); setTimeout(() => { setNavTab("home"); setScreen("home"); }, 2200); }
    }
  }

  function confirmRating() {
    if (rateMoreQueue[obStep]) addRating(rateMoreQueue[obStep].id, sliderVal);
    advanceOb();
  }

  async function openDetail(movie, prediction, opts = {}) {
    let pred = prediction;
    if (!pred && user && Object.keys(userRatings).length > 0) {
      try {
        const { data, error } = await invokeMatch({ action: "predict", userRatings, catalogue, movieId: movie.id });
        if (!error && data?.prediction) pred = data.prediction;
      } catch { /* optional prediction */ }
    }
    detailReturnScreenRef.current = screenRef.current;
    history.pushState({ cinemastroDetail: true }, "", window.location.href);
    detailHistoryPushedRef.current = true;
    setSelected({ movie, prediction: pred });
    if (opts.startEditing && userRatings[movie.id] != null) {
      setDetailEditRating(true);
      setDetailRating(userRatings[movie.id]);
      setDetailTouched(true);
    } else {
      setDetailEditRating(false);
      setDetailRating(7);
      setDetailTouched(false);
    }
    setScreen("detail");
  }

  function goBack() {
    if (detailHistoryPushedRef.current) {
      history.back();
      return;
    }
    setDetailEditRating(false);
    setSelected(null);
    setScreen(navTab === "mood" ? "mood-results" : navTab);
  }

  function openLegalPage(target) {
    legalReturnScreenRef.current = screenRef.current;
    history.pushState({ cinemastroLegal: true }, "", window.location.href);
    legalHistoryPushedRef.current = true;
    setScreen(target);
  }

  function closeLegalPage() {
    if (legalHistoryPushedRef.current) {
      history.back();
      return;
    }
    const ret = legalReturnScreenRef.current;
    legalReturnScreenRef.current = null;
    setScreen(ret ?? "home");
  }

  function goHome() {
    const s = screenRef.current;
    if (s === "onboarding" || s === "rate-more") void markOnboardingComplete();
    setNavTab("home");
    setScreen("home");
    setSelected(null);
    setDetailEditRating(false);
    setShowAvatarMenu(false);
  }

  useEffect(() => {
    if (!showAvatarMenu) return;
    const close = () => setShowAvatarMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showAvatarMenu]);

  useEffect(() => {
    const onPopState = () => {
      if (detailHistoryPushedRef.current) {
        detailHistoryPushedRef.current = false;
        const ret = detailReturnScreenRef.current;
        detailReturnScreenRef.current = null;
        setDetailEditRating(false);
        setSelected(null);
        if (ret != null) setScreen(ret);
        return;
      }
      if (legalHistoryPushedRef.current) {
        legalHistoryPushedRef.current = false;
        const ret = legalReturnScreenRef.current;
        legalReturnScreenRef.current = null;
        if (ret != null) setScreen(ret);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  async function toggleWatchlist(movie) {
    const alreadySaved = watchlist.find(m => m.id === movie.id);
    setWatchlist(w => alreadySaved ? w.filter(m => m.id !== movie.id) : [...w, movie]);
    if (user) {
      const [type, tmdbId] = movie.id.split("-");
      if (alreadySaved) {
        await supabase.from("watchlist").delete().eq("user_id", user.id).eq("tmdb_id", parseInt(tmdbId)).eq("media_type", type);
      } else {
        await supabase.from("watchlist").insert({ user_id: user.id, tmdb_id: parseInt(tmdbId), media_type: type, title: movie.title, poster: movie.poster });
        setTimeout(() => goBack(), 1000);
      }
    } else if (!alreadySaved) { setTimeout(() => goBack(), 1000); }
  }

  function toggleMoodOption(cardId, optionId) {
    setMoodSelections(prev => {
      const current = prev[cardId] || [];
      const exists = current.includes(optionId);
      return { ...prev, [cardId]: exists ? current.filter(i => i !== optionId) : [...current, optionId] };
    });
  }

  function advanceMood() {
    const nextStep = moodStep + 1;
    if (nextStep < cardOrder.length) { setMoodStep(nextStep); }
    else { computeMoodResults(); }
  }

  async function computeMoodResults() {
    setScreen("loading-recs");
    const { region, indian_lang, genre, vibe } = moodSelections;
    const currentYear = new Date().getFullYear();
    const params = new URLSearchParams({ language: "en-US", page: "1", sort_by: "popularity.desc" });
    const wantsAnimation = vibe.includes("animation_anime");
    if (!wantsAnimation) params.set("without_genres", DEFAULT_EXCLUDED_GENRE_IDS.join(","));

    let allLangs = [];
    if (region.length > 0 && !region.includes("any")) {
      // Get languages from non-indian regions first
      const nonIndianRegions = region.filter(r => r !== "indian");
      allLangs = nonIndianRegions.flatMap(r => MOOD_CARDS[0].options.find(o => o.id === r)?.languages || []);
      // Add Indian languages if selected
      if (region.includes("indian")) {
        const selectedIndianLangs = indian_lang || [];
        if (selectedIndianLangs.includes("all_indian") || selectedIndianLangs.length === 0) {
          allLangs = [...allLangs, ...ALL_INDIAN_LANGS];
        } else {
          const indianCard = MOOD_CARDS.find(c => c.id === "indian_lang");
          const indianLangs = selectedIndianLangs.flatMap(l => indianCard?.options.find(o => o.id === l)?.languages || []);
          allLangs = [...allLangs, ...indianLangs];
        }
      }
      if (allLangs.length > 0) params.set("with_original_language", allLangs.join("|"));
    }

    if (genre.length > 0) params.set("with_genres", genre.join("|"));
    // TMDB has no "critics" / "hidden gem" lists — approximate with discover filters.
    const wantsHidden = vibe.includes("hidden");
    const wantsShort = vibe.includes("short");
    const wantsVeryRecent = vibe.includes("very_recent");
    const wantsRecent = vibe.includes("recent");
    const wantsModern = vibe.includes("modern");
    const wantsClassic = vibe.includes("classic");
    const wantsAcclaimed = vibe.includes("acclaimed");
    if (wantsShort) params.set("with_runtime.lte", "90"); // quick-watch movies: under 90m
    if (wantsHidden) {
      // Hidden gems: high-rated, consensus-liquidity floor, then local score sorting.
      params.set("sort_by", "vote_average.desc");
      params.set("vote_average.gte", "7.5");
      params.set("vote_count.gte", "100");
    } else if (wantsAcclaimed) {
      params.set("vote_average.gte", "7.5");
      params.set("vote_count.gte", "200");
    }
    // Era precedence (deterministic): modern (3–15y) > very_recent/recent > classic (15y+)
    if (wantsModern) {
      params.set("primary_release_date.gte", `${currentYear - 15}-01-01`);
      params.set("primary_release_date.lte", `${currentYear - 3}-12-31`);
    } else {
      if (wantsVeryRecent) params.set("primary_release_date.gte", `${currentYear - 1}-01-01`);
      else if (wantsRecent) params.set("primary_release_date.gte", `${currentYear - 3}-01-01`);
    }
    if (wantsClassic && !wantsModern && !wantsVeryRecent && !wantsRecent) {
      // Classic = at least 15 years old and broadly validated.
      params.set("primary_release_date.lte", `${currentYear - 15}-12-31`);
      params.set("vote_count.gte", "250");
    }
    if (vibe.includes("family")) params.set("with_genres", [...(genre.length ? genre : []), "10751"].join("|"));

    try {
      // If mixing English + other languages, fetch separately and interleave
      const hasEnglish = region.includes("en") || region.includes("any") || region.length === 0;
      const nonEngLangs = allLangs.filter(l => l !== "en");

      let allMovieResults = [], allTVResults = [];

      if (hasEnglish && nonEngLangs.length > 0) {
        const engParams = new URLSearchParams(params);
        engParams.set("with_original_language", "en");
        const regParams = new URLSearchParams(params);
        regParams.set("with_original_language", nonEngLangs.join("|"));

        const engTv = tmdbTvParamsFromMovieParams(engParams);
        const regTv = tmdbTvParamsFromMovieParams(regParams);
        if (wantsShort) {
          // Quick-watch TV: favor short episodes and ended shows.
          engTv.set("with_runtime.lte", "24");
          regTv.set("with_runtime.lte", "24");
          engTv.set("with_status", "3");
          regTv.set("with_status", "3");
        }
        if (wantsAcclaimed) {
          // Acclaimed can get over-pruned later; fetch deeper pages up front to widen candidate supply.
          const engParamsP2 = new URLSearchParams(engParams); engParamsP2.set("page", "2");
          const engParamsP3 = new URLSearchParams(engParams); engParamsP3.set("page", "3");
          const regParamsP2 = new URLSearchParams(regParams); regParamsP2.set("page", "2");
          const regParamsP3 = new URLSearchParams(regParams); regParamsP3.set("page", "3");
          const engTvP2 = new URLSearchParams(engTv); engTvP2.set("page", "2");
          const engTvP3 = new URLSearchParams(engTv); engTvP3.set("page", "3");
          const regTvP2 = new URLSearchParams(regTv); regTvP2.set("page", "2");
          const regTvP3 = new URLSearchParams(regTv); regTvP3.set("page", "3");
          const [em1, em2, em3, et1, et2, et3, rm1, rm2, rm3, rt1, rt2, rt3] = await Promise.all([
            fetchTMDB(`/discover/movie?${engParams.toString()}`),
            fetchTMDB(`/discover/movie?${engParamsP2.toString()}`),
            fetchTMDB(`/discover/movie?${engParamsP3.toString()}`),
            fetchTMDB(`/discover/tv?${engTv.toString()}`),
            fetchTMDB(`/discover/tv?${engTvP2.toString()}`),
            fetchTMDB(`/discover/tv?${engTvP3.toString()}`),
            fetchTMDB(`/discover/movie?${regParams.toString()}`),
            fetchTMDB(`/discover/movie?${regParamsP2.toString()}`),
            fetchTMDB(`/discover/movie?${regParamsP3.toString()}`),
            fetchTMDB(`/discover/tv?${regTv.toString()}`),
            fetchTMDB(`/discover/tv?${regTvP2.toString()}`),
            fetchTMDB(`/discover/tv?${regTvP3.toString()}`),
          ]);
          allMovieResults = [
            ...(em1.results || []), ...(em2.results || []), ...(em3.results || []),
            ...(rm1.results || []), ...(rm2.results || []), ...(rm3.results || []),
          ].slice(0, 60);
          allTVResults = [
            ...(et1.results || []), ...(et2.results || []), ...(et3.results || []),
            ...(rt1.results || []), ...(rt2.results || []), ...(rt3.results || []),
          ].slice(0, 60);
        } else {
          const [engMovies, engTV, regMovies, regTV] = await Promise.all([
            fetchTMDB(`/discover/movie?${engParams.toString()}`),
            fetchTMDB(`/discover/tv?${engTv.toString()}`),
            fetchTMDB(`/discover/movie?${regParams.toString()}`),
            fetchTMDB(`/discover/tv?${regTv.toString()}`),
          ]);
          // Interleave: 1 English, 1 Regional alternating
          const eM = (engMovies.results || []).slice(0, 10);
          const rM = (regMovies.results || []).slice(0, 10);
          const eT = (engTV.results || []).slice(0, 10);
          const rT = (regTV.results || []).slice(0, 10);
          for (let i = 0; i < 10; i++) {
            if (eM[i]) allMovieResults.push({ ...eM[i], _lang: "en" });
            if (rM[i]) allMovieResults.push({ ...rM[i], _lang: "reg" });
            if (eT[i]) allTVResults.push({ ...eT[i], _lang: "en" });
            if (rT[i]) allTVResults.push({ ...rT[i], _lang: "reg" });
          }
        }
      } else {
        const tvParams = tmdbTvParamsFromMovieParams(params);
        if (wantsShort) {
          tvParams.set("with_runtime.lte", "24");
          tvParams.set("with_status", "3");
        }
        if (wantsHidden || wantsAcclaimed) {
          const movieP2 = new URLSearchParams(params); movieP2.set("page", "2");
          const movieP3 = new URLSearchParams(params); movieP3.set("page", "3");
          const tvP2 = new URLSearchParams(tvParams); tvP2.set("page", "2");
          const tvP3 = new URLSearchParams(tvParams); tvP3.set("page", "3");
          const [m1, m2, m3, t1, t2, t3] = await Promise.all([
            fetchTMDB(`/discover/movie?${params.toString()}`),
            fetchTMDB(`/discover/movie?${movieP2.toString()}`),
            fetchTMDB(`/discover/movie?${movieP3.toString()}`),
            fetchTMDB(`/discover/tv?${tvParams.toString()}`),
            fetchTMDB(`/discover/tv?${tvP2.toString()}`),
            fetchTMDB(`/discover/tv?${tvP3.toString()}`),
          ]);
          const perTypeCap = wantsAcclaimed ? 60 : 30;
          allMovieResults = [...(m1.results || []), ...(m2.results || []), ...(m3.results || [])].slice(0, perTypeCap);
          allTVResults = [...(t1.results || []), ...(t2.results || []), ...(t3.results || [])].slice(0, perTypeCap);
        } else {
          const [movieData, tvData] = await Promise.all([
            fetchTMDB(`/discover/movie?${params.toString()}`),
            fetchTMDB(`/discover/tv?${tvParams.toString()}`),
          ]);
          allMovieResults = (movieData.results || []).slice(0, 10);
          allTVResults = (tvData.results || []).slice(0, 10);
        }
      }
      const normalize = (item, type) => ({
        id: `${type}-${item.id}`, tmdbId: item.id, type,
        title: item.title || item.name,
        year: (item.release_date || item.first_air_date || "").slice(0, 4),
        releaseDate: tmdbReleaseDateString(item),
        synopsis: item.overview || "",
        poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : null,
        tmdbRating: Math.round((item.vote_average || 0) * 10) / 10 || 7,
        voteCount: Number(item.vote_count || 0),
        genreIds: item.genre_ids || [],
        language: item.original_language || "en",
        popularity: item.popularity,
        hiddenBaseScore: (Math.round((item.vote_average || 0) * 10) / 10 * 2) - Number(item.popularity || 0),
        originCountries: Array.isArray(item.origin_country)
          ? item.origin_country.filter(c => typeof c === "string").map(c => c.toUpperCase())
          : Array.isArray(item.production_countries)
            ? item.production_countries.map(c => c?.iso_3166_1).filter(c => typeof c === "string").map(c => c.toUpperCase())
            : [],
      });
      let combined = [
        ...allMovieResults.slice(0, 10).map(m => normalize(m, "movie")),
        ...allTVResults.slice(0, 10).map(m => normalize(m, "tv")),
      ];
      if (combined.length === 0) {
        const fallbackWithoutGenres = wantsAnimation
          ? ""
          : `&without_genres=${DEFAULT_EXCLUDED_GENRE_IDS.join(",")}`;
        const [mFb, tFb] = await Promise.all([
          fetchTMDB(`/discover/movie?language=en-US&page=1&sort_by=popularity.desc${fallbackWithoutGenres}`),
          fetchTMDB(`/discover/tv?language=en-US&page=1&sort_by=popularity.desc${fallbackWithoutGenres}`),
        ]);
        combined = [
          ...(mFb.results || []).slice(0, 8).map(m => normalize(m, "movie")),
          ...(tFb.results || []).slice(0, 8).map(m => normalize(m, "tv")),
        ];
      }
      const needsCountryHydration = Array.isArray(region) && (region.includes("en") || region.includes("indian"));
      if (needsCountryHydration) {
        combined = await Promise.all(combined.map(async (m) => {
          if (Array.isArray(m.originCountries) && m.originCountries.length > 0) return m;
          try {
            const detail = await fetchTMDB(`/${m.type}/${m.tmdbId}?language=en-US`);
            const originCountries = Array.isArray(detail?.origin_country)
              ? detail.origin_country.filter(c => typeof c === "string").map(c => c.toUpperCase())
              : Array.isArray(detail?.production_countries)
                ? detail.production_countries.map(c => c?.iso_3166_1).filter(c => typeof c === "string").map(c => c.toUpperCase())
                : [];
            return { ...m, originCountries };
          } catch {
            return m;
          }
        }));
      }
      const documentarySelected = Array.isArray(genre) && genre.includes(99);
      combined = combined.filter((m) => passesMoodRegionFilter(m, region));
      if (!documentarySelected) {
        combined = combined.filter((m) => !isDocumentaryLike(m));
      }
      if (wantsHidden) {
        combined = [...combined]
          .filter((m) => Number(m.voteCount || 0) >= 100)
          .sort((a, b) => (Number(b.hiddenBaseScore || 0) - Number(a.hiddenBaseScore || 0)))
          .slice(0, 50);
      }
      if (wantsAcclaimed && combined.length < 10) {
        // Refill pass: keep acclaimed intent but soften vote floor to avoid tiny result sets.
        const refillParams = new URLSearchParams(params);
        refillParams.set("vote_count.gte", "100");
        const refillTvParams = tmdbTvParamsFromMovieParams(refillParams);
        const refillMovieP2 = new URLSearchParams(refillParams); refillMovieP2.set("page", "2");
        const refillTvP2 = new URLSearchParams(refillTvParams); refillTvP2.set("page", "2");
        const [m1, m2, t1, t2] = await Promise.all([
          fetchTMDB(`/discover/movie?${refillParams.toString()}`),
          fetchTMDB(`/discover/movie?${refillMovieP2.toString()}`),
          fetchTMDB(`/discover/tv?${refillTvParams.toString()}`),
          fetchTMDB(`/discover/tv?${refillTvP2.toString()}`),
        ]);
        const refill = [
          ...((m1.results || []).slice(0, 14)).map((m) => normalize(m, "movie")),
          ...((m2.results || []).slice(0, 14)).map((m) => normalize(m, "movie")),
          ...((t1.results || []).slice(0, 14)).map((m) => normalize(m, "tv")),
          ...((t2.results || []).slice(0, 14)).map((m) => normalize(m, "tv")),
        ];
        const seenIds = new Set(combined.map((m) => m.id));
        const refillFiltered = refill
          .filter((m) => !seenIds.has(m.id))
          .filter((m) => passesMoodRegionFilter(m, region))
          .filter((m) => documentarySelected || !isDocumentaryLike(m));
        combined = [...combined, ...refillFiltered].slice(0, 30);
      }
      function scoreMoodFromTmdb() {
        const seen = new Set(Object.keys(userRatings));
        let pool = combined.filter(m => !seen.has(m.id));
        if (pool.length === 0) pool = combined.slice();
        const base = pool
          .map(m => ({
            movie: m,
            predicted: m.tmdbRating,
            low: Math.max(1, m.tmdbRating - 1),
            high: Math.min(10, m.tmdbRating + 1),
            confidence: "low",
            neighborCount: 0,
          }));
        return wantsHidden
          ? base.sort((a, b) => (Number(b.movie.hiddenBaseScore || 0) - Number(a.movie.hiddenBaseScore || 0)))
          : base.sort((a, b) => b.predicted - a.predicted);
      }
      let scored = [];
      if (user && !wantsHidden) {
        const { data, error } = await invokeMatch({ action: "mood", userRatings, catalogue, movies: combined, vibe });
        if (!error && data?.scored?.length) scored = data.scored;
        else {
          if (error) console.warn("mood match function:", error.message);
          scored = scoreMoodFromTmdb();
        }
      } else {
        scored = scoreMoodFromTmdb();
      }
      if (scored.length < 10) {
        // Safety net: if edge scoring comes back thin, top up locally from the same candidate pool.
        const localBackfill = scoreMoodFromTmdb();
        const seenRecIds = new Set(scored.map((r) => r?.movie?.id).filter(Boolean));
        for (const rec of localBackfill) {
          const id = rec?.movie?.id;
          if (!id || seenRecIds.has(id)) continue;
          scored.push(rec);
          seenRecIds.add(id);
          if (scored.length >= 10) break;
        }
      }
      setMoodResults(pickMoodMix(scored, 7, 3));
    } catch (e) { console.error(e); setMoodResults([]); }
    setScreen("mood-results");
  }

  function resetMood() {
    setMoodStep(0);
    setMoodSelections({ region: [], indian_lang: [], genre: [], vibe: [] });
    setMoodResults([]);
    setScreen("mood-picker");
  }

  function selectToWatch(movieId) {
    setSelectedToWatch(prev => ({ ...prev, [movieId]: !prev[movieId] }));
    const movie = catalogue.find(m => m.id === movieId) || moodResults.find(r => r.movie.id === movieId)?.movie;
    if (movie && !watchlist.find(m => m.id === movieId)) toggleWatchlist(movie);
  }

  const inWatchlist = (id) => watchlist.some(m => m.id === id);
  const confClass = (c) => c === "high" ? "conf-high" : c === "medium" ? "conf-medium" : "conf-low";
  const confLabel = (c) => c === "high" ? "✓✓ High confidence" : c === "medium" ? "✓ Medium confidence" : "~ Low confidence";
  const stripConfShort = (c) => (c === "high" ? "High confidence" : c === "medium" ? "Medium" : "Low confidence");
  const predBoxClass = (c) => c === "high" ? "d-pred-box-high" : c === "medium" ? "d-pred-box-medium" : "d-pred-box-low";
  const predValClass = (c) => c === "high" ? "d-pred-val-high" : c === "medium" ? "d-pred-val-medium" : "d-pred-val-low";
  const predRangeClass = (c) => c === "high" ? "d-pred-range-high" : c === "medium" ? "d-pred-range-medium" : "d-pred-range-low";
  const shouldShowPredRange = (pred) => {
    if (!pred) return false;
    if (pred.confidence !== "high") return true;
    const width = Math.abs(Number(pred.high) - Number(pred.low));
    return Number.isFinite(width) && width > 0.4;
  };
  const obMovie = obMovies[obStep];
  const userInitial = user?.user_metadata?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "?";
  const userName = user?.user_metadata?.name || user?.email?.split("@")[0] || "there";
  const ratedMovies = Object.entries(userRatings).map(([id, score]) => {
    const movie = catalogue.find(m => m.id === id);
    return movie ? { movie, score } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score);

  const ratedSearchLower = ratedSearchQuery.trim().toLowerCase();
  const filteredRatedMovies = ratedSearchLower
    ? ratedMovies.filter(({ movie }) => (movie.title || "").toLowerCase().includes(ratedSearchLower))
    : ratedMovies;

  const navProps = { navTab, setNavTab, setScreen, setMoodStep, setMoodSelections, setMoodResults };

  function AccountAvatarMenu() {
    return (
      <div className="avatar-wrap">
        <div
          className="avatar"
          onClick={(e) => {
            e.stopPropagation();
            setShowAvatarMenu(v => !v);
          }}
        >
          {userInitial}
        </div>
        {showAvatarMenu && (
          <div className="avatar-menu" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="avatar-menu-btn"
              onClick={() => {
                setShowAvatarMenu(false);
                setNavTab("profile");
                setScreen("profile");
              }}
            >
              Profile
            </button>
            <button
              type="button"
              className="avatar-menu-btn danger"
              onClick={() => {
                setShowAvatarMenu(false);
                handleSignOut();
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="viewport-shell">
      <div className="app">
        <style>{styles}</style>

      {/* SPLASH */}
      {screen === "splash" && (
        <div className="splash">
          <div className="splash-logo"><AppBrand variant="splash" /></div>
          <button className="btn-primary" onClick={() => { setAuthMode("signup"); setScreen("auth"); }}>Get Started</button>
          <button className="btn-ghost" onClick={() => { setAuthMode("signin"); setScreen("auth"); }}>Sign In</button>
        </div>
      )}

      {/* AUTH */}
      {screen === "auth" && (
        <div className="auth">
          <button className="auth-back" onClick={() => setScreen("splash")}>← Back</button>
          <div className="auth-inner">
            <div className="auth-title">{authMode === "signup" ? "Create account" : authMode === "reset" ? "Reset password" : "Welcome back"}</div>
            <div className="auth-sub">{authMode === "signup" ? "Join Cinemastro to get personalised picks" : authMode === "reset" ? "Set a new password for your account" : "Sign in to your Cinemastro account"}</div>
            {authNotice && <div className="auth-note">{authNotice}</div>}
            {authError && <div className="auth-error">{authError}</div>}
            {authMode === "signup" && (
              <div className="auth-field">
                <label className="auth-label">Your name</label>
                <input className="auth-input" type="text" placeholder="e.g. Alex" value={authName} onChange={e => setAuthName(e.target.value)} />
              </div>
            )}
            <div className="auth-field">
              <label className="auth-label">Email</label>
              <input className="auth-input" type="email" placeholder="you@example.com" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
            </div>
            <div className="auth-field">
              <label className="auth-label">{authMode === "reset" ? "New password" : "Password"}</label>
              <input className="auth-input" type="password" placeholder="Min. 6 characters" value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
            </div>
            {authMode === "signin" && (
              <div className="auth-link-row">
                <button type="button" className="auth-link-btn" onClick={handleForgotPassword} disabled={authLoading}>Forgot password?</button>
              </div>
            )}
            <button className="auth-btn" disabled={authLoading} onClick={authMode === "signup" ? handleSignUp : authMode === "reset" ? handleUpdatePassword : handleSignIn}>
              {authLoading ? "Please wait…" : authMode === "signup" ? "Create Account" : authMode === "reset" ? "Update Password" : "Sign In"}
            </button>
            {authMode !== "reset" && (
              <div className="auth-switch">
                {authMode === "signup"
                  ? <>Already have an account? <span onClick={() => { setAuthMode("signin"); setAuthError(""); setAuthNotice(""); }}>Sign in</span></>
                  : <>New to Cinemastro? <span onClick={() => { setAuthMode("signup"); setAuthError(""); setAuthNotice(""); }}>Create account</span></>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CINEMA PREFERENCE — PRIMARY */}
      {screen === "pref-primary" && (
        <div className="pref">
          <div className="pref-step">Step 1 of 2</div>
          <div className="pref-title">What do you mainly watch?</div>
          <div className="pref-sub">This helps us pick the right titles for you to rate</div>
          <div className="pref-options">
            <div className={`pref-option ${cinemaPreference === "hollywood" ? "selected" : ""}`}
              onClick={() => setCinemaPreference("hollywood")}>
              <div className="pref-option-icon">🌍</div>
              <div className="pref-option-text">
                <div className="pref-option-label">Mainly Hollywood / English</div>
                <div className="pref-option-desc">US & UK films and TV shows</div>
              </div>
            </div>
            <div className={`pref-option ${cinemaPreference === "mix" ? "selected" : ""}`}
              onClick={() => setCinemaPreference("mix")}>
              <div className="pref-option-icon">🌏</div>
              <div className="pref-option-text">
                <div className="pref-option-label">A mix of languages</div>
                <div className="pref-option-desc">I also enjoy other world cinema</div>
              </div>
            </div>
          </div>
          {catalogue.length === 0 && (
            <p className="pref-sub" style={{ marginTop: 16, color: "#888" }}>
              {catalogueBootstrapDone
                ? (
                  <>
                    Couldn’t load titles. Check your connection, then{" "}
                    <button
                      type="button"
                      className="auth-link-btn"
                      disabled={catalogueRetryBusy}
                      onClick={() => void retryInitialCatalogueFetch()}
                    >
                      {catalogueRetryBusy ? "Retrying…" : "try again"}
                    </button>
                    .
                  </>
                )
                : "Loading catalogue…"}
            </p>
          )}
          <button className="pref-btn" disabled={!cinemaPreference || catalogue.length === 0} onClick={confirmPrimaryPreference}>
            Continue →
          </button>
        </div>
      )}

      {/* CINEMA PREFERENCE — SECONDARY */}
      {screen === "pref-secondary" && (
        <div className="pref">
          <div className="pref-step">Step 2 of 2</div>
          <div className="pref-title">Which other cinema do you love?</div>
          <div className="pref-sub">Pick one — you can always explore more later</div>
          <div className="pref-grid">
            {OTHER_CINEMA_OPTIONS.map(opt => (
              <div key={opt.id}
                className={`pref-grid-option ${otherCinema === opt.id ? "selected" : ""}`}
                onClick={() => setOtherCinema(opt.id)}>
                <div className="pref-grid-icon">{opt.flag}</div>
                <div className="pref-grid-label">{opt.label}</div>
              </div>
            ))}
          </div>
          <button className="pref-btn" disabled={!otherCinema} onClick={confirmSecondaryPreference}>
            Let's go 🎬
          </button>
        </div>
      )}

      {/* LOADING CATALOGUE */}
      {screen === "loading-catalogue" && (
        <div className="loading">
          <div className="loading-ring" />
          <div className="loading-title">Loading Cinemastro…</div>
          <div className="loading-sub">Fetching your profile</div>
          {loadingCatalogueSlowHint && (
            <div className="loading-sub" style={{ marginTop: 14, maxWidth: 280, textAlign: "center", lineHeight: 1.45 }}>
              This is taking longer than usual — often a slow network. It should continue automatically; you can also close and reopen the app.
            </div>
          )}
        </div>
      )}

      {/* FETCHING */}
      {screen === "fetching" && (
        <div className="loading">
          <div className="loading-ring" />
          <div className="loading-title">Loading titles…</div>
          <div className="loading-sub">Fetching movies & shows</div>
        </div>
      )}
      {screen === "fetching" && catalogue.length > 0 && (() => { setTimeout(() => setScreen("onboarding"), 100); return null; })()}

      {/* ONBOARDING */}
      {screen === "onboarding" && !obMovie && (
        <div className="loading">
          <div className="loading-ring" />
          <div className="loading-title">Preparing titles…</div>
          <div className="loading-sub">One moment</div>
        </div>
      )}
      {screen === "onboarding" && obMovie && (
        <div className="onboarding">
          <div className="ob-header">
            <TopbarBrandCluster onPress={goHome} community={siteStats?.community} ratings={siteStats?.ratings} />
            <div className="ob-step">Step {obStep + 1} of {obMovies.length}</div>
            <div className="ob-title">Rate what you've seen</div>
            <div className="ob-subtitle">Creating your tastometer</div>
          </div>
          <div className="ob-dots">
            {obMovies.map((_, i) => (
              <div key={i} className={`ob-dot ${i < obStep ? "done" : i === obStep ? "active" : ""}`} />
            ))}
          </div>
          <div className="card-area">
            <div className="movie-card" key={obStep}>
              <div className="card-poster">
                {obMovie.poster ? <img src={obMovie.poster} alt={obMovie.title} /> : <div className="card-poster-fallback">🎬</div>}
                <div className="card-type-badge">{obMovie.type === "movie" ? "Movie" : "TV Show"}</div>
                {obMovie.language !== "en" && (
                  <div className="card-lang-badge">
                    {OTHER_CINEMA_OPTIONS.find(o => o.lang === obMovie.language)?.flag || "🌏"}
                  </div>
                )}
              </div>
              <div className="card-info">
                <div className="card-title">{obMovie.title}</div>
                <div className="card-year">{obMovie.year}</div>
              </div>
            </div>
          </div>
          <div className="rating-area">
            <div className="rating-row">
              <div className="rating-q">Your rating</div>
              <div className={`rating-val ${sliderTouched ? "" : "unset"}`}>{sliderTouched ? sliderVal : "—"}</div>
            </div>
            <input className="slider" type="range" min="1" max="10" step="0.5" value={sliderVal}
              onChange={e => { setSliderVal(parseFloat(e.target.value)); setSliderTouched(true); }} />
            <div className="ob-actions">
              <button className="btn-confirm" onClick={confirmRating} disabled={!sliderTouched}>Confirm Rating</button>
              <button className="btn-skip" onClick={advanceOb}>Haven't seen it</button>
            </div>
          </div>
        </div>
      )}

      {/* LOADING RECS */}
      {screen === "loading-recs" && (
        <div className="loading">
          <div className="loading-ring" />
          <div className="loading-title">Using your tastometer to predict</div>
          <div className="loading-sub">Scoring titles for you</div>
        </div>
      )}

      {/* HOME */}
      {screen === "home" && (
        <div className="home">
          <div className="home-topbar">
            <TopbarBrandCluster onPress={goHome} community={siteStats?.community} ratings={siteStats?.ratings} />
            <div />
            <AccountAvatarMenu />
          </div>
          <div className={`home-header ${homeSegment !== HOME_SEGMENT_NOW_PLAYING ? "home-header--no-hero-tagline" : ""}`}>
            <div className="home-hero">
              <TopbarBrandCluster onPress={goHome} community={siteStats?.community} ratings={siteStats?.ratings} />
              {homeSegment === HOME_SEGMENT_NOW_PLAYING && (
                <div className="home-hero-copy">
                  <div className="home-subtitle">Movies and Shows - Picked for your TASTE!</div>
                </div>
              )}
            </div>
            <AccountAvatarMenu />
          </div>
          <div className="section-divider" style={{ margin: "0 24px 10px", borderTop: "1px solid #1a1a1a" }} />
          <div className="home-desktop-nav-row">
            <div className="home-topnav" role="tablist" aria-label="Now Playing, Your picks, Friends">
              {[
                [HOME_SEGMENT_NOW_PLAYING, "Now Playing"],
                [HOME_SEGMENT_YOUR_PICKS, "Your picks"],
                [HOME_SEGMENT_FRIENDS, "Friends"],
              ].map(([id, label]) => (
                <button
                  key={`desktop-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={homeSegment === id}
                  className={`home-segment ${homeSegment === id ? "active" : ""}`}
                  onClick={() => setHomeSegment(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="home-segments" role="tablist" aria-label="Now Playing, Your picks, Friends">
            {[
              [HOME_SEGMENT_NOW_PLAYING, "Now Playing"],
              [HOME_SEGMENT_YOUR_PICKS, "Your picks"],
              [HOME_SEGMENT_FRIENDS, "Friends"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={homeSegment === id}
                className={`home-segment ${homeSegment === id ? "active" : ""}`}
                onClick={() => setHomeSegment(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {homeSegment === HOME_SEGMENT_NOW_PLAYING && (
            <div className="section">
              {homePicksLoadFailed ? (
                <div className="no-recs">
                  <div className="no-recs-text">Couldn&apos;t load picks right now.<br />Check your connection and try again.</div>
                </div>
              ) : (
                <>
                  <div className="top-picks-block">
                    <div className="section-header">
                      <div className="section-title">In Theaters</div>
                      <div className="section-meta">Now playing</div>
                    </div>
                    {theaterRecs.length === 0 ? (
                      <div className="empty-box">
                        <div className="empty-text">
                          {showRegionKeys.length > 0
                            ? "Limited titles for this region in US theaters right now"
                            : "No theatrical releases"}
                        </div>
                      </div>
                    ) : (
                      <div className="strip">
                        {theaterRecs.map(rec => (
                          <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                            <div className="strip-poster">
                              {rec.movie.poster ? <img src={rec.movie.poster} alt={rec.movie.title} /> : <div className="strip-poster-fallback">🎬</div>}
                              <div className="strip-badge" style={{ color: userRatings[rec.movie.id] ? "#88cc88" : "#e8c96a" }}>
                                {userRatings[rec.movie.id] ? `★ ${formatScore(userRatings[rec.movie.id])}` : formatScore(rec.predicted)}
                              </div>
                            </div>
                            <div className="strip-title">{rec.movie.title}</div>
                            <div className="strip-genre">{formatStripMediaMeta(rec.movie, tvStripMetaByTmdbId)}</div>
                            <div className="strip-range">{formatScore(rec.low)}–{formatScore(rec.high)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="top-picks-block">
                    <div className="section-header">
                      <div className="section-title">What&apos;s hot</div>
                      <div className="section-meta">Trending today</div>
                    </div>
                    {!whatsHotReady ? (
                      <SkeletonStrip />
                    ) : whatsHotRecsResolved.length === 0 ? (
                      <div className="empty-box">
                        <div className="empty-text">No trending titles right now</div>
                      </div>
                    ) : (
                      <div className="strip">
                        {whatsHotRecsResolved.map((rec) => (
                          <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                            <div className="strip-poster">
                              {rec.movie.poster ? <img src={rec.movie.poster} alt={rec.movie.title} /> : <div className="strip-poster-fallback">🎬</div>}
                              {inTheaterIdsForWhatsHotPill.has(rec.movie.id) && qualifiesForTheatricalPillMovie(rec.movie) && (
                                <div className="strip-hot-theater-pill">In theaters</div>
                              )}
                              <div className="strip-badge" style={{ color: userRatings[rec.movie.id] ? "#88cc88" : "#e8c96a" }}>
                                {userRatings[rec.movie.id] ? `★ ${formatScore(userRatings[rec.movie.id])}` : formatScore(rec.predicted)}
                              </div>
                            </div>
                            <div className="strip-title">{rec.movie.title}</div>
                            <div className="strip-genre">{formatStripMediaMeta(rec.movie, tvStripMetaByTmdbId)}</div>
                            <div className="strip-range">{formatScore(rec.low)}–{formatScore(rec.high)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="top-picks-block">
                    <div className="section-header">
                      <div className="section-title">Streaming</div>
                      <div className="section-meta">Broad picks (not your app list)</div>
                    </div>
                    <div className="filter-row" style={{ paddingTop: 0, paddingBottom: 4 }}>
                      <button type="button" className={`filter-pill ${streamingTab === "tv" ? "active" : ""}`} onClick={() => setStreamingTab("tv")}>
                        Series
                      </button>
                      <button type="button" className={`filter-pill ${streamingTab === "movie" ? "active" : ""}`} onClick={() => setStreamingTab("movie")}>
                        Movies
                      </button>
                    </div>
                    {showStreamingMovieSkeleton ? (
                      <SkeletonStrip />
                    ) : streamingTab === "tv" && !streamingTvReady ? (
                      <SkeletonStrip />
                    ) : streamingRecs.length === 0 ? (
                      <div className="empty-box"><div className="empty-text">No streaming {streamingTab === "movie" ? "movies" : "series"} right now</div></div>
                    ) : (
                      <div className="strip">
                        {streamingRecs.map(rec => (
                          <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                            <div className="strip-poster">
                              {rec.movie.poster ? <img src={rec.movie.poster} alt={rec.movie.title} /> : <div className="strip-poster-fallback">🎬</div>}
                              <div className="strip-badge" style={{ color: userRatings[rec.movie.id] ? "#88cc88" : "#e8c96a" }}>
                                {userRatings[rec.movie.id] ? `★ ${formatScore(userRatings[rec.movie.id])}` : formatScore(rec.predicted)}
                              </div>
                            </div>
                            <div className="strip-title">{rec.movie.title}</div>
                            <div className="strip-genre">{formatStripMediaMeta(rec.movie, tvStripMetaByTmdbId)}</div>
                            <div className="strip-range">{formatScore(rec.low)}–{formatScore(rec.high)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {secondaryRegionKey && (
                    <div className="top-picks-block">
                      <div className="section-header">
                        <div className="section-title">{V130_SECONDARY_HOME_TITLE[secondaryRegionKey] ?? "Region"}</div>
                        <div className="section-meta">Theaters &amp; streaming</div>
                      </div>
                      <div className="filter-row" style={{ paddingTop: 0, paddingBottom: 4 }}>
                        <button
                          type="button"
                          className={`filter-pill ${secondaryBlockSegment === SECONDARY_BLOCK_THEATERS ? "active" : ""}`}
                          onClick={() => setSecondaryBlockSegment(SECONDARY_BLOCK_THEATERS)}
                        >
                          In Theaters
                        </button>
                        <button
                          type="button"
                          className={`filter-pill ${secondaryBlockSegment === SECONDARY_BLOCK_STREAMING ? "active" : ""}`}
                          onClick={() => setSecondaryBlockSegment(SECONDARY_BLOCK_STREAMING)}
                        >
                          Streaming
                        </button>
                      </div>
                      {secondaryBlockSegment === SECONDARY_BLOCK_STREAMING && (
                        <div className="filter-row" style={{ paddingTop: 0, paddingBottom: 4 }}>
                          <button
                            type="button"
                            className={`filter-pill ${secondaryBlockStreamingTab === "tv" ? "active" : ""}`}
                            onClick={() => setSecondaryBlockStreamingTab("tv")}
                          >
                            Series
                          </button>
                          <button
                            type="button"
                            className={`filter-pill ${secondaryBlockStreamingTab === "movie" ? "active" : ""}`}
                            onClick={() => setSecondaryBlockStreamingTab("movie")}
                          >
                            Movies
                          </button>
                        </div>
                      )}
                      {!secondaryStripReady ? (
                        <SkeletonStrip />
                      ) : secondaryActiveRawRows.length === 0 ? (
                        <div className="empty-box">
                          <div className="empty-text">
                            {secondaryBlockSegment === SECONDARY_BLOCK_THEATERS
                              ? "No theatrical releases in this market right now"
                              : secondaryBlockStreamingTab === "movie"
                                ? "No streaming movies in this market right now"
                                : "No streaming series in this market right now"}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="strip">
                            {secondaryStripRecsVisible.map((rec) => (
                              <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                                <div className="strip-poster">
                                  {rec.movie.poster ? <img src={rec.movie.poster} alt={rec.movie.title} /> : <div className="strip-poster-fallback">🎬</div>}
                                  <div className="strip-badge" style={{ color: userRatings[rec.movie.id] ? "#88cc88" : "#e8c96a" }}>
                                    {userRatings[rec.movie.id] ? `★ ${formatScore(userRatings[rec.movie.id])}` : formatScore(rec.predicted)}
                                  </div>
                                </div>
                                <div className="strip-title">{rec.movie.title}</div>
                                <div className="strip-genre">{formatStripMediaMeta(rec.movie, tvStripMetaByTmdbId)}</div>
                                <div className="strip-range">{formatScore(rec.low)}–{formatScore(rec.high)}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
              {Object.keys(userRatings).length === 0 && theaterRecs.length + streamingMovieRecsResolved.length + streamingTvRecsResolved.length + whatsHotRecsResolved.length + secondaryStripRecsAll.length > 0 && (
                <div className="no-recs" style={{ marginTop: 16, border: "none", padding: "12px 0 0" }}>
                  <div className="no-recs-text" style={{ fontSize: 12 }}>Rate a few titles for tighter predictions</div>
                  <button className="btn-confirm" style={{ marginTop: 12, width: "100%" }} onClick={startDefaultRateMore}>Rate More Titles</button>
                </div>
              )}
            </div>
          )}

          {homeSegment === HOME_SEGMENT_YOUR_PICKS && (
            <>
              {(hasYourPicksStripSource || yourPicksLoading) && (
                <div className="section">
                  <div className="section-header">
                    <div className="section-title">🔥 For you</div>
                    {hasYourPicksStripSource && (
                      <div
                        className="section-meta"
                        style={{ cursor: "pointer" }}
                        onClick={() => setTopPickOffset((p) => p + 3)}
                      >
                        {"↻ Refresh"}
                      </div>
                    )}
                  </div>
                  {moreForYouStrip.length > 0 ? (
                    <div className="strip">
                      {moreForYouStrip.map((row) => (
                        <div
                          className="strip-card"
                          key={row.rec.movie.id}
                          role="button"
                          tabIndex={0}
                          aria-label={row.kind === "pick" ? `${row.rec.movie.title}, personal pick` : `${row.rec.movie.title}, popular recommendation`}
                          onClick={() => openDetail(row.rec.movie, row.rec)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(row.rec.movie, row.rec); } }}
                        >
                          <div className="strip-poster">
                            {row.rec.movie.poster ? <img src={row.rec.movie.poster} alt="" /> : <div className="strip-poster-fallback">🎬</div>}
                            <div className="strip-badge" style={{ color: userRatings[row.rec.movie.id] ? "#88cc88" : "#e8c96a" }}>
                              {userRatings[row.rec.movie.id] ? `★ ${formatScore(userRatings[row.rec.movie.id])}` : formatScore(row.rec.predicted)}
                            </div>
                          </div>
                          <div className="strip-title">{row.rec.movie.title}</div>
                          <div className="strip-genre">{formatStripMediaMeta(row.rec.movie, tvStripMetaByTmdbId)}</div>
                          <div className="strip-range">{formatScore(row.rec.low)}–{formatScore(row.rec.high)}</div>
                          <div className="strip-range" style={{ color: "#888" }}>{stripConfShort(row.rec.confidence)}</div>
                          <div className={`strip-row-kind ${row.kind === "pick" ? "strip-row-kind--pick" : "strip-row-kind--pop"}`}>
                            {row.kind === "pick" ? "✨ Pick" : "📈 Popular"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <SkeletonStrip showKind />
                  )}
                </div>
              )}
              {(hasYourPicksStripSource || yourPicksLoading) && (
                <div className="section">
                  <div className="section-header">
                    <div className="section-title">✨ Worth a Look</div>
                    <div className="section-meta">
                      {selectedStreamingProviderIds.length > 0
                        ? "Strong predictions — not on your selected services"
                        : "Strong predictions — beyond the first strip"}
                    </div>
                  </div>
                  {worthLookStrip.length > 0 ? (
                    <div className="strip">
                      {worthLookStrip.map((row) => (
                        <div
                          className="strip-card"
                          key={row.rec.movie.id}
                          role="button"
                          tabIndex={0}
                          aria-label={row.kind === "pick" ? `${row.rec.movie.title}, personal pick` : `${row.rec.movie.title}, popular recommendation`}
                          onClick={() => openDetail(row.rec.movie, row.rec)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(row.rec.movie, row.rec); } }}
                        >
                          <div className="strip-poster">
                            {row.rec.movie.poster ? <img src={row.rec.movie.poster} alt="" /> : <div className="strip-poster-fallback">🎬</div>}
                            <div className="strip-badge" style={{ color: userRatings[row.rec.movie.id] ? "#88cc88" : "#e8c96a" }}>
                              {userRatings[row.rec.movie.id] ? `★ ${formatScore(userRatings[row.rec.movie.id])}` : formatScore(row.rec.predicted)}
                            </div>
                          </div>
                          <div className="strip-title">{row.rec.movie.title}</div>
                          <div className="strip-genre">{formatStripMediaMeta(row.rec.movie, tvStripMetaByTmdbId)}</div>
                          <div className="strip-range">{formatScore(row.rec.low)}–{formatScore(row.rec.high)}</div>
                          <div className="strip-range" style={{ color: "#888" }}>{stripConfShort(row.rec.confidence)}</div>
                          <div className={`strip-row-kind ${row.kind === "pick" ? "strip-row-kind--pick" : "strip-row-kind--pop"}`}>
                            {row.kind === "pick" ? "✨ Pick" : "📈 Popular"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <SkeletonStrip showKind />
                  )}
                </div>
              )}
              {!hasYourPicksStripSource && !yourPicksLoading && (
                <div className="section">
                  <div className="no-recs">
                    <div className="no-recs-text">Predictions will show here after your first catalogue load and ratings.<br />Browse <strong>Now Playing</strong> to get started.</div>
                  </div>
                </div>
              )}
            </>
          )}

          {homeSegment === HOME_SEGMENT_FRIENDS && (
            <div className="friends-placeholder">
              <div className="friends-placeholder-title">Friends</div>
              <p className="friends-placeholder-text">Groups, shared lists, and watching with people you know will show up here.</p>
              <p className="friends-placeholder-text" style={{ marginTop: 12, color: "#555" }}>Coming soon.</p>
            </div>
          )}

          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {/* RATE MORE */}
      {screen === "rate-more" && rateMoreMovie && (
        <div className="onboarding">
          <div className="ob-header">
            <TopbarBrandCluster onPress={goHome} community={siteStats?.community} ratings={siteStats?.ratings} />
            <div className="ob-step">Rating {obStep + 1}</div>
            <div className="ob-title">Rate Similar titles</div>
            <div className="ob-subtitle">{rateMoreContextMovieId ? "Improve this prediction" : "Improve your recommendations"}</div>
          </div>
          <div className="card-area">
            <div className="movie-card" key={obStep}>
              <div className="card-poster">
                {rateMoreMovie.poster ? <img src={rateMoreMovie.poster} alt={rateMoreMovie.title} /> : <div className="card-poster-fallback">🎬</div>}
                <div className="card-type-badge">{rateMoreMovie.type === "movie" ? "Movie" : "TV Show"}</div>
              </div>
              <div className="card-info">
                <div className="card-title">{rateMoreMovie.title}</div>
                <div className="card-year">{rateMoreMovie.year}</div>
              </div>
            </div>
          </div>
          <div className="rating-area">
            <div className="rating-row">
              <div className="rating-q">Your rating</div>
              <div className={`rating-val ${sliderTouched ? "" : "unset"}`}>{sliderTouched ? sliderVal : "—"}</div>
            </div>
            <input className="slider" type="range" min="1" max="10" step="0.5" value={sliderVal}
              onChange={e => { setSliderVal(parseFloat(e.target.value)); setSliderTouched(true); }} />
            <div className="ob-actions">
              <button className="btn-confirm" onClick={() => { confirmRating(); setSliderVal(7); setSliderTouched(false); }} disabled={!sliderTouched}>Confirm Rating</button>
              <button className="btn-skip" onClick={() => advanceOb()}>Skip</button>
            </div>
            <button className="btn-ghost" style={{ width: "100%", marginTop: 12 }} onClick={() => { void markOnboardingComplete(); exitRateMoreFlow(); }}>Done for now</button>
          </div>
        </div>
      )}

      {/* DISCOVER */}
      {screen === "discover" && (
        <div className="discover">
          <div className="page-topbar">
            <TopbarBrandCluster onPress={goHome} community={siteStats?.community} ratings={siteStats?.ratings} />
            <div />
            <AccountAvatarMenu />
          </div>
          <div className="discover-header">
            <div className="discover-title">Discover</div>
            <form
              className="search-box"
              onSubmit={e => {
                e.preventDefault();
                const q = searchQuery.trim();
                setAppliedSearchQuery(q);
                if (q.length < 2) { setSearchResults([]); setSearchError(""); }
              }}
            >
              <button type="submit" className="search-submit-btn" aria-label="Search">
                <span className="search-icon">🔍</span>
              </button>
              <input
                className="search-input"
                type="text"
                placeholder="Search any movie or show…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </form>
          </div>
          <div className="filter-row">
            {FILTERS.map(f => (
              <button key={f} className={`filter-pill ${activeFilter === f ? "active" : ""}`} onClick={() => setActiveFilter(f)}>{f}</button>
            ))}
          </div>
          {searching && <div className="search-status">Searching…</div>}
          {!searching && appliedSearchQuery.length >= 2 && !searchError && (
            <div className="search-status">{discoverItems.length} result{discoverItems.length !== 1 ? "s" : ""} for "{appliedSearchQuery}"</div>
          )}
          {discoverItems.length === 0 && !searching ? (
            <div className="disc-empty">
              <div className="disc-empty-text">
                {searchError
                  ? searchError
                  : appliedSearchQuery.length >= 2
                    ? `No results for "${appliedSearchQuery}"`
                    : "Type a title and tap search"}
              </div>
            </div>
          ) : (
            <div className="disc-grid">
              {discoverItems.map(m => {
                const rec = recMap[m.id];
                const myRating = userRatings[m.id];
                return (
                  <div className="disc-card" key={m.id} onClick={() => openDetail(m, rec)}>
                    <div className="disc-poster">
                      {m.poster ? <img src={m.poster} alt={m.title} /> : <div className="disc-poster-fallback">🎬</div>}
                      <div className="disc-type">{m.type === "movie" ? "Movie" : "TV"}</div>
                      <div className="disc-badge">
                        {myRating ? <span className="disc-rated-badge">★ {myRating}</span>
                          : rec ? <span className="disc-pred-badge">{formatScore(rec.predicted)}</span>
                            : <span className="disc-unseen-badge">Unrated</span>}
                      </div>
                    </div>
                    <div className="disc-title">{m.title}</div>
                    <div className="disc-meta">
                      {m.type === "movie" ? `Movie · ${formatMovieReleaseLine(m)}` : `TV · ${m.year}`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {/* MOOD PICKER */}
      {screen === "mood-picker" && currentMoodCard && (
        <div className="mood">
          <div className="page-topbar">
            <TopbarBrandCluster onPress={goHome} community={siteStats?.community} ratings={siteStats?.ratings} />
            <div />
            <AccountAvatarMenu />
          </div>
          <div className="mood-header">
            <button className="mood-back" onClick={() => { setNavTab("home"); setScreen("home"); }}>← Back</button>
            <div className="mood-step">Card {moodStep + 1} of {totalCards}</div>
            <div className="mood-title">{currentMoodCard.title}</div>
            <div className="mood-subtitle">{currentMoodCard.subtitle}</div>
          </div>
          <div className="mood-dots">
            {cardOrder.map((_, i) => <div key={i} className={`mood-dot ${i < moodStep ? "done" : i === moodStep ? "active" : ""}`} />)}
          </div>
          <div className="mood-options">
            {currentMoodCard.options.map(opt => (
              <button key={opt.id}
                className={`mood-option ${(moodSelections[moodCardKey] || []).includes(opt.id) ? "selected" : ""}`}
                onClick={() => toggleMoodOption(moodCardKey, opt.id)}>
                {opt.label}
              </button>
            ))}
          </div>
          <div className="mood-actions">
            <button className="mood-next" onClick={advanceMood}>
              {moodStep < totalCards - 1 ? "Next →" : "Find my matches 🎯"}
            </button>
            <button className="mood-skip" onClick={() => { setMoodSelections(prev => ({ ...prev, [moodCardKey]: [] })); advanceMood(); }}>
              Skip this card
            </button>
          </div>
          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {/* MOOD RESULTS */}
      {screen === "mood-results" && (
        <div className="mood-results">
          <div className="page-topbar">
            <TopbarBrandCluster onPress={goHome} community={siteStats?.community} ratings={siteStats?.ratings} />
            <div />
            <AccountAvatarMenu />
          </div>
          <div className="mood-results-header">
            <button className="mood-results-back" onClick={resetMood}>←</button>
            <div className="mood-results-title">Tonight's picks</div>
          </div>
          {moodResults.length === 0 ? (
            <div className="mood-no-results">
              <div className="mood-no-results-text">No matches found.<br /><br />Try skipping some filters or broadening your choices.</div>
              <button className="mood-next" style={{ margin: "20px 24px 0", width: "calc(100% - 48px)" }} onClick={resetMood}>Try again</button>
            </div>
          ) : (
            <div className="mood-results-grid">
              {moodResults.map(rec => (
                <div className="mood-result-card" key={rec.movie.id}>
                  <div className="mood-result-poster">
                    {rec.movie.backdrop || rec.movie.poster
                      ? <img src={rec.movie.backdrop || rec.movie.poster} alt={rec.movie.title} />
                      : <div className="mood-result-poster-fallback">🎬</div>}
                    <div className="mood-result-overlay" />
                    <div className="mood-result-type">{rec.movie.type === "movie" ? "Movie" : "TV"}</div>
                    <div className="mood-result-badge">{formatScore(rec.predicted)}</div>
                  </div>
                  <div className="mood-result-info">
                    <div className="mood-result-title">{rec.movie.title}</div>
                    <div className="mood-result-meta">
                      {rec.movie.year} · Predicted {formatScore(rec.predicted)} ({formatScore(rec.low)}–{formatScore(rec.high)})
                      {Number.isFinite(Number(rec.movie.voteCount)) ? ` · ${formatPublicStat(Number(rec.movie.voteCount))} votes` : ""}
                    </div>
                    <div className="mood-result-synopsis">{(rec.movie.synopsis || "").slice(0, 100)}…</div>
                    <div className="mood-result-actions">
                      <button
                        className={`btn-select-watch ${(inWatchlist(rec.movie.id) || selectedToWatch[rec.movie.id]) ? "selected" : ""}`}
                        onClick={() => selectToWatch(rec.movie.id)}
                      >
                        {(inWatchlist(rec.movie.id) || selectedToWatch[rec.movie.id]) ? "✓ In Watchlist" : "🎬 Select to Watch"}
                      </button>
                      <button className="btn-detail" onClick={() => openDetail(rec.movie, rec)}>Details</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {/* RATED */}
      {screen === "rated" && (
        <div className="discover">
          <div className="page-topbar">
            <TopbarBrandCluster onPress={goHome} community={siteStats?.community} ratings={siteStats?.ratings} />
            <div />
            <AccountAvatarMenu />
          </div>
          <div className="discover-header">
            <button type="button" className="mood-back" style={{ marginBottom: 8 }} onClick={() => { setRatedSearchQuery(""); setScreen("profile"); }}>← Profile</button>
            <div className="discover-title">Your Ratings</div>
          </div>
          {ratedMovies.length === 0 ? (
            <div className="disc-empty"><div className="disc-empty-text">You haven&apos;t rated anything yet</div></div>
          ) : (
            <>
              <div className="rated-search-wrap">
                <div className="search-box">
                  <span className="search-icon">🔍</span>
                  <input
                    className="search-input"
                    type="search"
                    placeholder="Search your rated titles…"
                    value={ratedSearchQuery}
                    onChange={e => setRatedSearchQuery(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                {ratedSearchQuery.trim() && (
                  <div className="search-status" style={{ paddingTop: 6 }}>
                    {filteredRatedMovies.length} result{filteredRatedMovies.length !== 1 ? "s" : ""}
                  </div>
                )}
              </div>
              {filteredRatedMovies.length === 0 ? (
                <div className="disc-empty"><div className="disc-empty-text">No titles match &quot;{ratedSearchQuery.trim()}&quot;</div></div>
              ) : (
                <div className="profile-section" style={{ paddingTop: 4 }}>
                  {filteredRatedMovies.map(({ movie, score }) => (
                    <div className="rated-list-item" key={movie.id} onClick={() => openDetail(movie, recMap[movie.id])}>
                      <div className="rated-thumb">
                        {movie.poster ? <img src={movie.poster} alt={movie.title} /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 20 }}>🎬</div>}
                      </div>
                      <div className="rated-info">
                        <div className="rated-info-title">{movie.title}</div>
                        <div className="rated-info-meta">{movie.type === "movie" ? "Movie" : "TV"} · {movie.year}</div>
                      </div>
                      <div className="rated-row-actions">
                        <div className="rated-score-pill">{score}</div>
                        <button
                          type="button"
                          className="rated-rerate-btn"
                          onClick={e => {
                            e.stopPropagation();
                            openDetail(movie, recMap[movie.id], { startEditing: true });
                          }}>
                          Rerate
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {/* PROFILE */}
      {screen === "profile" && (
        <div className="profile">
          <div className="page-topbar">
            <TopbarBrandCluster onPress={goHome} community={siteStats?.community} ratings={siteStats?.ratings} />
            <div />
            <AccountAvatarMenu />
          </div>
          <div className="profile-top">
            <div className="profile-avatar">{userInitial}</div>
            <div className="profile-top-text">
              <div className="profile-name">{userName}</div>
              <div className="profile-stats-inline">
                <button
                  type="button"
                  className="profile-stat-chip"
                  onClick={() => { setRatedSearchQuery(""); setScreen("rated"); }}
                >
                  Rated {Object.keys(userRatings).length}
                </button>
                <span className="profile-stat-chip">
                  Avg {ratedMovies.length > 0 ? (ratedMovies.reduce((s, r) => s + r.score, 0) / ratedMovies.length).toFixed(1) : "—"}
                </span>
                <span className="profile-stat-chip">Matches {recommendations.length}</span>
              </div>
            </div>
          </div>
          <div className="section profile-watchlist-section">
            <div className="section-header">
              <div className="section-title">📌 Watchlist</div>
              <div className="section-meta">{watchlist.length} {watchlist.length === 1 ? "title" : "titles"}</div>
            </div>
            {watchlist.length === 0 ? (
              <div className="empty-box"><div className="empty-text">Save titles from detail to watch later</div></div>
            ) : (
              <div className="strip">
                {watchlist.map(m => (
                  <div className="wl-card" key={m.id} onClick={() => openDetail(m, recMap[m.id])}>
                    <div className="wl-poster">
                      {m.poster ? <img src={m.poster} alt={m.title} /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 36 }}>🎬</div>}
                    </div>
                    <div className="strip-title">{m.title}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="profile-settings">
            <div className="profile-settings-title">Settings</div>
            {profileSettingsError && <div className="auth-error" style={{ marginBottom: 12 }}>{profileSettingsError}</div>}
            <div className="profile-settings-card">
              <div className="profile-settings-label">Where you watch</div>
              <p className="settings-providers-hint">Select the services you subscribe to. We’ll use this to tailor availability and picks.</p>
              <div className="settings-provider-grid">
                {STREAMING_SERVICES.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={`settings-provider-pill ${selectedStreamingProviderIds.includes(s.id) ? "selected" : ""}`}
                    onClick={() => toggleStreamingProvider(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="profile-settings-label" style={{ marginTop: 20 }}>Genres to show</div>
              <p className="settings-providers-hint">Recommendations in Home use TMDB genres. A title appears if it has at least one of the genres you select. Leave none selected to show all genres — including animation.</p>
              <div className="settings-genre-actions">
                <button type="button" className="settings-genre-action-btn" onClick={() => persistShowGenreIds(PROFILE_GENRE_OPTIONS.map(g => g.id))}>Select all</button>
                <button type="button" className="settings-genre-action-btn" onClick={() => persistShowGenreIds([])}>Clear (all genres)</button>
              </div>
              <div className="settings-provider-grid">
                {PROFILE_GENRE_OPTIONS.map(g => (
                  <button
                    key={g.id}
                    type="button"
                    className={`settings-provider-pill ${showGenreIds.includes(g.id) ? "selected" : ""}`}
                    onClick={() => toggleShowGenre(g.id)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <div className="profile-settings-label" style={{ marginTop: 20 }}>Regions to show</div>
              <p className="settings-providers-hint">Recommendations in Home can be narrowed by original language buckets like Hollywood, Indian, and Asian cinema. Leave none selected to show all regions.</p>
              <div className="settings-genre-actions">
                <button type="button" className="settings-genre-action-btn" onClick={() => persistShowRegionKeys(PROFILE_REGION_OPTIONS.map(r => r.id))}>Select all</button>
                <button type="button" className="settings-genre-action-btn" onClick={() => persistShowRegionKeys([])}>Clear (all regions)</button>
              </div>
              <div className="settings-provider-grid">
                {PROFILE_REGION_OPTIONS.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    className={`settings-provider-pill ${showRegionKeys.includes(r.id) ? "selected" : ""}`}
                    onClick={() => toggleShowRegion(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              {/* V1.3.0: Optional second home-market strip (Now Playing); primary flow stays US / Hollywood. */}
              <div className="profile-settings-label" style={{ marginTop: 20 }}>Home — second region (optional)</div>
              <p className="settings-providers-hint">
                Adds a Region block on Now Playing with <strong>In Theaters</strong> / <strong>Streaming</strong> tabs; under Streaming, <strong>Series</strong> and <strong>Movies</strong>. Primary US strips stay above. “None” hides the block.
              </p>
              <div className="settings-provider-grid">
                <button
                  type="button"
                  className={`settings-provider-pill ${secondaryRegionKey == null ? "selected" : ""}`}
                  onClick={() => persistSecondaryRegionKey(null)}
                >
                  None
                </button>
                {PROFILE_REGION_OPTIONS.filter((r) => r.id !== "hollywood").map((r) => (
                  <button
                    key={`v13-sec-${r.id}`}
                    type="button"
                    className={`settings-provider-pill ${secondaryRegionKey === r.id ? "selected" : ""}`}
                    onClick={() => persistSecondaryRegionKey(r.id)}
                  >
                    {V130_SECONDARY_HOME_TITLE[r.id] ?? r.label}
                  </button>
                ))}
              </div>
              <div className="profile-settings-label" style={{ marginTop: 20 }}>Email</div>
              <div className="profile-settings-email">{user?.email || "—"}</div>
            </div>
            <div className="profile-app-version">Cinemastro v{APP_VERSION}</div>
          </div>
          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {screen === "privacy" && (
        <Suspense fallback={<LegalLazyFallback />}>
          <LegalPagePrivacy onBack={closeLegalPage} />
        </Suspense>
      )}
      {screen === "terms" && (
        <Suspense fallback={<LegalLazyFallback />}>
          <LegalPageTerms onBack={closeLegalPage} />
        </Suspense>
      )}
      {screen === "about" && (
        <Suspense fallback={<LegalLazyFallback />}>
          <LegalPageAbout onBack={closeLegalPage} />
        </Suspense>
      )}

      {/* DETAIL */}
        {screen === "detail" && selectedMovie && (() => {
        const { movie, prediction } = selectedMovie;
        const myRating = userRatings[movie.id];
        return (
          <div className="detail">
            <div className="page-topbar">
              <TopbarBrandCluster onPress={goHome} community={siteStats?.community} ratings={siteStats?.ratings} />
              <div />
              <AccountAvatarMenu />
            </div>
            <div className="detail-poster-wrap">
              <div className="d-poster">
                {movie.backdrop || movie.poster ? <img src={movie.backdrop || movie.poster} alt={movie.title} /> : <div className="d-poster-fallback">🎬</div>}
                <div className="d-overlay" />
              </div>
            </div>
            <div className="detail-content-wrap">
              <div className="d-body">
                <div className="d-type-genre">
                  <span className="d-type-pill">{movie.type === "movie" ? "Movie" : "TV Show"}</span>
                  {movie.year && <span className="d-genre-text">{movie.year}</span>}
                </div>
                <div className="d-title">{movie.title}</div>
                {prediction && (
                  <div className={`d-pred-box ${predBoxClass(prediction.confidence)}`}>
                    <div>
                      <div className="d-pred-label">Predicted rating for you</div>
                      <div className="d-pred-sub">Based on your tastometer</div>
                      <span className={confClass(prediction.confidence)}>{confLabel(prediction.confidence)}</span>
                      {(prediction.confidence === "low" || prediction.confidence === "medium") && (
                        <>
                          <div className="d-pred-improve">Rate more titles to improve</div>
                          <button
                            type="button"
                            className="d-rate-now-btn"
                            disabled={rateSimilarLoading}
                            onClick={() => { void handleRateNowForPrediction(movie); }}
                          >
                            {rateSimilarLoading ? "Loading..." : "Rate now"}
                          </button>
                          {rateSimilarError && <div className="d-pred-improve-err">{rateSimilarError}</div>}
                        </>
                      )}
                    </div>
                    <div>
                      <div className={`d-pred-val ${predValClass(prediction.confidence)}`}>{formatScore(prediction.predicted)}</div>
                      {shouldShowPredRange(prediction) && (
                        <div className={`d-pred-range ${predRangeClass(prediction.confidence)}`}>
                          {formatScore(prediction.low)}–{formatScore(prediction.high)}
                        </div>
                      )}
                      {movie.tmdbRating && <div className="d-tmdb">TMDB avg: {movie.tmdbRating}</div>}
                    </div>
                  </div>
                )}
                {!prediction && (
                  <div>
                    {movie.tmdbRating && (
                      <div className="d-pred-box" style={{ marginBottom: 10 }}>
                        <div>
                          <div className="d-pred-label">TMDB Average Rating</div>
                          <div className="d-pred-sub">From the broader community</div>
                        </div>
                        <div className="d-pred-val" style={{ fontSize: 32 }}>{movie.tmdbRating}</div>
                      </div>
                    )}
                    <div className="d-pred-box">
                      <div>
                        <div className="d-pred-label">Predicted Rating for You</div>
                        <div className="d-pred-sub">Rate more titles to unlock</div>
                      </div>
                      <div className="d-pred-val" style={{ fontSize: 32, color: "#555" }}>TBD</div>
                    </div>
                  </div>
                )}
                <div className="d-synopsis">{movie.synopsis}</div>
                <WhereToWatch tmdbId={movie.tmdbId} type={movie.type} />
                <div className="detail-rate-section">
                  {myRating && !detailEditRating ? (
                    <div className="rated-box" style={{ marginTop: 20 }}>
                      <div className="rated-score">{myRating}</div>
                      <div className="rated-label">Your rating saved ✓</div>
                      {prediction && <div className="rated-pred">Predicted was {formatScore(prediction.predicted)} ({formatScore(prediction.low)}–{formatScore(prediction.high)})</div>}
                      <button type="button" className="btn-full btn-full-dark" style={{ marginTop: 16, width: "100%" }}
                        onClick={() => { setDetailEditRating(true); setDetailRating(myRating); setDetailTouched(true); }}>
                        Change rating
                      </button>
                    </div>
                  ) : myRating && detailEditRating ? (
                    <div style={{ marginTop: 20 }}>
                      <div className="d-rate-label">Update your rating</div>
                      <div className="d-rate-row">
                        <input className="slider" type="range" min="1" max="10" step="0.5"
                          value={detailRating} style={{ flex: 1 }}
                          onChange={e => { setDetailRating(parseFloat(e.target.value)); setDetailTouched(true); }} />
                        <div className="d-rate-val" style={{ color: "#e8c96a" }}>{detailRating}</div>
                      </div>
                      <div className="d-actions" style={{ marginTop: 14 }}>
                        <button className="btn-full btn-full-gold" disabled={!detailTouched}
                          onClick={() => { addRating(movie.id, detailRating); setDetailEditRating(false); }}>
                          Save new rating
                        </button>
                        <button type="button" className="btn-full btn-full-dark"
                          onClick={() => { setDetailEditRating(false); setDetailRating(myRating); }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : !myRating ? (
                    <div style={{ marginTop: 20 }}>
                      <div className="d-rate-label">Your rating</div>
                      <div className="d-rate-row">
                        <input className="slider" type="range" min="1" max="10" step="0.5"
                          value={detailRating} style={{ flex: 1 }}
                          onChange={e => { setDetailRating(parseFloat(e.target.value)); setDetailTouched(true); }} />
                        <div className="d-rate-val" style={{ color: detailTouched ? "#e8c96a" : "#444" }}>
                          {detailTouched ? detailRating : "—"}
                        </div>
                      </div>
                      <div className="d-actions">
                        <button className="btn-full btn-full-gold" disabled={!detailTouched}
                          onClick={() => { addRating(movie.id, detailRating); setTimeout(() => goBack(), 800); }}>
                          Submit Rating
                        </button>
                        <button className={`btn-full btn-full-dark ${inWatchlist(movie.id) ? "saved-style" : ""}`}
                          onClick={() => toggleWatchlist(movie)}>
                          {inWatchlist(movie.id) ? "✓ Saved" : "+ Watchlist"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        );
        })()}
      </div>
    </div>
  );
}