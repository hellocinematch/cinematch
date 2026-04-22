import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, lazy, Suspense } from "react";
import packageJson from "../package.json";
import { AppFooter } from "./appFooter.jsx";
import { supabase } from "./supabase";
import {
  CIRCLE_CAP,
  CIRCLE_MEMBER_CAP,
  CIRCLE_NAME_MAX,
  validateCircleName,
  circleAvatarInitials,
  CIRCLE_DESCRIPTION_MAX,
  VIBES,
  vibeMeta,
  fetchMyCircles,
  fetchCircleDetail,
  createCircle,
  leaveCircle,
  currentUserRole,
  fetchPendingInvites,
  sendCircleInvite,
  acceptCircleInvite,
  declineCircleInvite,
  fetchRatingCircleShareIds,
  syncRatingCircleShares,
  fetchCircleRatedTitles,
  CIRCLE_STRIP_INITIAL,
  CIRCLE_STRIP_PAGE,
  CIRCLE_STRIP_MAX,
  CIRCLE_GRID_PAGE,
  CIRCLE_TOP_MAX,
} from "./circles";

const LegalPagePrivacy = lazy(() => import("./legal.jsx").then((m) => ({ default: m.LegalPagePrivacy })));
const LegalPageTerms = lazy(() => import("./legal.jsx").then((m) => ({ default: m.LegalPageTerms })));
const LegalPageAbout = lazy(() => import("./legal.jsx").then((m) => ({ default: m.LegalPageAbout })));

// Shown on Profile as "Cinemastro v…". Version from package.json / CHANGELOG.md (v3.5.0: precomputed neighbors + faster match predict; v3.4.0: detail card copy/chips refresh; v3.3.0: detail hero + 2 score cards; v3.2.1: predict skeleton; v3.2.0: Rate now overlap+TMDB; v3.1.2: Discover clear; v3.1.0: rating_count + meter).
const APP_VERSION = packageJson.version;

const TMDB_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiOThhYjJlMThiODdjZmQyODFhY2JlYWZmNDhkMjE0ZSIsIm5iZiI6MTc3NDY0MTcxMS4yNDYsInN1YiI6IjY5YzZlMjJmYWRkOGNkNzhkMTUzNzgyOSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.jJhQu5G7iVJyW4MqDttCqiGestEHZjsrUKe73baRO7A";
const TMDB_BASE = "https://api.themoviedb.org/3";
/** Direct TMDB CDN URLs work on Vercel; `/tmdb-images` only works via Vite dev proxy. */
const TMDB_IMG_HOST = "https://image.tmdb.org";
/** Full-size poster in data / DB / detail — strips and lists rewrite at render via `posterSrcThumb`. */
const TMDB_IMG = `${TMDB_IMG_HOST}/t/p/w500`;
const TMDB_IMG_BACKDROP = `${TMDB_IMG_HOST}/t/p/w780`;
/** TMDB `w*` token for small posters (strips, list thumbs, grids) — ~2× typical strip width on phone. */
const TMDB_POSTER_THUMB = "w342";
/** Detail float, large cards, hero poster fallback — matches `TMDB_IMG`. */
const TMDB_POSTER_DETAIL = "w500";

const TMDB_IMAGE_PROFILE_RE = /^(https:\/\/image\.tmdb\.org\/t\/p\/)(w\d+|original)(\/.*)$/i;

/**
 * Rewrite TMDB CDN profile segment (`w500` → `w342`, etc.). Non-TMDB absolute URLs unchanged.
 * Bare `poster_path` values (e.g. `/abc.jpg`) become `https://image.tmdb.org/t/p/{sizeToken}/abc.jpg`.
 */
function tmdbImageProfileUrl(urlOrPath, sizeToken) {
  if (urlOrPath == null || urlOrPath === "") return null;
  const s = String(urlOrPath).trim();
  if (!s) return null;
  if (TMDB_IMAGE_PROFILE_RE.test(s)) {
    return s.replace(TMDB_IMAGE_PROFILE_RE, (_, prefix, _old, path) => `${prefix}${sizeToken}${path}`);
  }
  if (s.startsWith("/tmdb-images")) {
    const tail = s.slice("/tmdb-images".length);
    const m = tail.match(/^\/t\/p\/(w\d+|original)(\/.*)$/i);
    if (m) return `${TMDB_IMG_HOST}/t/p/${sizeToken}${m[2]}`;
    return `${TMDB_IMG_HOST}${tail}`;
  }
  if (/^https?:\/\//i.test(s)) return s;
  const path = s.startsWith("/") ? s : `/${s}`;
  return `${TMDB_IMG_HOST}/t/p/${sizeToken}${path}`;
}

function posterSrcThumb(urlOrPath) {
  return tmdbImageProfileUrl(urlOrPath, TMDB_POSTER_THUMB);
}

function posterSrcDetail(urlOrPath) {
  return tmdbImageProfileUrl(urlOrPath, TMDB_POSTER_DETAIL);
}

/** Mood cards: full-width visual — keep backdrop; poster-only uses detail profile. */
function moodCardBackdropOrPosterSrc(rec) {
  const b = rec?.movie?.backdrop;
  if (b) return b;
  return posterSrcDetail(rec?.movie?.poster);
}
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

function formatRuntimeMinutes(total) {
  const m = Number(total);
  if (!Number.isFinite(m) || m < 1) return null;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 1) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}

/** TMDB `YYYY-MM-DD` → `MM/DD/YYYY (US)` for detail facts bar. */
function formatUsReleaseDisplay(isoDate) {
  if (!isoDate || typeof isoDate !== "string") return null;
  const d = isoDate.slice(0, 10);
  const parts = d.split("-").map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, mo, day] = parts;
  return `${String(mo).padStart(2, "0")}/${String(day).padStart(2, "0")}/${y} (US)`;
}

function usMovieCertificationFromReleaseDatesPayload(releasePayload) {
  if (!releasePayload || !Array.isArray(releasePayload.results)) return null;
  const us = releasePayload.results.find((r) => r?.iso_3166_1 === "US");
  const dates = us?.release_dates;
  if (!Array.isArray(dates)) return null;
  const withCert = dates.filter((x) => typeof x?.certification === "string" && x.certification.trim());
  if (withCert.length === 0) return null;
  const theatrical = withCert.find((x) => Number(x.type) === 3);
  const pick = theatrical || withCert[0];
  return pick.certification.trim() || null;
}

function genresLineFromTmdbDetail(raw) {
  const g = raw?.genres;
  if (!Array.isArray(g) || g.length === 0) return null;
  const names = g.map((x) => x?.name).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Single `/movie/{id}` or `/tv/{id}` response (optionally with append_to_release_*).
 * Returns strings for the shaded facts bar + tagline.
 */
function detailMetaFromTmdbDetail(raw, mediaType) {
  const empty = { tagline: null, genresLine: null, certification: null, runtimeLabel: null, releaseLabel: null };
  if (!raw || isTmdbApiErrorPayload(raw)) return empty;
  const tag = typeof raw.tagline === "string" ? raw.tagline.trim() : "";
  const genresLine = genresLineFromTmdbDetail(raw);
  if (mediaType === "tv") {
    let certification = null;
    const cr = raw.content_ratings?.results;
    if (Array.isArray(cr)) {
      const us = cr.find((r) => r?.iso_3166_1 === "US");
      if (us?.rating) certification = String(us.rating).trim() || null;
    }
    let runtimeLabel = null;
    const ert = raw.episode_run_time;
    if (Array.isArray(ert) && ert.length > 0) {
      const mm = Number(ert[0]);
      if (Number.isFinite(mm) && mm > 0) runtimeLabel = `~${mm}m / ep`;
    }
    const releaseLabel = formatUsReleaseDisplay(raw.first_air_date);
    return {
      tagline: tag || null,
      genresLine,
      certification,
      runtimeLabel,
      releaseLabel,
    };
  }
  const certification = usMovieCertificationFromReleaseDatesPayload(raw.release_dates);
  const runtimeLabel = formatRuntimeMinutes(raw.runtime);
  const releaseLabel = formatUsReleaseDisplay(raw.release_date);
  return {
    tagline: tag || null,
    genresLine,
    certification,
    runtimeLabel,
    releaseLabel,
  };
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

/** v3.2.0: Rate now — max overlap candidates to rank before TMDB hydrate + genre filter (then slice to ONBOARDING_COUNT). */
const RATE_NOW_OVERLAP_CANDIDATE_CAP = 48;
/** v3.2.0: Parallel TMDB detail fetches per batch (avoid bursting read token). */
const RATE_NOW_TMDB_FETCH_CONCURRENCY = 8;

/**
 * Your Picks: **CF predicted** (neighbor-backed), then **high predicted** (match rows without overlap),
 * then **popular** (catalogue / TMDB). Main row loads **5 at a time** up to 20.
 */
const YOUR_PICKS_BATCH_SIZE = 5;
const YOUR_PICKS_VISIBLE_MAX = 20;
/** Max titles per Discover `predict_cached` batch (Edge + DB bound). */
const DISCOVER_PREDICT_CACHED_CAP = 120;
/** After `your_picks_page`, compute CF overlays for this many rec ids (cold cache — Edge only reads DB in `your_picks_page`). */
const YOUR_PICKS_PREDICT_CACHED_CAP = 80;
/** Parallel TMDB `/watch/providers` fetches when building Your Picks strips (streaming filter on). */
const YOUR_PICKS_WATCH_PROVIDER_FETCH_CONCURRENCY = 8;
/**
 * Unrated catalogue titles (by popularity) to run `predict_cached` on for Your Picks — same per-title
 * CF path as Pulse / Streaming when `match_recommendations_from_neighbors` omits a title (top-220 + catalogue join).
 */
const YOUR_PICKS_CATALOG_PREDICT_CAP = 96;

/** Stable id for catalogue rows (handles `id` vs type+tmdbId after JSON). */
function mediaIdKey(movie) {
  if (!movie) return null;
  if (movie.id != null && movie.id !== "") {
    const p = parseMediaKey(movie.id);
    if (p) return `${p.type}-${p.tmdbId}`;
    return String(movie.id);
  }
  const tid = movie.tmdbId;
  const ty = movie.type;
  if (tid != null && ty) return `${String(ty).toLowerCase()}-${Number(tid)}`;
  return null;
}

/** Match `userRatings` keys when `movie.id` is missing after JSON (Your Picks pools only). */
function recMovieRowId(rec) {
  return mediaIdKey(rec?.movie);
}

/** Grow **For you** toward `cap` from `pool` (rotation / sort already applied upstream). */
function topUpYourPicksStrip1Only(strip1, pool, cap) {
  const used = new Set(strip1.map((r) => recMovieRowId(r)).filter(Boolean));
  const out = [...strip1];
  for (const r of pool) {
    if (out.length >= cap) break;
    const rid = recMovieRowId(r);
    if (!rid || used.has(rid)) continue;
    out.push(r);
    used.add(rid);
  }
  return out;
}

/** v3.0.0: Parse catalogue id (`movie-123`, `tv-456`) for `get_cinemastro_title_avgs` RPC payloads. */
function parseMediaKey(id) {
  if (id == null || id === "") return null;
  const s = String(id);
  const i = s.indexOf("-");
  if (i <= 0) return null;
  const type = s.slice(0, i).toLowerCase();
  const tmdbId = parseInt(s.slice(i + 1), 10);
  if (!Number.isFinite(tmdbId) || (type !== "movie" && type !== "tv")) return null;
  return { type, tmdbId };
}

/** Canonical key for `cinemastroAvgByKey` / RPC merge (must match `mediaIdKey` catalogue ids: `movie-123`). */
function cinemastroAvgKeyFromRow(row) {
  if (row?.tmdb_id == null || row?.media_type == null) return null;
  const ty = String(row.media_type).trim().toLowerCase();
  const tid = Number(row.tmdb_id);
  if (!Number.isFinite(tid) || (ty !== "movie" && ty !== "tv")) return null;
  return `${ty}-${tid}`;
}

/** PostgREST usually returns an array; normalize single-row or odd shapes so merges never silently drop. */
function normalizeCinemastroRpcRows(data) {
  if (data == null) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && ("tmdb_id" in data || "avg_score" in data)) return [data];
  return [];
}

/** Cinemastro personal prediction exists only when neighbours rated this title (`predict` / strip Rec with real overlap). */
function hasPersonalPrediction(pred) {
  if (!pred) return false;
  return Number(pred.neighborCount ?? pred.neighbor_count ?? 0) >= 1;
}

/** Edge `Rec` rows may use `neighbor_count` (snake_case) in JSON — strips + Your Picks sort must match. */
function recNeighborCount(rec) {
  if (!rec || typeof rec !== "object") return 0;
  return Number(rec.neighborCount ?? rec.neighbor_count ?? 0);
}

/**
 * ✨ Pick = strict CF list only (`match` `recommendations` from `getRecommendations`).
 * 📈 Popular = theater / streaming pool and client `tmdbOnlyRec` fallbacks (same strip, different source).
 */
function toYourPicksStripRows(recs, cfRecommendationIdSet) {
  return recs.map((r) => {
    const id = mediaIdKey(r?.movie);
    const kind = id && cfRecommendationIdSet.has(id) ? "pick" : "popular";
    return { rec: r, kind };
  });
}

// ---------------------------------------------------------------------------
// SPA URL overlays (v2.1.0)
// ---------------------------------------------------------------------------
// `history.pushState` with an unchanged URL works with Safari’s toolbar ← back,
// but iOS edge-swipe and Mac trackpad “back” often need a distinct URL per step.
// We use short query keys; `popstate` still drives closing detail/legal.
const SPA_QS_DETAIL = "detail";
const SPA_QS_LEGAL = "legal";
const SPA_LEGAL_SCREENS = new Set(["privacy", "terms", "about"]);
/** Only hydrate `?detail=` / `?legal=` after primary nav is up — avoids racing splash/auth/onboarding. */
const SPA_DEEPLINK_READY_SCREENS = new Set(["circles", "pulse", "in-theaters", "streaming-page", "secondary-region", "your-picks", "discover", "profile", "watchlist", "rated", "mood-results"]);

/** One overlay at a time: title id (`movie-769`) or legal screen id (`privacy`). */
function spaUrlForOverlay(overlay) {
  const u = new URL(window.location.href);
  u.searchParams.delete(SPA_QS_DETAIL);
  u.searchParams.delete(SPA_QS_LEGAL);
  if (overlay.detail) u.searchParams.set(SPA_QS_DETAIL, overlay.detail);
  else if (overlay.legal) u.searchParams.set(SPA_QS_LEGAL, overlay.legal);
  return `${u.pathname}${u.search}${u.hash}`;
}

function spaUrlWithoutOverlays() {
  const u = new URL(window.location.href);
  u.searchParams.delete(SPA_QS_DETAIL);
  u.searchParams.delete(SPA_QS_LEGAL);
  return `${u.pathname}${u.search}${u.hash}`;
}

/** First TMDB catalogue fetch: post-login routing waits for this (or safety timeout), not for catalogue.length > 0. */
const CATALOGUE_BOOTSTRAP_SAFETY_MS = 22_000;
/** Defer non-critical home fetches so first paint / post-login routing wins on slow mobile networks. */
const WHATS_HOT_FETCH_DEFER_MS = 450;
const SECONDARY_STRIP_FETCH_DEFER_MS = 550;
/** Streaming page TMDB fetch: short defer after route paint. */
const STREAMING_PAGE_FETCH_DEFER_MS = 200;
/** Max titles per user watchlist (keep in sync with migration `enforce_watchlist_max_per_user`). */
const WATCHLIST_MAX = 30;

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
  const sorted = [...watchlistData].sort(
    (a, b) => (Number(a.sort_index) || 0) - (Number(b.sort_index) || 0),
  );
  const movieMap = Object.fromEntries(catalogue.map(m => [m.id, m]));
  return sorted.map((w) => {
    const ty = String(w.media_type ?? "movie").toLowerCase() === "tv" ? "tv" : "movie";
    const id = `${ty}-${w.tmdb_id}`;
    const base = movieMap[id] || { id, tmdbId: w.tmdb_id, type: ty, title: w.title, poster: w.poster };
    const poster = normalizeWatchlistPosterUrl(base.poster);
    const fromGroup = w.source_circle_id != null;
    const si = Number(w.sort_index);
    const tidNum = Number(w.tmdb_id);
    return {
      ...base,
      type: ty,
      tmdbId: Number.isFinite(Number(base.tmdbId)) ? Number(base.tmdbId) : tidNum,
      poster: poster ?? base.poster,
      fromGroup,
      source_circle_id: w.source_circle_id ?? null,
      sort_index: Number.isFinite(si) ? si : 0,
    };
  }).filter(Boolean);
}

/** TMDB genre id → short label (movie + TV). Used for watchlist meta line. */
const TMDB_GENRE_NAME_BY_ID = new Map([
  [28, "Action"], [12, "Adventure"], [16, "Animation"], [35, "Comedy"], [80, "Crime"],
  [99, "Documentary"], [18, "Drama"], [10751, "Family"], [14, "Fantasy"], [36, "History"],
  [27, "Horror"], [10402, "Music"], [9648, "Mystery"], [10749, "Romance"], [878, "Sci-Fi"],
  [10770, "TV Movie"], [53, "Thriller"], [10752, "War"], [37, "Western"],
  [10759, "Action & Adventure"], [10762, "Kids"], [10763, "News"], [10764, "Reality"],
  [10765, "Sci-Fi & Fantasy"], [10766, "Soap"], [10767, "Talk"], [10768, "War & Politics"],
]);

function firstWatchlistGenreName(movie) {
  const ids = movie?.genreIds;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isFinite(id)) continue;
    const label = TMDB_GENRE_NAME_BY_ID.get(id);
    if (label) return label;
  }
  return null;
}

/** One line under the title: type · year · TMDB score · genre (omits missing pieces except type/year placeholders). */
function formatWatchlistMetaLine(movie) {
  const parts = [];
  const t = movie?.type === "tv" ? "TV" : movie?.type === "movie" ? "Movie" : "—";
  parts.push(t);
  const y = movie?.year != null && String(movie.year).trim() !== "" ? String(movie.year) : null;
  parts.push(y ?? "—");
  const tr = movie?.tmdbRating;
  if (tr != null && Number.isFinite(Number(tr))) parts.push(`TMDB ${Number(tr).toFixed(1)}`);
  const g = firstWatchlistGenreName(movie);
  if (g) parts.push(g);
  return parts.join(" · ");
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

/** US theatrical pool: normalized movies, newest wide/limited release first (for Now Playing strip). */
function sortTheatricalMoviesByReleaseDateDesc(items) {
  return [...items].sort((a, b) => {
    const da = Date.parse(a.releaseDate || `${a.year}-01-01`) || 0;
    const db = Date.parse(b.releaseDate || `${b.year}-01-01`) || 0;
    if (db !== da) return db - da;
    return Number(b.popularity ?? 0) - Number(a.popularity ?? 0);
  });
}

/** Same pool: TMDB popularity → vote average → release (for “popular in theaters” strip). */
function sortTheatricalMoviesByPopularityDesc(items) {
  return [...items].sort((a, b) => {
    const popDiff = Number(b.popularity ?? 0) - Number(a.popularity ?? 0);
    if (popDiff !== 0) return popDiff;
    const ratingDiff = Number(b.tmdbRating ?? 0) - Number(a.tmdbRating ?? 0);
    if (ratingDiff !== 0) return ratingDiff;
    const da = Date.parse(a.releaseDate || `${a.year}-01-01`) || 0;
    const db = Date.parse(b.releaseDate || `${b.year}-01-01`) || 0;
    return db - da;
  });
}

/** Streaming page “Now” order: newest release/air date first, popularity tiebreak. */
function sortStreamingByReleaseDateDesc(items) {
  return [...items].sort((a, b) => {
    const da = Date.parse(a.releaseDate || `${a.year}-01-01`) || 0;
    const db = Date.parse(b.releaseDate || `${b.year}-01-01`) || 0;
    if (db !== da) return db - da;
    return Number(b.popularity ?? 0) - Number(a.popularity ?? 0);
  });
}

/** Streaming page “Popular” order: TMDB popularity → vote avg → release (mirrors theaters). */
function sortStreamingByPopularityDesc(items) {
  return [...items].sort((a, b) => {
    const popDiff = Number(b.popularity ?? 0) - Number(a.popularity ?? 0);
    if (popDiff !== 0) return popDiff;
    const ratingDiff = Number(b.tmdbRating ?? 0) - Number(a.tmdbRating ?? 0);
    if (ratingDiff !== 0) return ratingDiff;
    const da = Date.parse(a.releaseDate || `${a.year}-01-01`) || 0;
    const db = Date.parse(b.releaseDate || `${b.year}-01-01`) || 0;
    return db - da;
  });
}

/**
 * US now_playing (filtered). Returns two orderings over the same gated pool: release-date order and popularity order.
 */
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
    const normalized = withLimitedWindowGate.map((item) => normalizeTMDBItem(item, "movie"));
    const nowPlaying = sortTheatricalMoviesByReleaseDateDesc(normalized).slice(0, TARGET_COUNT);
    const popularInTheaters = sortTheatricalMoviesByPopularityDesc(normalized).slice(0, TARGET_COUNT);
    return { nowPlaying, popularInTheaters };
  } catch {
    return { nowPlaying: [], popularInTheaters: [] };
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

/** Pulse — trending movies + TV (week), interleaved; global discovery (not Home “today” strip). */
async function fetchPulseTrendingCatalog() {
  try {
    const excludedTrendingGenres = new Set([10767, 10763]); // Talk + News
    const [m1, m2, t1, t2] = await Promise.all([
      fetchTMDB("/trending/movie/week?language=en-US"),
      fetchTMDB("/trending/movie/week?language=en-US&page=2"),
      fetchTMDB("/trending/tv/week?language=en-US"),
      fetchTMDB("/trending/tv/week?language=en-US&page=2"),
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

/** Pulse — popular movies + TV, interleaved. */
async function fetchPulsePopularCatalog() {
  try {
    const excludedTrendingGenres = new Set([10767, 10763]);
    const [m1, m2, t1, t2] = await Promise.all([
      fetchTMDB("/movie/popular?language=en-US&page=1"),
      fetchTMDB("/movie/popular?language=en-US&page=2"),
      fetchTMDB("/tv/popular?language=en-US&page=1"),
      fetchTMDB("/tv/popular?language=en-US&page=2"),
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

function BottomNavListIcon() {
  return (
    <svg className="bottom-nav-list-svg" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BottomNav({
  navTab,
  setNavTab,
  setScreen,
  setMoodStep,
  setMoodSelections,
  setMoodResults,
  onSignOut,
  clearDetailForBottomNav,
}) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileNavRef = useRef(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const close = (e) => {
      if (profileNavRef.current && !profileNavRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [profileMenuOpen]);

  return (
    <div className="bottom-nav">
      <div
        className={`nav-item ${navTab === "mood" ? "active" : ""}`}
        onClick={() => {
          clearDetailForBottomNav?.();
          setProfileMenuOpen(false);
          setNavTab("mood");
          setMoodStep(0);
          setMoodSelections({ region: [], indian_lang: [], genre: [], vibe: [] });
          setMoodResults([]);
          setScreen("mood-picker");
        }}
      >
        <div className={`nav-item__icon-wrap ${navTab === "mood" ? "nav-item__icon-wrap--active" : ""}`}>
          <div className="nav-icon">🎭</div>
        </div>
      </div>
      <div
        className={`nav-item ${navTab === "watchlist" ? "active" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Watchlist"
        onClick={() => {
          clearDetailForBottomNav?.();
          setProfileMenuOpen(false);
          setNavTab("watchlist");
          setScreen("watchlist");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            clearDetailForBottomNav?.();
            setProfileMenuOpen(false);
            setNavTab("watchlist");
            setScreen("watchlist");
          }
        }}
      >
        <div className={`nav-item__icon-wrap ${navTab === "watchlist" ? "nav-item__icon-wrap--active" : ""}`}>
          <div className="nav-icon nav-icon--svg">
            <BottomNavListIcon />
          </div>
        </div>
      </div>
      <div
        ref={profileNavRef}
        className={`nav-item nav-item--profile ${navTab === "profile" || profileMenuOpen ? "active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setProfileMenuOpen((v) => !v);
        }}
      >
        <div className={`nav-item__icon-wrap ${navTab === "profile" || profileMenuOpen ? "nav-item__icon-wrap--active" : ""}`}>
          <div className="nav-icon">👤</div>
        </div>
        {profileMenuOpen ? (
          <div className="bottom-nav__profile-menu" onClick={(ev) => ev.stopPropagation()}>
            <button
              type="button"
              className="avatar-menu-btn"
              onClick={() => {
                clearDetailForBottomNav?.();
                setProfileMenuOpen(false);
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
                setProfileMenuOpen(false);
                onSignOut();
              }}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** TMDB-style horizontal primary nav (desktop-first; links scroll on narrow widths). */
function AppPrimaryNav({
  menuItems,
  activeSectionId,
  onNavigateSection,
  onDiscover,
  onHome,
  discoverActive,
  onDetailBack,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Close drawer if viewport widens past the mobile breakpoint (e.g. rotate, resize).
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(min-width: 900px)");
    const handle = (e) => { if (e.matches) setMobileOpen(false); };
    if (mql.addEventListener) mql.addEventListener("change", handle);
    else if (mql.addListener) mql.addListener(handle);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handle);
      else if (mql.removeListener) mql.removeListener(handle);
    };
  }, []);

  useEffect(() => {
    if (onDetailBack) setMobileOpen(false);
  }, [onDetailBack]);

  function handleDrawerSelect(id) {
    setMobileOpen(false);
    onNavigateSection(id);
  }

  return (
    <header
      className={`app-primary-nav${onDetailBack ? " app-primary-nav--with-detail-back" : ""}`}
      role="navigation"
      aria-label="Primary"
    >
      <div className="app-primary-nav__inner">
        {onDetailBack ? (
          <button
            type="button"
            className="app-primary-nav__detail-back app-primary-nav__detail-back--mobile"
            onClick={onDetailBack}
            aria-label="Back"
          >
            <span aria-hidden="true">&lt;</span>
          </button>
        ) : null}
        <button
          type="button"
          className={`app-primary-nav__hamburger ${mobileOpen ? "app-primary-nav__hamburger--open" : ""}`}
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="app-primary-nav-drawer"
        >
          <span aria-hidden="true">{mobileOpen ? "✕" : "☰"}</span>
        </button>
        <div className="app-primary-nav__brand">
          <AppBrand onPress={onHome} />
        </div>
        <nav className="app-primary-nav__links" aria-label="Sections">
          {menuItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`app-primary-nav__link ${activeSectionId === item.id ? "app-primary-nav__link--active" : ""}`}
              onClick={() => onNavigateSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="app-primary-nav__right">
          <button
            type="button"
            className={`app-primary-nav__icon ${discoverActive ? "app-primary-nav__icon--active" : ""}`}
            onClick={onDiscover}
            aria-label="Discover"
          >
            🔍
          </button>
        </div>
      </div>
      {onDetailBack ? (
        <button
          type="button"
          className="app-primary-nav__detail-back app-primary-nav__detail-back--desktop"
          onClick={onDetailBack}
          aria-label="Back"
        >
          <span aria-hidden="true">&lt;</span>
        </button>
      ) : null}
      {mobileOpen && (
        <>
          <button
            type="button"
            className="app-primary-nav__scrim"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <nav
            id="app-primary-nav-drawer"
            className="app-primary-nav__drawer"
            aria-label="Sections"
          >
            {menuItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app-primary-nav__drawer-link ${activeSectionId === item.id ? "app-primary-nav__drawer-link--active" : ""}`}
                onClick={() => handleDrawerSelect(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </>
      )}
    </header>
  );
}

function PageShell({ title, subtitle, children }) {
  return (
    <div className="discover">
      <div className="discover-header">
        <div className="discover-title">{title}</div>
        {subtitle ? <div className="search-status" style={{ paddingLeft: 0 }}>{subtitle}</div> : null}
      </div>
      {children}
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

/** One strip row from `match` `predict_cached` / `predict` `predictions` map (aligns with personal-score product rule). */
function recFromMatchPrediction(movie, pred) {
  const n = Number(pred?.neighborCount ?? pred?.neighbor_count ?? 0);
  const predN = Number(pred?.predicted);
  if (pred && typeof pred === "object" && Number.isFinite(predN) && n >= 1) {
    const lowRaw = Number(pred.low);
    const highRaw = Number(pred.high);
    return {
      movie,
      predicted: predN,
      low: Number.isFinite(lowRaw) ? lowRaw : Math.max(1, Math.round((predN - 1) * 10) / 10),
      high: Number.isFinite(highRaw) ? highRaw : Math.min(10, Math.round((predN + 1) * 10) / 10),
      confidence: pred.confidence ?? "low",
      neighborCount: n,
    };
  }
  return tmdbOnlyRec(movie);
}

function recsFromPredictionMap(movies, predictions) {
  if (!movies?.length) return [];
  const predMap = predictions && typeof predictions === "object" ? predictions : {};
  return movies
    .map((m) => recFromMatchPrediction(m, predictionMapLookup(predMap, m.id) ?? null))
    .sort((a, b) => b.predicted - a.predicted);
}

/** Same as {@link recsFromPredictionMap} but keeps `movies` order (e.g. Pulse trending / popular). */
function recsFromPredictionMapInOrder(movies, predictions) {
  if (!movies?.length) return [];
  const predMap = predictions && typeof predictions === "object" ? predictions : {};
  return movies.map((m) => recFromMatchPrediction(m, predictionMapLookup(predMap, m.id) ?? null));
}

/**
 * Edge `predict_cached` returns a `predictions` map that includes **null** entries for titles with
 * no neighbor raters. Spreading that map over cache would wipe good rows — merge only real preds.
 */
function mergeNonNullPredictions(base, fromEdge) {
  const out = { ...base };
  if (!fromEdge || typeof fromEdge !== "object") return out;
  for (const [k, v] of Object.entries(fromEdge)) {
    if (v == null || typeof v !== "object") continue;
    const predicted = Number(v.predicted);
    if (!Number.isFinite(predicted)) continue;
    const neighborCount = Number(v.neighborCount ?? v.neighbor_count ?? 0);
    out[k] = {
      ...v,
      predicted,
      neighborCount: Number.isFinite(neighborCount) ? neighborCount : 0,
    };
  }
  return out;
}

/** `predictions` maps use catalogue ids (`movie-123`); avoid missed lookups from type coercion. */
function predictionMapLookup(map, movieId) {
  if (map == null || movieId == null || typeof map !== "object") return undefined;
  const hit = map[movieId];
  if (hit != null) return hit;
  return map[String(movieId)];
}

/**
 * `supabase.functions.invoke` usually returns parsed JSON; occasionally `data` is a string or wrapped.
 * Without this, `data?.recommendations` stays empty even when the Edge body is valid.
 */
function unwrapMatchFunctionData(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return unwrapMatchFunctionData(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object") return null;
  if (
    "recommendations" in raw ||
    "worthALookRecs" in raw ||
    "predictions" in raw ||
    "prediction" in raw ||
    "scored" in raw
  ) {
    return raw;
  }
  if (raw.data != null && typeof raw.data === "object") {
    return unwrapMatchFunctionData(raw.data);
  }
  return raw;
}

function logMatchInvokeFailure(label, result) {
  const err = result?.error;
  if (!err) return;
  const msg = err.message ?? String(err);
  const body = result?.data;
  const extra =
    body && typeof body === "object" && body !== null && "error" in body ? body.error : "";
  console.warn(`[match invoke] ${label}:`, msg, extra !== "" ? extra : "");
}

/** Single-title `predict_cached` may return `prediction: null` while `predictions[id]` is set (Edge batch shape). */
function predictionFromMatchPredictCachedData(data, movieId) {
  if (!data || typeof data !== "object") return null;
  const top = data.prediction;
  if (top != null && typeof top === "object") return top;
  const map = data.predictions;
  if (map && typeof map === "object" && movieId != null) {
    let v = map[movieId];
    if (v == null) v = map[String(movieId)];
    if (v != null && typeof v === "object") return v;
  }
  return null;
}

/** Normalize Edge / cache payload so `hasPersonalPrediction` and detail UI see `neighborCount`. */
function normalizeDetailPredictionPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const predicted = Number(raw.predicted);
  if (!Number.isFinite(predicted)) return null;
  const nc = Number(raw.neighborCount ?? raw.neighbor_count ?? 0);
  const lowRaw = Number(raw.low);
  const highRaw = Number(raw.high);
  return {
    predicted,
    low: Number.isFinite(lowRaw) ? lowRaw : Math.max(1, Math.round((predicted - 1) * 10) / 10),
    high: Number.isFinite(highRaw) ? highRaw : Math.min(10, Math.round((predicted + 1) * 10) / 10),
    confidence: raw.confidence ?? "low",
    neighborCount: nc,
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
  /* Same centered column as .app / .bottom-nav so logo aligns with section titles + strip cards (TMDB-style). */
  .app-primary-nav {
    position:fixed;
    top:0;
    left:0;
    right:0;
    margin-left:auto;
    margin-right:auto;
    width:100%;
    max-width:var(--shell);
    z-index:2100;
    background:linear-gradient(180deg, #121212 0%, #0a0a0a 100%);
    border-bottom:1px solid #222;
    box-shadow:0 1px 0 rgba(232, 201, 106, 0.08), 0 2px 12px rgba(0,0,0,0.35);
    padding-top:env(safe-area-inset-top, 0px);
    box-sizing:border-box;
  }
  .app-primary-nav__inner {
    display:flex;
    align-items:center;
    gap:10px;
    width:100%;
    margin:0;
    padding:10px 24px 10px;
    min-height:56px;
    box-sizing:border-box;
  }
  .app-primary-nav--with-detail-back {
    display:flex;
    flex-direction:column;
    align-items:stretch;
  }
  @media (min-width: 900px) {
    .app-primary-nav--with-detail-back {
      flex-direction:row;
      flex-wrap:nowrap;
      align-items:center;
      gap:10px;
    }
    .app-primary-nav--with-detail-back .app-primary-nav__detail-back {
      order:0;
      flex-shrink:0;
      align-self:center;
    }
    .app-primary-nav--with-detail-back .app-primary-nav__inner {
      order:1;
      flex:1;
      min-width:0;
    }
  }
  .app-primary-nav__detail-back {
    flex-shrink:0;
    width:40px;
    height:40px;
    border-radius:50%;
    border:1px solid #333;
    background:#1a1a1a;
    color:#e8c96a;
    font-size:17px;
    line-height:1;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    cursor:pointer;
    font-family:'DM Sans',sans-serif;
    padding:0;
    margin:0;
    transition:border-color 0.15s, background 0.15s, color 0.15s;
  }
  .app-primary-nav__detail-back:hover { border-color:#555; background:#222; color:#f0d880; }
  .app-primary-nav__detail-back span { position:relative; left:-0.5px; }
  .app-primary-nav__detail-back--mobile { display:none; }
  .app-primary-nav__detail-back--desktop { display:inline-flex; }
  .app-primary-nav__brand { flex-shrink:0; }
  .app-primary-nav__brand .brand-logo--header {
    height:40px;
    width:auto;
    max-width:min(240px, 48vw);
    display:block;
    object-fit:contain;
  }
  .app-primary-nav__links {
    display:flex;
    align-items:center;
    gap:2px;
    flex:1;
    min-width:0;
    overflow-x:auto;
    -webkit-overflow-scrolling:touch;
    scrollbar-width:none;
  }
  .app-primary-nav__links::-webkit-scrollbar { display:none; }
  .app-primary-nav__link {
    flex-shrink:0;
    background:none;
    border:none;
    cursor:pointer;
    font-family:'DM Sans',sans-serif;
    font-size:13px;
    font-weight:600;
    color:#c8c4bc;
    padding:8px 10px;
    border-radius:6px;
    transition:color 0.15s, background 0.15s;
    white-space:nowrap;
  }
  .app-primary-nav__link:hover { color:#e8c96a; }
  .app-primary-nav__link--active {
    color:#e8c96a;
    background:#2a2610;
  }
  .app-primary-nav__right { flex-shrink:0; display:flex; align-items:center; gap:6px; }
  .app-primary-nav__icon {
    background:none;
    border:none;
    cursor:pointer;
    font-size:20px;
    padding:8px;
    line-height:1;
    border-radius:8px;
    color:#e8c96a;
  }
  .app-primary-nav__icon:hover { background:rgba(232, 201, 106, 0.12); }
  .app-primary-nav__icon--active { background:rgba(232, 201, 106, 0.16); }
  .app-primary-nav__hamburger {
    display:none;
    flex-shrink:0;
    background:none;
    border:none;
    cursor:pointer;
    font-size:22px;
    padding:8px 10px;
    line-height:1;
    border-radius:8px;
    color:#e8c96a;
    min-width:40px;
    align-items:center;
    justify-content:center;
  }
  .app-primary-nav__hamburger:hover { background:rgba(232, 201, 106, 0.12); }
  .app-primary-nav__hamburger--open { background:rgba(232, 201, 106, 0.16); }
  .app-primary-nav__scrim {
    position:fixed;
    left:0;
    right:0;
    bottom:0;
    top:calc(60px + env(safe-area-inset-top, 0px));
    background:rgba(0,0,0,0.55);
    border:none;
    padding:0;
    cursor:pointer;
    z-index:2099;
    display:none;
  }
  .app-primary-nav__drawer {
    position:fixed;
    top:calc(60px + env(safe-area-inset-top, 0px));
    left:0;
    right:0;
    z-index:2101;
    background:linear-gradient(180deg, #121212 0%, #0a0a0a 100%);
    border-bottom:1px solid #222;
    box-shadow:0 8px 20px rgba(0,0,0,0.5);
    display:none;
    flex-direction:column;
    padding:6px 0 10px;
    max-height:calc(100vh - 60px - env(safe-area-inset-top, 0px));
    overflow-y:auto;
  }
  .app-primary-nav__drawer-link {
    background:none;
    border:none;
    cursor:pointer;
    font-family:'DM Sans',sans-serif;
    font-size:15px;
    font-weight:600;
    color:#c8c4bc;
    padding:14px 24px;
    text-align:left;
    transition:color 0.15s, background 0.15s;
  }
  .app-primary-nav__drawer-link:hover { color:#e8c96a; background:rgba(232, 201, 106, 0.08); }
  .app-primary-nav__drawer-link--active { color:#e8c96a; background:#2a2610; }
  .app--primary-nav { padding-top:calc(60px + env(safe-area-inset-top, 0px)); }
  .app--primary-nav .home-header { padding-top:20px; }
  .topbar-brand-cluster { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:nowrap; }
  .topbar-brand-cluster .app-brand-button { flex-shrink:1; }
  .public-site-stats { display:flex; flex-direction:column; gap:1px; justify-content:center; flex-shrink:0; line-height:1.12; padding:2px 0; }
  .public-site-stats-row { display:flex; align-items:baseline; gap:5px; white-space:nowrap; }
  .public-site-stats-val { font-family:'DM Sans',sans-serif; font-size:11px; font-weight:600; color:#c4a85a; letter-spacing:0.02em; }
  .public-site-stats-lbl { font-family:'DM Sans',sans-serif; font-size:8px; font-weight:500; letter-spacing:0.55px; text-transform:uppercase; color:#555; }
  .home-header { padding:48px 24px 16px; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start; column-gap:12px; min-width:0; }
  .home-hero { min-width:0; display:flex; flex-direction:column; gap:10px; align-items:flex-start; }
  .home-hero-copy { padding:0; display:block; max-width:100%; min-width:0; }
  .home-greeting { font-family:'DM Sans',sans-serif; font-size:52px; font-weight:600; color:#f0ebe0; margin-top:2px; line-height:1.02; letter-spacing:-0.6px; overflow-wrap:anywhere; }
  .home-subtitle { font-family:'DM Serif Display',serif; font-size:42px; font-weight:400; color:#cdcdc8; margin-top:8px; line-height:1.1; max-width:100%; letter-spacing:-0.2px; overflow-wrap:anywhere; }
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
  .strip-card--circle-recent { position:relative; }
  .strip-card__menu-btn {
    position:absolute;
    top:4px;
    right:2px;
    z-index:4;
    width:32px;
    height:32px;
    border:none;
    border-radius:10px;
    background:rgba(10,10,10,0.65);
    color:#ccc;
    font-size:18px;
    line-height:1;
    cursor:pointer;
    padding:0;
    display:flex;
    align-items:center;
    justify-content:center;
    font-family:'DM Sans',sans-serif;
  }
  .strip-card__menu-btn:hover { background:rgba(0,0,0,0.85); color:#fff; }
  .circle-recent-strip-menu {
    position:absolute;
    top:38px;
    right:2px;
    z-index:2200;
    min-width:188px;
    max-width:min(100vw - 24px, 260px);
    background:#141414;
    border:1px solid #2a2a2a;
    border-radius:10px;
    box-shadow:0 10px 28px rgba(0,0,0,0.45);
    padding:4px;
  }
  .circle-recent-strip-menu__item {
    display:block;
    width:100%;
    text-align:left;
    background:none;
    border:none;
    color:#e8c96a;
    font-size:13px;
    font-family:'DM Sans',sans-serif;
    padding:10px 12px;
    border-radius:6px;
    cursor:pointer;
  }
  .circle-recent-strip-menu__item:hover:not(:disabled) { background:rgba(232, 201, 106, 0.08); }
  .circle-recent-strip-menu__item:disabled { opacity:0.5; cursor:default; color:#666; }
  .circle-recent-strip-menu__item + .circle-recent-strip-menu__item { border-top:1px solid #222; }
  .circle-recent-strip-menu__item--danger { color:#e8a0a0 !important; }
  .circle-recent-strip-menu__item--danger:hover:not(:disabled) { background:rgba(224,80,80,0.08); }
  .strip-poster { width:152px; height:212px; border-radius:12px; overflow:hidden; position:relative; border:1px solid #1e1e1e; background:#1a1a1a; }
  .strip-poster img { width:100%; height:100%; object-fit:cover; }
  .strip-poster-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:40px; }
  .strip-badge { position:absolute; bottom:6px; right:6px; background:rgba(0,0,0,0.82); padding:4px 8px; border-radius:10px; font-size:12px; color:#e8c96a; font-family:'DM Serif Display',serif; z-index:2; }
  /* v3.0.0: Cinemastro community avg — Option B gold edge; TMDB uses base .strip-badge only. */
  .strip-badge.strip-badge--cinemastro { border:1px solid rgba(201,162,39,0.65); box-shadow:0 0 0 1px rgba(232,201,106,0.1); }
  .strip-badge.strip-badge--predicted { border:1px solid rgba(59,130,246,0.7); box-shadow:0 0 0 1px rgba(59,130,246,0.2); }
  .strip-badge.strip-badge--predicted-provisional { border:1px solid rgba(96,165,250,0.55); box-shadow:0 0 0 1px rgba(96,165,250,0.12); opacity:0.95; }
  /* v3.1.0: Gold underline = community sample weight (tiered fill). */
  .strip-badge.strip-badge--with-meter { display:flex; flex-direction:column; align-items:center; gap:3px; padding:4px 8px 5px; }
  .cinemastro-vote-meter { width:100%; min-width:28px; max-width:72px; height:3px; border-radius:2px; border:1px solid rgba(201,162,39,0.55); background:rgba(0,0,0,0.35); box-sizing:border-box; overflow:hidden; }
  .cinemastro-vote-meter-fill { height:100%; background:linear-gradient(90deg,#a67c1a,#e8c96a); border-radius:1px; min-width:0; transition:width 0.25s ease; }
  /* Your picks only: icon-only Pick ✨ vs Popular 📈; mirrors score badge contrast (lower-left vs lower-right). */
  .strip-kind-icon {
    position:absolute; bottom:6px; left:6px; z-index:2;
    background:rgba(0,0,0,0.82); padding:3px 7px; border-radius:10px;
    font-size:13px; line-height:1.2;
    pointer-events:none;
  }
  .strip-kind-icon--pick { color:#c9a227; }
  .strip-kind-icon--pop { color:#888; }
  .strip-hot-theater-pill { position:absolute; top:6px; left:6px; background:rgba(0,0,0,0.78); color:#c9b87c; font-size:10px; font-weight:500; padding:3px 7px; border-radius:8px; z-index:2; font-family:'DM Sans',sans-serif; letter-spacing:0.02em; }
  .strip-title { font-size:14px; color:#ccc; margin-top:9px; line-height:1.35; }
  .strip-title.strip-title--circle-single { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; max-width:100%; text-align:center; }
  .strip-genre {
    display:inline-block; box-sizing:border-box; max-width:100%;
    font-size:11px; color:#8a8a8a; margin-top:2px; line-height:1.3;
    padding:2px 6px 3px; border-radius:5px;
    background:rgba(12,12,12,0.65); border:1px solid rgba(255,255,255,0.05);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:top;
  }
  .strip-genre.strip-genre--spacer { background:transparent; border-color:transparent; padding:0; min-height:0; color:transparent; }
  .strip-genre.strip-genre--circle-cine { font-size:11px; color:#7a7a7a; margin-top:4px; line-height:1.35; letter-spacing:0.1px; text-align:center; }
  .strip-card-skeleton { flex-shrink:0; width:152px; }
  .skel-poster { width:152px; height:212px; border-radius:12px; border:1px solid #1e1e1e; position:relative; overflow:hidden; background:#141414; }
  /* Placeholder pill where Pick/Popular icon will appear (Your picks skeleton). */
  .skel-kind-icon {
    position:absolute; bottom:6px; left:6px; z-index:2;
    width:30px; height:22px; border-radius:10px; background:#1f1f1f;
  }
  .skel-line { height:11px; border-radius:6px; margin-top:8px; position:relative; overflow:hidden; background:#191919; }
  .skel-line-title { width:88%; margin-top:9px; }
  .skel-line-meta { width:62%; }
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

  .bottom-nav { position:fixed; bottom:0; left:0; right:0; margin-left:auto; margin-right:auto; width:100%; max-width:var(--shell); box-sizing:border-box; background:rgba(10,10,10,0.95); border-top:1px solid #1a1a1a; display:flex; align-items:center; justify-content:space-between; gap:6px; padding:10px 8px calc(14px + env(safe-area-inset-bottom,0px)); padding-left:max(8px, env(safe-area-inset-left,0px)); padding-right:max(8px, env(safe-area-inset-right,0px)); backdrop-filter:blur(20px); z-index:100; }
  .nav-item__icon-wrap { width:44px; height:44px; border-radius:50%; display:flex; align-items:center; justify-content:center; transition:background 0.2s; }
  .nav-item__icon-wrap--active { background:rgba(232, 201, 106, 0.14); }
  .nav-icon--svg { display:flex; align-items:center; justify-content:center; color:#c9c9c9; }
  .nav-item.active .nav-item__icon-wrap .nav-icon--svg { color:#e8c96a; }
  .bottom-nav-list-svg { display:block; }
  .nav-item { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0; cursor:pointer; opacity:0.4; transition:opacity 0.2s; min-width:0; min-height:48px; }
  .nav-item--profile { position:relative; }
  .nav-item.active { opacity:1; }
  .nav-icon { font-size:20px; }
  .bottom-nav__profile-menu { position:absolute; right:0; bottom:calc(100% + 10px); min-width:150px; background:#141414; border:1px solid #2a2a2a; border-radius:10px; box-shadow:0 10px 28px rgba(0,0,0,0.45); padding:6px; z-index:130; }

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
  .search-input--with-clear { padding-right:42px; }
  .search-input::placeholder { color:#444; }
  .search-input:focus { border-color:#555; }
  .search-clear-btn { position:absolute; right:6px; top:50%; transform:translateY(-50%); width:30px; height:30px; border:none; border-radius:8px; background:transparent; color:#888; padding:0; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2; font-size:20px; line-height:1; font-family:'DM Sans',sans-serif; }
  .search-clear-btn:hover { color:#ccc; background:rgba(255,255,255,0.06); }
  .search-clear-btn:active { opacity:0.85; }
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
  .disc-pred-badge--predicted { color:#3b82f6; border:1px solid rgba(59,130,246,0.65); border-radius:8px; padding:2px 6px; display:inline-block; box-shadow:0 0 0 1px rgba(59,130,246,0.14); }
  .disc-pred-badge--predicted.disc-pred-badge--with-meter { padding:3px 6px 4px; }
  .disc-pred-badge.disc-pred-badge--with-meter { display:inline-flex; flex-direction:column; align-items:center; gap:2px; padding:3px 6px 4px; }
  .disc-community-badge--cinemastro { border:1px solid rgba(201,162,39,0.55); border-radius:8px; padding:2px 6px; display:inline-block; }
  .disc-community-badge--cinemastro.disc-pred-badge--with-meter { padding:3px 6px 4px; }
  .cinemastro-vote-meter--disc { max-width:56px; }
  .disc-unseen-badge { color:#555; font-size:10px; font-family:'DM Sans',sans-serif; }
  .disc-title { font-size:13px; color:#ccc; margin-top:8px; line-height:1.3; font-weight:500; overflow-wrap:anywhere; word-break:break-word; }
  .disc-title.disc-title--circle-single { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; overflow-wrap:normal; word-break:normal; min-width:0; max-width:100%; text-align:center; }
  .disc-meta { font-size:11px; color:#555; margin-top:2px; overflow-wrap:anywhere; word-break:break-word; }
  .disc-meta.disc-meta--circle-cine { color:#666; line-height:1.35; letter-spacing:0.1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; }
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
  .mood-result-badge.mood-result-badge--with-meter { display:flex; flex-direction:column; align-items:center; gap:3px; padding:5px 10px 6px; }
  .mood-result-badge.mood-result-badge--cinemastro { box-shadow:0 0 0 2px rgba(201,162,39,0.45); border-color:#c9a227; }
  .mood-result-badge.mood-result-badge--predicted { box-shadow:0 0 0 2px rgba(59,130,246,0.38); border-color:#3b82f6; color:#3b82f6; }
  .cinemastro-vote-meter--mood { max-width:64px; }
  .mood-result-type { position:absolute; top:12px; left:12px; background:rgba(0,0,0,0.7); border:1px solid #333; padding:3px 8px; border-radius:8px; font-size:9px; text-transform:uppercase; letter-spacing:1px; color:#aaa; }
  .mood-result-info { padding:14px 16px; }
  .mood-result-title { font-family:'DM Serif Display',serif; font-size:20px; color:#f0ebe0; line-height:1.1; }
  .mood-result-meta { font-size:12px; color:#666; margin-top:4px; }
  .mood-result-synopsis { font-size:12px; color:#777; margin-top:8px; line-height:1.5; }
  .mood-result-actions { display:flex; gap:8px; margin-top:12px; }
  .btn-select-watch { flex:2; background:#e8c96a; color:#0a0a0a; border:none; padding:12px; font-family:'DM Sans',sans-serif; font-size:13px; font-weight:500; cursor:pointer; border-radius:2px; transition:all 0.2s; }
  .btn-select-watch:hover:not(:disabled) { background:#f0d880; }
  .btn-select-watch:disabled { opacity:0.45; cursor:not-allowed; }
  .btn-select-watch.selected { background:#2a4a1a; color:#6aaa6a; border:1px solid #2a4a2a; }
  .btn-detail { flex:1; background:transparent; color:#888; border:1px solid #2a2a2a; padding:12px; font-family:'DM Sans',sans-serif; font-size:13px; cursor:pointer; border-radius:2px; transition:all 0.2s; }
  .btn-detail:hover { border-color:#555; color:#ccc; }
  .mood-no-results { padding:48px 24px; text-align:center; }
  .mood-no-results-text { font-size:14px; color:#444; line-height:1.7; }

  .wtw-section { margin-top:16px; }
  .wtw-title { font-size:12px; color:#666; letter-spacing:1px; text-transform:uppercase; margin-bottom:10px; }
  .detail-wtw-wrap {
    margin-top:18px;
    padding:14px 16px 16px;
    background:rgba(20,20,20,0.65);
    border-radius:10px;
    text-align:center;
  }
  .detail-wtw-wrap .wtw-section { margin-top:0; text-align:center; }
  .detail-wtw-wrap .wtw-title { text-align:center; }
  .detail-wtw-wrap .wtw-group-label,
  .detail-wtw-wrap .wtw-loading,
  .detail-wtw-wrap .wtw-none { text-align:center; }
  .detail-wtw-wrap .wtw-providers { justify-content:center; }
  .detail-wtw-wrap .wtw-link { text-align:center; }
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
  /* Hero: backdrop + TMDB-style poster float on the right, overlapping the band. */
  .detail-hero { position:relative; width:100%; max-width:100%; box-sizing:border-box; }
  .detail-hero-backdrop { position:relative; height:min(38vw, 240px); min-height:180px; max-height:300px; overflow:visible; background:#141414; }
  /* Bias left so the floating poster (right) doesn’t sit over the main focal area of the still. */
  .detail-hero-backdrop img { width:100%; height:100%; object-fit:cover; object-position:30% top; }
  .detail-hero-backdrop-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:clamp(48px, 15vw, 100px); background:#141414; }
  .detail-hero-backdrop .d-overlay { position:absolute; inset:0; background:linear-gradient(to top, #0a0a0a 0%, rgba(10,10,10,0.55) 40%, transparent 70%); pointer-events:none; z-index:1; }
  .detail-hero-poster--float {
    position:absolute;
    top:50%;
    right:max(14px, env(safe-area-inset-right, 0px));
    bottom:auto;
    transform:translateY(-50%);
    width:clamp(72px, 22vw, 104px);
    z-index:3;
    border-radius:8px;
    overflow:hidden;
    border:1px solid #333;
    box-shadow:0 12px 32px rgba(0,0,0,0.55);
    background:#1a1a1a;
  }
  .detail-hero-poster--float img { width:100%; display:block; aspect-ratio:2/3; object-fit:cover; }
  .detail-hero-band {
    position:relative;
    z-index:2;
    margin-top:clamp(-52px, -11vw, -40px);
    padding:0 max(20px, env(safe-area-inset-left, 0px)) 2px;
    padding-right:max(20px, env(safe-area-inset-right, 0px));
    box-sizing:border-box;
  }
  .detail-hero-copy { min-width:0; text-align:center; }
  .detail-hero-copy .d-type-genre { flex-wrap:wrap; margin-bottom:4px; justify-content:flex-start; }
  .d-title {
    font-family:'DM Serif Display',serif;
    font-size:clamp(1rem, 3.6vw, 1.42rem);
    color:#f0ebe0;
    line-height:1.18;
    margin-top:2px;
    text-align:center;
    text-shadow:0 2px 14px rgba(0,0,0,0.75);
    overflow-wrap:anywhere;
    word-break:normal;
  }
  .d-title .d-title-year {
    color:#8a8a82;
    font-weight:400;
    font-size:0.62em;
    letter-spacing:0.01em;
  }
  .detail .d-tagline { font-size:14px; color:#888; line-height:1.7; font-style:italic; margin:14px 0 10px; text-align:center; }
  .d-overview-heading { font-family:'DM Serif Display',serif; font-size:18px; color:#ddd7cd; margin:6px 0 8px; text-align:center; }
  .detail .d-synopsis { text-align:center; }
  .detail-content-wrap { width:100%; max-width:100%; margin:0 auto; box-sizing:border-box; padding-top:0; }
  .detail-rate-section { width:100%; }
  .d-overlay { position:absolute; inset:0; background:linear-gradient(to top, #0a0a0a 0%, transparent 50%); }
  .detail .d-body { padding:2px max(20px, env(safe-area-inset-left, 0px)) 24px; padding-right:max(20px, env(safe-area-inset-right, 0px)); }
  /* Detail scores: 2-row grid — labels, then values (compact). */
  .detail-score-block {
    display:grid;
    grid-template-columns:minmax(0, 1fr) auto minmax(0, 1fr);
    grid-template-rows:auto auto;
    column-gap:10px;
    row-gap:2px;
    align-items:center;
    margin:2px 0 12px;
  }
  .detail-score-lbl {
    font-size:11px;
    font-weight:600;
    color:#8f8f8f;
    letter-spacing:0.06em;
    text-transform:uppercase;
    text-align:center;
  }
  .detail-score-lbl--left { grid-column:1; grid-row:1; }
  .detail-score-lbl--right { grid-column:3; grid-row:1; }
  .detail-score-divider-v {
    grid-column:2;
    grid-row:1 / span 2;
    width:1px;
    justify-self:center;
    background:linear-gradient(180deg, transparent, #3a3a3a 12%, #3a3a3a 88%, transparent);
    align-self:stretch;
    min-height:48px;
  }
  .detail-score-val--left {
    grid-column:1;
    grid-row:2;
    justify-self:center;
    min-width:0;
    width:100%;
  }
  .detail-score-val--right {
    grid-column:3;
    grid-row:2;
    justify-self:center;
    min-width:0;
    width:100%;
  }
  .detail-score-val-cluster {
    display:flex;
    flex-direction:row;
    align-items:center;
    justify-content:center;
    gap:10px 12px;
  }
  .detail-score-meta-stack {
    display:flex;
    flex-direction:column;
    align-items:flex-start;
    justify-content:center;
    gap:3px;
    text-align:left;
    min-width:0;
  }
  .detail-score-meta-stack .detail-score-side-meta { line-height:1.2; }
  .detail-score-meta-stack .detail-score-conf-inline { line-height:1.2; }
  .cinemastro-vote-meter--detail-stack {
    width:100%;
    min-width:52px;
    max-width:80px;
    height:3px;
    margin:0;
    align-self:flex-start;
  }
  .detail-score-values-line {
    display:flex;
    flex-direction:row;
    align-items:baseline;
    justify-content:center;
    flex-wrap:wrap;
    gap:6px 10px;
    text-align:center;
  }
  .detail-score-side-meta { font-size:10px; color:#8a8a8a; white-space:nowrap; }
  .detail-score-conf-inline { font-size:10px; line-height:1.2; white-space:nowrap; }
  .detail-score-conf-inline--high { color:#6aaa6a; }
  .detail-score-conf-inline--medium { color:#d0be68; }
  .detail-score-conf-inline--low { color:#ca7c7c; }
  .detail-inline-score-val {
    font-family:'DM Serif Display',serif;
    font-size:clamp(1.35rem, 4.5vw, 1.75rem);
    line-height:1;
    color:#e8c96a;
  }
  .detail-inline-score-val--yours { color:#a8d4a8; }
  .detail-inline-score-val--pred { color:#6ca8ff; }
  .detail-inline-score-val--muted { color:#555; font-size:clamp(1.2rem, 4vw, 1.5rem); }
  .detail-cine-sub--inline { font-size:10px; color:#666; line-height:1.2; white-space:nowrap; }
  .detail-score-skel-inline {
    grid-column:1 / -1;
    grid-row:1 / -1;
    min-height:52px;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    gap:8px;
    margin:10px 0 12px;
  }
  .detail-rate-pill-wrap { display:flex; flex-direction:column; align-items:center; margin:0 0 14px; }
  .d-rate-now-btn--center { margin-top:0; }
  .detail-facts-bar {
    background:rgba(22,22,22,0.75);
    border:none;
    border-radius:10px;
    padding:10px 12px 12px;
    margin-bottom:4px;
  }
  .detail-facts-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:8px 10px; font-size:11px; color:#b0b0a8; line-height:1.4; }
  .detail-facts-cert {
    display:inline-flex;
    align-items:center;
    justify-content:center;
    min-width:26px;
    padding:2px 6px;
    border:none;
    border-radius:4px;
    font-size:10px;
    font-weight:700;
    color:#e0e0d8;
    background:rgba(0,0,0,0.35);
  }
  .detail-facts-sep { color:#444; font-weight:300; user-select:none; }
  .detail-facts-genres { font-size:11px; color:#888; text-align:center; margin-top:8px; line-height:1.35; }
  .detail-score-card-skel .skel-line { margin-top:0; }
  .cinemastro-vote-meter--detail-inline { max-width:120px; margin-top:4px; }
  .rated-box--compact { padding:16px 18px; }
  .rated-box--compact .rated-score { display:none; }
  .d-type-genre { display:flex; align-items:center; gap:8px; }
  .d-type-pill { background:#222; border:1px solid #333; padding:3px 8px; border-radius:8px; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#888; }
  .d-genre-text { font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#666; }
  .detail .d-rate-label {
    font-size:12px;
    color:#666;
    letter-spacing:1px;
    text-transform:uppercase;
    margin-bottom:10px;
    text-align:center;
  }
  .detail .d-rate-label--sentence {
    text-transform:none;
    letter-spacing:0.02em;
    line-height:1.4;
    font-weight:500;
  }
  .detail-rate-section--slider { text-align:center; }
  .detail-rate-section--slider .d-rate-slider-col { max-width:min(100%, 320px); margin-left:auto; margin-right:auto; }
  .detail-rate-section--slider .d-actions { justify-content:center; }
  .detail .rated-label {
    font-size:12px;
    letter-spacing:1px;
    text-transform:uppercase;
    color:#6aaa6a;
  }
  .d-rate-slider-col { flex:1; min-width:0; }
  .d-rate-slider-wrap { position:relative; padding-top:26px; margin-top:2px; }
  .d-rate-slider-bubble {
    position:absolute;
    top:0;
    transform:translateX(-50%);
    font-family:'DM Serif Display',serif;
    font-size:20px;
    line-height:1;
    color:#e8c96a;
    pointer-events:none;
    white-space:nowrap;
  }
  .detail .d-rate-row { align-items:flex-end; gap:0; }
  .d-pred-box { background:#141414; border:1px solid #222; border-radius:12px; padding:16px 20px; margin:18px 0; display:flex; justify-content:space-between; align-items:center; }
  /* v3.2.1: Same shimmer treatment as strip skeletons while match predict loads. */
  .d-pred-box-skeleton { align-items:stretch; gap:16px; border-color:#2a2a2a; }
  .d-pred-box-skeleton .d-pred-skel-right { display:flex; flex-direction:column; align-items:flex-end; justify-content:center; gap:10px; flex-shrink:0; min-width:52px; }
  .d-pred-box-skeleton .skel-line { margin-top:0; }
  /* v3.0.0: Detail community score — gold edge when source is Cinemastro aggregate. */
  .d-community-box--cinemastro { border-color:rgba(201,162,39,0.55); box-shadow:0 0 0 1px rgba(232,201,106,0.08); }
  .d-pred-box-low { border-style:dashed; border-color:#6c5a2c; }
  .d-pred-box-medium { border-style:solid; border-color:#7e6931; }
  .d-pred-box-high { border-style:solid; border-color:#b18f36; }
  .d-pred-label { font-size:12px; color:#666; }
  .d-pred-sub { font-size:11px; color:#444; margin-top:3px; }
  .d-pred-val { font-family:'DM Serif Display',serif; font-size:38px; color:#e8c96a; line-height:1; text-align:right; }
  .d-pred-val-block { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
  .cinemastro-vote-meter--detail { width:min(120px, 100%); max-width:100%; }
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
  .btn-full-dark:disabled { opacity:0.45; cursor:not-allowed; border-color:#2a2a2a; }
  .saved-style { background:#1a2a1a !important; color:#6aaa6a !important; border-color:#2a4a2a !important; }
  .rated-box { background:#141414; border:1px solid #2a4a2a; border-radius:12px; padding:20px; text-align:center; }
  .rated-score { font-family:'DM Serif Display',serif; font-size:48px; color:#e8c96a; }
  .rated-label { font-size:13px; color:#6aaa6a; margin-top:4px; }
  .rated-pred { font-size:12px; color:#444; margin-top:6px; }
  .no-recs { margin:0 24px; padding:28px; border:1px dashed #222; border-radius:12px; text-align:center; }
  .no-recs-text { font-size:13px; color:#444; line-height:1.6; }

  .profile { height:100%; min-height:0; background:#0a0a0a; padding-bottom:80px; animation:fadeIn 0.4s ease; overflow-x:hidden; overflow-x:clip; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain; min-width:0; width:100%; max-width:100%; }
  .profile-top { display:flex; gap:16px; align-items:flex-start; padding:52px 24px 20px; }
  .profile .profile-top { padding:14px 24px 20px; }
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
  .watchlist-page-intro { padding:8px 24px 4px; }
  .watchlist-page-intro .discover-title { margin:0; }
  .watchlist-page-intro .section-meta { margin-top:6px; color:#666; font-size:12px; }
  .wl-from-group { font-size:9px; letter-spacing:0.06em; text-transform:uppercase; color:#6a6a6a; margin-top:4px; font-weight:600; }
  .wl-card-meta { font-size:10px; color:#777; margin-top:4px; line-height:1.3; font-family:'DM Sans',sans-serif; max-width:100px; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .wl-list { padding:0 0 8px; width:100%; max-width:100%; box-sizing:border-box; }
  .wl-list-row { display:flex; align-items:stretch; gap:0; border-bottom:1px solid #1a1a1a; min-width:0; }
  .wl-list-row:last-child { border-bottom:none; }
  .wl-list-row__main { flex:1; min-width:0; display:flex; align-items:center; gap:12px; padding:12px 24px; background:none; border:none; cursor:pointer; text-align:left; color:inherit; font:inherit; }
  .wl-list-row__main:hover { background:rgba(255,255,255,0.03); }
  .wl-list-thumb { width:48px; height:72px; border-radius:8px; overflow:hidden; background:#1a1a1a; flex-shrink:0; border:1px solid #1e1e1e; }
  .wl-list-thumb img { width:100%; height:100%; object-fit:cover; }
  .wl-list-text { flex:1; min-width:0; }
  .wl-list-title { font-size:14px; color:#ccc; line-height:1.3; font-weight:500; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .wl-list-meta { font-size:11px; color:#666; margin-top:4px; line-height:1.4; font-family:'DM Sans',sans-serif; }
  .wl-list-row__more { position:relative; flex-shrink:0; display:flex; align-items:stretch; }
  .wl-list-row__more-btn { width:44px; border:none; background:transparent; color:#666; font-size:18px; line-height:1; cursor:pointer; padding:0; align-self:stretch; }
  .wl-list-row__more-btn:hover { color:#ccc; background:rgba(255,255,255,0.04); }
  .wl-list-row__menu {
    position:absolute;
    right:8px;
    top:50%;
    bottom:auto;
    transform:translateY(-50%);
    min-width:180px;
    background:#141414;
    border:1px solid #2a2a2a;
    border-radius:10px;
    box-shadow:0 10px 28px rgba(0,0,0,0.45);
    padding:4px;
    z-index:2190;
  }
  .wl-list-row__menu-item { display:block; width:100%; text-align:left; background:none; border:none; color:#e8c96a; font-size:13px; font-family:'DM Sans',sans-serif; padding:10px 12px; border-radius:6px; cursor:pointer; }
  .wl-list-row__menu-item:hover:not(:disabled) { background:rgba(232, 201, 106, 0.08); }
  .wl-list-row__menu-item:disabled { opacity:0.4; cursor:default; color:#666; }
  .wl-list-row__menu-item + .wl-list-row__menu-item { border-top:1px solid #222; }
  .detail-watchlist-source { font-size:12px; color:#777; margin-top:14px; line-height:1.4; font-family:'DM Sans',sans-serif; }
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
    /* Home login path: logo+stats in hero can overflow on narrow Safari widths. Keep logo only on mobile. */
    .home-header .public-site-stats { display:none; }
    .discover-header { padding-left:max(20px, env(safe-area-inset-left, 0px)); padding-right:max(20px, env(safe-area-inset-right, 0px)); min-width:0; }
    .app-primary-nav__inner {
      display:grid;
      grid-template-columns:auto 1fr auto;
      align-items:center;
      column-gap:8px;
      padding-left:max(12px, env(safe-area-inset-left, 0px));
      padding-right:max(20px, env(safe-area-inset-right, 0px));
    }
    .app-primary-nav__hamburger { display:inline-flex; grid-column:1; grid-row:1; }
    .app-primary-nav--with-detail-back .app-primary-nav__hamburger { display:none !important; }
    .app-primary-nav__detail-back--mobile { display:inline-flex !important; grid-column:1; grid-row:1; justify-self:start; align-self:center; }
    .app-primary-nav__detail-back--desktop { display:none !important; }
    .app-primary-nav__brand { grid-column:2; grid-row:1; justify-self:center; min-width:0; }
    .app-primary-nav__right { grid-column:3; grid-row:1; }
    .app-primary-nav__links { display:none; }
    .app-primary-nav__scrim { display:block; }
    .app-primary-nav__drawer { display:flex; }
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
    /* Title detail: same horizontal rhythm as home strips / section headers + safe-area (TMDB-like gutter). */
    .detail { padding-bottom:max(80px, calc(80px + env(safe-area-inset-bottom, 0px))); }
    .detail-hero-band {
      padding-left:max(20px, env(safe-area-inset-left, 0px));
      padding-right:max(20px, env(safe-area-inset-right, 0px));
    }
    .detail-content-wrap .d-body {
      padding-left:max(20px, env(safe-area-inset-left, 0px));
      padding-right:max(20px, env(safe-area-inset-right, 0px));
    }
    /* Detail title: sans on narrow viewports — DM Serif Display hairlines/subpixel badly on Mobile Safari. */
    .d-title {
      font-family:'DM Sans',sans-serif;
      font-weight:500;
      letter-spacing:-0.02em;
      line-height:1.22;
    }
    /* Circle detail: sans title on narrow viewports. */
    .circle-hero--detail .circle-hero__name {
      font-family:'DM Sans',sans-serif;
      font-size:clamp(1.05rem, 4.1vw, 1.32rem);
      font-weight:600;
      letter-spacing:-0.02em;
      line-height:1.22;
    }
  }

  /* Desktop/tablet: let app breathe beyond the mobile shell while keeping phone UX unchanged. */
  @media (min-width: 900px) {
    .app { --shell:1120px; }
    .app-brand.brand-logo--header { width:min(360px, 100%); }
    .app-primary-nav__brand .brand-logo--header {
      height:48px;
      max-width:min(300px, 34vw);
    }
    .topbar-brand-cluster { gap:14px; }
    .public-site-stats-val { font-size:12px; }
    .public-site-stats-lbl { font-size:9px; }
    .home-topbar { display:grid; grid-template-columns:minmax(0, auto) 1fr auto; align-items:center; gap:20px; padding:14px 32px; border-bottom:1px solid #1a1a1a; }
    .home-topbar .app-brand { margin:0; }
    .home-topbar .avatar-wrap { justify-self:end; align-self:center; }
    .page-topbar { padding:14px 32px; padding-top:max(14px, env(safe-area-inset-top, 0px)); }
    .app-footer { padding-left:32px; padding-right:32px; }
    .legal-body { padding-left:32px; padding-right:32px; }
    .home .section-divider { margin:0 32px 10px !important; }
    .home-header { padding:18px 32px 10px; display:block; }
    /* Logo + community stats live in home-topbar; hide duplicate cluster here (stats are siblings of .app-brand). */
    .home-header .topbar-brand-cluster { display:none; }
    .home-header .app-brand,
    .home-header .avatar-wrap { display:none; }
    .home-greeting { font-size:56px; }
    .home-subtitle { font-size:36px; max-width:none; white-space:nowrap; }
    .discover-header,
    .mood-header { padding-left:32px; padding-right:32px; }
    .app-primary-nav__inner { padding-left:32px; padding-right:32px; }
    .section-header { padding:0 32px; }
    .strip { padding-left:32px; padding-right:32px; gap:18px; }
    .strip-card { width:184px; }
    .strip-poster { width:184px; height:256px; }
    .strip-title { font-size:15px; line-height:1.32; }
    .strip-genre { font-size:12px; }
    .filter-row { padding-left:32px; padding-right:32px; }
    .disc-grid { padding:0 32px; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:16px; }
    /* Detail: readable hero + content width (v3.3.0 hero spans shell). */
    .detail-hero { max-width:min(100%, calc((min(100%, var(--shell)) - 64px - 48px) / 4 * 2 + 48px)); margin-left:auto; margin-right:auto; }
    .detail-hero-poster--float { width:118px; right:32px; top:50%; bottom:auto; transform:translateY(-50%); }
    .detail-hero-band { padding-left:32px; padding-right:32px; }
    .d-title { font-size:1.52rem; }
    .detail-inline-score-val { font-size:1.85rem; }
    .detail-content-wrap {
      max-width:calc((min(100%, var(--shell)) - 112px) / 2 + 16px);
    }
    .detail-content-wrap .d-body { padding-left:20px; padding-right:20px; }
    .detail-rate-section { max-width:380px; margin-left:auto; margin-right:auto; }
    .profile-top,
    .profile-settings,
    .profile-section,
    .watchlist-page-intro,
    .wl-list-row__main,
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
    .circles-detail-topbar { padding-left:32px; padding-right:32px; padding-top:14px; }
    .circle-hero--detail .circle-hero__top-bar--detail-chat {
      padding-left:32px;
      padding-right:32px;
      padding-top:max(14px, env(safe-area-inset-top, 0px));
    }
    .circles-detail-error-wrap { padding-left:32px; padding-right:32px; }
    .circles-detail-loading { padding-left:32px; padding-right:32px; }
    /* Home Now Playing: What’s hot + optional Region block. */
  }

  @media (min-width: 1200px) {
    .app { --shell:1240px; }
    .strip-card { width:198px; }
    .strip-poster { width:198px; height:276px; }
    .disc-grid { grid-template-columns:repeat(5, minmax(0, 1fr)); gap:18px; }
    .detail-hero { max-width:min(100%, calc((min(100%, var(--shell)) - 64px - 72px) / 5 * 2 + 72px)); }
    .detail-hero-poster--float { width:124px; }
    .detail-content-wrap {
      max-width:calc(2 * (min(100%, var(--shell)) - 64px - 72px) / 5 + 18px);
    }
  }

  @keyframes fadeIn { from{opacity:0} to{opacity:1} }
  @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spin { to{transform:rotate(360deg)} }
  @keyframes shimmer { 100% { transform:translateX(100%); } }
  @keyframes sheetUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }

  /* =============================================================================================
     Circles (v5.0.0 Phase A)
     ============================================================================================= */
  .circles-header { padding:16px 24px 4px; }
  .circles-header-row { display:flex; align-items:flex-start; gap:12px; justify-content:space-between; }
  .circles-header-copy { min-width:0; flex:1 1 auto; }
  .circles-count-sub { font-family:'DM Sans',sans-serif; font-size:13px; color:#888; margin-top:4px; }
  .circles-header-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
  .circles-bell { position:relative; background:#141414; border:1px solid #2a2a2a; color:#e8c96a; padding:8px 10px; border-radius:999px; cursor:pointer; font-size:14px; line-height:1; display:flex; align-items:center; gap:4px; }
  .circles-bell[disabled] { opacity:0.55; cursor:default; }
  .circles-bell-count { font-family:'DM Sans',sans-serif; font-size:11px; color:#888; font-weight:600; }
  .circles-new-btn { background:#e8c96a; color:#0a0a0a; border:none; padding:10px 16px; border-radius:999px; font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600; letter-spacing:0.3px; cursor:pointer; transition:background 0.15s, transform 0.15s; white-space:nowrap; }
  .circles-new-btn:hover:not(:disabled) { background:#f0d880; }
  .circles-new-btn:disabled { opacity:0.4; cursor:default; background:#2a2610; color:#e8c96a; }
  .circles-new-btn--lg { padding:14px 28px; font-size:14px; margin-top:20px; }
  .circles-cap-banner { margin-top:12px; padding:10px 14px; background:#2a1a0a; border:1px solid #4a2e12; color:#e8c96a; border-radius:10px; font-size:13px; }
  .circles-error-banner { margin-top:12px; padding:10px 14px; background:#1a0808; border:1px solid #441111; color:#f09a9a; border-radius:10px; font-size:13px; overflow-wrap:anywhere; }

  .circles-skeleton { padding:20px 24px; display:flex; flex-direction:column; gap:12px; }
  .circles-skeleton-card { height:96px; border-radius:14px; background:linear-gradient(90deg,#121212 0%,#1a1a1a 50%,#121212 100%); background-size:200% 100%; animation:shimmer 1.4s linear infinite; }

  .circles-empty { padding:32px 24px 24px; text-align:center; display:flex; flex-direction:column; align-items:center; animation:fadeIn 0.4s ease; }
  .circles-empty-title { font-family:'DM Serif Display',serif; font-size:26px; color:#f0ebe0; }
  .circles-empty-sub { margin-top:6px; font-size:13px; color:#888; max-width:320px; line-height:1.5; }
  .circles-empty-slots { margin-top:24px; display:grid; grid-template-columns:repeat(5, 1fr); gap:10px; width:100%; max-width:280px; }
  .circles-empty-slot { aspect-ratio:1; border-radius:10px; border:1px dashed #222; background:#111; }

  .circles-list { padding:16px 24px 24px; display:flex; flex-direction:column; gap:12px; animation:fadeIn 0.3s ease; }
  .circle-card { position:relative; display:block; width:100%; text-align:left; background:#111; border:1px solid #1e1e1e; border-radius:14px; padding:16px 18px; cursor:pointer; overflow:hidden; transition:transform 0.15s, border-color 0.15s; animation:slideUp 0.35s cubic-bezier(0.16,1,0.3,1); --vibe-accent:#e8c96a; --vibe-tint:#3a2a0a; font-family:'DM Sans',sans-serif; color:inherit; }
  .circle-card:hover { transform:translateY(-2px); border-color:var(--vibe-accent); }
  .circle-card:focus-visible { outline:2px solid var(--vibe-accent); outline-offset:2px; }
  .circle-card__tint { position:absolute; inset:0; background:radial-gradient(120% 100% at 0% 0%, color-mix(in srgb, var(--vibe-tint) 75%, transparent) 0%, transparent 65%); pointer-events:none; opacity:0.85; }
  .circle-card__body { position:relative; z-index:1; display:flex; flex-direction:column; gap:6px; }
  .circle-card__top { display:flex; align-items:center; gap:8px; }
  .circle-card__name { font-family:'DM Serif Display',serif; font-size:22px; color:#f0ebe0; line-height:1.1; flex:1 1 auto; min-width:0; overflow-wrap:anywhere; }
  .circle-card__crown { font-size:16px; flex-shrink:0; }
  .circle-card__desc { font-size:13px; color:#aaa; line-height:1.4; overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .circle-card__meta-row { display:flex; align-items:center; gap:10px; margin-top:4px; flex-wrap:wrap; }
  .circle-card__vibe-badge { display:inline-flex; align-items:center; padding:4px 10px; border-radius:999px; border:1px solid var(--vibe-accent); color:var(--vibe-accent); background:color-mix(in srgb, var(--vibe-accent) 12%, transparent); font-size:11px; font-weight:600; letter-spacing:0.4px; text-transform:uppercase; }
  .circle-card__members { font-size:12px; color:#888; letter-spacing:0.3px; }

  .circles-detail-shell { width:100%; min-width:0; box-sizing:border-box; }
  .circles-detail-topbar {
    padding:12px max(20px, env(safe-area-inset-left, 0px)) 8px max(20px, env(safe-area-inset-right, 0px));
    box-sizing:border-box;
  }
  .circles-detail-back-circle {
    width:40px;
    height:40px;
    border-radius:50%;
    border:1px solid rgba(255,255,255,0.22);
    background:rgba(0,0,0,0.42);
    color:#e8c96a;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    cursor:pointer;
    padding:0;
    flex-shrink:0;
    font-size:17px;
    font-weight:600;
    line-height:1;
    font-family:'DM Sans',sans-serif;
    transition:background 0.15s, border-color 0.15s, color 0.15s;
  }
  .circles-detail-back-circle:hover { background:rgba(0,0,0,0.58); border-color:rgba(232,201,106,0.45); color:#f0dc9a; }
  .circles-detail-back-circle:active { opacity:0.9; }
  .circles-detail-back-circle__glyph { display:block; margin-top:-1px; }
  /* Circle detail: chat-style header — back | avatar + title + member subtitle | (i). Invite is in Circle info modal. */
  .circle-hero--detail .circle-hero__top-bar--detail-chat {
    position:relative;
    z-index:2;
    display:grid;
    grid-template-columns:auto minmax(0, 1fr) auto;
    align-items:center;
    gap:10px;
    padding:max(6px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) 12px max(12px, env(safe-area-inset-left, 0px));
    box-sizing:border-box;
    background:rgba(10,10,10,0.5);
    backdrop-filter:blur(12px);
    -webkit-backdrop-filter:blur(12px);
    border-bottom:1px solid rgba(255,255,255,0.06);
  }
  .circle-hero--detail .circle-hero__top-bar-side--left {
    justify-self:start;
    display:flex;
    align-items:center;
    min-height:36px;
  }
  .circle-hero--detail .circle-hero__top-bar-center {
    justify-self:stretch;
    display:flex;
    align-items:center;
    justify-content:center;
    min-width:0;
    max-width:100%;
    padding:0;
  }
  .circle-hero--detail .circle-hero__identity {
    display:flex;
    flex-direction:row;
    align-items:center;
    justify-content:center;
    gap:10px;
    min-width:0;
    width:100%;
    max-width:100%;
  }
  .circle-hero__avatar {
    width:44px;
    height:44px;
    border-radius:50%;
    flex-shrink:0;
    border:1px solid color-mix(in srgb, var(--vibe-accent, #e8c96a) 55%, transparent);
    background:rgba(0,0,0,0.35);
    display:flex;
    align-items:center;
    justify-content:center;
    box-sizing:border-box;
  }
  .circle-hero__avatar-initials {
    font-family:'DM Sans',sans-serif;
    font-size:14px;
    font-weight:600;
    letter-spacing:0.04em;
    color:var(--vibe-accent, #e8c96a);
  }
  .circle-hero__identity-text {
    min-width:0;
    flex:0 1 auto;
    max-width:calc(100% - 54px);
    display:flex;
    flex-direction:column;
    gap:2px;
    align-items:center;
  }
  .circle-hero--detail .circle-hero__title-line {
    display:flex;
    align-items:center;
    justify-content:center;
    gap:6px;
    min-width:0;
    width:100%;
  }
  .circle-hero--detail .circle-hero__creator-star {
    flex-shrink:0;
    font-size:13px;
    line-height:1;
    color:var(--vibe-accent, #e8c96a);
  }
  .circle-hero--detail .circle-hero__top-bar-side--right {
    justify-self:end;
    display:flex;
    align-items:center;
    flex-shrink:0;
  }
  .circle-hero__subtitle-members {
    display:flex;
    align-items:center;
    justify-content:center;
    gap:5px;
    font-size:12px;
    line-height:1.25;
    color:#9a9690;
    font-family:'DM Sans',sans-serif;
    width:100%;
  }
  .circle-hero__members-icon { display:flex; color:#9a9690; flex-shrink:0; }
  .circle-hero__members-num { font-weight:600; color:#c8c4bc; }
  .circle-hero__members-label { color:#888; }
  .circle-info-invite-block {
    display:flex;
    flex-direction:column;
    align-items:stretch;
    gap:8px;
    margin:12px 0 4px;
  }
  .circle-info-invite-cap {
    margin:0;
    font-size:12px;
    color:#887755;
    line-height:1.35;
    text-align:center;
  }
  .circle-invite-btn--modal { display:flex; align-self:stretch; justify-content:center; }
  .circles-detail-loading { padding:40px max(20px, env(safe-area-inset-left, 0px)) 40px max(20px, env(safe-area-inset-right, 0px)); color:#666; font-size:13px; text-align:center; }
  .circles-detail-error-wrap {
    padding:0 max(20px, env(safe-area-inset-left, 0px)) 20px max(20px, env(safe-area-inset-right, 0px));
    box-sizing:border-box;
  }
  .circles-detail-error-wrap .circles-error-banner { margin-top:0; }
  .circle-hero { position:relative; background:#111; border:1px solid #1e1e1e; border-radius:16px; overflow:hidden; --vibe-accent:#e8c96a; --vibe-tint:#3a2a0a; animation:slideUp 0.35s cubic-bezier(0.16,1,0.3,1); }
  /* Circle detail: full-bleed band so the header feels like the room, not a card in a column. */
  .circle-hero--detail {
    width:100%;
    max-width:none;
    border-radius:0;
    border-left:none;
    border-right:none;
    border-top-color:#1e1e1e;
  }
  /* Single-line title in detail header (full name still in Circle info modal). */
  .circle-hero--detail .circle-hero__name--top-bar {
    flex:0 1 auto;
    min-width:0;
    max-width:100%;
    text-align:center;
    display:block;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    -webkit-line-clamp:unset;
    line-clamp:unset;
    -webkit-box-orient:unset;
  }
  .circle-hero__tint { position:absolute; inset:0; background:linear-gradient(135deg, color-mix(in srgb, var(--vibe-tint) 90%, transparent) 0%, transparent 70%); pointer-events:none; }
  .circle-hero__body { position:relative; z-index:1; padding:24px 20px; display:flex; flex-direction:column; gap:8px; }
  .circle-hero__name-row { display:flex; align-items:center; gap:10px; }
  .circle-hero__name { font-family:'DM Serif Display',serif; font-size:32px; color:#f0ebe0; line-height:1.15; flex:1 1 auto; min-width:0; overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .circle-hero__crown { font-size:22px; flex-shrink:0; }
  .circle-hero__desc { font-size:14px; color:#c8c4bc; line-height:1.5; overflow-wrap:anywhere; }
  .circle-hero__meta-row { display:flex; align-items:center; gap:10px; margin-top:4px; flex-wrap:wrap; }
  .circle-hero__meta-row--one-line { justify-content:space-between; gap:12px; align-items:center; }
  .circle-hero__meta-left { display:flex; align-items:center; gap:10px; flex-wrap:wrap; min-width:0; flex:1 1 auto; }
  .circle-hero__info-btn { flex-shrink:0; background:transparent; border:none; color:#e8c96a; font-size:13px; font-family:'DM Sans',sans-serif; font-weight:600; letter-spacing:0.02em; cursor:pointer; padding:4px 2px; text-decoration:underline; text-underline-offset:3px; align-self:center; }
  .circle-hero__info-btn:hover { color:#f0dc9a; }
  .circle-hero__info-btn.circle-hero__info-btn--icon {
    width:36px;
    height:36px;
    border-radius:50%;
    padding:0;
    border:1px solid rgba(232,201,106,0.45);
    background:rgba(0,0,0,0.35);
    text-decoration:none;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    box-sizing:border-box;
  }
  .circle-hero__info-btn.circle-hero__info-btn--icon:hover {
    border-color:rgba(232,201,106,0.7);
    background:rgba(0,0,0,0.5);
    color:#f0dc9a;
  }
  .circle-hero__info-btn-i {
    font-family:'DM Serif Display',serif;
    font-size:15px;
    font-weight:400;
    font-style:italic;
    line-height:1;
    color:inherit;
  }
  .circle-info-member-list { display:flex; flex-direction:column; gap:12px; margin:8px 0 16px; max-height:min(50vh, 320px); overflow-y:auto; }
  .circle-info-member-row { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:14px; color:#e0dcd4; }
  .circle-info-member-name { min-width:0; overflow-wrap:anywhere; }
  .circle-info-member-badge { flex-shrink:0; font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#888; }
  .circle-info-member-badge--creator { color:#e8c96a; }
  .circle-info-modal-leave { align-self:stretch; margin-top:4px; }

  .circle-detail-body { padding:12px 24px 40px; display:flex; flex-direction:column; gap:20px; }
  .circle-detail-strip-wrap { display:flex; flex-direction:column; gap:18px; }
  .circle-detail-strip-section { margin:0; }
  .circle-detail-strip-header { padding-left:0 !important; padding-right:0 !important; }
  .circle-detail-strip-header--tabs { flex-direction:column; align-items:stretch !important; gap:12px; padding-bottom:4px !important; }
  .circle-detail-ratings-tabs { display:flex; gap:8px; flex-wrap:wrap; width:100%; }
  .circle-detail-ratings-tab {
    flex:1;
    min-width:72px;
    padding:8px 12px;
    border-radius:20px;
    font-size:12px;
    font-family:'DM Sans',sans-serif;
    cursor:pointer;
    border:1px solid #2a2a2a;
    background:transparent;
    color:#888;
    -webkit-appearance:none;
    appearance:none;
    transition:background-color 0.2s, border-color 0.2s, color 0.2s;
  }
  .circle-detail-ratings-tab:hover:not(.circle-detail-ratings-tab--active) { border-color:#555; color:#ccc; }
  .circle-detail-ratings-tab.circle-detail-ratings-tab--active {
    background:#e8c96a;
    color:#0a0a0a;
    border-color:#e8c96a;
    font-weight:500;
  }
  .circle-rated-grid {
    display:grid;
    grid-template-columns:repeat(3, minmax(0, 1fr));
    gap:12px;
    width:100%;
    box-sizing:border-box;
  }
  .circle-rated-grid .disc-card { min-width:0; }
  @media (max-width: 360px) {
    .circle-rated-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  }
  .circle-rated-grid-score { margin-top:4px; }
  .circle-rated-grid-more {
    width:100%;
    box-sizing:border-box;
    margin-top:8px;
    padding:12px 16px;
    border-radius:20px;
    border:1px solid #2a2a2a;
    background:transparent;
    color:#e8c96a;
    font-family:'DM Sans',sans-serif;
    font-size:14px;
    font-weight:500;
    cursor:pointer;
    transition:border-color 0.2s, background 0.2s;
  }
  .circle-rated-grid-more:hover:not(:disabled) { border-color:#e8c96a; background:rgba(232,201,106,0.06); }
  .circle-rated-grid-more:disabled { opacity:0.5; cursor:default; }
  @keyframes circleRatedGridSkel {
    0%, 100% { opacity:0.5; }
    50% { opacity:0.85; }
  }
  .circle-rated-grid-skel {
    border-radius:12px;
    background:#1a1a1a;
    border:1px solid #1e1e1e;
    aspect-ratio:2/3;
    animation:circleRatedGridSkel 1.2s ease-in-out infinite;
  }
  .circle-rated-list {
    padding:0;
    width:100%;
    max-width:100%;
    box-sizing:border-box;
  }
  .circle-rated-list--skel { padding:0 0 8px; }
  .circle-rated-list-row {
    display:flex;
    align-items:center;
    gap:12px;
    width:100%;
    min-width:0;
    box-sizing:border-box;
    padding:12px 24px;
    border-bottom:1px solid #1a1a1a;
    background:none;
    border-left:none;
    border-right:none;
    border-top:none;
    cursor:pointer;
    text-align:left;
    color:inherit;
    font:inherit;
  }
  .circle-rated-list-row:hover { background:rgba(255,255,255,0.03); }
  .circle-rated-list-row:last-child { border-bottom:none; }
  .circle-rated-list-row--pending { opacity:0.85; pointer-events:none; }
  .circle-rated-list-ratings {
    margin-top:4px;
    display:flex;
    flex-wrap:wrap;
    align-items:center;
    gap:6px 8px;
    font-family:'DM Sans',sans-serif;
    font-size:11px;
    line-height:1;
  }
  .circle-rated-list-ratings--empty { color:#555; }
  .circle-rated-list-ratings-sep { color:#444; opacity:0.85; user-select:none; line-height:1; align-self:center; }
  .circle-list-rating { display:inline-flex; align-items:center; flex-wrap:wrap; gap:0 2px; }
  .circle-list-rating__lbl { font-size:10px; letter-spacing:0.04em; text-transform:uppercase; margin-right:3px; }
  .circle-list-rating__star { font-size:10px; line-height:1; margin-right:1px; }
  .circle-list-rating--cine .circle-list-rating__star { font-size:8.5px; line-height:1; margin-right:1px; opacity:0.95; }
  .circle-list-rating__num { font-weight:600; font-family:'DM Sans',sans-serif; line-height:1; }
  .circle-list-rating--circle .circle-gold-ring-mark { width:8px; height:8px; border-width:1.5px; }
  .circle-list-rating--circle .circle-list-rating__num { color:#d4a84a; }
  .circle-list-rating__paren { color:#888; font-weight:600; margin-left:2px; font-size:11px; }
  .circle-list-rating--you .circle-list-rating__lbl { color:#6aaa6a; text-transform:none; font-size:11px; letter-spacing:0.03em; }
  .circle-list-rating--you .circle-list-rating__num { color:#6aaa6a; }
  .circle-list-rating--cine { align-items:center; gap:1px; }
  .circle-list-rating--cine .circle-list-rating__num { color:#e8c96a; }
  /* All / Top: 3 lines — title; type·year; scores */
  .wl-list-title.circle-list-all-top__title {
    display:block !important; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    -webkit-line-clamp:unset !important; -webkit-box-orient:unset !important;
    max-width:100%;
  }
  .circle-list-all-top__type-year {
    font-size:12px; color:#777; font-weight:400; line-height:1.35; margin-top:3px; letter-spacing:0.02em;
    font-family:'DM Sans',sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  .circle-rated-list-skel-row {
    display:flex;
    align-items:center;
    gap:12px;
    padding:12px 24px;
    border-bottom:1px solid #1a1a1a;
  }
  .circle-rated-list-skel-thumb {
    width:48px;
    height:72px;
    border-radius:8px;
    background:#1a1a1a;
    border:1px solid #1e1e1e;
    flex-shrink:0;
    animation:circleRatedGridSkel 1.2s ease-in-out infinite;
  }
  .circle-rated-list-skel-lines { flex:1; min-width:0; display:flex; flex-direction:column; gap:6px; }
  .circle-rated-list-skel-line {
    border-radius:4px;
    background:#1a1a1a;
    animation:circleRatedGridSkel 1.2s ease-in-out infinite;
  }
  .circle-rated-list-skel-line--title { height:14px; width:min(100%, 220px); }
  .circle-rated-list-skel-line--ty { height:10px; width:min(100%, 120px); }
  .circle-rated-list-skel-line--meta { height:11px; width:min(100%, 180px); }
  .circle-detail-strip-block { margin-top:4px; }
  /* Gold hollow ring (circle score) — matches Cinemastro gold accent */
  .circle-gold-ring-mark {
    display:block;
    width:10px; height:10px;
    box-sizing:border-box;
    flex-shrink:0;
    border:1.65px solid rgba(201,162,39,0.88);
    border-radius:50%;
    box-shadow:0 0 0 0.5px rgba(232,201,106,0.2), inset 0 0 0 0.5px rgba(255,220,150,0.12);
    background:transparent;
    /* align to numerals: flex parents use align-items:center; no inline-block baseline drift */
  }
  .circle-list-rating--circle { display:inline-flex; align-items:center; gap:4px; }
  .strip-poster--circle-recent { position:relative; }
  .circle-strip-poster-meta {
    position:absolute; left:5px; bottom:5px; z-index:2;
    max-width:56%;
    font-size:10px; line-height:1.3; letter-spacing:0.02em;
    color:rgba(200, 197, 188, 0.92);
    text-shadow:0 1px 2px rgba(0,0,0,0.75);
    font-family:'DM Sans',sans-serif;
    pointer-events:none;
    padding:3px 6px; border-radius:5px;
    background:rgba(8,8,8,0.55); border:1px solid rgba(255,255,255,0.06);
    box-sizing:border-box;
  }
  /* Under strip title: circle (gold ring) + · + Cinemastro — pill groups with poster badge. */
  .circle-strip-below-title-scores {
    display:flex; align-items:center; justify-content:center; flex-wrap:wrap;
    margin-top:5px; gap:3px; row-gap:2px;
    max-width:100%;
    padding:3px 6px 4px;
    border-radius:10px;
    background:rgba(0,0,0,0.35);
    border:1px solid rgba(201,162,39,0.3);
    font-family:'DM Sans',sans-serif;
    font-size:11px;
    font-weight:600;
    line-height:1;
  }
  .circle-strip-below-title-scores__seg { display:inline-flex; align-items:center; gap:3px; color:#e8c96a; line-height:1; }
  .circle-strip-below-title-scores__seg--cine .cinematch-cine-star {
    font-size:0.68em; line-height:1; margin-right:0.5px; display:block;
    color:#e0c26a; text-shadow:none;
  }
  .circle-strip-below-title-scores__dot { color:#666; font-weight:500; user-select:none; line-height:1; }
  .circle-strip-below-title-scores__num { font-weight:600; line-height:1; }
  .circle-strip-rater-count { font-size:11px; color:#666; margin-top:2px; letter-spacing:0.2px; text-align:center; }
  .circle-strip-comm-line { font-size:11px; color:#888; margin-top:4px; letter-spacing:0.2px; }
  .circle-strip-comm-line--muted { color:#555; }
  .circle-detail-strip-empty { margin:0 !important; }
  .circle-detail-strip-empty .empty-sub { margin-top:8px; font-size:12px; color:#777; line-height:1.45; }
  .circle-strip-cap-hint { font-size:12px; color:#777; line-height:1.5; margin-top:8px; text-align:center; max-width:36em; margin-left:auto; margin-right:auto; }
  .circle-strip-cap-hint button { margin-top:8px; background:transparent; border:none; color:#e8c96a; text-decoration:underline; cursor:pointer; font-size:inherit; padding:0; font-family:inherit; }
  .strip--circle-recent--solo-cta { justify-content:center; }
  .circle-detail-recent-strip-outer { position:relative; width:100%; min-width:0; max-width:100%; }
  .circle-recent-scroll-hint {
    position:absolute; left:4px; top:106px; z-index:3; transform:translateY(-50%); pointer-events:none; display:flex; align-items:center; justify-content:center;
  }
  .circle-recent-scroll-hint__bubble {
    width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-sizing:border-box;
    background:rgba(10,10,10,0.35); border:1px solid rgba(232,201,106,0.2); color:rgba(232,201,106,0.5);
    font-size:17px; font-weight:500; line-height:1; user-select:none; backdrop-filter:blur(4px);
  }
  /* Add control: half-width “poster” column (76 = 152/2), + centered in 212px poster row. */
  .strip-card.strip-card--circle-add-rate {
    width:76px; max-width:76px; flex-shrink:0; border:none; background:transparent; padding:0; font:inherit; cursor:pointer; text-align:left;
    align-self:flex-start; box-sizing:border-box;
  }
  .strip-poster.strip-poster--circle-add-rate-slot { width:76px; min-width:76px; max-width:76px; display:flex; align-items:center; justify-content:center; box-sizing:border-box; }
  .strip-card--circle-add-rate:focus-visible { outline:2px solid #e8c96a; outline-offset:3px; border-radius:12px; }
  .strip-card--circle-add-rate .strip-title,
  .strip-card--circle-add-rate .strip-genre { visibility:hidden; }
  .circle-add-rate-bubble {
    width:36px; height:36px; border-radius:50%; box-sizing:border-box; display:flex; align-items:center; justify-content:center;
    border:1px solid rgba(232,201,106,0.32); background:rgba(232,201,106,0.07); color:rgba(201, 175, 120, 0.72);
    font-family:'DM Sans',sans-serif; font-size:22px; font-weight:300; line-height:1; user-select:none; transition:background 0.15s, border-color 0.15s, color 0.15s; flex-shrink:0;
  }
  .strip-card--circle-add-rate:hover .circle-add-rate-bubble {
    border-color:rgba(232,201,106,0.5); background:rgba(232,201,106,0.12); color:rgba(232, 210, 160, 0.92);
  }
  .strip-card--circle-add-rate:active .circle-add-rate-bubble { opacity:0.92; }
  .strip-card--circle-more { border:none; background:transparent; padding:0; font:inherit; text-align:left; align-self:flex-start; }
  .strip-card--circle-more:focus-visible { outline:2px solid #e8c96a; outline-offset:3px; border-radius:12px; }
  .strip-card--circle-more:disabled { opacity:0.55; cursor:default; }
  .strip-card--circle-more:not(:disabled):hover .circle-strip-more-poster { border-color:#555; background:#1e1e1e; }
  .circle-strip-more-poster { display:flex; align-items:center; justify-content:center; border-style:dashed; }
  .circle-strip-more-arrow { font-size:42px; font-weight:300; color:#e8c96a; line-height:1; user-select:none; }
  .circle-strip-more-spinner { font-size:13px; color:#888; }
  /* Your Picks: end-cap CTA when all batches visible (same footprint as a strip card). */
  .strip-card--your-picks-mood { flex-shrink:0; align-self:flex-start; pointer-events:auto; }
  .your-picks-mood-poster { padding:10px 8px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; }
  .your-picks-mood-inner { display:flex; flex-direction:column; align-items:stretch; justify-content:center; gap:10px; width:100%; min-height:0; }
  .your-picks-mood-copy { margin:0; font-size:11px; line-height:1.45; color:#888; text-align:center; font-family:'DM Sans',sans-serif; }
  .your-picks-mood-cta {
    flex-shrink:0; padding:8px 12px; border-radius:20px; font-size:12px; font-weight:500; font-family:'DM Sans',sans-serif;
    cursor:pointer; border:1px solid #e8c96a; background:#e8c96a; color:#0a0a0a; transition:opacity 0.2s;
  }
  .your-picks-mood-cta:hover { opacity:0.92; }
  .your-picks-mood-cta:active { opacity:0.85; }
  .strip-card--circle-pending { opacity:0.8; pointer-events:none; }
  .circle-detail-placeholder { background:#111; border:1px dashed #222; border-radius:14px; padding:20px; }
  .circle-detail-placeholder__title { font-family:'DM Serif Display',serif; font-size:18px; color:#f0ebe0; margin-bottom:6px; }
  .circle-detail-placeholder__text { font-size:13px; color:#888; line-height:1.5; }
  .circle-leave-btn { background:transparent; color:#e05a5a; border:1px solid #4a1818; padding:12px 20px; border-radius:10px; font-family:'DM Sans',sans-serif; font-size:14px; font-weight:500; cursor:pointer; transition:background 0.15s, border-color 0.15s; align-self:flex-start; }
  .circle-leave-btn:hover:not(:disabled) { background:#1a0808; border-color:#e05a5a; }
  .circle-leave-btn:disabled { opacity:0.5; cursor:default; }

  /* Centered modal (Circle info — overlays main circle view, not a bottom sheet) */
  .circles-modal-root { position:fixed; inset:0; z-index:2300; display:flex; align-items:center; justify-content:center; padding:max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); box-sizing:border-box; animation:fadeIn 0.2s ease; }
  .circles-modal-backdrop { position:absolute; inset:0; background:rgba(0,0,0,0.72); border:none; padding:0; cursor:pointer; }
  .circles-modal-panel { position:relative; width:100%; max-width:min(100%, 400px); max-height:min(85vh, 520px); display:flex; flex-direction:column; gap:12px; background:#141414; border:1px solid #2a2a2a; border-radius:16px; padding:16px 20px 20px; box-sizing:border-box; box-shadow:0 24px 64px rgba(0,0,0,0.55); overflow:hidden; animation:circlesModalIn 0.22s cubic-bezier(0.16,1,0.3,1); }
  @keyframes circlesModalIn { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
  .circles-modal-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-shrink:0; }
  .circles-modal-title { font-family:'DM Serif Display',serif; font-size:22px; color:#f0ebe0; line-height:1.2; margin:0; flex:1; min-width:0; padding-right:4px; }
  .circles-modal-close {
    flex-shrink:0;
    background:transparent;
    border:none;
    color:#888;
    font-size:26px;
    line-height:1;
    width:40px;
    height:40px;
    margin:-8px -10px -4px 0;
    padding:0;
    display:flex;
    align-items:center;
    justify-content:center;
    cursor:pointer;
    border-radius:10px;
    font-family:'DM Sans',sans-serif;
  }
  .circles-modal-close:hover { color:#f0ebe0; background:rgba(255,255,255,0.06); }
  .circles-modal-sub { font-size:13px; color:#888; margin-top:-2px; line-height:1.4; word-break:break-word; }
  .publish-rating-circle-list { max-height:min(45vh, 280px); overflow-y:auto; margin-top:4px; display:flex; flex-direction:column; gap:0; }
  .publish-rating-circle-row { display:flex; align-items:center; gap:12px; padding:10px 4px; border-bottom:1px solid #222; font-family:'DM Sans',sans-serif; font-size:14px; color:#e8e8e8; cursor:pointer; }
  .publish-rating-circle-row:last-child { border-bottom:none; }
  .publish-rating-circle-row input { width:18px; height:18px; accent-color:#e8c96a; cursor:pointer; flex-shrink:0; }

  /* Bottom sheet / confirm shared shell */
  .circles-sheet-root { position:fixed; inset:0; z-index:2200; display:flex; flex-direction:column; justify-content:flex-end; animation:fadeIn 0.2s ease; }
  .circles-sheet-backdrop { position:absolute; inset:0; background:rgba(0,0,0,0.6); border:none; padding:0; cursor:pointer; }
  .circles-sheet, .circles-confirm { position:relative; background:#141414; border-top:1px solid #2a2a2a; border-radius:20px 20px 0 0; padding:12px 20px max(24px, env(safe-area-inset-bottom, 0px)); width:100%; max-width:min(100%, 480px); margin:0 auto; animation:sheetUp 0.35s cubic-bezier(0.16,1,0.3,1); display:flex; flex-direction:column; gap:12px; box-sizing:border-box; box-shadow:0 -12px 32px rgba(0,0,0,0.5); }
  .circles-sheet-handle { width:40px; height:4px; border-radius:2px; background:#333; align-self:center; margin-bottom:4px; }
  .circles-sheet-title { font-family:'DM Serif Display',serif; font-size:24px; color:#f0ebe0; }
  .circles-sheet-sub { font-size:13px; color:#888; margin-top:-6px; }
  .circles-field { display:flex; flex-direction:column; gap:6px; position:relative; }
  .circles-field-label { font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:#888; font-weight:600; }
  .circles-field-required { color:#e8c96a; }
  .circles-input { background:#0f0f0f; border:1px solid #2a2a2a; border-radius:10px; padding:13px 14px; font-family:'DM Sans',sans-serif; font-size:16px; color:#f0ebe0; outline:none; transition:border-color 0.15s; }
  .circles-input:focus { border-color:#e8c96a; }
  .circles-input:disabled { opacity:0.6; }
  .circles-textarea { background:#0f0f0f; border:1px solid #2a2a2a; border-radius:10px; padding:12px 14px; font-family:'DM Sans',sans-serif; font-size:15px; color:#f0ebe0; outline:none; transition:border-color 0.15s; resize:vertical; min-height:60px; }
  .circles-textarea:focus { border-color:#e8c96a; }
  .circles-textarea:disabled { opacity:0.6; }
  .circles-field-count { position:absolute; top:0; right:0; font-size:11px; color:#555; font-family:'DM Sans',sans-serif; }
  .circles-sheet-actions { display:flex; gap:10px; margin-top:8px; }
  .circles-btn-primary { flex:2; background:#e8c96a; color:#0a0a0a; border:none; padding:14px; font-family:'DM Sans',sans-serif; font-size:15px; font-weight:600; border-radius:10px; cursor:pointer; transition:background 0.15s; }
  .circles-btn-primary:hover:not(:disabled) { background:#f0d880; }
  .circles-btn-primary:disabled { opacity:0.4; cursor:default; }
  .circles-btn-ghost { flex:1; background:#1a1a1a; color:#c8c4bc; border:1px solid #2a2a2a; padding:14px; font-family:'DM Sans',sans-serif; font-size:14px; border-radius:10px; cursor:pointer; transition:border-color 0.15s, color 0.15s; }
  .circles-btn-ghost:hover:not(:disabled) { border-color:#444; color:#f0ebe0; }
  .circles-btn-ghost:disabled { opacity:0.5; cursor:default; }
  .circles-btn-danger { flex:2; background:#e05a5a; color:#0a0a0a; border:none; padding:14px; font-family:'DM Sans',sans-serif; font-size:15px; font-weight:600; border-radius:10px; cursor:pointer; transition:background 0.15s; }
  .circles-btn-danger:hover:not(:disabled) { background:#ee7a7a; }
  .circles-btn-danger:disabled { opacity:0.5; cursor:default; }
  .circles-confirm-title { font-family:'DM Serif Display',serif; font-size:22px; color:#f0ebe0; }
  .circles-confirm-text { font-size:14px; color:#c8c4bc; line-height:1.5; }

  @media (max-width: 420px) {
    .circle-card__name { font-size:20px; }
    .circle-hero__name { font-size:26px; }
  }

  /* =============================================================================================
     Circles Phase B (v5.1.0) — invites
     ============================================================================================= */
  .circles-bell--active { border-color:#e8c96a; color:#0a0a0a; background:#e8c96a; }
  .circles-bell--active:hover { background:#f0d880; }
  .circles-bell--active .circles-bell-count { color:#0a0a0a; font-weight:700; }

  .circle-invite-btn { align-self:flex-start; background:#141414; border:1px solid #2a2a2a; color:#e8c96a; padding:10px 18px; border-radius:999px; font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600; letter-spacing:0.3px; cursor:pointer; transition:border-color 0.15s, background 0.15s; }
  .circle-invite-btn:hover:not(:disabled) { border-color:#e8c96a; background:#1a1608; }
  .circle-invite-btn:disabled { opacity:0.4; cursor:default; }

  .invites-panel-root { position:fixed; inset:0; z-index:2250; display:flex; flex-direction:column; justify-content:flex-start; animation:fadeIn 0.2s ease; }
  .invites-panel-backdrop { position:absolute; inset:0; background:rgba(0,0,0,0.6); border:none; padding:0; cursor:pointer; }
  .invites-panel { position:relative; background:#141414; border-bottom:1px solid #2a2a2a; border-radius:0 0 20px 20px; padding:16px 20px 20px; width:100%; max-width:min(100%, 520px); margin:0 auto; max-height:85vh; overflow-y:auto; animation:slideDown 0.3s cubic-bezier(0.16,1,0.3,1); box-sizing:border-box; box-shadow:0 12px 32px rgba(0,0,0,0.5); display:flex; flex-direction:column; gap:14px; }
  @keyframes slideDown { from{opacity:0;transform:translateY(-24px)} to{opacity:1;transform:translateY(0)} }
  .invites-panel-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .invites-panel-title { font-family:'DM Serif Display',serif; font-size:22px; color:#f0ebe0; }
  .invites-panel-close { background:transparent; color:#888; border:none; font-size:20px; cursor:pointer; padding:4px 10px; border-radius:8px; line-height:1; }
  .invites-panel-close:hover { color:#f0ebe0; background:#1a1a1a; }
  .invites-empty { padding:20px 4px; text-align:center; color:#888; }
  .invites-empty-title { font-family:'DM Serif Display',serif; font-size:18px; color:#c8c4bc; margin-bottom:4px; }
  .invites-empty-sub { font-size:13px; color:#777; line-height:1.4; }
  .invites-list { display:flex; flex-direction:column; gap:12px; }
  .invite-card { position:relative; background:#111; border:1px solid #1e1e1e; border-radius:14px; padding:14px 16px; overflow:hidden; --vibe-accent:#e8c96a; --vibe-tint:#3a2a0a; animation:slideUp 0.3s cubic-bezier(0.16,1,0.3,1); }
  .invite-card__tint { position:absolute; inset:0; background:radial-gradient(120% 100% at 0% 0%, color-mix(in srgb, var(--vibe-tint) 65%, transparent) 0%, transparent 65%); pointer-events:none; opacity:0.85; }
  .invite-card__body { position:relative; z-index:1; display:flex; flex-direction:column; gap:6px; }
  .invite-card__sender { font-size:12px; color:#aaa; letter-spacing:0.2px; }
  .invite-card__sender-name { color:var(--vibe-accent); font-weight:600; }
  .invite-card__sender-verb { color:#888; }
  .invite-card__circle-name { font-family:'DM Serif Display',serif; font-size:20px; color:#f0ebe0; line-height:1.15; overflow-wrap:anywhere; }
  .invite-card__meta-row { display:flex; align-items:center; gap:10px; margin-top:2px; flex-wrap:wrap; }
  .invite-card__actions { display:flex; gap:10px; margin-top:10px; }
  .invite-card__actions .circles-btn-primary,
  .invite-card__actions .circles-btn-ghost { padding:10px 14px; font-size:13px; }
  .invite-card__actions .circles-btn-primary { flex:1.4; }
  .invite-card__actions .circles-btn-ghost { flex:1; }
  .invite-card__cap-hint { margin-top:6px; font-size:12px; color:#e8c96a; opacity:0.85; }

  .circles-toast { position:fixed; left:50%; bottom:max(96px, env(safe-area-inset-bottom, 0px) + 88px); transform:translateX(-50%); background:#111; border:1px solid #2a2a2a; color:#f0ebe0; padding:12px 18px; border-radius:999px; font-family:'DM Sans',sans-serif; font-size:13px; box-shadow:0 8px 24px rgba(0,0,0,0.4); z-index:2400; animation:toastSlide 0.3s cubic-bezier(0.16,1,0.3,1); max-width:min(90vw, 460px); text-align:center; }
  .circles-toast--ok { border-color:#3d5a3d; }
  .circles-toast--warn { border-color:#4a3e12; color:#e8c96a; }
  @keyframes toastSlide { from{opacity:0;transform:translate(-50%, 12px)} to{opacity:1;transform:translate(-50%, 0)} }
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
                {p.logo_path && (
                  <img
                    src={`https://image.tmdb.org/t/p/original${p.logo_path}`}
                    alt={p.provider_name}
                    loading="lazy"
                    decoding="async"
                  />
                )}
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

/** Phase C circle strip: resolve poster row from catalogue or TMDB hydrate map. */
function circleStripResolveMovie(row, movieLookupById, circleStripExtraMovies) {
  const id = `${String(row.media_type)}-${Number(row.tmdb_id)}`;
  return movieLookupById.get(id) ?? circleStripExtraMovies.get(id) ?? null;
}

/** `openDetail` prediction payload from Edge `prediction` object (null if user already rated). */
function circleStripPredictionForDetail(row) {
  if (row.viewer_score != null && Number.isFinite(Number(row.viewer_score))) return null;
  const p = row.prediction;
  if (!p || typeof p.predicted !== "number") return null;
  return {
    predicted: p.predicted,
    low: typeof p.low === "number" ? p.low : Math.max(1, Math.round((p.predicted - 1) * 10) / 10),
    high: typeof p.high === "number" ? p.high : Math.min(10, Math.round((p.predicted + 1) * 10) / 10),
    neighborCount: Number(p.neighborCount ?? p.neighbor_count ?? 0),
    confidence: p.confidence ?? "low",
  };
}

function formatScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return (Math.round(x * 10) / 10).toFixed(1);
}

/** v3.1.0: Map value is `{ avgScore, ratingCount }` (legacy session may still have a bare number for avg only). */
function cinemastroEntryAvg(entry) {
  if (entry == null) return undefined;
  if (typeof entry === "number") return Number.isFinite(entry) ? entry : undefined;
  const a = Number(entry.avgScore);
  return Number.isFinite(a) ? a : undefined;
}

function cinemastroEntryCount(entry) {
  if (entry == null || typeof entry === "number") return undefined;
  const n = Number(entry.ratingCount);
  return Number.isFinite(n) ? n : undefined;
}

/** Discrete fill % for gold underline meter (tiers by community sample size). */
function cinemastroCommunityFillPercent(count) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return null;
  if (n <= 49) return 0;
  if (n <= 200) return 20;
  if (n <= 500) return 40;
  if (n <= 1500) return 70;
  if (n <= 3500) return 90;
  return 100;
}

function CinemastroVoteMeter({ count, className = "" }) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 1) return null;
  const pct = cinemastroCommunityFillPercent(n);
  if (pct == null) return null;
  const label = `${formatPublicStat(n)} Cinematch ratings`;
  return (
    <div
      className={`cinemastro-vote-meter${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <div className="cinemastro-vote-meter-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * v3.5.1: Poster / Discover / mood badge priority — user rating, then personal prediction, then community.
 * `pillClass` adds source-specific accents (Cinemastro gold, predicted blue).
 */
function stripBadgeDisplay(
  movie,
  userRating,
  predicted,
  cinemastroAvgByKey,
  predictedNeighborCount = 0,
  preferPersonalPredicted = false,
) {
  if (userRating != null && Number.isFinite(Number(userRating))) {
    return {
      text: `★ ${formatScore(userRating)}`,
      title: "Your rating",
      color: "#88cc88",
      pillClass: "",
      cinemastroCount: null,
    };
  }
  if (predicted != null && Number.isFinite(Number(predicted)) && Number(predictedNeighborCount) >= 1) {
    return {
      text: formatScore(predicted),
      title: "Predicted for you",
      color: "#3b82f6",
      pillClass: "strip-badge--predicted",
      cinemastroCount: null,
    };
  }
  if (
    preferPersonalPredicted &&
    predicted != null &&
    Number.isFinite(Number(predicted)) &&
    Number(predictedNeighborCount) < 1
  ) {
    return {
      text: formatScore(predicted),
      title: "Predicted for you (refines as more neighbors overlap)",
      color: "#60a5fa",
      pillClass: "strip-badge--predicted-provisional",
      cinemastroCount: null,
    };
  }
  const key = mediaIdKey(movie);
  const entry = key != null ? cinemastroAvgByKey[key] : undefined;
  const cAvg = cinemastroEntryAvg(entry);
  const cCount = cinemastroEntryCount(entry);
  if (typeof cAvg === "number" && Number.isFinite(cAvg)) {
    return {
      text: formatScore(cAvg),
      title:
        cCount != null && cCount > 0
          ? `Cinemastro rating · ${formatPublicStat(cCount)} ratings`
          : "Cinemastro rating",
      color: "#e8c96a",
      pillClass: "strip-badge--cinemastro",
      cinemastroCount: cCount ?? null,
    };
  }
  const tmdb = movie?.tmdbRating;
  if (tmdb != null && Number.isFinite(Number(tmdb))) {
    return {
      text: formatScore(Number(tmdb)),
      title: "TMDB average",
      color: "#e8c96a",
      pillClass: "",
      cinemastroCount: null,
    };
  }
  return { text: "—", title: "", color: "#e8c96a", pillClass: "", cinemastroCount: null };
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

/** Circle All/Top list: year segment for `Title · YYYY` (matches strip year rules). */
function formatCircleListYear(movie, tvMetaByTmdbId) {
  if (!movie) return "—";
  if (movie.type === "tv") {
    const meta = movie.tmdbId != null ? tvMetaByTmdbId?.[movie.tmdbId] : null;
    const y = meta?.latestYear ?? movie.year;
    if (y != null && String(y).trim() !== "") return String(y);
    return "—";
  }
  if (movie.year != null && String(movie.year).trim() !== "") return String(movie.year);
  const rd = movie.releaseDate;
  if (rd && /^\d{4}/.test(String(rd))) return String(rd).slice(0, 4);
  return "—";
}

/** Inline `Movie · YYYY` / `TV · YYYY` for circle title rows (same year rules as list year). */
function formatCircleTypeYearShort(movie, tvMetaByTmdbId) {
  if (!movie) return "· —";
  const kind = movie.type === "tv" ? "TV" : "Movie";
  return `${kind} · ${formatCircleListYear(movie, tvMetaByTmdbId)}`;
}

/**
 * Circles — Recent strip: under the title — gold ring + circle score · smaller ⭐ + Cinemastro (row fields).
 * Omits if both scores are missing.
 */
function CircleStripRingCineBelowTitle({ groupRating, siteRating }) {
  const hasGr = groupRating != null && Number.isFinite(Number(groupRating));
  const hasSr = siteRating != null && Number.isFinite(Number(siteRating));
  if (!hasGr && !hasSr) return null;
  const a11y = [
    hasGr ? `Circle ${formatScore(Number(groupRating))}` : null,
    hasSr ? `Cinemastro ${formatScore(Number(siteRating))}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="circle-strip-below-title-scores" title={a11y} aria-label={a11y}>
      {hasGr ? (
        <span className="circle-strip-below-title-scores__seg circle-strip-below-title-scores__seg--circle">
          <span className="circle-gold-ring-mark" aria-hidden="true" />
          <span className="circle-strip-below-title-scores__num">{formatScore(Number(groupRating))}</span>
        </span>
      ) : null}
      {hasGr && hasSr ? (
        <span className="circle-strip-below-title-scores__dot" aria-hidden="true">
          ·
        </span>
      ) : null}
      {hasSr ? (
        <span className="circle-strip-below-title-scores__seg circle-strip-below-title-scores__seg--cine">
          <span className="cinematch-cine-star" aria-hidden="true">⭐</span>
          <span className="circle-strip-below-title-scores__num">{formatScore(Number(siteRating))}</span>
        </span>
      ) : null}
    </div>
  );
}

/** Circle All/Top list row: ring+Circle score · smaller ★+Cinemastro · “You”+score (order; omit when missing). */
function CircleAllTopRatingsLine({ row, showRaterParen }) {
  const gr = row.group_rating;
  const vs = row.viewer_score;
  const sr = row.site_rating;
  const distinctRaters = Number(row.distinct_circle_raters ?? 0);
  const hasCircle = gr != null && Number.isFinite(Number(gr));
  const hasYou = vs != null && Number.isFinite(Number(vs));
  const hasCine = sr != null && Number.isFinite(Number(sr));
  const showParen = Boolean(showRaterParen) && hasCircle && distinctRaters > 0;
  const nodes = [];
  if (hasCircle) {
    nodes.push(
      <span
        key="c"
        className="circle-list-rating circle-list-rating--circle"
        aria-label={
          showParen
            ? `Circle score ${formatScore(Number(gr))}, ${distinctRaters} rated in this circle`
            : `Circle score ${formatScore(Number(gr))}`
        }
      >
        <span className="circle-gold-ring-mark" aria-hidden="true" />
        <span className="circle-list-rating__num">{formatScore(Number(gr))}</span>
        {showParen ? (
          <span className="circle-list-rating__paren" aria-hidden="true">
            ({distinctRaters})
          </span>
        ) : null}
      </span>,
    );
  }
  if (hasCine) {
    nodes.push(
      <span key="s" className="circle-list-rating circle-list-rating--cine">
        <span className="circle-list-rating__star" aria-hidden="true">⭐</span>
        <span className="circle-list-rating__num">{formatScore(Number(sr))}</span>
      </span>,
    );
  }
  if (hasYou) {
    nodes.push(
      <span key="y" className="circle-list-rating circle-list-rating--you">
        <span className="circle-list-rating__lbl">You</span>
        <span className="circle-list-rating__num">{formatScore(Number(vs))}</span>
      </span>,
    );
  }
  if (nodes.length === 0) {
    return <div className="circle-rated-list-ratings circle-rated-list-ratings--empty">—</div>;
  }
  const out = [];
  for (let i = 0; i < nodes.length; i += 1) {
    if (i > 0) {
      out.push(
        <span key={`sep-${i}`} className="circle-rated-list-ratings-sep" aria-hidden="true">
          ·
        </span>,
      );
    }
    out.push(nodes[i]);
  }
  return <div className="circle-rated-list-ratings">{out}</div>;
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
  /** Open ⋯ menu row id on Watchlist screen (single flyout). */
  const [watchlistRowMenuId, setWatchlistRowMenuId] = useState(null);
  const [selectedToWatch, setSelectedToWatch] = useState({});
  const [selectedMovie, setSelected] = useState(null);
  const [detailRating, setDetailRating] = useState(5);
  const [detailTouched, setDetailTouched] = useState(false);
  const [detailEditRating, setDetailEditRating] = useState(false);
  const [rateMoreMovies, setRateMoreMovies] = useState([]);
  const [rateMoreContextMovieId, setRateMoreContextMovieId] = useState(null);
  const [rateSimilarLoading, setRateSimilarLoading] = useState(false);
  const [rateSimilarError, setRateSimilarError] = useState("");
  const [ratedSearchQuery, setRatedSearchQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearchQuery, setAppliedSearchQuery] = useState("");
  const discoverSearchInputRef = useRef(null);
  const [activeFilter, setActiveFilter] = useState("All");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [moodStep, setMoodStep] = useState(0);
  const [moodSelections, setMoodSelections] = useState({ region: [], indian_lang: [], genre: [], vibe: [] });
  const [moodResults, setMoodResults] = useState([]);
  const [topPickOffset, setTopPickOffset] = useState(0);
  /** Your Picks: visible count = min(pool, 20, step × YOUR_PICKS_BATCH_SIZE). */
  const [yourPicksBatchStep, setYourPicksBatchStep] = useState(1);
  /** `predict_cached` over popular unrated catalogue rows (neighbor-backed preds merged into For you). */
  const [yourPicksCatalogPredictions, setYourPicksCatalogPredictions] = useState({});
  const [inTheaters, setInTheaters] = useState([]);
  const [streamingMovies, setStreamingMovies] = useState([]);
  const [streamingTV, setStreamingTV] = useState([]);
  /** Two-phase streaming fetch: movies first, then TV (+ /tv/{id} details). */
  const [streamingMoviesReady, setStreamingMoviesReady] = useState(false);
  const [streamingTvReady, setStreamingTvReady] = useState(false);
  const [whatsHot, setWhatsHot] = useState([]);
  const [_whatsHotReady, setWhatsHotReady] = useState(false);
  const [pulseTrending, setPulseTrending] = useState([]);
  const [pulsePopular, setPulsePopular] = useState([]);
  const [pulseCatalogReady, setPulseCatalogReady] = useState(false);
  /** Same US theatrical pool as {@link inTheaters}, sorted by TMDB popularity (In Theaters page second strip). */
  const [inTheatersPopularRanked, setInTheatersPopularRanked] = useState([]);
  const [streamingTab, setStreamingTab] = useState("tv"); // "movie" | "tv"
  const [selectedStreamingProviderIds, setSelectedStreamingProviderIds] = useState([]);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  // v5.0.0: Circles page state (Phase A — no Edge functions, direct supabase client calls).
  const [circlesList, setCirclesList] = useState([]);
  const [circlesLoading, setCirclesLoading] = useState(false);
  const [circlesError, setCirclesError] = useState("");
  const [circlesLoaded, setCirclesLoaded] = useState(false);
  const [showCreateCircleSheet, setShowCreateCircleSheet] = useState(false);
  const [createCircleName, setCreateCircleName] = useState("");
  const [createCircleDescription, setCreateCircleDescription] = useState("");
  const [createCircleVibe, setCreateCircleVibe] = useState("Mixed Bag");
  const [createCircleSubmitting, setCreateCircleSubmitting] = useState(false);
  const [createCircleError, setCreateCircleError] = useState("");
  const [selectedCircleId, setSelectedCircleId] = useState(null);
  const [circleDetailData, setCircleDetailData] = useState(null);
  const [circleDetailLoading, setCircleDetailLoading] = useState(false);
  const [circleDetailError, setCircleDetailError] = useState("");
  /** Phase C: `get-circle-rated-titles` payload + TMDB rows not yet in `movieLookupById`. */
  const [circleStripPayload, setCircleStripPayload] = useState(null);
  const [circleStripLoading, setCircleStripLoading] = useState(false);
  const [circleStripLoadingMore, setCircleStripLoadingMore] = useState(false);
  const [circleStripError, setCircleStripError] = useState("");
  /** Recent strip: more content exists to the left of current scroll (center-on-land). */
  const [circleRecentLeftScrollHint, setCircleRecentLeftScrollHint] = useState(false);
  const [circleStripExtraMovies, setCircleStripExtraMovies] = useState(() => new Map());
  /** Circle detail rated block: recent (horizontal strip) | all | top (grids). */
  const [circleRatingsView, setCircleRatingsView] = useState("recent");
  const [circleGridAllPayload, setCircleGridAllPayload] = useState(null);
  const [circleGridAllLoading, setCircleGridAllLoading] = useState(false);
  const [circleGridAllLoadingMore, setCircleGridAllLoadingMore] = useState(false);
  const [circleGridAllError, setCircleGridAllError] = useState("");
  const [circleGridTopPayload, setCircleGridTopPayload] = useState(null);
  const [circleGridTopLoading, setCircleGridTopLoading] = useState(false);
  const [circleGridTopLoadingMore, setCircleGridTopLoadingMore] = useState(false);
  const [circleGridTopError, setCircleGridTopError] = useState("");
  const [leaveCircleBusy, setLeaveCircleBusy] = useState(false);
  const [leaveCircleError, setLeaveCircleError] = useState("");
  const [leaveConfirmCircle, setLeaveConfirmCircle] = useState(null);
  /** After first-time rating: pick circles to publish. Manage: edit publish set. */
  const [publishRatingModal, setPublishRatingModal] = useState(null);
  const [publishModalBusy, setPublishModalBusy] = useState(false);
  const [publishModalError, setPublishModalError] = useState("");
  const [publishModalSelection, setPublishModalSelection] = useState(() => new Set());
  const [circleRatedRefreshKey, setCircleRatedRefreshKey] = useState(0);
  /** Recent strip: which row key has the ⋯ / long-press menu open. */
  const [circleRecentStripMenuRowKey, setCircleRecentStripMenuRowKey] = useState(null);
  const circleRecentStripLongPressTimerRef = useRef(null);
  const circleRecentStripLongPressStartRef = useRef({ x: 0, y: 0 });
  const circleRecentStripSuppressClickRef = useRef(false);
  const [circleStripUnpublishBusy, setCircleStripUnpublishBusy] = useState(false);
  const [showCircleInfoSheet, setShowCircleInfoSheet] = useState(false);
  /** `user_id` → display name for Circle info sheet (`get_circle_member_names` RPC + profiles fallback). */
  const [circleInfoNamesById, setCircleInfoNamesById] = useState({});
  // v5.1.0: Circles Phase B — invites.
  const [pendingInvites, setPendingInvites] = useState([]);
  const [pendingInvitesLoaded, setPendingInvitesLoaded] = useState(false);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
  const [pendingInvitesError, setPendingInvitesError] = useState("");
  const [showInvitesPanel, setShowInvitesPanel] = useState(false);
  /** Map<inviteId, "accepting" | "declining">. Per-invite, so multiple rows can animate. */
  const [inviteActionBusy, setInviteActionBusy] = useState({});
  const [inviteActionError, setInviteActionError] = useState("");
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [inviteEmailDraft, setInviteEmailDraft] = useState("");
  const [inviteSheetSubmitting, setInviteSheetSubmitting] = useState(false);
  const [inviteSheetError, setInviteSheetError] = useState("");
  const [inviteToast, setInviteToast] = useState(null);
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
  /** v3.1.0: `movie-${tmdbId}` → `{ avgScore, ratingCount }` from `get_cinemastro_title_avgs` (badges prefer over TMDB). */
  const [cinemastroAvgByKey, setCinemastroAvgByKey] = useState({});
  /** Latest title keys for Cinemastro batch RPC (read when debounced fetch runs, not when effect first fires). */
  const cinemastroFetchKeysRef = useRef([]);

  /** When set, opening title detail from Discover returns to `circle-detail` after rating/back (see `openDetail`). */
  const rateTitleReturnCircleIdRef = useRef(null);
  /** Recent strip: horizontal scroller, newest title ref (for “center on land”), add CTA when empty, skip re-center after “load more”. */
  const circleRecentStripRef = useRef(null);
  const circleRecentNewestRef = useRef(null);
  const circleRecentAddCtaRef = useRef(null);
  const circleRecentSkipScrollAfterLoadMoreRef = useRef(false);
  /** Browser Back should return to the in-app screen that opened detail, not leave the site (SPA history). */
  const detailReturnScreenRef = useRef(null);
  const detailHistoryPushedRef = useRef(false);
  const legalReturnScreenRef = useRef(null);
  const legalHistoryPushedRef = useRef(false);
  /** True after we applied `?detail=` from the address bar (no extra pushState). */
  const deepLinkDetailAppliedRef = useRef(false);
  const deepLinkLegalAppliedRef = useRef(false);
  const screenRef = useRef(screen);
  /** Deferred single-user neighbor recompute after rating writes. */
  const computeNeighborsTimerRef = useRef(null);
  const computeNeighborsPendingRef = useRef(false);
  const computeNeighborsInFlightRef = useRef(false);
  const attemptedRatedHydrationRef = useRef(new Set());
  const worthProviderCacheRef = useRef(new Map());
  const tvStripMetaCacheRef = useRef(new Map());
  const [tvStripMetaByTmdbId, setTvStripMetaByTmdbId] = useState({});
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    if (screen !== "discover" && screen !== "detail") {
      rateTitleReturnCircleIdRef.current = null;
    }
  }, [screen]);

  function shouldDeferComputeNeighbors() {
    const s = screenRef.current;
    return s === "onboarding" || s === "rate-more" || s === "loading-recs";
  }

  async function runComputeNeighborsNow() {
    if (!user || computeNeighborsInFlightRef.current) return;
    computeNeighborsPendingRef.current = false;
    computeNeighborsInFlightRef.current = true;
    try {
      const { data, error } = await supabase.functions.invoke("compute-neighbors", {
        body: { userId: user.id },
      });
      if (error) console.warn("compute-neighbors invoke failed:", error.message);
      else if (data && data.ok === false) {
        const bad = Array.isArray(data.results) ? data.results.filter((r) => !r.ok) : [];
        console.warn(
          "compute-neighbors finished with failures (user_neighbors may be empty until this succeeds):",
          bad.length ? bad : data,
        );
      } else if (data?.ok === true && Array.isArray(data.results)) {
        const mine = data.results.find((r) => r.userId === user.id);
        if (mine?.ok === true && mine.stored === 0) {
          console.warn(
            "compute-neighbors stored 0 neighbors for this user (check Edge logs / overlap). candidates:",
            mine.candidates,
          );
        }
      }
    } catch (e) {
      console.warn("compute-neighbors invoke failed:", e);
    } finally {
      computeNeighborsInFlightRef.current = false;
      if (computeNeighborsPendingRef.current && !shouldDeferComputeNeighbors()) {
        void runComputeNeighborsNow();
      }
    }
  }

  /** Debounce ratings outside onboarding; defer entirely while onboarding/rate-more is active. */
  function scheduleComputeNeighborsRebuild() {
    if (!user) return;
    computeNeighborsPendingRef.current = true;
    if (shouldDeferComputeNeighbors()) return;
    if (computeNeighborsTimerRef.current) clearTimeout(computeNeighborsTimerRef.current);
    computeNeighborsTimerRef.current = setTimeout(() => {
      computeNeighborsTimerRef.current = null;
      if (computeNeighborsPendingRef.current) void runComputeNeighborsNow();
    }, 8000);
  }

  /** Flush deferred recompute once onboarding/rate-more/loading exits. */
  useEffect(() => {
    if (!user) return;
    if (!computeNeighborsPendingRef.current || shouldDeferComputeNeighbors()) return;
    if (computeNeighborsTimerRef.current) clearTimeout(computeNeighborsTimerRef.current);
    computeNeighborsTimerRef.current = setTimeout(() => {
      computeNeighborsTimerRef.current = null;
      if (computeNeighborsPendingRef.current) void runComputeNeighborsNow();
    }, 1000);
  }, [screen, user]);

  useEffect(() => () => {
    if (computeNeighborsTimerRef.current) clearTimeout(computeNeighborsTimerRef.current);
  }, []);

  /** TMDB detail: tagline, genres, US certification, runtime, release — for facts bar + caption. */
  const [detailMeta, setDetailMeta] = useState({
    tagline: null,
    genresLine: null,
    certification: null,
    runtimeLabel: null,
    releaseLabel: null,
  });
  useEffect(() => {
    if (screen !== "detail" || !selectedMovie?.movie) {
      setDetailMeta({
        tagline: null,
        genresLine: null,
        certification: null,
        runtimeLabel: null,
        releaseLabel: null,
      });
      return;
    }
    const m = selectedMovie.movie;
    setDetailMeta({
      tagline: null,
      genresLine: null,
      certification: null,
      runtimeLabel: null,
      releaseLabel: null,
    });
    let cancelled = false;
    const type = m.type === "tv" ? "tv" : "movie";
    const append = type === "tv" ? "content_ratings" : "release_dates";
    void (async () => {
      const raw = await fetchTMDB(`/${type}/${m.tmdbId}?language=en-US&append_to_response=${append}`);
      if (cancelled) return;
      setDetailMeta(detailMetaFromTmdbDetail(raw, type));
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only refetch when detail title id changes
  }, [screen, selectedMovie?.movie?.id]);

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
  }, [screen, searching, appliedSearchQuery]);

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
      /* Safari tab resume: token refresh should not reset `user` or retrigger match/catalogue effects. */
      if (event === "TOKEN_REFRESHED") return;
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
        const [data, th] = await Promise.all([fetchCataloguePhasePopular(), fetchInTheaters([])]);
        if (cancelled) return;
        const seen = new Set(data.map(m => m.id));
        const pool = [...th.nowPlaying, ...th.popularInTheaters];
        const addedTheaters = pool.filter((m) => !seen.has(m.id));
        const merged = [...data, ...addedTheaters];
        setCatalogue(merged);
        setObCatalogue(data);
        setInTheaters(th.nowPlaying);
        setInTheatersPopularRanked(th.popularInTheaters);
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
        const th = await fetchInTheaters(showRegionKeys);
        if (cancelled) return;
        setInTheaters(th.nowPlaying);
        setInTheatersPopularRanked(th.popularInTheaters);
        setCatalogue((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const pool = [...th.nowPlaying, ...th.popularInTheaters];
          const added = pool.filter((m) => !seen.has(m.id));
          if (added.length === 0) return prev;
          return [...prev, ...added];
        });
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, [user, showRegionKeys]);

  /** Streaming page: US subscription-style pools (phase 1 = movies, phase 2 = TV + details). Not tied to profile provider picks (see More). */
  useEffect(() => {
    if (!user || screen !== "streaming-page") return;
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
    }, STREAMING_PAGE_FETCH_DEFER_MS);
    return () => {
      cancelled = true;
      clearTimeout(defer);
    };
  }, [user, showRegionKeys, screen]);

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

  /** Pulse page: week trending + global popular (TMDB only on wire; match scores via predict_cached). */
  useEffect(() => {
    if (!user || screen !== "pulse") return;
    let cancelled = false;
    setPulseCatalogReady(false);
    const defer = setTimeout(() => {
      (async () => {
        const [trendingRows, popularRows] = await Promise.all([
          fetchPulseTrendingCatalog(),
          fetchPulsePopularCatalog(),
        ]);
        if (cancelled) return;
        setPulseTrending(trendingRows);
        setPulsePopular(popularRows);
        setCatalogue((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const added = [...trendingRows, ...popularRows].filter((m) => !seen.has(m.id));
          if (added.length === 0) return prev;
          return [...prev, ...added];
        });
        setPulseCatalogReady(true);
      })();
    }, WHATS_HOT_FETCH_DEFER_MS);
    return () => {
      cancelled = true;
      clearTimeout(defer);
    };
  }, [user, screen]);

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

  const whatsHotRecsResolved = useMemo(() => {
    const fromMatch = matchData?.whatsHotRecs;
    if (fromMatch?.length) return fromMatch;
    return whatsHotForRecs.map((m) => tmdbOnlyRec(m));
  }, [matchData?.whatsHotRecs, whatsHotForRecs]);

  const pulseTrendingForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return pulseTrending;
    return pulseTrending.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [pulseTrending, user, showGenreIds, showRegionKeys]);

  const pulsePopularForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return pulsePopular;
    return pulsePopular.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [pulsePopular, user, showGenreIds, showRegionKeys]);

  const pulseTrendingRecsResolved = useMemo(() => {
    const fromMatch = matchData?.pulseTrendingRecs;
    if (fromMatch?.length) return fromMatch;
    return pulseTrendingForRecs.map((m) => tmdbOnlyRec(m));
  }, [matchData?.pulseTrendingRecs, pulseTrendingForRecs]);

  const pulsePopularRecsResolved = useMemo(() => {
    const fromMatch = matchData?.pulsePopularRecs;
    if (fromMatch?.length) return fromMatch;
    return pulsePopularForRecs.map((m) => tmdbOnlyRec(m));
  }, [matchData?.pulsePopularRecs, pulsePopularForRecs]);

  const inTheatersPagePopularForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return inTheatersPopularRanked;
    return inTheatersPopularRanked.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [inTheatersPopularRanked, user, showGenreIds, showRegionKeys]);

  const inTheatersPagePopularRecsResolved = useMemo(() => {
    const fromMatch = matchData?.inTheatersPagePopularRecs;
    if (fromMatch?.length) return fromMatch;
    return inTheatersPagePopularForRecs.map((m) => tmdbOnlyRec(m));
  }, [matchData?.inTheatersPagePopularRecs, inTheatersPagePopularForRecs]);

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

  /** For `?detail=` deep links: resolve media id once catalogue / strips are hydrated. */
  const movieLookupById = useMemo(() => {
    const map = new Map();
    const add = (rows) => {
      for (const m of rows || []) {
        if (m?.id) map.set(m.id, m);
      }
    };
    add(catalogue);
    add(watchlist);
    add(catalogueForRecs);
    add(inTheatersForRecs);
    add(streamingMoviesForRecs);
    add(streamingTVForRecs);
    add(secondaryStripCatalogRows);
    add(whatsHotForRecs);
    add(pulseTrendingForRecs);
    add(pulsePopularForRecs);
    add(inTheatersPagePopularForRecs);
    return map;
  }, [catalogue, watchlist, catalogueForRecs, inTheatersForRecs, streamingMoviesForRecs, streamingTVForRecs, secondaryStripCatalogRows, whatsHotForRecs, pulseTrendingForRecs, pulsePopularForRecs, inTheatersPagePopularForRecs]);

  const circleDetailHydrateIds = useMemo(() => {
    if (screen !== "circle-detail") return [];
    let titles = [];
    if (circleRatingsView === "recent" && Array.isArray(circleStripPayload?.titles)) {
      titles = circleStripPayload.titles;
    } else if (circleRatingsView === "all" && Array.isArray(circleGridAllPayload?.titles)) {
      titles = circleGridAllPayload.titles;
    } else if (circleRatingsView === "top" && Array.isArray(circleGridTopPayload?.titles)) {
      titles = circleGridTopPayload.titles;
    }
    const out = [];
    for (const t of titles) {
      const id = `${String(t.media_type)}-${Number(t.tmdb_id)}`;
      if (movieLookupById.has(id)) continue;
      if (circleStripExtraMovies.has(id)) continue;
      out.push({ id, media_type: t.media_type, tmdb_id: t.tmdb_id });
    }
    return out;
  }, [
    screen,
    circleRatingsView,
    circleStripPayload,
    circleGridAllPayload,
    circleGridTopPayload,
    movieLookupById,
    circleStripExtraMovies,
  ]);

  useEffect(() => {
    if (screen !== "circle-detail" || circleDetailHydrateIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const fetched = new Map();
      for (let i = 0; i < circleDetailHydrateIds.length; i += 8) {
        const chunk = circleDetailHydrateIds.slice(i, i + 8);
        await Promise.all(
          chunk.map(async (item) => {
            const raw = await fetchTMDB(`/${item.media_type}/${item.tmdb_id}?language=en-US`);
            if (cancelled || isTmdbApiErrorPayload(raw) || raw?.id == null) return;
            fetched.set(item.id, normalizeTMDBItem(raw, item.media_type));
          }),
        );
      }
      if (!cancelled && fetched.size) {
        setCircleStripExtraMovies((prev) => new Map([...prev, ...fetched]));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, circleDetailHydrateIds]);

  /** Secondary region strip: TMDB fallback until `matchData.secondaryRecs` fills from `predict_cached`. */
  const secondaryStripRecsResolved = useMemo(() => {
    const fromMatch = matchData?.secondaryRecs;
    if (fromMatch?.length) {
      const byId = Object.fromEntries(fromMatch.map((r) => [r.movie.id, r]));
      return secondaryStripCatalogRows.map((m) => byId[m.id] ?? tmdbOnlyRec(m));
    }
    return secondaryStripCatalogRows.map((m) => tmdbOnlyRec(m));
  }, [matchData?.secondaryRecs, secondaryStripCatalogRows]);
  /** V1.3.2: Raw rows for the active In theaters / Streaming → Movies|Series tab. */
  const secondaryActiveRawRows = useMemo(() => {
    if (secondaryBlockSegment === SECONDARY_BLOCK_THEATERS) return secondaryTheaterRows;
    return secondaryBlockStreamingTab === "movie" ? secondaryStreamingMovieRows : secondaryStreamingTvRows;
  }, [secondaryBlockSegment, secondaryBlockStreamingTab, secondaryTheaterRows, secondaryStreamingMovieRows, secondaryStreamingTvRows]);
  /** V1.3.3: Fixed cap per tab — no Load more (tabs replace pagination). */
  const secondaryStripRecsVisible = useMemo(() => {
    const byId = Object.fromEntries(secondaryStripRecsResolved.map((r) => [r.movie.id, r]));
    return secondaryActiveRawRows
      .slice(0, SECONDARY_STRIP_TAB_CAP)
      .map((m) => byId[m.id] ?? tmdbOnlyRec(m));
  }, [secondaryActiveRawRows, secondaryStripRecsResolved]);

  /**
   * Global CF hydration: `your_picks_page` + optional `predict_cached` overlay for rec ids.
   * **Not** gated on `screen` — Discover / In Theaters / etc. used to skip this entirely, so the
   * Network tab showed only `predict_cached` (strips + detail) and `recommendations` / overlays never filled.
   *
   * **Catalogue:** prefer `catalogueForRecs` (profile + secondary merge, v5.3.0). If filters make it
   * empty while bootstrap `catalogue` still has titles, fall back — otherwise the effect never runs.
   */
  useEffect(() => {
    if (!user) {
      setMatchData(null);
      setMatchLoading(false);
      return;
    }
    const hasRatings = Object.keys(userRatings).length > 0;
    const catalogueForMatch =
      Array.isArray(catalogueForRecs) && catalogueForRecs.length > 0
        ? catalogueForRecs
        : Array.isArray(catalogue) && catalogue.length > 0
          ? catalogue
          : [];
    const hasCatalogue = catalogueForMatch.length > 0;
    if (!hasRatings || !hasCatalogue) {
      setMatchLoading(false);
      return;
    }

    let cancelled = false;
    setMatchLoading(true);
    /** Short debounce only — coalesces rapid catalogue/ratings churn without the old 350ms “blank Your Picks” gap. */
    const t = setTimeout(async () => {
      try {
        const yourPicksResult = await invokeMatch({
          action: "your_picks_page",
          userRatings,
          catalogue: catalogueForMatch,
          topPickOffset,
        });
        let data = unwrapMatchFunctionData(yourPicksResult.data);
        let { error } = yourPicksResult;
        if (error) {
          logMatchInvokeFailure("your_picks_page", yourPicksResult);
          const msg = String(error?.message ?? "");
          const shouldFallBack = /Unknown action|not found|404/i.test(msg);
          console.warn("match your_picks_page:", msg);
          if (shouldFallBack) {
            const ro = await invokeMatch({
              action: "recommendations_only",
              userRatings,
              catalogue: catalogueForMatch,
              topPickOffset,
            });
            data = unwrapMatchFunctionData(ro.data);
            error = ro.error;
            if (error) {
              const msg2 = String(error?.message ?? "");
              const shouldUseLegacyFull = /Unknown action|not found|404/i.test(msg2);
              console.warn("match recommendations_only:", msg2);
              if (shouldUseLegacyFull) {
                const full = await invokeMatch({
                  action: "full",
                  omitStripRecs: true,
                  userRatings,
                  catalogue: catalogueForMatch,
                  inTheaters: inTheatersForRecs,
                  streamingMovies: streamingMoviesForRecs,
                  streamingTV: streamingTVForRecs,
                  topPickOffset,
                });
                data = unwrapMatchFunctionData(full.data);
                error = full.error;
              } else {
                error = null;
                data = { recommendations: [] };
              }
            }
          }
        }
        if (cancelled) return;
        if (error) {
          console.warn("match function fallback full:", error.message);
          setMatchData((prev) => {
            if (
              prev &&
              typeof prev === "object" &&
              (prev.theaterRecs?.length ||
                prev.whatsHotRecs?.length ||
                prev.pulseTrendingRecs?.length ||
                prev.pulsePopularRecs?.length ||
                prev.inTheatersPagePopularRecs?.length ||
                prev.streamingMovieRecs?.length ||
                prev.streamingTvRecs?.length ||
                prev.secondaryRecs?.length)
            ) {
              return prev;
            }
            return null;
          });
          return;
        }
        const nextRecs = Array.isArray(data?.recommendations) ? data.recommendations : [];
        const nextPredictions =
          data?.predictions && typeof data.predictions === "object" ? data.predictions : null;
        let mergedYourPicksPredictions =
          nextPredictions && typeof nextPredictions === "object" ? { ...nextPredictions } : {};

        if (cancelled) return;
        const overlayIds = new Set();
        for (const r of nextRecs) if (r?.movie?.id) overlayIds.add(r.movie.id);
        /** Skip ids `your_picks_page` already hydrated from `user_title_predictions` — avoids a second heavy `predict_cached` batch. */
        const idList = [...overlayIds]
          .filter((id) => !predictionMapLookup(mergedYourPicksPredictions, id))
          .slice(0, YOUR_PICKS_PREDICT_CACHED_CAP);
        if (idList.length > 0) {
          const predResult = await invokeMatch({
            action: "predict_cached",
            userRatings,
            titles: idList,
          });
          const predPayload = unwrapMatchFunctionData(predResult.data);
          const predErr = predResult.error;
          if (predErr) logMatchInvokeFailure("predict_cached (your picks overlay)", predResult);
          if (
            !cancelled &&
            !predErr &&
            predPayload?.predictions &&
            typeof predPayload.predictions === "object"
          ) {
            mergedYourPicksPredictions = mergeNonNullPredictions(
              mergedYourPicksPredictions,
              predPayload.predictions,
            );
          }
        }

        if (cancelled) return;
        setMatchData((prev) => ({
          ...(prev && typeof prev === "object" ? prev : {}),
          recommendations: nextRecs,
          /** Always set (even `{}`) so stale id→pred entries cannot overlay the wrong strip after a refresh. */
          yourPicksPredictions: mergedYourPicksPredictions,
        }));
      } catch (e) {
        if (!cancelled) console.error(e);
      } finally {
        if (!cancelled) setMatchLoading(false);
      }
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(t);
      setMatchLoading(false);
    };
  }, [
    user,
    userRatings,
    catalogue,
    catalogueForRecs,
    topPickOffset,
    inTheatersForRecs,
    streamingMoviesForRecs,
    streamingTVForRecs,
  ]);

  /** Page-local `predict_cached` for strips on the active screen only (no `your_picks_page` here). */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const hasRatings = Object.keys(userRatings).length > 0;

      async function predictStripThenMerge(movieRows, matchKey, preserveTmdbOrder = false) {
        const ids = movieRows.map((m) => m.id).filter(Boolean);
        if (ids.length === 0 || !hasRatings) return;
        const predResult = await invokeMatch({
          action: "predict_cached",
          userRatings,
          titles: ids,
        });
        const predPayload = unwrapMatchFunctionData(predResult.data);
        const predErr = predResult.error;
        if (predErr) logMatchInvokeFailure(`predict_cached (${matchKey})`, predResult);
        if (cancelled || predErr || !predPayload?.predictions) return;
        const recs = preserveTmdbOrder
          ? recsFromPredictionMapInOrder(movieRows, predPayload.predictions)
          : recsFromPredictionMap(movieRows, predPayload.predictions);
        setMatchData((prev) => ({
          ...(prev && typeof prev === "object" ? prev : {}),
          [matchKey]: recs,
        }));
      }

      try {
        if (screen === "in-theaters") {
          await predictStripThenMerge(inTheatersForRecs, "theaterRecs", true);
          await predictStripThenMerge(inTheatersPagePopularForRecs, "inTheatersPagePopularRecs", true);
        }
        if (screen === "secondary-region") {
          await predictStripThenMerge(secondaryStripCatalogRows, "secondaryRecs");
        }
        if (screen === "pulse") {
          await predictStripThenMerge(pulseTrendingForRecs, "pulseTrendingRecs", true);
          await predictStripThenMerge(pulsePopularForRecs, "pulsePopularRecs", true);
        }
        if (screen === "streaming-page") {
          await predictStripThenMerge(streamingMoviesForRecs, "streamingMovieRecs");
          await predictStripThenMerge(streamingTVForRecs, "streamingTvRecs");
        }
      } catch (e) {
        if (!cancelled) console.error(e);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    user,
    userRatings,
    inTheatersForRecs,
    inTheatersPagePopularForRecs,
    pulseTrendingForRecs,
    pulsePopularForRecs,
    streamingMoviesForRecs,
    streamingTVForRecs,
    secondaryStripCatalogRows,
    screen,
  ]);

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
        setScreen("circles");
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
      const { data: watchlistData } = await supabase
        .from("watchlist")
        .select("*")
        .eq("user_id", user.id)
        .order("sort_index", { ascending: true });
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
    function decodeJwtPayload(token) {
      const parts = String(token ?? "").split(".");
      if (parts.length !== 3) return null;
      try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
        return JSON.parse(atob(padded));
      } catch {
        return null;
      }
    }

    function isSupabaseAccessToken(token) {
      const payload = decodeJwtPayload(token);
      if (!payload || typeof payload !== "object") return false;
      const iss = String(payload.iss ?? "");
      const aud = String(payload.aud ?? "");
      const role = String(payload.role ?? "");
      const sub = String(payload.sub ?? "");
      const hasAuthShape =
        (aud === "authenticated" || aud === "anon") &&
        (role === "authenticated" || role === "anon") &&
        sub.length > 0;
      return hasAuthShape && iss.includes("/auth/v1");
    }

    async function callMatchWithAccessToken(token) {
      const t = String(token ?? "").trim();
      if (!t) return { data: null, error: { message: "No auth session token available" } };
      return supabase.functions.invoke("match", {
        headers: { Authorization: `Bearer ${t}` },
        body,
      });
    }

    let { data: sessWrap } = await supabase.auth.getSession();
    let session = sessWrap?.session;
    if (!session?.access_token) {
      return { data: null, error: { message: "No auth session token available" } };
    }
    if (!isSupabaseAccessToken(session.access_token)) {
      const { data: ref, error: refErr } = await supabase.auth.refreshSession();
      if (!refErr && ref?.session?.access_token) session = ref.session;
    }
    if (!session?.access_token || !isSupabaseAccessToken(session.access_token)) {
      return {
        data: null,
        error: {
          message:
            "Auth session token is not a Supabase access token. Sign out/in and retry.",
        },
      };
    }

    /** `getSession()` can return an expired JWT; gateway + Edge `getUser()` then respond 401 Invalid JWT. */
    const expMs = session.expires_at ? session.expires_at * 1000 : 0;
    if (!expMs || expMs < Date.now() + 120_000) {
      const { data: ref, error: refErr } = await supabase.auth.refreshSession();
      if (!refErr && ref?.session?.access_token) session = ref.session;
    }

    let result = await callMatchWithAccessToken(session.access_token);
    const e = result.error;
    const is401 =
      e?.name === "FunctionsHttpError" &&
      typeof e.context?.status === "number" &&
      e.context.status === 401;
    if (is401) {
      const { data: ref2, error: refErr2 } = await supabase.auth.refreshSession();
      if (!refErr2 && ref2?.session?.access_token) {
        result = await callMatchWithAccessToken(ref2.session.access_token);
      }
    }
    return result;
  }

  async function loadUserData() {
    if (!user) return { ratingCount: 0 };
    const [{ data: ratingsData }, { data: watchlistData }] = await Promise.all([
      supabase.from("ratings").select("*").eq("user_id", user.id),
      supabase.from("watchlist").select("*").eq("user_id", user.id).order("sort_index", { ascending: true }),
    ]);
    if (ratingsData) {
      const ratingsMap = {};
      ratingsData.forEach((r) => {
        const ty = String(r.media_type ?? "").toLowerCase();
        if (ty !== "movie" && ty !== "tv") return;
        const tid = Number(r.tmdb_id);
        if (!Number.isFinite(tid)) return;
        ratingsMap[`${ty}-${tid}`] = r.score;
      });
      setUserRatings(ratingsMap);
    }
    if (watchlistData?.length) {
      setWatchlist(buildWatchlistFromRows(watchlistData, catalogue));
    }

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("name, streaming_provider_ids, show_genre_ids, show_region_keys, secondary_region_key")
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
    setUser(null);
    setUserRatings({}); setWatchlist([]);
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
    setPulseTrending([]);
    setPulsePopular([]);
    setPulseCatalogReady(false);
    setInTheatersPopularRanked([]);
    setStreamingMoviesReady(true);
    setStreamingTvReady(true);
    setCinemaPreference(null); setOtherCinema(null);
    setScreen("splash"); setNavTab("home");
  }

  async function retryInitialCatalogueFetch() {
    setCatalogueRetryBusy(true);
    try {
      const [data, th] = await Promise.all([fetchCatalogue(), fetchInTheaters([])]);
      const seen = new Set(data.map((m) => m.id));
      const pool = [...th.nowPlaying, ...th.popularInTheaters];
      const addedTheaters = pool.filter((m) => !seen.has(m.id));
      const merged = [...data, ...addedTheaters];
      setCatalogue(merged);
      setObCatalogue(data);
      setInTheaters(th.nowPlaying);
      setInTheatersPopularRanked(th.popularInTheaters);
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

  /** v3.1.2: One-tap clear for Discover search (input + applied query + results). */
  function clearDiscoverSearch() {
    setSearchQuery("");
    setAppliedSearchQuery("");
    setSearchResults([]);
    setSearchError("");
    setSearching(false);
    discoverSearchInputRef.current?.focus();
  }

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

  /** When `matchData.recommendations` is `[]`, we must use it — not fall back to sticky (that hid empty CF and broke “predicted first” sort). */
  const rawRecommendations = matchData?.recommendations;
  const stickyRecommendationsRef = useRef([]);
  useEffect(() => {
    if (!user) {
      stickyRecommendationsRef.current = [];
      return;
    }
    const r = matchData?.recommendations;
    if (Array.isArray(r) && r.length > 0) {
      stickyRecommendationsRef.current = r;
    } else if (Array.isArray(r) && r.length === 0) {
      stickyRecommendationsRef.current = [];
    }
  }, [user, matchData?.recommendations]);
  const baseRecommendations = Array.isArray(rawRecommendations)
    ? rawRecommendations
    : stickyRecommendationsRef.current.length > 0
      ? stickyRecommendationsRef.current
      : EMPTY_MATCH_RECS;

  /**
   * Overlay `matchData.yourPicksPredictions` (from Your Picks `predict_cached` pass) onto a rec list so each
   * row gets `neighborCount` ≥ 1 when a neighbor-backed prediction exists — even if `recommendations_only`
   * returned a TMDB fallback for that title. Rows already carrying ≥ 1 neighbors stay as-is.
   */
  const overlayYourPicksPredictions = useCallback(
    (recs) => {
      const predMap = matchData?.yourPicksPredictions;
      if (!predMap || typeof predMap !== "object" || !recs?.length) return recs;
      return recs.map((r) => {
        if (!r?.movie?.id) return r;
        if (recNeighborCount(r) >= 1) return r;
        const pred = predictionMapLookup(predMap, r.movie.id);
        if (!pred || Number(pred.neighborCount ?? pred.neighbor_count ?? 0) < 1) return r;
        return recFromMatchPrediction(r.movie, pred);
      });
    },
    [matchData?.yourPicksPredictions],
  );

  const recommendations = useMemo(
    () => overlayYourPicksPredictions(baseRecommendations),
    [baseRecommendations, overlayYourPicksPredictions],
  );

  const theaterRecs = useMemo(() => {
    const fromMatch = matchData?.theaterRecs;
    if (fromMatch?.length) return fromMatch;
    return inTheatersForRecs.map((m) => tmdbOnlyRec(m));
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
   * Streaming page derives two strips over the same pool: **Now Streaming** (release / air-date desc)
   * and **What’s popular in streaming** (TMDB popularity desc). `predict_cached` scores overlay via id map
   * when `matchData.streamingMovieRecs` / `streamingTvRecs` are present; TMDB fallback otherwise.
   */
  const streamingMoviesNowResolved = useMemo(() => {
    const fromMatch = matchData?.streamingMovieRecs;
    const byId = fromMatch?.length ? Object.fromEntries(fromMatch.map((r) => [r.movie.id, r])) : null;
    return sortStreamingByReleaseDateDesc(streamingMoviesForRecs).map((m) => byId?.[m.id] ?? tmdbOnlyRec(m));
  }, [matchData?.streamingMovieRecs, streamingMoviesForRecs]);

  const streamingMoviesPopularResolved = useMemo(() => {
    const fromMatch = matchData?.streamingMovieRecs;
    const byId = fromMatch?.length ? Object.fromEntries(fromMatch.map((r) => [r.movie.id, r])) : null;
    return sortStreamingByPopularityDesc(streamingMoviesForRecs).map((m) => byId?.[m.id] ?? tmdbOnlyRec(m));
  }, [matchData?.streamingMovieRecs, streamingMoviesForRecs]);

  const streamingTvNowResolved = useMemo(() => {
    const fromMatch = matchData?.streamingTvRecs;
    const byId = fromMatch?.length ? Object.fromEntries(fromMatch.map((r) => [r.movie.id, r])) : null;
    return sortStreamingByReleaseDateDesc(streamingTVForRecs).map((m) => byId?.[m.id] ?? tmdbOnlyRec(m));
  }, [matchData?.streamingTvRecs, streamingTVForRecs]);

  const streamingTvPopularResolved = useMemo(() => {
    const fromMatch = matchData?.streamingTvRecs;
    const byId = fromMatch?.length ? Object.fromEntries(fromMatch.map((r) => [r.movie.id, r])) : null;
    return sortStreamingByPopularityDesc(streamingTVForRecs).map((m) => byId?.[m.id] ?? tmdbOnlyRec(m));
  }, [matchData?.streamingTvRecs, streamingTVForRecs]);

  const streamingNowRecs = streamingTab === "movie" ? streamingMoviesNowResolved : streamingTvNowResolved;
  const streamingPopularRecs = streamingTab === "movie" ? streamingMoviesPopularResolved : streamingTvPopularResolved;

  /**
   * Movies fetch completes before TV; default streaming tab is Series. Users who switch to Movies often
   * already have streamingMoviesReady=true, so the old !streamingMoviesReady skeleton never ran — empty strip.
   * Also show skeleton while match is in flight and there are no movie rows yet (TMDB pool empty until match fills).
   */
  const showStreamingMovieSkeleton =
    streamingTab === "movie" &&
    (!streamingMoviesReady ||
      (matchLoading && streamingMovieRecsResolved.length === 0));

  /** `homePicksLoadFailed` removed in v4.0.8 — the Home screen retired and every remaining primary
   *  page owns its own empty/error state. */

  /** Strict CF neighbour picks only — not theater / streaming pools (otherwise every strip row became Pick). */
  const cfRecommendationPickIdSet = useMemo(() => {
    const s = new Set();
    for (const r of recommendations) {
      const k = mediaIdKey(r?.movie);
      if (k) s.add(k);
    }
    for (const rawId of Object.keys(yourPicksCatalogPredictions)) {
      const pred = yourPicksCatalogPredictions[rawId];
      if (Number(pred?.neighborCount ?? pred?.neighbor_count ?? 0) < 1) continue;
      const p = parseMediaKey(String(rawId));
      if (p) s.add(`${p.type}-${p.tmdbId}`);
    }
    return s;
  }, [recommendations, yourPicksCatalogPredictions]);

  /** Catalogue ids for a Pulse-style `predict_cached` batch (unrated, not in RPC `recommendations`). */
  const yourPicksCatalogPredictTitleIds = useMemo(() => {
    if (!user || Object.keys(userRatings).length === 0) return [];
    const catalogueRows =
      Array.isArray(catalogueForRecs) && catalogueForRecs.length > 0
        ? catalogueForRecs
        : Array.isArray(catalogue) && catalogue.length > 0
          ? catalogue
          : [];
    const rated = new Set(Object.keys(userRatings));
    const inRpc = new Set();
    for (const r of recommendations) {
      const k = recMovieRowId(r);
      if (k) inRpc.add(k);
    }
    const candidates = catalogueRows.filter((m) => {
      const k = mediaIdKey(m);
      if (!k || rated.has(k) || inRpc.has(k)) return false;
      const mid = m.id != null && m.id !== "" ? String(m.id) : k;
      return parseMediaKey(mid) != null;
    });
    candidates.sort((a, b) => Number(b.popularity ?? 0) - Number(a.popularity ?? 0));
    return candidates
      .slice(0, YOUR_PICKS_CATALOG_PREDICT_CAP)
      .map((m) => (m.id != null && m.id !== "" ? String(m.id) : mediaIdKey(m)))
      .filter((id) => id && parseMediaKey(id));
  }, [user, userRatings, catalogueForRecs, catalogue, recommendations]);

  useEffect(() => {
    if (!user) {
      setYourPicksCatalogPredictions({});
      return;
    }
    if (yourPicksCatalogPredictTitleIds.length === 0) {
      setYourPicksCatalogPredictions({});
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const predResult = await invokeMatch({
          action: "predict_cached",
          userRatings,
          titles: yourPicksCatalogPredictTitleIds,
        });
        const predPayload = unwrapMatchFunctionData(predResult.data);
        if (predResult.error) logMatchInvokeFailure("predict_cached (your picks catalogue)", predResult);
        if (cancelled || predResult.error || !predPayload?.predictions) return;
        setYourPicksCatalogPredictions(mergeNonNullPredictions({}, predPayload.predictions));
      } catch (e) {
        if (!cancelled) console.error(e);
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, userRatings, yourPicksCatalogPredictTitleIds]);

  /**
   * Main Your Picks pool: RPC **`recommendations`** plus **catalogue `predict_cached`** rows with
   * neighbor overlap (same path as Pulse), merged and sorted by **predicted desc**, then **popular**.
   */
  const yourPicksMainCandidates = useMemo(() => {
    const catalogueRows =
      Array.isArray(catalogueForRecs) && catalogueForRecs.length > 0
        ? catalogueForRecs
        : Array.isArray(catalogue) && catalogue.length > 0
          ? catalogue
          : [];
    const rated = new Set(Object.keys(userRatings));
    const seen = new Set();
    const cfList = [];
    for (const r of recommendations) {
      const rid = recMovieRowId(r);
      if (!rid || seen.has(rid)) continue;
      seen.add(rid);
      cfList.push(r);
    }
    for (const m of catalogueRows) {
      const rid = mediaIdKey(m);
      if (!rid || seen.has(rid) || rated.has(rid)) continue;
      const movieIdForPred = m.id != null && m.id !== "" ? String(m.id) : rid;
      const pred =
        predictionMapLookup(yourPicksCatalogPredictions, movieIdForPred) ??
        predictionMapLookup(yourPicksCatalogPredictions, rid);
      if (pred == null || typeof pred !== "object") continue;
      if (Number(pred.neighborCount ?? pred.neighbor_count ?? 0) < 1) continue;
      const rec = recFromMatchPrediction(m, pred);
      if (recNeighborCount(rec) < 1) continue;
      seen.add(rid);
      cfList.push(rec);
    }
    cfList.sort((a, b) => {
      const dp = Number(b.predicted) - Number(a.predicted);
      if (dp !== 0) return dp;
      return recNeighborCount(b) - recNeighborCount(a);
    });
    const cfNeighborSorted = cfList;

    const popular = [];
    for (const m of catalogueRows) {
      const rid = mediaIdKey(m);
      if (!rid || rated.has(rid) || seen.has(rid)) continue;
      seen.add(rid);
      popular.push(tmdbOnlyRec(m));
    }
    popular.sort((a, b) => Number(b.movie.popularity ?? 0) - Number(a.movie.popularity ?? 0));
    let restSorted = popular.slice(0, 120);

    if (cfNeighborSorted.length === 0 && restSorted.length === 0 && catalogueRows.length > 0) {
      const emerg = [];
      for (const m of catalogueRows) {
        const rid = mediaIdKey(m);
        if (!rid || rated.has(rid)) continue;
        emerg.push(tmdbOnlyRec(m));
      }
      emerg.sort((a, b) => Number(b.movie.popularity ?? 0) - Number(a.movie.popularity ?? 0));
      restSorted = emerg.slice(0, 120);
    }
    return { cfNeighborSorted, restSorted };
  }, [recommendations, catalogueForRecs, catalogue, userRatings, yourPicksCatalogPredictions]);

  const hasYourPicksStripSource =
    yourPicksMainCandidates.cfNeighborSorted.length > 0 || yourPicksMainCandidates.restSorted.length > 0;

  const yourPicksPoolSig = useMemo(
    () =>
      [...yourPicksMainCandidates.cfNeighborSorted, ...yourPicksMainCandidates.restSorted]
        .map((r) => recMovieRowId(r))
        .filter(Boolean)
        .join("\x1e"),
    [yourPicksMainCandidates],
  );

  useEffect(() => {
    setYourPicksBatchStep(1);
  }, [yourPicksPoolSig]);

  const yourPicksTotalCandidates = useMemo(
    () => yourPicksMainCandidates.cfNeighborSorted.length + yourPicksMainCandidates.restSorted.length,
    [yourPicksMainCandidates],
  );

  const yourPicksVisibleCap = useMemo(() => {
    const n = yourPicksTotalCandidates;
    if (n === 0) return 0;
    return Math.min(n, YOUR_PICKS_VISIBLE_MAX, yourPicksBatchStep * YOUR_PICKS_BATCH_SIZE);
  }, [yourPicksTotalCandidates, yourPicksBatchStep]);

  const yourPicksMaxBatchSteps = useMemo(() => {
    const n = yourPicksTotalCandidates;
    if (n === 0) return 1;
    return Math.min(
      YOUR_PICKS_VISIBLE_MAX / YOUR_PICKS_BATCH_SIZE,
      Math.ceil(Math.min(n, YOUR_PICKS_VISIBLE_MAX) / YOUR_PICKS_BATCH_SIZE),
    );
  }, [yourPicksTotalCandidates]);

  /** Your Picks **For you** row — built in `rebuildMoreTabStrips`. */
  const [moreForYouStrip, setMoreForYouStrip] = useState([]);
  /** True while resolving TMDB watch providers for Your Picks (streaming filter on). */
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
      const { cfNeighborSorted, restSorted } = yourPicksMainCandidates;
      if (cfNeighborSorted.length === 0 && restSorted.length === 0) {
        if (!cancelled) {
          setMoreStripsLoading(false);
          setMoreForYouStrip([]);
        }
        return;
      }

      const rotatePart = (arr) => {
        if (arr.length === 0) return arr;
        const s = topPickOffset % arr.length;
        return [...arr.slice(s), ...arr.slice(0, s)];
      };
      const pred = rotatePart(cfNeighborSorted);
      const unpred = rotatePart(restSorted);
      const rotated = [...pred, ...unpred];
      const visibleCap = Math.min(
        rotated.length,
        YOUR_PICKS_VISIBLE_MAX,
        yourPicksBatchStep * YOUR_PICKS_BATCH_SIZE,
      );
      const cfN = cfNeighborSorted.length;
      const restAligned = rotated.slice(cfN);

      if (selectedStreamingProviderIds.length === 0) {
        let main = rotated.slice(0, visibleCap);
        main = topUpYourPicksStrip1Only(main, rotated, visibleCap);
        if (!cancelled) {
          setMoreStripsLoading(false);
          setMoreForYouStrip(toYourPicksStripRows(main, cfRecommendationPickIdSet));
        }
        return;
      }

      if (!cancelled) setMoreStripsLoading(true);
      try {
        let main = [];
        for (const r of pred) {
          if (main.length >= visibleCap) break;
          main.push(r);
        }
        let rIdx = 0;
        while (main.length < visibleCap && rIdx < restAligned.length) {
          const batch = restAligned.slice(
            rIdx,
            Math.min(rIdx + YOUR_PICKS_WATCH_PROVIDER_FETCH_CONCURRENCY, restAligned.length),
          );
          rIdx += batch.length;
          await Promise.all(batch.map((rec) => getFlatrateProviderIds(rec.movie)));
          for (const rec of batch) {
            if (cancelled) return;
            if (main.length >= visibleCap) break;
            const ids = await getFlatrateProviderIds(rec.movie);
            if (ids.some((id) => selectedStreamingProviderIds.includes(id))) main.push(rec);
          }
        }
        if (main.length === 0 && pred.length > 0) {
          for (const r of pred) {
            if (main.length >= visibleCap) break;
            main.push(r);
          }
        } else if (main.length < visibleCap && main.length > 0) {
          const inMain = new Set(main.map((r) => recMovieRowId(r)).filter(Boolean));
          const backfillPool = restSorted.filter((rec) => {
            const bid = recMovieRowId(rec);
            return bid && !inMain.has(bid);
          });
          let bfIdx = 0;
          while (main.length < visibleCap && bfIdx < backfillPool.length) {
            const batch = backfillPool.slice(
              bfIdx,
              Math.min(bfIdx + YOUR_PICKS_WATCH_PROVIDER_FETCH_CONCURRENCY, backfillPool.length),
            );
            bfIdx += batch.length;
            await Promise.all(batch.map((rec) => getFlatrateProviderIds(rec.movie)));
            for (const rec of batch) {
              if (cancelled) return;
              if (main.length >= visibleCap) break;
              const ids = await getFlatrateProviderIds(rec.movie);
              if (ids.some((id) => selectedStreamingProviderIds.includes(id))) main.push(rec);
            }
          }
        }

        if (cancelled) return;
        if (main.length === 0 && rotated.length > 0) {
          main = topUpYourPicksStrip1Only([], rotated, visibleCap);
        }
        if (!cancelled) setMoreForYouStrip(toYourPicksStripRows(main, cfRecommendationPickIdSet));
      } catch (e) {
        if (!cancelled) {
          console.warn("Your Picks strip rebuild (streaming):", e);
          const fb = topUpYourPicksStrip1Only([], rotated, visibleCap);
          setMoreForYouStrip(toYourPicksStripRows(fb, cfRecommendationPickIdSet));
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
    yourPicksMainCandidates,
    yourPicksBatchStep,
    cfRecommendationPickIdSet,
    selectedStreamingProviderIds,
    topPickOffset,
  ]);

  useEffect(() => {
    let cancelled = false;
    const tvCandidates = [
      ...theaterRecs.map((r) => r.movie),
      ...streamingRecs.map((r) => r.movie),
      ...whatsHotRecsResolved.map((r) => r.movie),
      ...pulseTrendingRecsResolved.map((r) => r.movie),
      ...pulsePopularRecsResolved.map((r) => r.movie),
      ...inTheatersPagePopularRecsResolved.map((r) => r.movie),
      ...secondaryStripRecsResolved.map((r) => r.movie),
      ...moreForYouStrip.map((row) => row.rec.movie),
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
  }, [theaterRecs, streamingRecs, whatsHotRecsResolved, pulseTrendingRecsResolved, pulsePopularRecsResolved, inTheatersPagePopularRecsResolved, secondaryStripRecsResolved, moreForYouStrip]);

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

  /** `predict_cached` overlay for Discover grid (cap keeps Edge bounded); merged into `recMap` below. */
  const discoverRecsResolved = useMemo(() => {
    const fromMatch = matchData?.discoverRecs;
    if (fromMatch?.length) {
      const byId = Object.fromEntries(fromMatch.map((r) => [r.movie.id, r]));
      return discoverItems.map((m) => byId[m.id] ?? tmdbOnlyRec(m));
    }
    return discoverItems.map((m) => tmdbOnlyRec(m));
  }, [matchData?.discoverRecs, discoverItems]);

  useEffect(() => {
    if (!user || screen !== "discover") return;
    const hasRatings = Object.keys(userRatings).length > 0;
    if (!hasRatings) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const rows = discoverItems.slice(0, DISCOVER_PREDICT_CACHED_CAP);
      if (rows.length === 0) return;
      try {
        const predResult = await invokeMatch({
          action: "predict_cached",
          userRatings,
          titles: rows.map((m) => m.id).filter(Boolean),
        });
        const predPayload = unwrapMatchFunctionData(predResult.data);
        const predErr = predResult.error;
        if (predErr) logMatchInvokeFailure("predict_cached (discover)", predResult);
        if (cancelled || predErr || !predPayload?.predictions) return;
        const recs = recsFromPredictionMapInOrder(rows, predPayload.predictions);
        setMatchData((prev) => ({
          ...(prev && typeof prev === "object" ? prev : {}),
          discoverRecs: recs,
        }));
      } catch (e) {
        if (!cancelled) console.error(e);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, userRatings, screen, discoverItems]);

  const yourPicksCatalogPredRecMap = useMemo(() => {
    const out = {};
    for (const [rawId, pred] of Object.entries(yourPicksCatalogPredictions)) {
      if (pred == null || typeof pred !== "object") continue;
      const movie = movieLookupById.get(String(rawId));
      if (!movie?.id) continue;
      out[movie.id] = recFromMatchPrediction(movie, pred);
    }
    return out;
  }, [yourPicksCatalogPredictions, movieLookupById]);

  const recMap = useMemo(() => ({
    ...Object.fromEntries(streamingMovieRecsResolved.map(r => [r.movie.id, r])),
    ...Object.fromEntries(streamingTvRecsResolved.map(r => [r.movie.id, r])),
    ...Object.fromEntries(whatsHotRecsResolved.map(r => [r.movie.id, r])),
    ...Object.fromEntries(pulseTrendingRecsResolved.map((r) => [r.movie.id, r])),
    ...Object.fromEntries(pulsePopularRecsResolved.map((r) => [r.movie.id, r])),
    ...Object.fromEntries(inTheatersPagePopularRecsResolved.map((r) => [r.movie.id, r])),
    ...Object.fromEntries(secondaryStripRecsResolved.map((r) => [r.movie.id, r])),
    ...Object.fromEntries(theaterRecs.map(r => [r.movie.id, r])),
    ...Object.fromEntries(moreForYouStrip.map((row) => [row.rec.movie.id, row.rec])),
    ...Object.fromEntries(recommendations.map(r => [r.movie.id, r])),
    ...yourPicksCatalogPredRecMap,
    ...Object.fromEntries(discoverRecsResolved.map((r) => [r.movie.id, r])),
  }), [streamingMovieRecsResolved, streamingTvRecsResolved, whatsHotRecsResolved, pulseTrendingRecsResolved, pulsePopularRecsResolved, inTheatersPagePopularRecsResolved, secondaryStripRecsResolved, theaterRecs, moreForYouStrip, recommendations, yourPicksCatalogPredRecMap, discoverRecsResolved]);
  const FILTERS = ["All", "Movies", "TV Shows"];
  const rateMoreQueue = rateMoreMovies.length > 0 ? rateMoreMovies : obMovies;
  const rateMoreMovie = rateMoreQueue[obStep] ?? null;
  const yourPicksLoading = matchLoading || moreStripsLoading;

  /** Loading placeholders for horizontal strips; `showKind` adds lower-left pill (Your picks ✨/📈). */
  function SkeletonStrip({ count = 7, showKind = false }) {
    return (
      <div className="strip" aria-hidden="true">
        {Array.from({ length: count }).map((_, idx) => (
          <div className="strip-card-skeleton" key={`sk-${idx}`}>
            <div className="skel-poster">
              {showKind && <div className="skel-kind-icon" />}
            </div>
            <div className="skel-line skel-line-title" />
            <div className="skel-line skel-line-meta" />
          </div>
        ))}
      </div>
    );
  }

  const cinemastroTitleKeysData = useMemo(() => {
    const s = new Set();
    const addMovie = (m) => {
      const k = mediaIdKey(m);
      if (k) s.add(k);
    };
    const addRec = (r) => {
      if (r?.movie) addMovie(r.movie);
    };
    for (const m of catalogue) addMovie(m);
    for (const id of Object.keys(userRatings)) s.add(id);
    for (const r of theaterRecs) addRec(r);
    for (const r of inTheatersPagePopularRecsResolved) addRec(r);
    for (const r of whatsHotRecsResolved) addRec(r);
    for (const r of streamingMovieRecsResolved) addRec(r);
    for (const r of streamingTvRecsResolved) addRec(r);
    for (const r of secondaryStripRecsResolved) addRec(r);
    for (const row of moreForYouStrip) addRec(row.rec);
    for (const m of discoverItems) addMovie(m);
    for (const r of moodResults) addRec(r);
    if (selectedMovie?.movie) addMovie(selectedMovie.movie);
    for (const m of watchlist) addMovie(m);
    const keys = [...s].sort();
    return { keys, sig: keys.join("\x1e") };
  }, [
    catalogue,
    userRatings,
    theaterRecs,
    inTheatersPagePopularRecsResolved,
    whatsHotRecsResolved,
    streamingMovieRecsResolved,
    streamingTvRecsResolved,
    secondaryStripRecsResolved,
    moreForYouStrip,
    discoverItems,
    moodResults,
    selectedMovie,
    watchlist,
  ]);

  cinemastroFetchKeysRef.current = cinemastroTitleKeysData.keys;

  useEffect(() => {
    const sig = cinemastroTitleKeysData.sig;
    if (!sig) return undefined;

    let cancelled = false;
    const chunk = (arr, n) => {
      const out = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };

    const run = async () => {
      const keys = cinemastroFetchKeysRef.current;
      if (!keys.length) return;
      for (const part of chunk(keys, 120)) {
        if (cancelled) return;
        const payload = [];
        const seenSig = new Set();
        for (const key of part) {
          const p = parseMediaKey(key);
          if (!p) continue;
          const rowSig = `${p.type}:${p.tmdbId}`;
          if (seenSig.has(rowSig)) continue;
          seenSig.add(rowSig);
          payload.push({ tmdb_id: p.tmdbId, media_type: p.type });
        }
        if (!payload.length) continue;
        const { data, error } = await supabase.rpc("get_cinemastro_title_avgs", { p_titles: payload });
        if (cancelled) return;
        if (error) {
          console.warn("get_cinemastro_title_avgs:", error.message);
          continue;
        }
        const rows = normalizeCinemastroRpcRows(data);
        const batchMerge = {};
        for (const row of rows) {
          const k = cinemastroAvgKeyFromRow(row);
          if (!k) continue;
          const sc = Number(row.avg_score);
          if (!Number.isFinite(sc)) continue;
          const rc = Number(row.rating_count);
          batchMerge[k] = {
            avgScore: sc,
            ratingCount: Number.isFinite(rc) ? rc : 0,
          };
        }
        if (!cancelled && Object.keys(batchMerge).length) {
          setCinemastroAvgByKey((prev) => ({ ...prev, ...batchMerge }));
        }
      }
    };

    /* Strips resolve in waves; sig flips often. Immediate fetch + stale=true aborts every run before
       any chunk finishes. Debounce so one batch runs after keys settle (detail refresh still instant). */
    const debounceMs = 520;
    const t = window.setTimeout(() => {
      void run();
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [cinemastroTitleKeysData.sig]);

  async function refreshCinemastroAvgForMediaId(movieId) {
    const p = parseMediaKey(movieId);
    if (!p) return;
    const { data, error } = await supabase.rpc("get_cinemastro_title_avgs", {
      p_titles: [{ tmdb_id: p.tmdbId, media_type: p.type }],
    });
    if (error) return;
    const rows = normalizeCinemastroRpcRows(data);
    const row = rows[0];
    if (!row) return;
    const k = cinemastroAvgKeyFromRow(row);
    if (!k) return;
    const sc = Number(row.avg_score);
    if (!Number.isFinite(sc)) return;
    const rc = Number(row.rating_count);
    setCinemastroAvgByKey((prev) => ({
      ...prev,
      [k]: { avgScore: sc, ratingCount: Number.isFinite(rc) ? rc : 0 },
    }));
  }

  function StripPosterBadge({ movie, predicted, predictedNeighborCount = 0, preferPersonalPredicted = false }) {
    const bd = stripBadgeDisplay(
      movie,
      userRatings[movie.id],
      predicted,
      cinemastroAvgByKey,
      predictedNeighborCount,
      preferPersonalPredicted,
    );
    const showMeter =
      bd.pillClass === "strip-badge--cinemastro" &&
      bd.cinemastroCount != null &&
      bd.cinemastroCount >= 1;
    return (
      <div
        className={`strip-badge${bd.pillClass ? ` ${bd.pillClass}` : ""}${showMeter ? " strip-badge--with-meter" : ""}`}
        style={{ color: bd.color }}
        title={bd.title || undefined}
      >
        <span className="strip-badge-score">{bd.text}</span>
        {showMeter ? <CinemastroVoteMeter count={bd.cinemastroCount} /> : null}
      </div>
    );
  }

  async function addRating(movieId, score, options = {}) {
    const skipPublishModal = options.skipPublishModal === true;
    const pendingNavigate = options.pendingNavigate ?? "none";
    const navigateDelayMs = options.navigateDelayMs ?? 800;
    const hadRating = userRatings[movieId] != null;

    setUserRatings(prev => ({ ...prev, [movieId]: score }));
    setWatchlist(prev => prev.filter(m => m.id !== movieId));
    setSelectedToWatch(prev => { const n = { ...prev }; delete n[movieId]; return n; });
    if (user) {
      const [type, tmdbId] = movieId.split("-");
      const { error: ratingErr } = await supabase.from("ratings").upsert({ user_id: user.id, tmdb_id: parseInt(tmdbId), media_type: type, score }, { onConflict: "user_id,tmdb_id,media_type" });
      if (ratingErr) console.warn("Could not save rating:", ratingErr.message);
      else {
        void refreshCinemastroAvgForMediaId(movieId);
        scheduleComputeNeighborsRebuild();
      }
      await supabase.from("watchlist").delete().eq("user_id", user.id).eq("tmdb_id", parseInt(tmdbId)).eq("media_type", type);
    }

    const shouldOpenPublish = Boolean(user) && !skipPublishModal && !hadRating;
    if (shouldOpenPublish) {
      const defaults = [];
      if (rateTitleReturnCircleIdRef.current) defaults.push(rateTitleReturnCircleIdRef.current);
      if (detailReturnScreenRef.current === "circle-detail" && selectedCircleId) {
        defaults.push(selectedCircleId);
      }
      setPublishRatingModal({
        movieId,
        mode: "afterRate",
        pendingNavigate,
        defaultCircleIds: [...new Set(defaults)],
      });
      return;
    }

    if (pendingNavigate === "back") {
      setTimeout(() => goBack(), navigateDelayMs);
    }
  }

  async function completePublishRatingModal(selectedIds) {
    const ctx = publishRatingModal;
    if (!ctx) return;
    setPublishModalBusy(true);
    setPublishModalError("");
    try {
      await syncRatingCircleShares(ctx.movieId, selectedIds);
      const nav = ctx.pendingNavigate;
      setPublishRatingModal(null);
      setPublishModalBusy(false);
      setCircleRatedRefreshKey((k) => k + 1);
      if (nav === "back") goBack();
    } catch (e) {
      setPublishModalBusy(false);
      setPublishModalError(e?.message || "Could not save.");
    }
  }

  function cancelPublishRatingModal() {
    const ctx = publishRatingModal;
    const nav = ctx?.pendingNavigate;
    setPublishRatingModal(null);
    setPublishModalBusy(false);
    setPublishModalError("");
    if (ctx?.mode === "afterRate" && nav === "back") goBack();
  }

  function togglePublishCirclePick(circleId) {
    setPublishModalSelection((prev) => {
      const n = new Set(prev);
      if (n.has(circleId)) n.delete(circleId);
      else n.add(circleId);
      return n;
    });
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

  /**
   * v3.2.0: Neighbor overlap from `ratings` only — do not require rows in `catalogueForRecs`.
   * Rank by overlap + avg score (+ same-type boost); hydrate via catalogue or TMDB detail; drop animation.
   */
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
    const agg = new Map();

    for (const row of overlapRatings || []) {
      const mt = row.media_type === "tv" ? "tv" : "movie";
      const tid = Number(row.tmdb_id);
      if (!Number.isFinite(tid)) continue;
      const rid = `${mt}-${tid}`;
      if (blockedIds.has(rid)) continue;
      let rec = agg.get(rid);
      if (!rec) {
        rec = { mediaType: mt, tmdbId: tid, userIds: new Set(), scoreSum: 0, scoreCount: 0 };
        agg.set(rid, rec);
      }
      rec.userIds.add(row.user_id);
      const s = Number(row.score);
      if (Number.isFinite(s)) {
        rec.scoreSum += s;
        rec.scoreCount += 1;
      }
    }

    const ranked = [...agg.values()]
      .map((x) => {
        const overlapN = x.userIds.size;
        const avgScore = x.scoreCount > 0 ? x.scoreSum / x.scoreCount : 0;
        const sameTypeBoost = x.mediaType === mediaType ? 1.15 : 1;
        const rank = (overlapN * 1.9 + avgScore * 0.65) * sameTypeBoost;
        return { ...x, rank };
      })
      .sort((a, b) => b.rank - a.rank);

    const pool = ranked.slice(0, RATE_NOW_OVERLAP_CANDIDATE_CAP);
    const catalogueById = new Map(catalogueForRecs.map((m) => [m.id, m]));
    const needFetch = [];
    for (const c of pool) {
      const rid = `${c.mediaType}-${c.tmdbId}`;
      if (!catalogueById.has(rid)) needFetch.push(c);
    }

    const tmdbByRid = new Map();
    for (let i = 0; i < needFetch.length; i += RATE_NOW_TMDB_FETCH_CONCURRENCY) {
      const chunk = needFetch.slice(i, i + RATE_NOW_TMDB_FETCH_CONCURRENCY);
      const settled = await Promise.all(
        chunk.map(async (c) => {
          const rid = `${c.mediaType}-${c.tmdbId}`;
          const raw = await fetchTMDB(`/${c.mediaType}/${c.tmdbId}?language=en-US`);
          if (isTmdbApiErrorPayload(raw) || raw?.id == null) return null;
          return [rid, normalizeTMDBItem(raw, c.mediaType)];
        }),
      );
      for (const row of settled) {
        if (row) tmdbByRid.set(row[0], row[1]);
      }
    }

    const out = [];
    for (const c of pool) {
      if (out.length >= limit) break;
      const rid = `${c.mediaType}-${c.tmdbId}`;
      const m = catalogueById.get(rid) ?? tmdbByRid.get(rid);
      if (!m) continue;
      if (hasExcludedGenre(m)) continue;
      out.push(m);
    }
    return out;
  }

  /** v3.2.0: Queue from overlap+TMDB hydrate (`fetchNeighborOverlapTitlesFor`); fallback still catalogue popularity. */
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
        void openDetail(contextMovie, recMap[contextMovieId] || null);
        return;
      }
    }
    setNavTab("home");
    setScreen("circles");
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
      else { setScreen("loading-recs"); setTimeout(() => { setNavTab("home"); setScreen("circles"); }, 2200); }
    }
  }

  function confirmRating() {
    if (rateMoreQueue[obStep]) void addRating(rateMoreQueue[obStep].id, sliderVal, { skipPublishModal: true });
    advanceOb();
  }

  /** v3.2.1: Navigate immediately; fetch `predict` in background and show skeleton until settled. */
  function openDetail(movie, prediction, opts = {}) {
    const pred = prediction ?? null;
    const s = screenRef.current;
    if (s === "discover" && rateTitleReturnCircleIdRef.current != null) {
      detailReturnScreenRef.current = "circle-detail";
    } else {
      detailReturnScreenRef.current = s;
    }
    // Distinct URL per detail step so iOS edge-swipe / Mac trackpad back can popstate (v2.1.0). Community avg on detail from v3.0.0 RPC.
    if (opts.skipHistoryPush) {
      detailHistoryPushedRef.current = false;
    } else {
      history.pushState({ cinemastroDetail: true }, "", spaUrlForOverlay({ detail: movie.id }));
      detailHistoryPushedRef.current = true;
    }
    // Show skeleton until we know session + whether to call Edge — `user` from React can lag `getSession()` after refresh.
    setSelected({ movie, prediction: pred, predictionLoading: true });
    void refreshCinemastroAvgForMediaId(movie.id);
    if (opts.startEditing && userRatings[movie.id] != null) {
      setDetailEditRating(true);
      setDetailRating(userRatings[movie.id]);
      setDetailTouched(true);
    } else {
      setDetailEditRating(false);
      setDetailRating(5);
      /** Default 5 is a deliberate starting point — allow submit without forcing a slider wiggle. */
      setDetailTouched(userRatings[movie.id] == null);
    }
    setScreen("detail");
    const movieId = movie.id;
    void (async () => {
      try {
        const { data: sessWrap } = await supabase.auth.getSession();
        const sessionUser = sessWrap?.session?.user ?? null;
        /** `getSession()` can lag behind React `user` after refresh; do not skip `predict_cached` in that gap. */
        const authedForCf = Boolean(sessionUser?.id ?? user?.id);
        const hasRatings = Object.keys(userRatings).length > 0;
        const neighborN = Number(pred?.neighborCount ?? pred?.neighbor_count ?? 0);
        const alreadyHaveCf =
          pred != null &&
          neighborN >= 1 &&
          normalizeDetailPredictionPayload(pred) != null;
        const needsPredict = authedForCf && hasRatings && !alreadyHaveCf;

        if (!needsPredict) {
          setSelected((prev) => {
            if (!prev || prev.movie?.id !== movieId) return prev;
            const nextPred =
              pred != null ? (normalizeDetailPredictionPayload(pred) ?? pred) : null;
            return { ...prev, prediction: nextPred, predictionLoading: false };
          });
          return;
        }

        const result = await invokeMatch({ action: "predict_cached", userRatings, movieId });
        const { data, error } = result;
        if (error) logMatchInvokeFailure("predict_cached (detail)", result);
        const raw = !error ? predictionFromMatchPredictCachedData(data, movieId) : null;
        const nextPred = normalizeDetailPredictionPayload(raw);
        setSelected((prev) => {
          if (!prev || prev.movie?.id !== movieId) return prev;
          return { ...prev, prediction: nextPred, predictionLoading: false };
        });
      } catch (e) {
        console.warn("[match invoke] predict_cached (detail) threw:", e);
        setSelected((prev) => {
          if (!prev || prev.movie?.id !== movieId) return prev;
          return { ...prev, prediction: null, predictionLoading: false };
        });
      }
    })();
  }

  function goBack() {
    if (detailHistoryPushedRef.current) {
      history.back();
      return;
    }
    history.replaceState(null, "", spaUrlWithoutOverlays());
    setDetailEditRating(false);
    setSelected(null);
    // navTab === "home" is the idle bottom-nav sentinel; the landing screen is now "circles".
    setScreen(
      navTab === "mood"
        ? "mood-results"
        : navTab === "home"
          ? "circles"
          : navTab === "watchlist"
            ? "watchlist"
            : navTab,
    );
  }

  function openLegalPage(target) {
    if (!SPA_LEGAL_SCREENS.has(target)) return;
    legalReturnScreenRef.current = screenRef.current;
    history.pushState({ cinemastroLegal: true }, "", spaUrlForOverlay({ legal: target }));
    legalHistoryPushedRef.current = true;
    setScreen(target);
  }

  function closeLegalPage() {
    if (legalHistoryPushedRef.current) {
      history.back();
      return;
    }
    history.replaceState(null, "", spaUrlWithoutOverlays());
    const ret = legalReturnScreenRef.current;
    legalReturnScreenRef.current = null;
    setScreen(ret ?? "circles");
  }

  /** v4.0.8: Landing surface is now Circles; "home" as a screen has been retired. `navTab === "home"`
   *  stays as the idle bottom-nav sentinel (i.e. neither Mood nor Profile is active). */
  function goHome() {
    const s = screenRef.current;
    if (s === "onboarding" || s === "rate-more") void markOnboardingComplete();
    history.replaceState(null, "", spaUrlWithoutOverlays());
    detailHistoryPushedRef.current = false;
    legalHistoryPushedRef.current = false;
    setNavTab("home");
    setScreen("circles");
    setSelected(null);
    setDetailEditRating(false);
    setShowAvatarMenu(false);
  }

  // ============================================================================================
  // Circles (Phase A) — data loaders + actions. Uses the supabase client directly (no Edge yet).
  // ============================================================================================

  const reloadMyCircles = useCallback(async () => {
    if (!user) return;
    setCirclesLoading(true);
    setCirclesError("");
    try {
      const rows = await fetchMyCircles();
      setCirclesList(rows);
      setCirclesLoaded(true);
    } catch (e) {
      console.error("Circles: fetchMyCircles failed", e);
      setCirclesError(e?.message || "Could not load your circles.");
    } finally {
      setCirclesLoading(false);
    }
  }, [user]);

  // Initial load once the user is signed in and the circles page is reachable.
  useEffect(() => {
    if (!user) {
      setCirclesList([]);
      setCirclesLoaded(false);
      return;
    }
    if (circlesLoaded) return;
    void reloadMyCircles();
  }, [user, circlesLoaded, reloadMyCircles]);

  // Also refresh whenever the user navigates to the Circles list (cheap; small response).
  useEffect(() => {
    if (!user) return;
    if (screen !== "circles") return;
    if (!circlesLoaded) return;
    void reloadMyCircles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const activeCirclesCount = circlesList.length;
  const atCircleCap = activeCirclesCount >= CIRCLE_CAP;

  const circleNameById = useMemo(() => {
    const map = new Map();
    for (const c of circlesList) {
      if (c?.id) map.set(c.id, c.name);
    }
    return map;
  }, [circlesList]);

  const publishModalCircles = useMemo(
    () => circlesList.filter((c) => c?.status === "active"),
    [circlesList],
  );

  function openCreateCircleSheet() {
    if (atCircleCap) return;
    setCreateCircleName("");
    setCreateCircleDescription("");
    setCreateCircleVibe("Mixed Bag");
    setCreateCircleError("");
    setShowCreateCircleSheet(true);
  }

  function closeCreateCircleSheet() {
    if (createCircleSubmitting) return;
    setShowCreateCircleSheet(false);
    setCreateCircleError("");
  }

  async function submitCreateCircle() {
    if (!user || createCircleSubmitting) return;
    const nameCheck = validateCircleName(createCircleName);
    if (!nameCheck.ok) {
      setCreateCircleError(nameCheck.error);
      return;
    }
    if (createCircleDescription.length > CIRCLE_DESCRIPTION_MAX) {
      setCreateCircleError(`Description must be ${CIRCLE_DESCRIPTION_MAX} characters or fewer.`);
      return;
    }
    if (atCircleCap) {
      setCreateCircleError("You're at the 10-circle limit. Leave one to create another.");
      return;
    }
    setCreateCircleSubmitting(true);
    setCreateCircleError("");
    try {
      const fresh = await createCircle({
        name: nameCheck.name,
        description: createCircleDescription,
        vibe: createCircleVibe,
        creatorId: user.id,
      });
      setCirclesList((prev) => [fresh, ...prev]);
      setShowCreateCircleSheet(false);
      setCreateCircleName("");
      setCreateCircleDescription("");
      setCreateCircleVibe("Mixed Bag");
    } catch (e) {
      console.error("Circles: createCircle failed", e);
      setCreateCircleError(e?.message || "Could not create circle. Please try again.");
    } finally {
      setCreateCircleSubmitting(false);
    }
  }

  function openCircleDetail(circleId) {
    if (!circleId) return;
    setSelectedCircleId(circleId);
    setCircleDetailData(null);
    setCircleDetailError("");
    setLeaveCircleError("");
    setCircleStripPayload(null);
    setCircleStripError("");
    setCircleStripExtraMovies(new Map());
    setScreen("circle-detail");
  }

  function backFromCircleDetail() {
    setSelectedCircleId(null);
    setCircleDetailData(null);
    setCircleDetailError("");
    setLeaveCircleError("");
    setLeaveConfirmCircle(null);
    setShowCircleInfoSheet(false);
    setCircleInfoNamesById({});
    setCircleStripPayload(null);
    setCircleStripError("");
    setCircleStripExtraMovies(new Map());
    setScreen("circles");
  }

  // Load circle detail when entering the detail screen.
  useEffect(() => {
    if (screen !== "circle-detail") return;
    if (!selectedCircleId) return;
    let cancelled = false;
    setCircleDetailLoading(true);
    setCircleDetailError("");
    (async () => {
      try {
        const detail = await fetchCircleDetail(selectedCircleId);
        if (cancelled) return;
        if (!detail) {
          setCircleDetailError("This circle is no longer available.");
          setCircleDetailData(null);
        } else {
          setCircleDetailData(detail);
        }
      } catch (e) {
        if (cancelled) return;
        console.error("Circles: fetchCircleDetail failed", e);
        setCircleDetailError(e?.message || "Could not load circle.");
      } finally {
        if (!cancelled) setCircleDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, selectedCircleId]);

  useEffect(() => {
    setCircleStripExtraMovies(new Map());
  }, [selectedCircleId]);

  useEffect(() => {
    setCircleRatingsView("recent");
    setCircleGridAllPayload(null);
    setCircleGridAllLoading(false);
    setCircleGridAllLoadingMore(false);
    setCircleGridAllError("");
    setCircleGridTopPayload(null);
    setCircleGridTopLoading(false);
    setCircleGridTopLoadingMore(false);
    setCircleGridTopError("");
  }, [selectedCircleId]);

  // Phase C: circle rated strip (Edge + RPC) — first page only; see loadCircleStripMore.
  useEffect(() => {
    if (screen !== "circle-detail" || !selectedCircleId || !user) {
      return;
    }
    let cancelled = false;
    setCircleStripPayload(null);
    setCircleStripLoadingMore(false);
    setCircleStripLoading(true);
    setCircleStripError("");
    (async () => {
      try {
        const data = await fetchCircleRatedTitles({
          circleId: selectedCircleId,
          limit: CIRCLE_STRIP_INITIAL,
          offset: 0,
          view: "recent",
        });
        if (cancelled) return;
        setCircleStripPayload(data);
      } catch (e) {
        if (cancelled) return;
        console.error("Circles: fetchCircleRatedTitles failed", e);
        setCircleStripError(e?.message || "Could not load circle titles.");
        setCircleStripPayload(null);
      } finally {
        if (!cancelled) setCircleStripLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, selectedCircleId, user, circleRatedRefreshKey]);

  useEffect(() => {
    if (screen !== "circle-detail") return;
    setCircleGridAllPayload(null);
    setCircleGridTopPayload(null);
  }, [circleRatedRefreshKey, screen, selectedCircleId]);

  useEffect(() => {
    if (!publishRatingModal) {
      setPublishModalSelection(new Set());
      setPublishModalError("");
      return;
    }
    let cancelled = false;
    if (publishRatingModal.mode === "manage") {
      fetchRatingCircleShareIds(publishRatingModal.movieId)
        .then((ids) => {
          if (!cancelled) setPublishModalSelection(new Set(ids));
        })
        .catch((e) => {
          if (!cancelled) setPublishModalError(e?.message || "Could not load.");
        });
    } else {
      setPublishModalSelection(new Set(publishRatingModal.defaultCircleIds || []));
    }
    return () => {
      cancelled = true;
    };
  }, [publishRatingModal]);

  useEffect(() => {
    if (screen !== "circle-detail" || !selectedCircleId || !user) return;
    if (circleRatingsView !== "all") return;
    if (circleGridAllPayload != null) return;
    let cancelled = false;
    setCircleGridAllLoading(true);
    setCircleGridAllError("");
    (async () => {
      try {
        const data = await fetchCircleRatedTitles({
          circleId: selectedCircleId,
          limit: CIRCLE_GRID_PAGE,
          offset: 0,
          view: "all",
        });
        if (cancelled) return;
        setCircleGridAllPayload(data);
      } catch (e) {
        if (cancelled) return;
        console.error("Circles: fetchCircleRatedTitles (all) failed", e);
        setCircleGridAllError(e?.message || "Could not load titles.");
        setCircleGridAllPayload(null);
      } finally {
        if (!cancelled) setCircleGridAllLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, selectedCircleId, user, circleRatingsView, circleGridAllPayload]);

  useEffect(() => {
    if (screen !== "circle-detail" || !selectedCircleId || !user) return;
    if (circleRatingsView !== "top") return;
    if (circleGridTopPayload != null) return;
    let cancelled = false;
    setCircleGridTopLoading(true);
    setCircleGridTopError("");
    (async () => {
      try {
        const data = await fetchCircleRatedTitles({
          circleId: selectedCircleId,
          limit: CIRCLE_GRID_PAGE,
          offset: 0,
          view: "top",
        });
        if (cancelled) return;
        setCircleGridTopPayload(data);
      } catch (e) {
        if (cancelled) return;
        console.error("Circles: fetchCircleRatedTitles (top) failed", e);
        setCircleGridTopError(e?.message || "Could not load titles.");
        setCircleGridTopPayload(null);
      } finally {
        if (!cancelled) setCircleGridTopLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, selectedCircleId, user, circleRatingsView, circleGridTopPayload]);

  async function loadCircleStripMore() {
    if (!selectedCircleId || !user || circleStripLoadingMore || circleStripLoading) return;
    const prev = circleStripPayload;
    if (!prev || prev.gated) return;
    const cur = Array.isArray(prev.titles) ? prev.titles : [];
    const offset = cur.length;
    if (offset >= CIRCLE_STRIP_MAX || !prev.has_more) return;

    circleRecentSkipScrollAfterLoadMoreRef.current = true;
    setCircleStripLoadingMore(true);
    setCircleStripError("");
    try {
      const data = await fetchCircleRatedTitles({
        circleId: selectedCircleId,
        limit: CIRCLE_STRIP_PAGE,
        offset,
        view: "recent",
      });
      setCircleStripPayload((p) => {
        const base = p || {};
        const merged = [
          ...(Array.isArray(base.titles) ? base.titles : []),
          ...(Array.isArray(data.titles) ? data.titles : []),
        ];
        return {
          ...data,
          titles: merged,
          total_eligible: data.total_eligible ?? base.total_eligible,
          has_more: Boolean(data.has_more),
        };
      });
    } catch (e) {
      console.error("Circles: loadCircleStripMore failed", e);
      setCircleStripError(e?.message || "Could not load more titles.");
    } finally {
      setCircleStripLoadingMore(false);
    }
  }

  const updateCircleRecentScrollLeftHint = useCallback(() => {
    const scroller = circleRecentStripRef.current;
    if (!scroller) {
      setCircleRecentLeftScrollHint(false);
      return;
    }
    const { scrollWidth, clientWidth, scrollLeft } = scroller;
    const canScrollX = scrollWidth - clientWidth > 2;
    setCircleRecentLeftScrollHint(canScrollX && scrollLeft > 4);
  }, []);

  // Circle Recent: on first load / circle change, scroll so newest title is ~centered; skip re-center after “Load earlier”.
  useLayoutEffect(() => {
    if (screen !== "circle-detail" || circleRatingsView !== "recent" || !circleStripPayload) return;
    if (circleStripLoading) return;
    if (circleStripLoadingMore) return;
    if (circleRecentSkipScrollAfterLoadMoreRef.current) {
      circleRecentSkipScrollAfterLoadMoreRef.current = false;
      return;
    }
    const scroller = circleRecentStripRef.current;
    if (!scroller) return;
    const t = Array.isArray(circleStripPayload.titles) ? circleStripPayload.titles : [];
    const center = (el) => {
      if (!el) return;
      const left = el.offsetLeft + el.offsetWidth / 2 - scroller.clientWidth / 2;
      scroller.scrollLeft = Math.max(0, Math.min(left, scroller.scrollWidth - scroller.clientWidth));
    };
    if (t.length === 0) {
      center(circleRecentAddCtaRef.current);
    } else {
      center(circleRecentNewestRef.current);
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateCircleRecentScrollLeftHint();
      });
    });
  }, [screen, circleRatingsView, selectedCircleId, circleStripPayload, circleStripLoading, circleStripLoadingMore, circleRatedRefreshKey, updateCircleRecentScrollLeftHint]);

  useEffect(() => {
    if (screen !== "circle-detail" || circleRatingsView !== "recent" || !circleStripPayload || circleStripLoading) {
      setCircleRecentLeftScrollHint(false);
      return;
    }
    const scroller = circleRecentStripRef.current;
    if (!scroller) return;
    const onScroll = () => {
      updateCircleRecentScrollLeftHint();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      onScroll();
    });
    ro.observe(scroller);
    window.addEventListener("resize", onScroll, { passive: true });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateCircleRecentScrollLeftHint();
      });
    });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      ro.disconnect();
      window.removeEventListener("resize", onScroll);
    };
  }, [
    screen,
    circleRatingsView,
    circleStripPayload,
    circleStripLoading,
    updateCircleRecentScrollLeftHint,
  ]);

  async function loadCircleGridAllMore() {
    if (!selectedCircleId || !user || circleGridAllLoadingMore || circleGridAllLoading) return;
    const prev = circleGridAllPayload;
    if (!prev || prev.gated) return;
    const cur = Array.isArray(prev.titles) ? prev.titles : [];
    const offset = cur.length;
    if (!prev.has_more) return;
    setCircleGridAllLoadingMore(true);
    setCircleGridAllError("");
    try {
      const data = await fetchCircleRatedTitles({
        circleId: selectedCircleId,
        limit: CIRCLE_GRID_PAGE,
        offset,
        view: "all",
      });
      setCircleGridAllPayload((p) => {
        const base = p || {};
        const merged = [
          ...(Array.isArray(base.titles) ? base.titles : []),
          ...(Array.isArray(data.titles) ? data.titles : []),
        ];
        return {
          ...data,
          titles: merged,
          total_eligible: data.total_eligible ?? base.total_eligible,
          has_more: Boolean(data.has_more),
        };
      });
    } catch (e) {
      console.error("Circles: loadCircleGridAllMore failed", e);
      setCircleGridAllError(e?.message || "Could not load more titles.");
    } finally {
      setCircleGridAllLoadingMore(false);
    }
  }

  async function loadCircleGridTopMore() {
    if (!selectedCircleId || !user || circleGridTopLoadingMore || circleGridTopLoading) return;
    const prev = circleGridTopPayload;
    if (!prev || prev.gated) return;
    const cur = Array.isArray(prev.titles) ? prev.titles : [];
    const offset = cur.length;
    if (offset >= CIRCLE_TOP_MAX || !prev.has_more) return;
    setCircleGridTopLoadingMore(true);
    setCircleGridTopError("");
    try {
      const data = await fetchCircleRatedTitles({
        circleId: selectedCircleId,
        limit: CIRCLE_GRID_PAGE,
        offset,
        view: "top",
      });
      setCircleGridTopPayload((p) => {
        const base = p || {};
        const prevTitles = Array.isArray(base.titles) ? base.titles : [];
        const nextChunk = Array.isArray(data.titles) ? data.titles : [];
        const merged = prevTitles.concat(nextChunk).slice(0, CIRCLE_TOP_MAX);
        return {
          ...data,
          titles: merged,
          total_eligible: data.total_eligible ?? base.total_eligible,
          has_more: Boolean(data.has_more) && merged.length < CIRCLE_TOP_MAX,
        };
      });
    } catch (e) {
      console.error("Circles: loadCircleGridTopMore failed", e);
      setCircleGridTopError(e?.message || "Could not load more titles.");
    } finally {
      setCircleGridTopLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!showCircleInfoSheet || !circleDetailData?.members?.length) {
      if (!showCircleInfoSheet) setCircleInfoNamesById({});
      return;
    }
    let cancelled = false;
    setCircleInfoNamesById({});
    const circleId = circleDetailData.id;
    const ids = circleDetailData.members.map((m) => m.user_id);
    (async () => {
      const { data: rpcRows, error: rpcError } = await supabase.rpc("get_circle_member_names", {
        p_circle_id: circleId,
      });
      if (cancelled) return;
      const next = {};
      if (!rpcError && Array.isArray(rpcRows)) {
        for (const row of rpcRows) {
          if (row?.user_id) {
            next[row.user_id] = typeof row.member_name === "string" ? row.member_name : "";
          }
        }
      }
      const needProfiles = ids.filter((id) => !(id in next));
      if (needProfiles.length) {
        const { data: profs, error: profErr } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", needProfiles);
        if (cancelled) return;
        if (!profErr && Array.isArray(profs)) {
          for (const p of profs) {
            if (p?.id && !(p.id in next)) {
              next[p.id] = typeof p.name === "string" ? p.name : "";
            }
          }
        }
      }
      setCircleInfoNamesById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [showCircleInfoSheet, circleDetailData?.id]);

  useEffect(() => {
    setShowCircleInfoSheet(false);
  }, [selectedCircleId]);

  function requestLeaveCircle(circle) {
    if (!circle) return;
    setLeaveCircleError("");
    setLeaveConfirmCircle(circle);
  }

  function openLeaveFromCircleInfo() {
    setShowCircleInfoSheet(false);
    if (circleDetailData) requestLeaveCircle(circleDetailData);
  }

  function cancelLeaveCircle() {
    if (leaveCircleBusy) return;
    setLeaveConfirmCircle(null);
  }

  async function confirmLeaveCircle() {
    if (!user || !leaveConfirmCircle || leaveCircleBusy) return;
    const target = leaveConfirmCircle;
    const role = currentUserRole(target, user.id);
    setLeaveCircleBusy(true);
    setLeaveCircleError("");
    try {
      await leaveCircle({
        circleId: target.id,
        userId: user.id,
        isCreator: role === "creator",
      });
      setCirclesList((prev) => prev.filter((c) => c.id !== target.id));
      setLeaveConfirmCircle(null);
      backFromCircleDetail();
    } catch (e) {
      console.error("Circles: leaveCircle failed", e);
      setLeaveCircleError(e?.message || "Could not leave the circle. Please try again.");
    } finally {
      setLeaveCircleBusy(false);
    }
  }

  // ============================================================================================
  // Circles Phase B (v5.1.0) — pending invites + invite-by-email.
  // ============================================================================================

  const reloadPendingInvites = useCallback(async () => {
    if (!user) return;
    setPendingInvitesLoading(true);
    setPendingInvitesError("");
    try {
      const rows = await fetchPendingInvites();
      setPendingInvites(rows);
      setPendingInvitesLoaded(true);
    } catch (e) {
      console.error("Circles: fetchPendingInvites failed", e);
      setPendingInvitesError(e?.message || "Could not load invites.");
    } finally {
      setPendingInvitesLoading(false);
    }
  }, [user]);

  // Initial fetch once signed in; also refresh every time the user lands on the circles list.
  useEffect(() => {
    if (!user) {
      setPendingInvites([]);
      setPendingInvitesLoaded(false);
      return;
    }
    if (!pendingInvitesLoaded) {
      void reloadPendingInvites();
    }
  }, [user, pendingInvitesLoaded, reloadPendingInvites]);

  useEffect(() => {
    if (!user) return;
    if (screen !== "circles") return;
    if (!pendingInvitesLoaded) return;
    void reloadPendingInvites();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const pendingInvitesCount = pendingInvites.length;

  function openInvitesPanel() {
    setInviteActionError("");
    setShowInvitesPanel(true);
    if (user && !pendingInvitesLoading) void reloadPendingInvites();
  }

  function closeInvitesPanel() {
    setShowInvitesPanel(false);
    setInviteActionError("");
  }

  function markInviteBusy(inviteId, action) {
    setInviteActionBusy((prev) => ({ ...prev, [inviteId]: action }));
  }

  function clearInviteBusy(inviteId) {
    setInviteActionBusy((prev) => {
      if (!(inviteId in prev)) return prev;
      const next = { ...prev };
      delete next[inviteId];
      return next;
    });
  }

  async function handleAcceptInvite(invite) {
    if (!user || !invite || inviteActionBusy[invite.id]) return;
    setInviteActionError("");
    markInviteBusy(invite.id, "accepting");
    try {
      const res = await acceptCircleInvite({ inviteId: invite.id });
      setPendingInvites((prev) => prev.filter((row) => row.id !== invite.id));
      // Prepend the full circle row so the user sees it in the Circles list immediately.
      const raw = res?.circle;
      if (raw && typeof raw === "object") {
        const members = Array.isArray(raw.circle_members) ? raw.circle_members : [];
        const normalized = {
          id: raw.id,
          name: raw.name,
          description: raw.description ?? "",
          vibe: raw.vibe ?? "Mixed Bag",
          status: raw.status,
          archivedAt: raw.archived_at,
          createdAt: raw.created_at,
          creatorId: raw.creator_id,
          memberCount: members.length,
          members,
        };
        if (normalized.status === "active") {
          setCirclesList((prev) => {
            const without = prev.filter((c) => c.id !== normalized.id);
            return [normalized, ...without];
          });
        }
      }
      setInviteToast({
        tone: "ok",
        text: `Joined ${invite.circleName}.`,
      });
      if (pendingInvites.length <= 1) setShowInvitesPanel(false);
    } catch (e) {
      console.error("Circles: acceptCircleInvite failed", e);
      setInviteActionError(e?.message || "Could not accept that invite.");
    } finally {
      clearInviteBusy(invite.id);
    }
  }

  async function handleDeclineInvite(invite) {
    if (!user || !invite || inviteActionBusy[invite.id]) return;
    setInviteActionError("");
    markInviteBusy(invite.id, "declining");
    try {
      await declineCircleInvite({ inviteId: invite.id });
      setPendingInvites((prev) => prev.filter((row) => row.id !== invite.id));
      if (pendingInvites.length <= 1) setShowInvitesPanel(false);
    } catch (e) {
      console.error("Circles: declineCircleInvite failed", e);
      setInviteActionError(e?.message || "Could not decline that invite.");
    } finally {
      clearInviteBusy(invite.id);
    }
  }

  function openInviteSheet() {
    setShowCircleInfoSheet(false);
    setInviteEmailDraft("");
    setInviteSheetError("");
    setShowInviteSheet(true);
  }

  function closeInviteSheet() {
    if (inviteSheetSubmitting) return;
    setShowInviteSheet(false);
    setInviteSheetError("");
  }

  async function submitInviteByEmail() {
    if (!user || inviteSheetSubmitting) return;
    if (!circleDetailData) return;
    const email = inviteEmailDraft.trim();
    if (!email) {
      setInviteSheetError("Enter an email address.");
      return;
    }
    setInviteSheetSubmitting(true);
    setInviteSheetError("");
    try {
      const res = await sendCircleInvite({
        circleId: circleDetailData.id,
        invitedEmail: email,
      });
      const recipientName = res?.recipient?.name || email;
      if (res?.auto_declined) {
        setInviteToast({
          tone: "warn",
          text: `${recipientName}'s circles are full — invite was auto-declined.`,
        });
      } else {
        setInviteToast({
          tone: "ok",
          text: `Invite sent to ${recipientName}.`,
        });
      }
      setShowInviteSheet(false);
      setInviteEmailDraft("");
    } catch (e) {
      console.error("Circles: sendCircleInvite failed", e);
      setInviteSheetError(e?.message || "Could not send the invite.");
    } finally {
      setInviteSheetSubmitting(false);
    }
  }

  // Auto-dismiss the transient toast after ~3.2s.
  useEffect(() => {
    if (!inviteToast) return;
    const t = setTimeout(() => setInviteToast(null), 3200);
    return () => clearTimeout(t);
  }, [inviteToast]);

  const shouldShowSecondaryRegionPage = Boolean(secondaryRegionKey);
  /** v4.0.8: `home` retired as a screen; `circles` is the landing. Kept `home` out of the set so
   *  lingering `setScreen("home")` (any we missed) would visibly fail instead of silently rendering
   *  nothing. */
  const primaryNavScreens = new Set([
    "circles",
    "circle-detail",
    "pulse",
    "in-theaters",
    "streaming-page",
    "your-picks",
    "secondary-region",
    "discover",
    "profile",
    "watchlist",
    "rated",
    "mood-picker",
    "mood-results",
    "detail",
  ]);
  const menuItems = [
    { id: "circles", label: "Circles" },
    { id: "pulse", label: "Pulse" },
    { id: "in-theaters", label: "In Theaters" },
    { id: "streaming-page", label: "Streaming" },
    { id: "your-picks", label: "Your Picks" },
    { id: "watchlist", label: "Watchlist" },
    ...(shouldShowSecondaryRegionPage
      ? [{ id: "secondary-region", label: V130_SECONDARY_HOME_TITLE[secondaryRegionKey] ?? "Region" }]
      : []),
  ];
  // v5.0.0: keep the "Circles" section link highlighted while the user is drilled into a circle.
  const activeSectionId = screen === "discover" ? null : screen === "circle-detail" ? "circles" : screen;

  /** Leaving title detail via top nav (not browser back): drop overlay URL + selection without `history.back()`. */
  function clearDetailOverlayToNavigate() {
    if (screen !== "detail") return;
    if (detailHistoryPushedRef.current) {
      history.replaceState(null, "", spaUrlWithoutOverlays());
      detailHistoryPushedRef.current = false;
    }
    detailReturnScreenRef.current = null;
    setSelected(null);
    setDetailEditRating(false);
  }

  /** Discover → pick a title → rate; `goBack` / after submit returns to this circle. */
  function openDiscoverFromCircleForRating() {
    if (!selectedCircleId || !circleDetailData || circleDetailData.status !== "active") return;
    rateTitleReturnCircleIdRef.current = selectedCircleId;
    clearDetailOverlayToNavigate();
    setNavTab("discover");
    setScreen("discover");
  }

  function navigatePrimarySection(nextScreen) {
    clearDetailOverlayToNavigate();
    if (nextScreen === "pulse") {
      setNavTab("home");
      setScreen("pulse");
      return;
    }
    if (nextScreen === "watchlist") {
      setNavTab("watchlist");
      setScreen("watchlist");
      return;
    }
    /* Primary nav → Circles / Pulse / etc. is not a bottom-tab screen; clear watchlist/mood/profile highlight. */
    setNavTab("home");
    setScreen(nextScreen);
  }

  const showPrimaryNav = Boolean(user && primaryNavScreens.has(screen));

  useEffect(() => {
    if (!showAvatarMenu) return;
    const close = () => setShowAvatarMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showAvatarMenu]);

  useEffect(() => {
    if (screen !== "watchlist") setWatchlistRowMenuId(null);
  }, [screen]);

  useEffect(() => {
    if (!watchlistRowMenuId) return;
    const close = () => setWatchlistRowMenuId(null);
    const t = window.setTimeout(() => window.addEventListener("click", close), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("click", close);
    };
  }, [watchlistRowMenuId]);

  useEffect(() => {
    if (!circleRecentStripMenuRowKey) return;
    const close = () => setCircleRecentStripMenuRowKey(null);
    const t = window.setTimeout(() => window.addEventListener("click", close), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("click", close);
    };
  }, [circleRecentStripMenuRowKey]);

  useEffect(() => {
    if (!circleRecentStripMenuRowKey) return;
    const el = circleRecentStripRef.current;
    if (!el) return;
    const onScroll = () => setCircleRecentStripMenuRowKey(null);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [circleRecentStripMenuRowKey]);

  useEffect(() => {
    setCircleRecentStripMenuRowKey(null);
  }, [selectedCircleId, circleRatingsView, screen]);

  useEffect(
    () => () => {
      if (circleRecentStripLongPressTimerRef.current != null) {
        window.clearTimeout(circleRecentStripLongPressTimerRef.current);
        circleRecentStripLongPressTimerRef.current = null;
      }
    },
    [],
  );

  const watchlistDisplay = useMemo(() => {
    return [...watchlist].sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0));
  }, [watchlist]);

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

  /** Open detail from shared / bookmarked `?detail=movie-769` once we can resolve the row. */
  useEffect(() => {
    const u = new URL(window.location.href);
    const detailId = u.searchParams.get(SPA_QS_DETAIL);
    if (!detailId || deepLinkDetailAppliedRef.current) return;
    if (!SPA_DEEPLINK_READY_SCREENS.has(screen)) return;
    const movie = movieLookupById.get(detailId);
    if (!movie) return;
    deepLinkDetailAppliedRef.current = true;
    void openDetail(movie, null, { skipHistoryPush: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- openDetail omitted (hoisted); single apply gated by ref
  }, [movieLookupById, screen]);

  /** `?legal=privacy` etc. when not showing a detail link. */
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get(SPA_QS_DETAIL)) return;
    const legal = u.searchParams.get(SPA_QS_LEGAL);
    if (!legal || !SPA_LEGAL_SCREENS.has(legal) || deepLinkLegalAppliedRef.current) return;
    if (!SPA_DEEPLINK_READY_SCREENS.has(screen)) return;
    deepLinkLegalAppliedRef.current = true;
    legalReturnScreenRef.current = "home";
    legalHistoryPushedRef.current = false;
    setScreen(legal);
  }, [screen]);

  function clearCircleRecentStripLongPressTimer() {
    if (circleRecentStripLongPressTimerRef.current != null) {
      window.clearTimeout(circleRecentStripLongPressTimerRef.current);
      circleRecentStripLongPressTimerRef.current = null;
    }
  }

  async function unpublishTitleFromCircleStrip(movieId) {
    if (!selectedCircleId || !user) return;
    setCircleStripUnpublishBusy(true);
    try {
      const ids = await fetchRatingCircleShareIds(movieId);
      const next = ids.filter((id) => id !== selectedCircleId);
      await syncRatingCircleShares(movieId, next);
      setCircleRecentStripMenuRowKey(null);
      setCircleRatedRefreshKey((k) => k + 1);
    } catch (e) {
      setInviteToast({
        tone: "warn",
        text: e?.message || "Could not remove from this circle.",
      });
    } finally {
      setCircleStripUnpublishBusy(false);
    }
  }

  async function toggleWatchlist(movie, opts = {}) {
    const skipGoBack = opts.skipGoBack === true;
    const circleIdForSource =
      opts.circleIdForSource != null ? opts.circleIdForSource : null;
    const alreadySaved = watchlist.find(m => m.id === movie.id);
    const fromCircleContext =
      circleIdForSource != null
        ? Boolean(circleIdForSource)
        : detailReturnScreenRef.current === "circle-detail" && selectedCircleId;
    const sourceCircleId =
      circleIdForSource != null ? circleIdForSource : (fromCircleContext ? selectedCircleId : null);

    if (user && !alreadySaved) {
      if (watchlist.length >= WATCHLIST_MAX) {
        setInviteToast({
          tone: "warn",
          text: `Watchlist is full (${WATCHLIST_MAX} titles). Remove one to add more.`,
        });
        return;
      }
      const [type, tmdbId] = movie.id.split("-");
      const tid = parseInt(tmdbId, 10);
      const { data: rows } = await supabase
        .from("watchlist")
        .select("sort_index")
        .eq("user_id", user.id)
        .order("sort_index", { ascending: false })
        .limit(1);
      const nextSort = (rows?.[0]?.sort_index != null ? Number(rows[0].sort_index) : -1) + 1;
      const row = {
        user_id: user.id,
        tmdb_id: tid,
        media_type: type,
        title: movie.title,
        poster: movie.poster,
        sort_index: nextSort,
      };
      if (sourceCircleId) row.source_circle_id = sourceCircleId;
      const { error: insertErr } = await supabase.from("watchlist").insert(row);
      if (insertErr) {
        setInviteToast({
          tone: "warn",
          text: insertErr.message || "Could not add to watchlist.",
        });
        return;
      }
      setWatchlist((w) => [
        ...w,
        {
          ...movie,
          fromGroup: Boolean(sourceCircleId),
          source_circle_id: sourceCircleId ?? null,
          sort_index: nextSort,
        },
      ]);
      if (!skipGoBack) setTimeout(() => goBack(), 1000);
      return;
    }

    if (user && alreadySaved) {
      const [type, tmdbId] = movie.id.split("-");
      setWatchlist((w) => w.filter((m) => m.id !== movie.id));
      await supabase.from("watchlist").delete().eq("user_id", user.id).eq("tmdb_id", parseInt(tmdbId, 10)).eq("media_type", type);
      return;
    }

    if (!alreadySaved && watchlist.length >= WATCHLIST_MAX) {
      setInviteToast({
        tone: "warn",
        text: `Watchlist is full (${WATCHLIST_MAX} titles). Remove one to add more.`,
      });
      return;
    }

    setWatchlist((w) =>
      alreadySaved
        ? w.filter((m) => m.id !== movie.id)
        : [
            ...w,
            {
              ...movie,
              fromGroup: Boolean(sourceCircleId),
              source_circle_id: sourceCircleId ?? null,
              sort_index: w.reduce((m, x) => Math.max(m, x.sort_index ?? -1), -1) + 1,
            },
          ],
    );
    if (!alreadySaved && !skipGoBack) {
      setTimeout(() => goBack(), 1000);
    }
  }

  function watchlistRowKeys(m) {
    let tid = Number(m?.tmdbId ?? m?.tmdb_id);
    let rawType = String(m?.type || "movie").toLowerCase();
    if (rawType !== "tv") rawType = "movie";
    if (!Number.isFinite(tid) && m?.id != null) {
      const p = parseMediaKey(m.id);
      if (p) {
        tid = p.tmdbId;
        rawType = p.type;
      }
    }
    if (!Number.isFinite(tid)) return null;
    return { tid, mt: rawType === "tv" ? "tv" : "movie" };
  }

  async function swapWatchlistOrder(movieId, direction) {
    if (!user) return;
    const list = [...watchlist].sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0));
    const i = list.findIndex((m) => m.id === movieId);
    if (i < 0) return;
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    const cur = list[i];
    const other = list[j];
    const curK = watchlistRowKeys(cur);
    const othK = watchlistRowKeys(other);
    if (!curK || !othK) {
      console.warn("Watchlist swap: bad row keys", { cur, other });
      return;
    }
    const a = cur.sort_index ?? i;
    const b = other.sort_index ?? j;
    const uid = user.id;
    const TEMP = 2147483646;
    try {
      // Do not require `.select()` / RETURNING: some RLS setups omit returned rows even when the row updated.
      const { error: e1 } = await supabase
        .from("watchlist")
        .update({ sort_index: TEMP })
        .eq("user_id", uid)
        .eq("tmdb_id", curK.tid)
        .eq("media_type", curK.mt);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("watchlist")
        .update({ sort_index: a })
        .eq("user_id", uid)
        .eq("tmdb_id", othK.tid)
        .eq("media_type", othK.mt);
      if (e2) throw e2;
      const { error: e3 } = await supabase
        .from("watchlist")
        .update({ sort_index: b })
        .eq("user_id", uid)
        .eq("tmdb_id", curK.tid)
        .eq("media_type", curK.mt);
      if (e3) throw e3;
    } catch (e) {
      console.warn("Watchlist reorder failed:", e);
      return;
    }
    setWatchlist((w) => {
      const byId = new Map(w.map((m) => [m.id, { ...m }]));
      const c = byId.get(cur.id);
      const o = byId.get(other.id);
      if (c) c.sort_index = b;
      if (o) o.sort_index = a;
      return w.map((m) => byId.get(m.id) ?? m);
    });
    setWatchlistRowMenuId(null);
  }

  async function moveWatchlistItemToTop(movieId) {
    if (!user) return;
    const list = [...watchlist].sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0));
    const i = list.findIndex((m) => m.id === movieId);
    if (i <= 0) return;
    const cur = list[i];
    const top = list[0];
    const k = watchlistRowKeys(cur);
    if (!k) {
      console.warn("Watchlist to-top: bad row keys", cur);
      return;
    }
    const newSort = (Number(top.sort_index) || 0) - 1;
    const uid = user.id;
    try {
      const { error } = await supabase
        .from("watchlist")
        .update({ sort_index: newSort })
        .eq("user_id", uid)
        .eq("tmdb_id", k.tid)
        .eq("media_type", k.mt);
      if (error) throw error;
    } catch (e) {
      console.warn("Watchlist reorder failed:", e);
      return;
    }
    setWatchlist((w) =>
      w.map((m) => (m.id === cur.id ? { ...m, sort_index: newSort } : m)),
    );
    setWatchlistRowMenuId(null);
  }

  async function moveWatchlistItemToBottom(movieId) {
    if (!user) return;
    const list = [...watchlist].sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0));
    const i = list.findIndex((m) => m.id === movieId);
    if (i < 0 || i >= list.length - 1) return;
    const cur = list[i];
    const bot = list[list.length - 1];
    const k = watchlistRowKeys(cur);
    if (!k) {
      console.warn("Watchlist to-bottom: bad row keys", cur);
      return;
    }
    const newSort = (Number(bot.sort_index) || 0) + 1;
    const uid = user.id;
    try {
      const { error } = await supabase
        .from("watchlist")
        .update({ sort_index: newSort })
        .eq("user_id", uid)
        .eq("tmdb_id", k.tid)
        .eq("media_type", k.mt);
      if (error) throw error;
    } catch (e) {
      console.warn("Watchlist reorder failed:", e);
      return;
    }
    setWatchlist((w) =>
      w.map((m) => (m.id === cur.id ? { ...m, sort_index: newSort } : m)),
    );
    setWatchlistRowMenuId(null);
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
    const movie = catalogue.find(m => m.id === movieId) || moodResults.find((r) => r.movie.id === movieId)?.movie;
    const inWl = watchlist.some((m) => m.id === movieId);
    if (movie && !inWl && watchlist.length >= WATCHLIST_MAX) {
      setInviteToast({
        tone: "warn",
        text: `Watchlist is full (${WATCHLIST_MAX} titles). Remove one to add more.`,
      });
      return;
    }
    setSelectedToWatch((prev) => ({ ...prev, [movieId]: !prev[movieId] }));
    if (movie && !inWl) void toggleWatchlist(movie);
  }

  const inWatchlist = (id) => watchlist.some(m => m.id === id);
  const confToneLabel = (c) => c === "high" ? "High" : c === "medium" ? "Medium" : "Low";
  const shouldShowPredictionRange = (pred) => {
    if (!pred) return false;
    return formatScore(pred.low) !== formatScore(pred.high);
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

  const navProps = {
    navTab,
    setNavTab,
    setScreen,
    setMoodStep,
    setMoodSelections,
    setMoodResults,
    onSignOut: handleSignOut,
    clearDetailForBottomNav: clearDetailOverlayToNavigate,
  };

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
      <div
        className={`app${showPrimaryNav ? " app--primary-nav" : ""}`}
      >
        <style>{styles}</style>
        {showPrimaryNav && (
          <AppPrimaryNav
            menuItems={menuItems}
            activeSectionId={activeSectionId}
            onNavigateSection={navigatePrimarySection}
            onDiscover={() => {
              clearDetailOverlayToNavigate();
              setNavTab("discover");
              setScreen("discover");
            }}
            onHome={goHome}
            discoverActive={screen === "discover"}
            onDetailBack={screen === "detail" ? goBack : undefined}
          />
        )}

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
                {obMovie.poster ? (
                  <img src={posterSrcDetail(obMovie.poster)} alt={obMovie.title} loading="eager" decoding="async" />
                ) : (
                  <div className="card-poster-fallback">🎬</div>
                )}
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

      {screen === "circles" && (
        <div className="home">
          <div className="discover">
            <div className="discover-header circles-header">
              <div className="circles-header-row">
                <div className="circles-header-copy">
                  <div className="discover-title">Circles</div>
                  <div className="circles-count-sub">
                    {activeCirclesCount} of {CIRCLE_CAP} circles
                  </div>
                </div>
                <div className="circles-header-actions">
                  <button
                    type="button"
                    className={`circles-bell${pendingInvitesCount > 0 ? " circles-bell--active" : ""}`}
                    aria-label={
                      pendingInvitesCount > 0
                        ? `Pending invites (${pendingInvitesCount})`
                        : "Pending invites"
                    }
                    title={
                      pendingInvitesCount > 0
                        ? `${pendingInvitesCount} pending invite${pendingInvitesCount === 1 ? "" : "s"}`
                        : "No pending invites"
                    }
                    onClick={openInvitesPanel}
                    disabled={!user}
                  >
                    <span aria-hidden="true">🔔</span>
                    {pendingInvitesCount > 0 ? (
                      <span className="circles-bell-count">
                        {pendingInvitesCount > 99 ? "99+" : pendingInvitesCount}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="circles-new-btn"
                    onClick={openCreateCircleSheet}
                    disabled={atCircleCap || circlesLoading || !user}
                  >
                    + New Circle
                  </button>
                </div>
              </div>
              {atCircleCap && (
                <div className="circles-cap-banner">
                  You're at the {CIRCLE_CAP}-circle limit. Leave one to create or join another.
                </div>
              )}
              {circlesError && (
                <div className="circles-error-banner">{circlesError}</div>
              )}
            </div>

            {circlesLoading && !circlesLoaded ? (
              <div className="circles-skeleton">
                <div className="circles-skeleton-card" />
                <div className="circles-skeleton-card" />
                <div className="circles-skeleton-card" />
              </div>
            ) : activeCirclesCount === 0 ? (
              <div className="circles-empty">
                <div className="circles-empty-title">Create your first circle</div>
                <div className="circles-empty-sub">
                  Circles are private groups where your taste, ratings, and picks flow together.
                </div>
                <div className="circles-empty-slots" aria-hidden="true">
                  {Array.from({ length: CIRCLE_CAP }).map((_, i) => (
                    <div className="circles-empty-slot" key={i} />
                  ))}
                </div>
                <button
                  type="button"
                  className="circles-new-btn circles-new-btn--lg"
                  onClick={openCreateCircleSheet}
                  disabled={!user}
                >
                  + Create a circle
                </button>
              </div>
            ) : (
              <div className="circles-list">
                {circlesList.map((circle) => {
                  const meta = vibeMeta(circle.vibe);
                  const isCreator = currentUserRole(circle, user?.id) === "creator";
                  return (
                    <button
                      type="button"
                      key={circle.id}
                      className="circle-card"
                      onClick={() => openCircleDetail(circle.id)}
                      style={{
                        "--vibe-accent": meta.accent,
                        "--vibe-tint": meta.tint,
                      }}
                    >
                      <div className="circle-card__tint" aria-hidden="true" />
                      <div className="circle-card__body">
                        <div className="circle-card__top">
                          <div className="circle-card__name">{circle.name}</div>
                          {isCreator && (
                            <div className="circle-card__crown" title="You're the creator">👑</div>
                          )}
                        </div>
                        {circle.description && (
                          <div className="circle-card__desc">{circle.description}</div>
                        )}
                        <div className="circle-card__meta-row">
                          <span className="circle-card__vibe-badge">{meta.id}</span>
                          <span className="circle-card__members">
                            {circle.memberCount} {circle.memberCount === 1 ? "member" : "members"}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {/* Circles — circle detail: hero + Phase C rated strips + invite / leave */}
      {screen === "circle-detail" && (
        <div className="home">
          <div className="discover">
            <div className="circles-detail-shell">
              {circleDetailLoading && !circleDetailData ? (
                <>
                  <div className="circles-detail-topbar">
                    <button
                      type="button"
                      className="circles-detail-back-circle"
                      onClick={backFromCircleDetail}
                      aria-label="Back to circles"
                    >
                      <span className="circles-detail-back-circle__glyph" aria-hidden="true">&lt;</span>
                    </button>
                  </div>
                  <div className="circles-detail-loading">Loading…</div>
                </>
              ) : circleDetailError ? (
                <>
                  <div className="circles-detail-topbar">
                    <button
                      type="button"
                      className="circles-detail-back-circle"
                      onClick={backFromCircleDetail}
                      aria-label="Back to circles"
                    >
                      <span className="circles-detail-back-circle__glyph" aria-hidden="true">&lt;</span>
                    </button>
                  </div>
                  <div className="circles-detail-error-wrap">
                    <div className="circles-error-banner">{circleDetailError}</div>
                  </div>
                </>
              ) : circleDetailData ? (
                (() => {
                  const meta = vibeMeta(circleDetailData.vibe);
                  const isCreator = currentUserRole(circleDetailData, user?.id) === "creator";
                  const mc = circleDetailData.memberCount;
                  const initials = circleAvatarInitials(circleDetailData.name);
                  return (
                    <div
                      className="circle-hero circle-hero--detail"
                      style={{
                        "--vibe-accent": meta.accent,
                        "--vibe-tint": meta.tint,
                      }}
                    >
                      <div className="circle-hero__tint" aria-hidden="true" />
                      <div className="circle-hero__top-bar circle-hero__top-bar--detail-chat">
                        <div className="circle-hero__top-bar-side circle-hero__top-bar-side--left">
                          <button
                            type="button"
                            className="circles-detail-back-circle"
                            onClick={backFromCircleDetail}
                            aria-label="Back to circles"
                          >
                            <span className="circles-detail-back-circle__glyph" aria-hidden="true">&lt;</span>
                          </button>
                        </div>
                        <div className="circle-hero__top-bar-center">
                          <div className="circle-hero__identity">
                            <div className="circle-hero__avatar" aria-hidden="true">
                              <span className="circle-hero__avatar-initials">{initials}</span>
                            </div>
                            <div className="circle-hero__identity-text">
                              <div className="circle-hero__title-line">
                                {isCreator ? (
                                  <span
                                    className="circle-hero__creator-star"
                                    title="You're the creator"
                                    aria-hidden="true"
                                  >
                                    ★
                                  </span>
                                ) : null}
                                <span className="circle-hero__name circle-hero__name--top-bar">{circleDetailData.name}</span>
                              </div>
                              <div className="circle-hero__subtitle-members">
                                <span className="circle-hero__members-icon" aria-hidden="true">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="15"
                                    height="15"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.75"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                    <circle cx="9" cy="7" r="4" />
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                                  </svg>
                                </span>
                                <span className="circle-hero__members-num">{mc}</span>
                                <span className="circle-hero__members-label">
                                  {mc === 1 ? "member" : "members"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="circle-hero__top-bar-side circle-hero__top-bar-side--right">
                          <button
                            type="button"
                            className="circle-hero__info-btn circle-hero__info-btn--icon"
                            onClick={() => setShowCircleInfoSheet(true)}
                            aria-label="Circle info"
                          >
                            <span className="circle-hero__info-btn-i" aria-hidden="true">
                              i
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : null}
            </div>

            {circleDetailData && (
              <div className="circle-detail-body">
                {(() => {
                  const mc = circleDetailData.memberCount;
                  if (mc < 2) {
                    return (
                      <div className="circle-detail-placeholder">
                        <div className="circle-detail-placeholder__title">Ratings in this circle</div>
                        <div className="circle-detail-placeholder__text">
                          Once you have at least two members, you can publish titles here. Each pick appears
                          when a member has shared that rating to this circle — with a group score and
                          your personal prediction.
                        </div>
                      </div>
                    );
                  }
                  const showStripRaterCounts = mc > 2;
                  const ratingsTabs = (
                    <div className="section-header circle-detail-strip-header circle-detail-strip-header--tabs">
                      <div className="section-title">Ratings</div>
                      <div className="circle-detail-ratings-tabs" role="tablist" aria-label="Circle ratings views">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={circleRatingsView === "recent"}
                          className={`circle-detail-ratings-tab${circleRatingsView === "recent" ? " circle-detail-ratings-tab--active" : ""}`}
                          onClick={() => setCircleRatingsView("recent")}
                        >
                          Recent
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={circleRatingsView === "all"}
                          className={`circle-detail-ratings-tab${circleRatingsView === "all" ? " circle-detail-ratings-tab--active" : ""}`}
                          onClick={() => setCircleRatingsView("all")}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={circleRatingsView === "top"}
                          className={`circle-detail-ratings-tab${circleRatingsView === "top" ? " circle-detail-ratings-tab--active" : ""}`}
                          onClick={() => setCircleRatingsView("top")}
                        >
                          Top
                        </button>
                      </div>
                    </div>
                  );
                  const titles = Array.isArray(circleStripPayload?.titles) ? circleStripPayload.titles : [];
                  const stripTitlesOrdered = titles.length > 0 ? [...titles].reverse() : [];
                  const renderStripRow = (row, isNewest) => {
                    const movie = circleStripResolveMovie(row, movieLookupById, circleStripExtraMovies);
                    const rowKey = `${String(row.media_type)}-${Number(row.tmdb_id)}`;
                    const predDetail = circleStripPredictionForDetail(row);
                    const distinctRaters = Number(row.distinct_circle_raters ?? 0);
                    const predictedForBadge =
                      row.viewer_score != null && Number.isFinite(Number(row.viewer_score))
                        ? null
                        : row.prediction != null && typeof row.prediction.predicted === "number"
                          ? row.prediction.predicted
                          : null;
                    const predictedNeighborCount =
                      row.prediction != null
                        ? Number(row.prediction.neighborCount ?? row.prediction.neighbor_count ?? 0)
                        : 0;
                    if (!movie) {
                      return (
                        <div
                          className="strip-card strip-card--circle-pending"
                          key={rowKey}
                          ref={isNewest ? circleRecentNewestRef : null}
                        >
                          <div className="strip-poster strip-poster--circle-recent">
                            <div className="strip-poster-fallback">🎬</div>
                          </div>
                          <div className="strip-title strip-title--circle-single">Loading…</div>
                        </div>
                      );
                    }
                    const inWatchlist = Boolean(watchlist.find((m) => m.id === movie.id));
                    const hasUserRating = userRatings[movie.id] != null;
                    const userPublishedHere =
                      row.viewer_score != null && Number.isFinite(Number(row.viewer_score));
                    const onStripCardPointerDown = (e) => {
                      if (e.button !== 0) return;
                      const el = e.target;
                      if (el.closest?.(".strip-card__menu-btn")) return;
                      if (el.closest?.(".circle-recent-strip-menu")) return;
                      circleRecentStripLongPressStartRef.current = { x: e.clientX, y: e.clientY };
                      clearCircleRecentStripLongPressTimer();
                      circleRecentStripLongPressTimerRef.current = window.setTimeout(() => {
                        circleRecentStripLongPressTimerRef.current = null;
                        circleRecentStripSuppressClickRef.current = true;
                        setCircleRecentStripMenuRowKey(rowKey);
                      }, 520);
                    };
                    const onStripCardPointerMove = (e) => {
                      if (circleRecentStripLongPressTimerRef.current == null) return;
                      const { x, y } = circleRecentStripLongPressStartRef.current;
                      const dx = e.clientX - x;
                      const dy = e.clientY - y;
                      if (dx * dx + dy * dy > 100) {
                        clearCircleRecentStripLongPressTimer();
                      }
                    };
                    const onStripCardPointerEnd = () => {
                      clearCircleRecentStripLongPressTimer();
                    };
                    const openStripMenu = (e) => {
                      e.stopPropagation();
                      setCircleRecentStripMenuRowKey((k) => (k === rowKey ? null : rowKey));
                    };
                    const closeStripMenu = () => setCircleRecentStripMenuRowKey(null);
                    return (
                      <div
                        className="strip-card strip-card--circle-recent"
                        key={rowKey}
                        ref={isNewest ? circleRecentNewestRef : null}
                        role="button"
                        tabIndex={0}
                        onPointerDown={onStripCardPointerDown}
                        onPointerMove={onStripCardPointerMove}
                        onPointerUp={onStripCardPointerEnd}
                        onPointerLeave={onStripCardPointerEnd}
                        onPointerCancel={onStripCardPointerEnd}
                        onClick={(e) => {
                          const el = e.target;
                          if (el.closest?.(".strip-card__menu-btn")) return;
                          if (el.closest?.(".circle-recent-strip-menu")) return;
                          if (circleRecentStripSuppressClickRef.current) {
                            circleRecentStripSuppressClickRef.current = false;
                            return;
                          }
                          openDetail(movie, predDetail);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openDetail(movie, predDetail);
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="strip-card__menu-btn"
                          aria-label="Title actions"
                          aria-haspopup="true"
                          aria-expanded={circleRecentStripMenuRowKey === rowKey}
                          onClick={openStripMenu}
                        >
                          ⋯
                        </button>
                        {circleRecentStripMenuRowKey === rowKey ? (
                          <div
                            className="circle-recent-strip-menu"
                            role="menu"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="circle-recent-strip-menu__item"
                              role="menuitem"
                              onClick={() => {
                                closeStripMenu();
                                openDetail(movie, predDetail);
                              }}
                            >
                              Details
                            </button>
                            <button
                              type="button"
                              className="circle-recent-strip-menu__item"
                              role="menuitem"
                              onClick={() => {
                                closeStripMenu();
                                if (hasUserRating) {
                                  openDetail(movie, predDetail, { startEditing: true });
                                } else {
                                  openDetail(movie, predDetail);
                                }
                              }}
                            >
                              {hasUserRating ? "Rerate" : "Rate"}
                            </button>
                            <button
                              type="button"
                              className="circle-recent-strip-menu__item"
                              role="menuitem"
                              disabled={!inWatchlist && watchlist.length >= WATCHLIST_MAX}
                              onClick={() => {
                                closeStripMenu();
                                void toggleWatchlist(movie, {
                                  skipGoBack: true,
                                  circleIdForSource: selectedCircleId,
                                });
                              }}
                            >
                              {inWatchlist ? "Delete from watchlist" : "Add to watchlist"}
                            </button>
                            {hasUserRating ? (
                              <button
                                type="button"
                                className="circle-recent-strip-menu__item"
                                role="menuitem"
                                onClick={() => {
                                  closeStripMenu();
                                  setPublishRatingModal({ movieId: movie.id, mode: "manage" });
                                }}
                              >
                                Forward
                              </button>
                            ) : null}
                            {userPublishedHere ? (
                              <button
                                type="button"
                                className="circle-recent-strip-menu__item circle-recent-strip-menu__item--danger"
                                role="menuitem"
                                disabled={circleStripUnpublishBusy}
                                onClick={() => {
                                  void unpublishTitleFromCircleStrip(movie.id);
                                }}
                              >
                                {circleStripUnpublishBusy ? "Removing…" : "Remove from circle"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="strip-poster strip-poster--circle-recent">
                          {movie.poster ? (
                            <img src={posterSrcThumb(movie.poster)} alt="" loading="lazy" decoding="async" />
                          ) : (
                            <div className="strip-poster-fallback">🎬</div>
                          )}
                          <div className="circle-strip-poster-meta" aria-hidden="true">
                            {formatCircleTypeYearShort(movie, tvStripMetaByTmdbId)}
                          </div>
                          <StripPosterBadge
                            movie={movie}
                            predicted={predictedForBadge}
                            predictedNeighborCount={predictedForBadge != null ? predictedNeighborCount : 0}
                          />
                        </div>
                        {showStripRaterCounts && distinctRaters > 0 ? (
                          <div className="circle-strip-rater-count">
                            {distinctRaters === 1 ? "1 rated" : `${distinctRaters} rated`}
                          </div>
                        ) : null}
                        <div className="strip-title strip-title--circle-single" title={movie.title}>
                          {movie.title}
                        </div>
                        <CircleStripRingCineBelowTitle
                          groupRating={row.group_rating}
                          siteRating={row.site_rating}
                        />
                      </div>
                    );
                  };
                  const renderCircleAllTopListRow = (row) => {
                    const movie = circleStripResolveMovie(row, movieLookupById, circleStripExtraMovies);
                    const rowKey = `${String(row.media_type)}-${Number(row.tmdb_id)}`;
                    const predDetail = circleStripPredictionForDetail(row);
                    if (!movie) {
                      return (
                        <div key={rowKey} className="circle-rated-list-row circle-rated-list-row--pending">
                          <div className="wl-list-thumb">
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                height: "100%",
                                fontSize: 22,
                              }}
                            >
                              🎬
                            </div>
                          </div>
                          <div className="wl-list-text">
                            <div className="wl-list-title">Loading…</div>
                            <div className="circle-rated-list-ratings circle-rated-list-ratings--empty">—</div>
                          </div>
                        </div>
                      );
                    }
                    const year = formatCircleListYear(movie, tvStripMetaByTmdbId);
                    const kind = movie.type === "tv" ? "TV" : "Movie";
                    const titleLineFull = `${movie.title} · ${kind} · ${year}`;
                    return (
                      <button
                        key={rowKey}
                        type="button"
                        className="circle-rated-list-row"
                        onClick={() => openDetail(movie, predDetail)}
                      >
                        <div className="wl-list-thumb">
                          {movie.poster ? (
                            <img src={posterSrcThumb(movie.poster)} alt="" loading="lazy" decoding="async" />
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                height: "100%",
                                fontSize: 22,
                              }}
                            >
                              🎬
                            </div>
                          )}
                        </div>
                        <div className="wl-list-text">
                          <div className="wl-list-title circle-list-all-top__title" title={titleLineFull}>
                            {movie.title}
                          </div>
                          <div className="circle-list-all-top__type-year" aria-label="Type and year">
                            {kind} · {year}
                          </div>
                          <CircleAllTopRatingsLine row={row} showRaterParen={showStripRaterCounts} />
                        </div>
                      </button>
                    );
                  };
                  const showLoadMore =
                    circleStripPayload
                    && !circleStripPayload.gated
                    && circleStripPayload.has_more
                    && titles.length < CIRCLE_STRIP_MAX;
                  const showSearchHint =
                    circleStripPayload
                    && !circleStripPayload.gated
                    && (circleStripPayload.total_eligible ?? 0) > CIRCLE_STRIP_MAX
                    && titles.length >= CIRCLE_STRIP_MAX
                    && !circleStripPayload.has_more;
                  const allTitles = Array.isArray(circleGridAllPayload?.titles) ? circleGridAllPayload.titles : [];
                  const topTitles = Array.isArray(circleGridTopPayload?.titles) ? circleGridTopPayload.titles : [];
                  const showAllMore =
                    circleGridAllPayload
                    && !circleGridAllPayload.gated
                    && circleGridAllPayload.has_more;
                  const showTopMore =
                    circleGridTopPayload
                    && !circleGridTopPayload.gated
                    && circleGridTopPayload.has_more
                    && topTitles.length < CIRCLE_TOP_MAX;
                  const gridSkel = (
                    <div className="circle-rated-list circle-rated-list--skel" aria-hidden="true">
                      {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="circle-rated-list-skel-row">
                          <div className="circle-rated-list-skel-thumb" />
                          <div className="circle-rated-list-skel-lines">
                            <div className="circle-rated-list-skel-line circle-rated-list-skel-line--title" />
                            <div className="circle-rated-list-skel-line circle-rated-list-skel-line--ty" />
                            <div className="circle-rated-list-skel-line circle-rated-list-skel-line--meta" />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                  const emptyRated = (
                    <div className="empty-box circle-detail-strip-empty">
                      <div className="empty-text">Nothing published in this circle yet.</div>
                      <div className="empty-sub">When members rate and choose to share here, those picks appear in these views.</div>
                    </div>
                  );
                  const recentStripActiveEmptyCopy =
                    titles.length === 0 && circleDetailData.status === "active" ? (
                      <div className="empty-box circle-detail-strip-empty circle-detail-recent-empty-copy">
                        <div className="empty-text">Nothing published here yet.</div>
                        <div className="empty-sub">Rate a title, then use Publish to circles to show it here (there&apos;s no backfill).</div>
                      </div>
                    ) : null;
                  return (
                    <>
                      <div className="circle-detail-strip-wrap">
                        <div className="section circle-detail-strip-section">
                          {ratingsTabs}
                          {circleRatingsView === "recent" && circleStripError ? (
                            <div className="circles-error-banner" role="alert">{circleStripError}</div>
                          ) : null}
                          {circleRatingsView === "all" && circleGridAllError ? (
                            <div className="circles-error-banner" role="alert">{circleGridAllError}</div>
                          ) : null}
                          {circleRatingsView === "top" && circleGridTopError ? (
                            <div className="circles-error-banner" role="alert">{circleGridTopError}</div>
                          ) : null}
                          {circleRatingsView === "recent" && circleStripLoading && !circleStripPayload ? (
                            <SkeletonStrip count={6} />
                          ) : null}
                          {circleRatingsView === "all" && circleGridAllLoading && circleGridAllPayload == null ? gridSkel : null}
                          {circleRatingsView === "top" && circleGridTopLoading && circleGridTopPayload == null ? gridSkel : null}
                          {circleRatingsView === "recent" && circleStripPayload && !circleStripLoading ? (
                            titles.length === 0 && circleDetailData.status !== "active" ? (
                              emptyRated
                            ) : (
                              <>
                                {recentStripActiveEmptyCopy}
                                <div className="circle-detail-recent-strip-outer">
                                  {circleRecentLeftScrollHint ? (
                                    <div
                                      className="circle-recent-scroll-hint"
                                      aria-hidden="true"
                                      title="Scroll for earlier titles"
                                    >
                                      <span className="circle-recent-scroll-hint__bubble" aria-hidden>←</span>
                                    </div>
                                  ) : null}
                                  <div
                                    ref={circleRecentStripRef}
                                    className={`strip strip--circle-recent${
                                      titles.length === 0
                                        ? " strip--circle-recent--solo-cta"
                                        : ""
                                    }`}
                                  >
                                  {showLoadMore && (
                                    <button
                                      type="button"
                                      className="strip-card strip-card--circle-more"
                                      onClick={() => void loadCircleStripMore()}
                                      disabled={circleStripLoadingMore}
                                      aria-label={
                                        circleStripLoadingMore ? "Loading earlier titles" : "Load earlier titles"
                                      }
                                    >
                                      <div className="strip-poster circle-strip-more-poster">
                                        {circleStripLoadingMore ? (
                                          <span className="circle-strip-more-spinner">Loading…</span>
                                        ) : (
                                          <span className="circle-strip-more-arrow" aria-hidden>←</span>
                                        )}
                                      </div>
                                      <div className="strip-title">Earlier</div>
                                      <div className="strip-genre strip-genre--spacer" aria-hidden>&nbsp;</div>
                                    </button>
                                  )}
                                  {stripTitlesOrdered.map((row, i) =>
                                    renderStripRow(row, i === stripTitlesOrdered.length - 1)
                                  )}
                                  {circleDetailData.status === "active" && (
                                    <button
                                      type="button"
                                      className="strip-card strip-card--circle-add-rate"
                                      ref={circleRecentAddCtaRef}
                                      onClick={openDiscoverFromCircleForRating}
                                      aria-label="Add a title for this circle. Opens Discover."
                                    >
                                      <div className="strip-poster strip-poster--circle-add-rate-slot" aria-hidden="true">
                                        <span className="circle-add-rate-bubble">+</span>
                                      </div>
                                      <div className="strip-title">&nbsp;</div>
                                      <div className="strip-genre strip-genre--spacer" aria-hidden>&nbsp;</div>
                                    </button>
                                  )}
                                </div>
                                </div>
                              </>
                            )
                          ) : null}
                          {circleRatingsView === "all" && circleGridAllPayload && !circleGridAllLoading ? (
                            allTitles.length === 0 ? (
                              emptyRated
                            ) : (
                              <>
                                <div className="circle-rated-list">{allTitles.map(renderCircleAllTopListRow)}</div>
                                {showAllMore ? (
                                  <button
                                    type="button"
                                    className="circle-rated-grid-more"
                                    onClick={() => void loadCircleGridAllMore()}
                                    disabled={circleGridAllLoadingMore}
                                  >
                                    {circleGridAllLoadingMore ? "Loading…" : "More"}
                                  </button>
                                ) : null}
                              </>
                            )
                          ) : null}
                          {circleRatingsView === "top" && circleGridTopPayload && !circleGridTopLoading ? (
                            topTitles.length === 0 ? (
                              emptyRated
                            ) : (
                              <>
                                <div className="circle-rated-list">{topTitles.map(renderCircleAllTopListRow)}</div>
                                {showTopMore ? (
                                  <button
                                    type="button"
                                    className="circle-rated-grid-more"
                                    onClick={() => void loadCircleGridTopMore()}
                                    disabled={circleGridTopLoadingMore}
                                  >
                                    {circleGridTopLoadingMore ? "Loading…" : "More"}
                                  </button>
                                ) : null}
                              </>
                            )
                          ) : null}
                        </div>
                      </div>
                      {showSearchHint && circleRatingsView === "recent" ? (
                        <div className="circle-strip-cap-hint">
                          Showing {CIRCLE_STRIP_MAX} recent titles in this circle. For anything else, search by title in Discover.
                          <div>
                            <button type="button" onClick={openDiscoverFromCircleForRating}>
                              Open Discover
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
          <BottomNav {...navProps} />
        </div>
      )}

      {/* Circle info — centered modal over circle detail (not bottom sheet) */}
      {showCircleInfoSheet && circleDetailData && (
        <div className="circles-modal-root" role="dialog" aria-modal="true" aria-label="Circle info">
          <button
            type="button"
            className="circles-modal-backdrop"
            aria-label="Close"
            onClick={() => setShowCircleInfoSheet(false)}
          />
          <div className="circles-modal-panel">
            <div className="circles-modal-header">
              <h2 className="circles-modal-title">Circle info</h2>
              <button
                type="button"
                className="circles-modal-close"
                aria-label="Close"
                onClick={() => setShowCircleInfoSheet(false)}
              >
                ×
              </button>
            </div>
            <div className="circles-modal-sub">{circleDetailData.name}</div>
            <div className="circle-info-member-list">
              {[...(circleDetailData.members || [])]
                .sort((a, b) => {
                  if (a.role === "creator" && b.role !== "creator") return -1;
                  if (b.role === "creator" && a.role !== "creator") return 1;
                  const na = (circleInfoNamesById[a.user_id] || "").trim() || String(a.user_id);
                  const nb = (circleInfoNamesById[b.user_id] || "").trim() || String(b.user_id);
                  return na.localeCompare(nb);
                })
                .map((m) => {
                  const isYou = user?.id === m.user_id;
                  const rawName = (circleInfoNamesById[m.user_id] || "").trim();
                  const label = isYou
                    ? "You"
                    : rawName || `…${String(m.user_id).slice(0, 8)}`;
                  const roleLabel = m.role === "creator" ? "Creator" : "Member";
                  return (
                    <div className="circle-info-member-row" key={m.id || `${m.user_id}`}>
                      <span className="circle-info-member-name">{label}</span>
                      <span
                        className={`circle-info-member-badge ${
                          m.role === "creator" ? "circle-info-member-badge--creator" : ""
                        }`}
                      >
                        {roleLabel}
                      </span>
                    </div>
                  );
                })}
            </div>
            {currentUserRole(circleDetailData, user?.id) === "creator" && circleDetailData.status === "active" && (
              <div className="circle-info-invite-block">
                <button
                  type="button"
                  className="circle-invite-btn circle-invite-btn--modal"
                  onClick={openInviteSheet}
                  disabled={circleDetailData.memberCount >= CIRCLE_MEMBER_CAP}
                >
                  + Invite more
                </button>
                {circleDetailData.memberCount >= CIRCLE_MEMBER_CAP && (
                  <p className="circle-info-invite-cap">This circle is full ({CIRCLE_MEMBER_CAP}/{CIRCLE_MEMBER_CAP}).</p>
                )}
              </div>
            )}
            <button
              type="button"
              className="circle-leave-btn circle-info-modal-leave"
              onClick={openLeaveFromCircleInfo}
              disabled={leaveCircleBusy}
            >
              Leave circle
            </button>
          </div>
        </div>
      )}

      {/* Create Circle bottom sheet */}
      {showCreateCircleSheet && (
        <div className="circles-sheet-root" role="dialog" aria-modal="true" aria-label="Create a circle">
          <button
            type="button"
            className="circles-sheet-backdrop"
            aria-label="Close"
            onClick={closeCreateCircleSheet}
          />
          <div className="circles-sheet">
            <div className="circles-sheet-handle" aria-hidden="true" />
            <div className="circles-sheet-title">New circle</div>
            <div className="circles-sheet-sub">Private by default. You can invite up to {CIRCLE_MEMBER_CAP} members.</div>

            <div className="circles-field">
              <label className="circles-field-label">
                Name <span className="circles-field-required">*</span>
              </label>
              <input
                className="circles-input"
                type="text"
                maxLength={CIRCLE_NAME_MAX}
                placeholder="e.g. Friday movie night"
                value={createCircleName}
                onChange={(e) => setCreateCircleName(e.target.value)}
                disabled={createCircleSubmitting}
                autoFocus
              />
              <div className="circles-field-count">
                {createCircleName.length}/{CIRCLE_NAME_MAX}
              </div>
            </div>

            <div className="circles-field">
              <label className="circles-field-label">Description</label>
              <textarea
                className="circles-textarea"
                maxLength={CIRCLE_DESCRIPTION_MAX}
                placeholder="What's this circle about? (optional)"
                value={createCircleDescription}
                onChange={(e) => setCreateCircleDescription(e.target.value)}
                disabled={createCircleSubmitting}
                rows={2}
              />
              <div className="circles-field-count">
                {createCircleDescription.length}/{CIRCLE_DESCRIPTION_MAX}
              </div>
            </div>

            <div className="circles-field">
              <label className="circles-field-label">Vibe</label>
              <select
                className="circles-input"
                value={createCircleVibe}
                onChange={(e) => setCreateCircleVibe(e.target.value)}
                disabled={createCircleSubmitting}
              >
                {VIBES.map((v) => (
                  <option key={v.id} value={v.id}>{v.id}</option>
                ))}
              </select>
            </div>

            {createCircleError && <div className="circles-error-banner">{createCircleError}</div>}

            <div className="circles-sheet-actions">
              <button
                type="button"
                className="circles-btn-ghost"
                onClick={closeCreateCircleSheet}
                disabled={createCircleSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="circles-btn-primary"
                onClick={submitCreateCircle}
                disabled={createCircleSubmitting || !createCircleName.trim()}
              >
                {createCircleSubmitting ? "Creating…" : "Create circle"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase B: pending-invites panel. Slides down from the top. */}
      {showInvitesPanel && (
        <div className="invites-panel-root" role="dialog" aria-modal="true" aria-label="Pending invites">
          <button
            type="button"
            className="invites-panel-backdrop"
            aria-label="Close"
            onClick={closeInvitesPanel}
          />
          <div className="invites-panel">
            <div className="invites-panel-header">
              <div className="invites-panel-title">Invites</div>
              <button
                type="button"
                className="invites-panel-close"
                onClick={closeInvitesPanel}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {inviteActionError && (
              <div className="circles-error-banner">{inviteActionError}</div>
            )}
            {pendingInvitesError && (
              <div className="circles-error-banner">{pendingInvitesError}</div>
            )}
            {pendingInvitesLoading && pendingInvites.length === 0 ? (
              <div className="invites-empty">Loading…</div>
            ) : pendingInvites.length === 0 ? (
              <div className="invites-empty">
                <div className="invites-empty-title">No pending invites</div>
                <div className="invites-empty-sub">When someone invites you to a circle, it'll show up here.</div>
              </div>
            ) : (
              <div className="invites-list">
                {pendingInvites.map((invite) => {
                  const meta = vibeMeta(invite.circleVibe);
                  const busy = inviteActionBusy[invite.id];
                  return (
                    <div
                      key={invite.id}
                      className="invite-card"
                      style={{ "--vibe-accent": meta.accent, "--vibe-tint": meta.tint }}
                    >
                      <div className="invite-card__tint" aria-hidden="true" />
                      <div className="invite-card__body">
                        <div className="invite-card__sender">
                          <span className="invite-card__sender-name">{invite.inviterName}</span>
                          <span className="invite-card__sender-verb"> invited you to</span>
                        </div>
                        <div className="invite-card__circle-name">{invite.circleName}</div>
                        <div className="invite-card__meta-row">
                          <span className="circle-card__vibe-badge">{meta.id}</span>
                          <span className="circle-card__members">
                            {invite.memberCount} {invite.memberCount === 1 ? "member" : "members"}
                          </span>
                        </div>
                        <div className="invite-card__actions">
                          <button
                            type="button"
                            className="circles-btn-ghost"
                            onClick={() => handleDeclineInvite(invite)}
                            disabled={Boolean(busy)}
                          >
                            {busy === "declining" ? "Declining…" : "Decline"}
                          </button>
                          <button
                            type="button"
                            className="circles-btn-primary"
                            onClick={() => handleAcceptInvite(invite)}
                            disabled={Boolean(busy) || atCircleCap}
                          >
                            {busy === "accepting" ? "Joining…" : "Join circle"}
                          </button>
                        </div>
                        {atCircleCap && (
                          <div className="invite-card__cap-hint">
                            You're at the {CIRCLE_CAP}-circle limit. Leave one first to join this.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Phase B: invite-by-email composer sheet (creator only, circle-detail). */}
      {showInviteSheet && circleDetailData && (
        <div className="circles-sheet-root" role="dialog" aria-modal="true" aria-label="Invite a member">
          <button
            type="button"
            className="circles-sheet-backdrop"
            aria-label="Close"
            onClick={closeInviteSheet}
          />
          <div className="circles-sheet">
            <div className="circles-sheet-handle" aria-hidden="true" />
            <div className="circles-sheet-title">Invite a member</div>
            <div className="circles-sheet-sub">
              They'll need an existing Cinemastro account for the invite to land in their bell.
            </div>

            <div className="circles-field">
              <label className="circles-field-label">Email</label>
              <input
                className="circles-input"
                type="email"
                autoComplete="email"
                placeholder="friend@example.com"
                value={inviteEmailDraft}
                onChange={(e) => setInviteEmailDraft(e.target.value)}
                disabled={inviteSheetSubmitting}
                autoFocus
              />
            </div>

            {inviteSheetError && <div className="circles-error-banner">{inviteSheetError}</div>}

            <div className="circles-sheet-actions">
              <button
                type="button"
                className="circles-btn-ghost"
                onClick={closeInviteSheet}
                disabled={inviteSheetSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="circles-btn-primary"
                onClick={submitInviteByEmail}
                disabled={inviteSheetSubmitting || !inviteEmailDraft.trim()}
              >
                {inviteSheetSubmitting ? "Sending…" : "Send invite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase B: transient toast for invite-send / invite-accept feedback. */}
      {inviteToast && (
        <div
          className={`circles-toast circles-toast--${inviteToast.tone}`}
          role="status"
          aria-live="polite"
        >
          {inviteToast.text}
        </div>
      )}

      {/* Leave circle confirmation */}
      {leaveConfirmCircle && (
        <div className="circles-sheet-root" role="dialog" aria-modal="true" aria-label="Leave circle">
          <button
            type="button"
            className="circles-sheet-backdrop"
            aria-label="Cancel"
            onClick={cancelLeaveCircle}
          />
          <div className="circles-confirm">
            <div className="circles-confirm-title">Leave this circle?</div>
            <div className="circles-confirm-text">
              {currentUserRole(leaveConfirmCircle, user?.id) === "creator"
                ? "You're the creator. Leaving will archive the circle. No new invites. Picks published in this group stop showing in its feeds; members can still view the archived circle."
                : "Picks you published in this group will be removed from this circle. Your personal ratings on your account stay the same."}
            </div>
            {leaveCircleError && <div className="circles-error-banner">{leaveCircleError}</div>}
            <div className="circles-sheet-actions">
              <button
                type="button"
                className="circles-btn-ghost"
                onClick={cancelLeaveCircle}
                disabled={leaveCircleBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="circles-btn-danger"
                onClick={confirmLeaveCircle}
                disabled={leaveCircleBusy}
              >
                {leaveCircleBusy ? "Leaving…" : "Leave circle"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publish rating to circles (first-time rate or manage) */}
      {publishRatingModal && (
        <div className="circles-modal-root" role="dialog" aria-modal="true" aria-label="Publish to circles">
          <button
            type="button"
            className="circles-modal-backdrop"
            aria-label="Close"
            onClick={cancelPublishRatingModal}
          />
          <div className="circles-modal-panel">
            <div className="circles-modal-header">
              <h2 className="circles-modal-title">
                {publishRatingModal.mode === "manage" ? "Circles for this title" : "Publish to circles"}
              </h2>
              <button
                type="button"
                className="circles-modal-close"
                aria-label="Close"
                onClick={cancelPublishRatingModal}
              >
                ×
              </button>
            </div>
            <p className="circles-modal-sub">
              {publishRatingModal.mode === "manage"
                ? "Choose which groups see this title with your score. Your rating stays the same everywhere."
                : "Pick which groups see this title. You can skip and add circles later from the title detail."}
            </p>
            {publishModalCircles.length === 0 ? (
              <p className="circles-modal-sub">You’re not in any active circles yet.</p>
            ) : (
              <div className="publish-rating-circle-list">
                {publishModalCircles.map((c) => (
                  <label key={c.id} className="publish-rating-circle-row">
                    <input
                      type="checkbox"
                      checked={publishModalSelection.has(c.id)}
                      onChange={() => togglePublishCirclePick(c.id)}
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            )}
            {publishModalError ? <div className="circles-error-banner">{publishModalError}</div> : null}
            <div className="circles-sheet-actions">
              <button
                type="button"
                className="circles-btn-ghost"
                onClick={cancelPublishRatingModal}
                disabled={publishModalBusy}
              >
                {publishRatingModal.mode === "afterRate" ? "Skip" : "Cancel"}
              </button>
              <button
                type="button"
                className="circles-btn-primary"
                disabled={publishModalBusy || publishModalCircles.length === 0}
                onClick={() => void completePublishRatingModal([...publishModalSelection])}
              >
                {publishModalBusy ? "Saving…" : "Done"}
              </button>
            </div>
          </div>
        </div>
      )}

      {screen === "pulse" && (
        <div className="home">
          <PageShell title="Pulse" subtitle="Trending & popular worldwide — scored for your taste">
            {!pulseCatalogReady ? (
              <>
                <div className="section">
                  <div className="section-header">
                    <div className="section-title">Trending</div>
                    <div className="section-meta">This week</div>
                  </div>
                  <SkeletonStrip />
                </div>
                <div className="section">
                  <div className="section-header">
                    <div className="section-title">Popular</div>
                    <div className="section-meta">Movies &amp; TV</div>
                  </div>
                  <SkeletonStrip />
                </div>
              </>
            ) : (
              <>
                <div className="section">
                  <div className="section-header">
                    <div className="section-title">Trending</div>
                    <div className="section-meta">This week</div>
                  </div>
                  {pulseTrendingRecsResolved.length === 0 ? (
                    <div className="empty-box">
                      <div className="empty-text">No trending titles right now</div>
                    </div>
                  ) : (
                    <div className="strip">
                      {pulseTrendingRecsResolved.map((rec) => (
                        <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                          <div className="strip-poster">
                            {rec.movie.poster ? <img src={posterSrcThumb(rec.movie.poster)} alt={rec.movie.title} loading="lazy" decoding="async" /> : <div className="strip-poster-fallback">🎬</div>}
                            <StripPosterBadge movie={rec.movie} predicted={rec.predicted} predictedNeighborCount={recNeighborCount(rec)} />
                          </div>
                          <div className="strip-title">{rec.movie.title}</div>
                          <div className="strip-genre">{formatStripMediaMeta(rec.movie, tvStripMetaByTmdbId)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="section">
                  <div className="section-header">
                    <div className="section-title">Popular</div>
                    <div className="section-meta">Movies &amp; TV</div>
                  </div>
                  {pulsePopularRecsResolved.length === 0 ? (
                    <div className="empty-box">
                      <div className="empty-text">No popular titles right now</div>
                    </div>
                  ) : (
                    <div className="strip">
                      {pulsePopularRecsResolved.map((rec) => (
                        <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                          <div className="strip-poster">
                            {rec.movie.poster ? <img src={posterSrcThumb(rec.movie.poster)} alt={rec.movie.title} loading="lazy" decoding="async" /> : <div className="strip-poster-fallback">🎬</div>}
                            <StripPosterBadge movie={rec.movie} predicted={rec.predicted} predictedNeighborCount={recNeighborCount(rec)} />
                          </div>
                          <div className="strip-title">{rec.movie.title}</div>
                          <div className="strip-genre">{formatStripMediaMeta(rec.movie, tvStripMetaByTmdbId)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {Object.keys(userRatings).length === 0 &&
                  pulseTrendingRecsResolved.length + pulsePopularRecsResolved.length > 0 && (
                    <div className="no-recs" style={{ marginTop: 16, border: "none", padding: "12px 0 0" }}>
                      <div className="no-recs-text" style={{ fontSize: 12 }}>Rate a few titles for tighter predictions</div>
                      <button className="btn-confirm" style={{ marginTop: 12, width: "100%" }} onClick={startDefaultRateMore}>
                        Rate More Titles
                      </button>
                    </div>
                  )}
              </>
            )}
          </PageShell>
          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {screen === "in-theaters" && (
        <div className="home">
          <PageShell title="In Theaters" subtitle={"Now playing and what's buzzing in US theaters — scored for your taste"}>
            <div className="section" style={{ paddingTop: 0 }}>
              <div className="section-header">
                <div className="section-title">Now Playing</div>
                <div className="section-meta">In theaters</div>
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
                  {theaterRecs.map((rec) => (
                    <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                      <div className="strip-poster">
                        {rec.movie.poster ? <img src={posterSrcThumb(rec.movie.poster)} alt={rec.movie.title} loading="lazy" decoding="async" /> : <div className="strip-poster-fallback">🎬</div>}
                        <StripPosterBadge movie={rec.movie} predicted={rec.predicted} predictedNeighborCount={recNeighborCount(rec)} />
                      </div>
                      <div className="strip-title">{rec.movie.title}</div>
                      <div className="strip-genre">{formatStripMediaMeta(rec.movie, tvStripMetaByTmdbId)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="section">
              <div className="section-header">
                <div className="section-title">Popular in theaters</div>
                <div className="section-meta">Same US releases, TMDB popularity order</div>
              </div>
              {inTheatersPagePopularRecsResolved.length === 0 ? (
                <div className="empty-box">
                  <div className="empty-text">
                    {showRegionKeys.length > 0
                      ? "Limited titles for this region in US theaters right now"
                      : "No theatrical releases"}
                  </div>
                </div>
              ) : (
                <div className="strip">
                  {inTheatersPagePopularRecsResolved.map((rec) => (
                    <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                      <div className="strip-poster">
                        {rec.movie.poster ? <img src={posterSrcThumb(rec.movie.poster)} alt={rec.movie.title} loading="lazy" decoding="async" /> : <div className="strip-poster-fallback">🎬</div>}
                        <StripPosterBadge movie={rec.movie} predicted={rec.predicted} predictedNeighborCount={recNeighborCount(rec)} />
                      </div>
                      <div className="strip-title">{rec.movie.title}</div>
                      <div className="strip-genre">{formatStripMediaMeta(rec.movie, tvStripMetaByTmdbId)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {Object.keys(userRatings).length === 0 &&
              theaterRecs.length + inTheatersPagePopularRecsResolved.length > 0 && (
                <div className="section">
                  <div className="no-recs" style={{ marginTop: 0, border: "none", padding: "0 0 8px" }}>
                    <div className="no-recs-text" style={{ fontSize: 12 }}>Rate a few titles for tighter predictions</div>
                    <button className="btn-confirm" style={{ marginTop: 12, width: "100%" }} onClick={startDefaultRateMore}>
                      Rate More Titles
                    </button>
                  </div>
                </div>
              )}
          </PageShell>
          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {screen === "streaming-page" && (
        <div className="home">
          <PageShell title="Streaming" subtitle="New & popular on major services — scored for your taste (not filtered by your app list)">
            <div className="section" style={{ paddingTop: 0 }}>
              <div className="filter-row" style={{ paddingTop: 0, paddingBottom: 4 }}>
                <button type="button" className={`filter-pill ${streamingTab === "tv" ? "active" : ""}`} onClick={() => setStreamingTab("tv")}>
                  Series
                </button>
                <button type="button" className={`filter-pill ${streamingTab === "movie" ? "active" : ""}`} onClick={() => setStreamingTab("movie")}>
                  Movies
                </button>
              </div>
              <div className="section-header">
                <div className="section-title">Now Streaming</div>
                <div className="section-meta">Newest {streamingTab === "movie" ? "releases" : "series & seasons"}</div>
              </div>
              {showStreamingMovieSkeleton ? (
                <SkeletonStrip />
              ) : streamingTab === "tv" && !streamingTvReady ? (
                <SkeletonStrip />
              ) : streamingNowRecs.length === 0 ? (
                <div className="empty-box">
                  <div className="empty-text">No streaming {streamingTab === "movie" ? "movies" : "series"} right now</div>
                </div>
              ) : (
                <div className="strip">
                  {streamingNowRecs.map((rec) => (
                    <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                      <div className="strip-poster">
                        {rec.movie.poster ? <img src={posterSrcThumb(rec.movie.poster)} alt={rec.movie.title} loading="lazy" decoding="async" /> : <div className="strip-poster-fallback">🎬</div>}
                        <StripPosterBadge movie={rec.movie} predicted={rec.predicted} predictedNeighborCount={recNeighborCount(rec)} />
                      </div>
                      <div className="strip-title">{rec.movie.title}</div>
                      <div className="strip-genre">{formatStripMediaMeta(rec.movie, tvStripMetaByTmdbId)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="section">
              <div className="section-header">
                <div className="section-title">What&apos;s popular in streaming</div>
                <div className="section-meta">Same pool, TMDB popularity order</div>
              </div>
              {showStreamingMovieSkeleton ? (
                <SkeletonStrip />
              ) : streamingTab === "tv" && !streamingTvReady ? (
                <SkeletonStrip />
              ) : streamingPopularRecs.length === 0 ? (
                <div className="empty-box">
                  <div className="empty-text">No streaming {streamingTab === "movie" ? "movies" : "series"} right now</div>
                </div>
              ) : (
                <div className="strip">
                  {streamingPopularRecs.map((rec) => (
                    <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                      <div className="strip-poster">
                        {rec.movie.poster ? <img src={posterSrcThumb(rec.movie.poster)} alt={rec.movie.title} loading="lazy" decoding="async" /> : <div className="strip-poster-fallback">🎬</div>}
                        <StripPosterBadge movie={rec.movie} predicted={rec.predicted} predictedNeighborCount={recNeighborCount(rec)} />
                      </div>
                      <div className="strip-title">{rec.movie.title}</div>
                      <div className="strip-genre">{formatStripMediaMeta(rec.movie, tvStripMetaByTmdbId)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {Object.keys(userRatings).length === 0 &&
              streamingNowRecs.length + streamingPopularRecs.length > 0 && (
                <div className="section">
                  <div className="no-recs" style={{ marginTop: 0, border: "none", padding: "0 0 8px" }}>
                    <div className="no-recs-text" style={{ fontSize: 12 }}>Rate a few titles for tighter predictions</div>
                    <button className="btn-confirm" style={{ marginTop: 12, width: "100%" }} onClick={startDefaultRateMore}>
                      Rate More Titles
                    </button>
                  </div>
                </div>
              )}
          </PageShell>
          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {screen === "your-picks" && (
        <div className="home">
          <PageShell title="Your Picks" subtitle="CF predictions first, then high predicted, then popular — five at a time (up to 20)">
            {/* Strips: score badge bottom-right; ✨/📈 icon-only pill bottom-left. */}
            {(hasYourPicksStripSource || yourPicksLoading) && (
              <div className="section" style={{ paddingTop: 0 }}>
                <div className="section-header">
                  <div className="section-title">🔥 For you</div>
                  {hasYourPicksStripSource && (
                    <div
                      className="section-meta"
                      style={{ cursor: "pointer" }}
                      onClick={() => setTopPickOffset((p) => p + 1)}
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
                          {row.rec.movie.poster ? <img src={posterSrcThumb(row.rec.movie.poster)} alt="" loading="lazy" decoding="async" /> : <div className="strip-poster-fallback">🎬</div>}
                          <span
                            className={`strip-kind-icon ${row.kind === "pick" ? "strip-kind-icon--pick" : "strip-kind-icon--pop"}`}
                            aria-hidden
                            title={row.kind === "pick" ? "Personal pick" : "Popular pool"}
                          >
                            {row.kind === "pick" ? "✨" : "📈"}
                          </span>
                          <StripPosterBadge
                            movie={row.rec.movie}
                            predicted={row.rec.predicted}
                            predictedNeighborCount={recNeighborCount(row.rec)}
                            preferPersonalPredicted
                          />
                        </div>
                        <div className="strip-title">{row.rec.movie.title}</div>
                        <div className="strip-genre">{formatStripMediaMeta(row.rec.movie, tvStripMetaByTmdbId)}</div>
                      </div>
                    ))}
                    {hasYourPicksStripSource &&
                      yourPicksBatchStep < yourPicksMaxBatchSteps && (
                      <button
                        type="button"
                        className="strip-card strip-card--circle-more"
                        aria-label={`Show more picks (${Math.min(
                          YOUR_PICKS_BATCH_SIZE,
                          Math.min(yourPicksTotalCandidates, YOUR_PICKS_VISIBLE_MAX) - yourPicksVisibleCap,
                        )} more)`}
                        onClick={() =>
                          setYourPicksBatchStep((s) => Math.min(yourPicksMaxBatchSteps, s + 1))}
                      >
                        <div className="strip-poster circle-strip-more-poster">
                          <span className="circle-strip-more-arrow" aria-hidden>→</span>
                        </div>
                        <div className="strip-title">More</div>
                        <div className="strip-genre strip-genre--spacer" aria-hidden>&nbsp;</div>
                      </button>
                    )}
                    {hasYourPicksStripSource &&
                      yourPicksBatchStep >= yourPicksMaxBatchSteps && (
                      <div
                        className="strip-card strip-card--your-picks-mood"
                        role="region"
                        aria-label="Try Mood for more suggestions"
                      >
                        <div className="strip-poster circle-strip-more-poster your-picks-mood-poster">
                          <div className="your-picks-mood-inner">
                            <p className="your-picks-mood-copy">
                              You&apos;ve opened every batch in this list — try Mood for a different angle on your taste.
                            </p>
                            <button
                              type="button"
                              className="your-picks-mood-cta"
                              onClick={() => {
                                setMoodStep(0);
                                setMoodSelections({ region: [], indian_lang: [], genre: [], vibe: [] });
                                setMoodResults([]);
                                setNavTab("mood");
                                setScreen("mood-picker");
                              }}
                            >
                              Try Mood
                            </button>
                          </div>
                        </div>
                        <div className="strip-title">&nbsp;</div>
                        <div className="strip-genre strip-genre--spacer" aria-hidden>&nbsp;</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <SkeletonStrip showKind count={YOUR_PICKS_BATCH_SIZE} />
                )}
              </div>
            )}
            {!hasYourPicksStripSource && !yourPicksLoading && (
              <div className="section">
                <div className="no-recs">
                  <div className="no-recs-text">Predictions will show here after your first catalogue load and ratings.<br />Browse <strong>In Theaters</strong> or <strong>Streaming</strong> to get started.</div>
                </div>
              </div>
            )}
          </PageShell>
          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {screen === "secondary-region" && (
        <div className="home">
          <PageShell
            title={V130_SECONDARY_HOME_TITLE[secondaryRegionKey] ?? "Region"}
            subtitle="Theaters & streaming — scored for your taste"
          >
            {!secondaryRegionKey || !V130_SECONDARY_REGION_IDS.includes(secondaryRegionKey) ? (
              <div className="disc-empty">
                <div className="disc-empty-text">
                  Pick a secondary region in your profile to see regional theaters &amp; streaming here.
                </div>
              </div>
            ) : (
              <>
                <div className="section" style={{ paddingTop: 0 }}>
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
                  <div className="section-header">
                    <div className="section-title">
                      {secondaryBlockSegment === SECONDARY_BLOCK_THEATERS
                        ? "In Theaters"
                        : secondaryBlockStreamingTab === "movie"
                          ? "Streaming Movies"
                          : "Streaming Series"}
                    </div>
                    <div className="section-meta">
                      {secondaryBlockSegment === SECONDARY_BLOCK_THEATERS
                        ? "Newest regional releases"
                        : "New & popular on major services"}
                    </div>
                  </div>
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
                    <div className="strip">
                      {secondaryStripRecsVisible.map((rec) => (
                        <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                          <div className="strip-poster">
                            {rec.movie.poster ? <img src={posterSrcThumb(rec.movie.poster)} alt={rec.movie.title} loading="lazy" decoding="async" /> : <div className="strip-poster-fallback">🎬</div>}
                            <StripPosterBadge movie={rec.movie} predicted={rec.predicted} predictedNeighborCount={recNeighborCount(rec)} />
                          </div>
                          <div className="strip-title">{rec.movie.title}</div>
                          <div className="strip-genre">{formatStripMediaMeta(rec.movie, tvStripMetaByTmdbId)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {Object.keys(userRatings).length === 0 && secondaryStripRecsVisible.length > 0 && (
                  <div className="section">
                    <div className="no-recs" style={{ marginTop: 0, border: "none", padding: "0 0 8px" }}>
                      <div className="no-recs-text" style={{ fontSize: 12 }}>Rate a few titles for tighter predictions</div>
                      <button className="btn-confirm" style={{ marginTop: 12, width: "100%" }} onClick={startDefaultRateMore}>
                        Rate More Titles
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </PageShell>
          <AppFooter
            onPrivacy={() => openLegalPage("privacy")}
            onTerms={() => openLegalPage("terms")}
            onAbout={() => openLegalPage("about")}
          />
          <BottomNav {...navProps} />
        </div>
      )}

      {/* HOME screen retired in v4.0.8 — primary landing is now Circles. What's hot + Secondary Region
          have migrated off Home: What's hot removed entirely (Pulse / In Theaters already cover
          trending / theatrical), Secondary Region lives on its own page above. */}

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
                {rateMoreMovie.poster ? (
                  <img src={posterSrcDetail(rateMoreMovie.poster)} alt={rateMoreMovie.title} loading="eager" decoding="async" />
                ) : (
                  <div className="card-poster-fallback">🎬</div>
                )}
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
                ref={discoverSearchInputRef}
                className={`search-input${searchQuery.length > 0 ? " search-input--with-clear" : ""}`}
                type="text"
                placeholder="Search any movie or show…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoComplete="off"
              />
              {searchQuery.length > 0 ? (
                <button
                  type="button"
                  className="search-clear-btn"
                  aria-label="Clear search"
                  onClick={() => clearDiscoverSearch()}
                >
                  ×
                </button>
              ) : null}
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
                const discBd = stripBadgeDisplay(m, myRating, rec?.predicted ?? null, cinemastroAvgByKey, recNeighborCount(rec));
                const discMeter =
                  discBd.pillClass === "strip-badge--cinemastro" &&
                  discBd.cinemastroCount != null &&
                  discBd.cinemastroCount >= 1;
                return (
                  <div className="disc-card" key={m.id} onClick={() => openDetail(m, rec)}>
                    <div className="disc-poster">
                      {m.poster ? <img src={posterSrcThumb(m.poster)} alt={m.title} loading="lazy" decoding="async" /> : <div className="disc-poster-fallback">🎬</div>}
                      <div className="disc-type">{m.type === "movie" ? "Movie" : "TV"}</div>
                      <div className="disc-badge">
                        {myRating ? <span className="disc-rated-badge">★ {myRating}</span>
                          : discBd.text === "—"
                            ? <span className="disc-unseen-badge">Unrated</span>
                            : (
                              <span
                                className={`disc-pred-badge${discBd.pillClass === "strip-badge--cinemastro" ? " disc-community-badge--cinemastro" : ""}${discBd.pillClass === "strip-badge--predicted" ? " disc-pred-badge--predicted" : ""}${discMeter ? " disc-pred-badge--with-meter" : ""}`}
                                title={discBd.title || undefined}
                              >
                                <span className="disc-pred-badge-score">{discBd.text}</span>
                                {discMeter ? (
                                  <CinemastroVoteMeter count={discBd.cinemastroCount} className="cinemastro-vote-meter--disc" />
                                ) : null}
                              </span>
                            )}
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
            <button className="mood-back" onClick={() => { setNavTab("home"); setScreen("circles"); }}>← Back</button>
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
                      ? <img src={moodCardBackdropOrPosterSrc(rec)} alt={rec.movie.title} loading="lazy" decoding="async" />
                      : <div className="mood-result-poster-fallback">🎬</div>}
                    <div className="mood-result-overlay" />
                    <div className="mood-result-type">{rec.movie.type === "movie" ? "Movie" : "TV"}</div>
                    {(() => {
                      const mbd = stripBadgeDisplay(rec.movie, userRatings[rec.movie.id], rec.predicted, cinemastroAvgByKey, recNeighborCount(rec));
                      const moodMeter =
                        mbd.pillClass === "strip-badge--cinemastro" &&
                        mbd.cinemastroCount != null &&
                        mbd.cinemastroCount >= 1;
                      return (
                        <div
                          className={`mood-result-badge${mbd.pillClass === "strip-badge--cinemastro" ? " mood-result-badge--cinemastro" : ""}${mbd.pillClass === "strip-badge--predicted" ? " mood-result-badge--predicted" : ""}${moodMeter ? " mood-result-badge--with-meter" : ""}`}
                          title={mbd.title || undefined}
                        >
                          <span className="mood-result-badge-score">{mbd.text}</span>
                          {moodMeter ? (
                            <CinemastroVoteMeter count={mbd.cinemastroCount} className="cinemastro-vote-meter--mood" />
                          ) : null}
                        </div>
                      );
                    })()}
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
                        type="button"
                        className={`btn-select-watch ${(inWatchlist(rec.movie.id) || selectedToWatch[rec.movie.id]) ? "selected" : ""}`}
                        disabled={!inWatchlist(rec.movie.id) && watchlist.length >= WATCHLIST_MAX}
                        title={
                          !inWatchlist(rec.movie.id) && watchlist.length >= WATCHLIST_MAX
                            ? `Watchlist full (${WATCHLIST_MAX}). Remove a title first.`
                            : undefined
                        }
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
                        {movie.poster ? <img src={posterSrcThumb(movie.poster)} alt={movie.title} loading="lazy" decoding="async" /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 20 }}>🎬</div>}
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
              <div className="section-meta">
                {watchlist.length} / {WATCHLIST_MAX} {watchlist.length === 1 ? "title" : "titles"}
              </div>
            </div>
            {watchlist.length === 0 ? (
              <div className="empty-box"><div className="empty-text">Save titles from detail to watch later</div></div>
            ) : (
              <div className="strip">
                {watchlistDisplay.map((m) => (
                  <div className="wl-card" key={m.id} onClick={() => openDetail(m, recMap[m.id])}>
                    <div className="wl-poster">
                      {m.poster ? <img src={posterSrcThumb(m.poster)} alt={m.title} loading="lazy" decoding="async" /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 36 }}>🎬</div>}
                    </div>
                    <div className="strip-title">{m.title}</div>
                    <div className="wl-card-meta">{formatWatchlistMetaLine(m)}</div>
                    {m.fromGroup ? <div className="wl-from-group">Group</div> : null}
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

      {screen === "watchlist" && (
        <div className="profile watchlist-screen">
          <div className="watchlist-page-intro">
            <div className="discover-title">Watchlist</div>
            <div className="section-meta">
              {watchlist.length} / {WATCHLIST_MAX} {watchlist.length === 1 ? "title" : "titles"}
            </div>
          </div>
          <div className="section profile-watchlist-section">
            {watchlist.length === 0 ? (
              <div className="empty-box">
                <div className="empty-text">Save titles from detail to watch later</div>
              </div>
            ) : (
              <div className="wl-list">
                {watchlistDisplay.map((m, rowIndex) => {
                  const canMoveUp = rowIndex > 0;
                  const canMoveDown = rowIndex < watchlistDisplay.length - 1;
                  return (
                  <div className="wl-list-row" key={m.id}>
                    <button
                      type="button"
                      className="wl-list-row__main"
                      onClick={() => openDetail(m, recMap[m.id])}
                    >
                      <div className="wl-list-thumb">
                        {m.poster ? (
                          <img src={posterSrcThumb(m.poster)} alt="" loading="lazy" decoding="async" />
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 22 }}>🎬</div>
                        )}
                      </div>
                      <div className="wl-list-text">
                        <div className="wl-list-title">{m.title}</div>
                        <div className="wl-list-meta">{formatWatchlistMetaLine(m)}</div>
                        {m.fromGroup ? <div className="wl-from-group" style={{ marginTop: 6 }}>Group</div> : null}
                      </div>
                    </button>
                    <div className="wl-list-row__more">
                      <button
                        type="button"
                        className="wl-list-row__more-btn"
                        aria-label="Watchlist actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setWatchlistRowMenuId((id) => (id === m.id ? null : m.id));
                        }}
                      >
                        <span aria-hidden="true">⋯</span>
                      </button>
                      {watchlistRowMenuId === m.id ? (
                        <div className="wl-list-row__menu" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="wl-list-row__menu-item"
                            onClick={() => {
                              setWatchlistRowMenuId(null);
                              openDetail(m, recMap[m.id]);
                            }}
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            className="wl-list-row__menu-item"
                            disabled={!canMoveUp}
                            onClick={() => {
                              if (!canMoveUp) return;
                              void moveWatchlistItemToTop(m.id);
                            }}
                          >
                            ⇈ Top
                          </button>
                          <button
                            type="button"
                            className="wl-list-row__menu-item"
                            disabled={!canMoveUp}
                            onClick={() => {
                              if (!canMoveUp) return;
                              void swapWatchlistOrder(m.id, "up");
                            }}
                          >
                            ↑ Up
                          </button>
                          <button
                            type="button"
                            className="wl-list-row__menu-item"
                            disabled={!canMoveDown}
                            onClick={() => {
                              if (!canMoveDown) return;
                              void swapWatchlistOrder(m.id, "down");
                            }}
                          >
                            ↓ Down
                          </button>
                          <button
                            type="button"
                            className="wl-list-row__menu-item"
                            disabled={!canMoveDown}
                            onClick={() => {
                              if (!canMoveDown) return;
                              void moveWatchlistItemToBottom(m.id);
                            }}
                          >
                            ⇊ Bottom
                          </button>
                          <button
                            type="button"
                            className="wl-list-row__menu-item"
                            onClick={() => {
                              setWatchlistRowMenuId(null);
                              void toggleWatchlist(m);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
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
        const { movie, prediction, predictionLoading } = selectedMovie;
        const showPredSkeleton = Boolean(predictionLoading);
        const myRating = userRatings[movie.id];
        const detailMediaKey = mediaIdKey(movie);
        const detailCinemastroEntry = detailMediaKey != null ? cinemastroAvgByKey[detailMediaKey] : undefined;
        const detailCinemastroAvg = cinemastroEntryAvg(detailCinemastroEntry);
        const detailCinemastroCount = cinemastroEntryCount(detailCinemastroEntry);
        const detailHasCinemastro = typeof detailCinemastroAvg === "number" && Number.isFinite(detailCinemastroAvg);
        const detailTmdbNum = movie.tmdbRating != null && Number.isFinite(Number(movie.tmdbRating)) ? Number(movie.tmdbRating) : null;
        const heroBackdropSrc = movie.backdrop || movie.poster || null;
        const showRatePill = !myRating && hasPersonalPrediction(prediction) && !showPredSkeleton;
        const hasFactsBar = Boolean(
          detailMeta.certification ||
            detailMeta.releaseLabel ||
            detailMeta.runtimeLabel ||
            detailMeta.genresLine,
        );
        const sliderBubbleLeftPct = (v) => {
          const x = Number(v);
          if (!Number.isFinite(x)) return 50;
          const clamped = Math.min(10, Math.max(1, x));
          return ((clamped - 1) / 9) * 100;
        };
        const confInlineClass =
          prediction?.confidence === "high"
            ? "detail-score-conf-inline--high"
            : prediction?.confidence === "medium"
              ? "detail-score-conf-inline--medium"
              : "detail-score-conf-inline--low";
        return (
          <div className="detail">
            {!showPrimaryNav ? (
              <div className="page-topbar">
                <TopbarBrandCluster onPress={goHome} community={siteStats?.community} ratings={siteStats?.ratings} />
                <div />
                <AccountAvatarMenu />
              </div>
            ) : null}
            <div className="detail-hero">
              <div className="detail-hero-backdrop">
                {heroBackdropSrc ? (
                  <img src={heroBackdropSrc} alt="" loading="eager" fetchPriority="high" decoding="async" />
                ) : (
                  <div className="detail-hero-backdrop-fallback" aria-hidden>🎬</div>
                )}
                <div className="d-overlay" />
                {movie.poster ? (
                  <div className="detail-hero-poster--float">
                    <img src={posterSrcDetail(movie.poster)} alt="" loading="eager" decoding="async" />
                  </div>
                ) : null}
              </div>
              <div className="detail-hero-band">
                <div className="detail-hero-copy">
                  <div className="d-type-genre">
                    <span className="d-type-pill">{movie.type === "movie" ? "Movie" : "TV Show"}</span>
                  </div>
                  <h1 className="d-title">
                    {movie.title}
                    {movie.year ? <span className="d-title-year"> ({movie.year})</span> : null}
                  </h1>
                </div>
              </div>
            </div>
            <div className="detail-content-wrap">
              <div className="d-body">
                {showPredSkeleton ? (
                  <div className="detail-score-skel-inline" aria-busy="true" aria-label="Loading prediction">
                    <div className="skel-line skel-line-title" style={{ width: "55%" }} />
                    <div className="skel-line skel-line-meta" style={{ width: "40%" }} />
                  </div>
                ) : (
                  <div className="detail-score-block">
                    <div className="detail-score-lbl detail-score-lbl--left">
                      {myRating != null && Number.isFinite(Number(myRating)) ? "You rated" : "For you"}
                    </div>
                    <div className="detail-score-lbl detail-score-lbl--right">{detailHasCinemastro ? "Cinemastro" : "TMDB"}</div>
                    <div className="detail-score-divider-v" aria-hidden="true" />
                    <div className="detail-score-val--left">
                      {myRating != null && Number.isFinite(Number(myRating)) ? (
                        <div className="detail-score-values-line">
                          <span className="detail-inline-score-val detail-inline-score-val--yours">{formatScore(Number(myRating))}</span>
                        </div>
                      ) : hasPersonalPrediction(prediction) ? (
                        <div className="detail-score-val-cluster">
                          <span className="detail-inline-score-val detail-inline-score-val--pred">{formatScore(prediction.predicted)}</span>
                          <div className="detail-score-meta-stack">
                            {shouldShowPredictionRange(prediction) ? (
                              <span className="detail-score-side-meta">
                                {formatScore(prediction.low)}–{formatScore(prediction.high)}
                              </span>
                            ) : null}
                            <span className={`detail-score-conf-inline ${confInlineClass}`}>{confToneLabel(prediction.confidence)}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="detail-score-values-line">
                          <span className="detail-inline-score-val detail-inline-score-val--muted">TBD</span>
                          <span className="detail-score-side-meta">Rate more to predict.</span>
                        </div>
                      )}
                    </div>
                    <div className="detail-score-val--right">
                      {detailHasCinemastro ? (
                        <div className="detail-score-val-cluster">
                          <span className="detail-inline-score-val">{formatScore(detailCinemastroAvg)}</span>
                          <div className="detail-score-meta-stack">
                            <span className="detail-cine-sub--inline">TMDB-based</span>
                            {detailCinemastroCount != null && detailCinemastroCount >= 1 ? (
                              <CinemastroVoteMeter count={detailCinemastroCount} className="cinemastro-vote-meter--detail-stack" />
                            ) : null}
                          </div>
                        </div>
                      ) : detailTmdbNum != null ? (
                        <div className="detail-score-values-line">
                          <span className="detail-inline-score-val">{formatScore(detailTmdbNum)}</span>
                        </div>
                      ) : (
                        <div className="detail-score-values-line">
                          <span className="detail-inline-score-val detail-inline-score-val--muted">—</span>
                          <span className="detail-score-side-meta">No score yet</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {inWatchlist(movie.id)
                  ? (() => {
                      const wl = watchlist.find((w) => w.id === movie.id);
                      if (!wl?.fromGroup && !wl?.source_circle_id) return null;
                      const circleLabel = wl.source_circle_id ? circleNameById.get(wl.source_circle_id) : null;
                      return (
                        <div className="detail-watchlist-source">
                          {circleLabel ? `Watchlist · from ${circleLabel}` : "Watchlist · from a circle"}
                        </div>
                      );
                    })()
                  : null}
                {showRatePill ? (
                  <div className="detail-rate-pill-wrap">
                    <button
                      type="button"
                      className="d-rate-now-btn d-rate-now-btn--center"
                      disabled={rateSimilarLoading}
                      onClick={() => { void handleRateNowForPrediction(movie); }}
                    >
                      {rateSimilarLoading
                        ? "Loading..."
                        : prediction.confidence === "high"
                          ? "Rate more"
                          : "Rate to refine"}
                    </button>
                    {rateSimilarError ? <div className="d-pred-improve-err">{rateSimilarError}</div> : null}
                  </div>
                ) : null}
                {hasFactsBar ? (
                  <div className="detail-facts-bar">
                    {detailMeta.certification || detailMeta.releaseLabel || detailMeta.runtimeLabel ? (
                      <div className="detail-facts-row">
                        {detailMeta.certification ? (
                          <span className="detail-facts-cert">{detailMeta.certification}</span>
                        ) : null}
                        {detailMeta.certification && (detailMeta.releaseLabel || detailMeta.runtimeLabel) ? (
                          <span className="detail-facts-sep">·</span>
                        ) : null}
                        {detailMeta.releaseLabel ? <span>{detailMeta.releaseLabel}</span> : null}
                        {detailMeta.releaseLabel && detailMeta.runtimeLabel ? <span className="detail-facts-sep">·</span> : null}
                        {detailMeta.runtimeLabel ? <span>{detailMeta.runtimeLabel}</span> : null}
                      </div>
                    ) : null}
                    {detailMeta.genresLine ? <div className="detail-facts-genres">{detailMeta.genresLine}</div> : null}
                  </div>
                ) : null}
                {detailMeta.tagline ? <p className="d-tagline">{detailMeta.tagline}</p> : null}
                <h2 className="d-overview-heading">Overview</h2>
                <div className="d-synopsis">{movie.synopsis}</div>
                <div className="detail-wtw-wrap">
                  <WhereToWatch tmdbId={movie.tmdbId} type={movie.type} />
                </div>
                <div className="detail-rate-section">
                  {myRating && !detailEditRating ? (
                    <div className="rated-box rated-box--compact" style={{ marginTop: 20 }}>
                      <div className="rated-label">Your rating saved ✓</div>
                      {hasPersonalPrediction(prediction) && <div className="rated-pred">Predicted was {formatScore(prediction.predicted)} ({formatScore(prediction.low)}–{formatScore(prediction.high)})</div>}
                      <button type="button" className="btn-full btn-full-dark" style={{ marginTop: 16, width: "100%" }}
                        onClick={() => { setDetailEditRating(true); setDetailRating(myRating); setDetailTouched(true); }}>
                        Change rating
                      </button>
                      {user && publishModalCircles.length > 0 ? (
                        <button
                          type="button"
                          className="btn-full btn-full-dark"
                          style={{ marginTop: 10, width: "100%" }}
                          onClick={() => {
                            setPublishRatingModal({
                              movieId: movie.id,
                              mode: "manage",
                              pendingNavigate: "none",
                              defaultCircleIds: [],
                            });
                          }}
                        >
                          Publish to circles…
                        </button>
                      ) : null}
                    </div>
                  ) : myRating && detailEditRating ? (
                    <div className="detail-rate-section--slider" style={{ marginTop: 20 }}>
                      <div className="d-rate-label">Update your rating</div>
                      <div className="d-rate-row">
                        <div className="d-rate-slider-col">
                          <div className="d-rate-slider-wrap">
                            <output
                              className="d-rate-slider-bubble"
                              style={{ left: `${sliderBubbleLeftPct(detailRating)}%` }}
                            >
                              {detailRating}
                            </output>
                            <input
                              className="slider d-rate-slider"
                              type="range"
                              min="1"
                              max="10"
                              step="0.5"
                              value={detailRating}
                              onChange={e => { setDetailRating(parseFloat(e.target.value)); setDetailTouched(true); }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="d-actions" style={{ marginTop: 14 }}>
                        <button className="btn-full btn-full-gold" disabled={!detailTouched}
                          onClick={() => { void addRating(movie.id, detailRating, { skipPublishModal: true }); setDetailEditRating(false); }}>
                          Save new rating
                        </button>
                        <button type="button" className="btn-full btn-full-dark"
                          onClick={() => { setDetailEditRating(false); setDetailRating(myRating); }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : !myRating ? (
                    <div className="detail-rate-section--slider" style={{ marginTop: 20 }}>
                      <div className="d-rate-label d-rate-label--sentence">Select your rating and submit</div>
                      <div className="d-rate-row">
                        <div className="d-rate-slider-col">
                          <div className="d-rate-slider-wrap">
                            <output
                              className="d-rate-slider-bubble"
                              style={{ left: `${sliderBubbleLeftPct(detailRating)}%`, color: "#e8c96a" }}
                            >
                              {detailRating}
                            </output>
                            <input
                              className="slider d-rate-slider"
                              type="range"
                              min="1"
                              max="10"
                              step="0.5"
                              value={detailRating}
                              onChange={e => { setDetailRating(parseFloat(e.target.value)); setDetailTouched(true); }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="d-actions">
                        <button className="btn-full btn-full-gold" disabled={!detailTouched}
                          onClick={() => { void addRating(movie.id, detailRating, { pendingNavigate: "back", navigateDelayMs: 800 }); }}>
                          Submit Rating
                        </button>
                        <button
                          type="button"
                          className={`btn-full btn-full-dark ${inWatchlist(movie.id) ? "saved-style" : ""}`}
                          disabled={!inWatchlist(movie.id) && watchlist.length >= WATCHLIST_MAX}
                          title={
                            !inWatchlist(movie.id) && watchlist.length >= WATCHLIST_MAX
                              ? `Watchlist full (${WATCHLIST_MAX}). Remove a title first.`
                              : undefined
                          }
                          onClick={() => toggleWatchlist(movie)}
                        >
                          {inWatchlist(movie.id) ? "✓ Saved" : "+ Watchlist"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <BottomNav {...navProps} />
          </div>
        );
        })()}
      </div>
    </div>
  );
}