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
  updateCircle,
  leaveCircle,
  isCircleModerator,
  fetchPendingInvites,
  sendCircleInvite,
  acceptCircleInvite,
  declineCircleInvite,
  fetchRatingCircleShareIds,
  syncRatingCircleShares,
  addRatingCircleShares,
  fetchCircleTitlePublishers,
  fetchCirclePendingInviteLabels,
  fetchCircleRatedTitles,
  CIRCLE_STRIP_INITIAL,
  CIRCLE_STRIP_PAGE,
  CIRCLE_STRIP_MAX,
  CIRCLE_GRID_PAGE,
  CIRCLE_TOP_MAX,
  fetchMyCircleUnseenActivity,
  markCircleLastSeen,
  getCircleOthersActivityWatermark,
  buildCopyToMailCircleInviteText,
  buildCopyToMailCircleInviteMailto,
  INVITE_NO_CINEMASTRO_ACCOUNT_ERR_PREFIX,
} from "./circles";
import "./App.css";
import { PulsePage } from "./pages/PulsePage.jsx";
import { InTheatersPage } from "./pages/InTheatersPage.jsx";
import { SecondaryRegionPage } from "./pages/SecondaryRegionPage.jsx";

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

/**
 * Secondary Region → **Streaming** when profile secondary is **Indian**: same top three majors, then India-catalog SVOD.
 * Per-provider discover uses **US** `watch_region` for Netflix / Prime / Hulu (dense TMDB data) and **IN** for JioHotstar, Sony Liv, etc.
 * Primary Streaming page and profile “Where you watch” still use {@link STREAMING_SERVICES}.
 */
const SECONDARY_INDIAN_STREAMING_SERVICES = [
  { id: 8, label: "Netflix" },
  { id: 9, label: "Prime Video" },
  { id: 15, label: "Hulu" },
  { id: 2336, label: "JioHotstar" },
  { id: 237, label: "Sony Liv" },
  { id: 232, label: "Zee5" },
  { id: 309, label: "Sun Nxt" },
  { id: 2059, label: "Eros Now" },
];

/** TMDB `watch_region` for Indian secondary per-provider / shallow-provider discover (JustWatch India rows). */
const SECONDARY_INDIAN_STREAMING_WATCH_REGION = "IN";

function streamingServicesForSecondaryBlock(secondaryRegionKey) {
  return secondaryRegionKey === "indian" ? SECONDARY_INDIAN_STREAMING_SERVICES : STREAMING_SERVICES;
}

/**
 * Indian secondary **TV** service discover: `with_origin_country=IN` helps **Netflix** US strip density.
 * **Prime** / **Hulu** Indian catalog in TMDB is often not `IN` origin on discover — use broad US+provider + client filter only.
 */
const INDIAN_SECONDARY_TV_USE_ORIGIN_COUNTRY_IN_PROVIDER_ID = 8; // Netflix; not 9/15 (Prime/Hulu) — 6.0.14

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
  const empty = {
    tagline: null,
    genresLine: null,
    certification: null,
    runtimeLabel: null,
    releaseLabel: null,
    languageLabel: null,
  };
  if (!raw || isTmdbApiErrorPayload(raw)) return empty;
  const tag = typeof raw.tagline === "string" ? raw.tagline.trim() : "";
  const genresLine = genresLineFromTmdbDetail(raw);
  const languageLabel = formatOriginalLanguageDisplay(raw?.original_language) || null;
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
      languageLabel,
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
    languageLabel,
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

/** Legal routes use path URLs `/privacy`, `/terms`, `/about` (legacy `?legal=` still read on load). */
function pathnameLegalSegment(pathname) {
  const seg = String(pathname || "").replace(/^\/+|\/+$/g, "").split("/")[0];
  return SPA_LEGAL_SCREENS.has(seg) ? seg : null;
}

/** One overlay at a time: title id (`movie-769`) or legal screen path `/privacy` etc. */
function spaUrlForOverlay(overlay) {
  const u = new URL(window.location.href);
  if (overlay.detail) {
    u.searchParams.delete(SPA_QS_DETAIL);
    u.searchParams.delete(SPA_QS_LEGAL);
    if (pathnameLegalSegment(u.pathname)) {
      u.pathname = "/";
    }
    u.searchParams.set(SPA_QS_DETAIL, overlay.detail);
    return `${u.pathname}${u.search}${u.hash}`;
  }
  if (overlay.legal) {
    return `/${overlay.legal}${u.hash}`;
  }
  return `${u.pathname}${u.search}${u.hash}`;
}

function spaUrlWithoutOverlays() {
  const u = new URL(window.location.href);
  const legalSeg = pathnameLegalSegment(u.pathname);
  if (legalSeg) {
    u.pathname = "/";
  }
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

/** `origin_country` on discover / list payloads (raw TMDB). */
function rawTmdbItemHasOriginIn(item) {
  const raw = item?.origin_country;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return raw.map((c) => String(c).toUpperCase()).includes("IN");
}

/** `originCountries` on {@link normalizeTMDBItem} rows. */
function normalizedTmdbItemHasOriginIn(norm) {
  const raw = norm?.originCountries;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return raw.map((c) => String(c).toUpperCase()).includes("IN");
}

/**
 * Indian secondary taste: `original_language` in profile bucket (hi, ta, …) **or** India as origin.
 * Many Indian Netflix / US-catalog titles are `original_language: en` in TMDB; editorial lists still match `origin_country: IN`.
 */
function filterNormalizedRowsByIndianSecondaryTaste(rows, langCodes) {
  if (!Array.isArray(langCodes) || langCodes.length === 0) return rows;
  const allow = new Set(langCodes.map((c) => String(c).toLowerCase()));
  return (rows || []).filter((m) => {
    if (allow.has(String(m?.language || "").toLowerCase())) return true;
    return normalizedTmdbItemHasOriginIn(m);
  });
}

/**
 * Deduplicate by TMDB id; keep **newer** `releaseDate` (then popularity) for secondary streaming strips.
 * `cap` = {@link SECONDARY_STRIP_TAB_CAP} in practice.
 */
function mergeSecondaryStripByNewestUnique(rows, cap) {
  if (!Array.isArray(rows) || cap < 1) return [];
  const sorted = [...rows].sort((a, b) => {
    const da = a?.releaseDate || "0000-00-00";
    const db = b?.releaseDate || "0000-00-00";
    if (db !== da) return String(db).localeCompare(String(da));
    return (Number(b?.popularity) || 0) - (Number(a?.popularity) || 0);
  });
  const seen = new Set();
  const out = [];
  for (const m of sorted) {
    if (m?.tmdbId == null) continue;
    if (seen.has(m.tmdbId)) continue;
    seen.add(m.tmdbId);
    out.push(m);
    if (out.length >= cap) break;
  }
  return out;
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

/** Main **Streaming** page only: hidden by default unless user includes them via the Genres control. Family (10751) is not excluded. */
const STREAMING_PAGE_HIDABLE_GENRE_IDS = Object.freeze([16, 99, 10764, 10762]); // Animation, Documentary, Reality, Kids

/** Labels for {@link STREAMING_PAGE_HIDABLE_GENRE_IDS} (UI toggles). */
const STREAMING_PAGE_GENRE_TOGGLE_OPTIONS = Object.freeze([
  { id: 16, label: "Animation" },
  { id: 99, label: "Documentary" },
  { id: 10764, label: "Reality" },
  { id: 10762, label: "Kids" },
]);

function streamingPageExcludedGenreIds(includedHidableIds) {
  const inc = new Set(
    (includedHidableIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n)),
  );
  return STREAMING_PAGE_HIDABLE_GENRE_IDS.filter((id) => !inc.has(id));
}

function filterStreamingPageExcludedGenres(items, includedHidableIds) {
  const excluded = streamingPageExcludedGenreIds(includedHidableIds);
  return (items || []).filter((item) => !hasExcludedGenre(item, excluded));
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

/** Circles list: “last activity in circle” line from `latest_share_at` (any member; local calendar). */
function formatCircleListLastActivity(isoOrString) {
  if (isoOrString == null || isoOrString === "") return null;
  const d = new Date(isoOrString);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startToday - startThat) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 0) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** US limited theatrical (TMDB release type 2): newest type-2 date within `maxDays`, or pass if no US type-2 row. */
function passesUsTheatricalLimitedWindow(releasePayload, maxDays) {
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
  return withinPastDays(newestLimited, maxDays);
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
 * US theatrical: **Now** = `now_playing` + gates, release-date order. **Popular** = `/trending/movie/week` (pages 1–2),
 * same genre / released / language / US limited-window gates; **trending order** (parallel to main Streaming “popular”).
 */
async function fetchInTheaters(regionKeys = []) {
  try {
    const LIMITED_THEATRICAL_MAX_DAYS = 14;
    const langCodes = getRegionLanguageCodes(regionKeys);
    const now = formatIsoDate(new Date());
    const [p1, p2, w1, w2] = await Promise.all([
      fetchTMDB("/movie/now_playing?language=en-US&region=US&page=1"),
      fetchTMDB("/movie/now_playing?language=en-US&region=US&page=2"),
      fetchTMDB("/trending/movie/week?language=en-US"),
      fetchTMDB("/trending/movie/week?language=en-US&page=2"),
    ]);

    const filterLangAndReleased = (item) =>
      item?.release_date &&
      item.release_date <= now &&
      (langCodes.length > 0 ? langCodes.includes(String(item?.original_language || "").toLowerCase()) : true);

    const mergedNp = filterDefaultExcludedGenres([...(p1.results || []), ...(p2.results || [])]).filter(filterLangAndReleased);

    const dedupedNp = [...new Map(mergedNp.map((item) => [item.id, item])).values()];
    const releaseDatesMapNp = await fetchMovieReleaseDatesById(dedupedNp.map((item) => item.id));
    const gatedNp = dedupedNp.filter((item) =>
      passesUsTheatricalLimitedWindow(releaseDatesMapNp.get(item.id), LIMITED_THEATRICAL_MAX_DAYS),
    );
    const normalizedNp = gatedNp.map((item) => normalizeTMDBItem(item, "movie"));
    const nowPlaying = sortTheatricalMoviesByReleaseDateDesc(normalizedNp).slice(0, IN_THEATERS_PAGE_STRIP_CAP);

    const trendingMerged = [...(w1.results || []), ...(w2.results || [])];
    const trendingDeduped = [...new Map(trendingMerged.map((item) => [item.id, item])).values()];
    const trendingPreGate = filterDefaultExcludedGenres(trendingDeduped).filter(filterLangAndReleased);
    const releaseDatesMapTrend = await fetchMovieReleaseDatesById(trendingPreGate.map((item) => item.id));
    const trendingGated = trendingPreGate.filter((item) =>
      passesUsTheatricalLimitedWindow(releaseDatesMapTrend.get(item.id), LIMITED_THEATRICAL_MAX_DAYS),
    );
    const popularInTheaters = trendingGated
      .slice(0, IN_THEATERS_PAGE_STRIP_CAP)
      .map((item) => normalizeTMDBItem(item, "movie"));

    return { nowPlaying, popularInTheaters };
  } catch {
    return { nowPlaying: [], popularInTheaters: [] };
  }
}

/** Dedupe by id for catalogue / predict: **Now** first, then **Popular** titles not already listed. */
function mergeInTheatersStripsForCatalogue(nowPlaying, popularInTheaters) {
  const out = [];
  const seen = new Set();
  for (const m of [...(nowPlaying || []), ...(popularInTheaters || [])]) {
    if (m == null || m.id == null || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
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

function filterRowsByProfileLanguageCodes(rows, langCodes) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (!Array.isArray(langCodes) || langCodes.length === 0) return rows;
  const allow = new Set(langCodes.map((c) => String(c).toLowerCase()));
  return rows.filter((m) => allow.has(String(m?.language || "").toLowerCase()));
}

/** Main **Streaming** page — All services: movies **now** = US `flatrate`, **90d** release window, newest date first (B). */
async function fetchStreamingPageMoviesNowAllServices(regionKeys, includedHidableGenreIds = []) {
  const fill = async (langSuffix) => {
    const gte = dateDaysAgo(90);
    const lte = formatIsoDate(new Date());
    const out = [];
    const seen = new Set();
    for (let page = 1; page <= 5 && out.length < STREAMING_PAGE_STRIP_CAP; page++) {
      const path = `/discover/movie?language=en-US&sort_by=primary_release_date.desc&page=${page}&region=US&watch_region=US&with_watch_monetization_types=flatrate&primary_release_date.gte=${gte}&primary_release_date.lte=${lte}${langSuffix}`;
      const data = await fetchTMDB(path);
      if (isTmdbApiErrorPayload(data)) break;
      for (const item of filterStreamingPageExcludedGenres(data?.results || [], includedHidableGenreIds)) {
        if (out.length >= STREAMING_PAGE_STRIP_CAP) break;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(normalizeTMDBItem(item, "movie"));
      }
      if ((data?.results || []).length < 1) break;
    }
    return out;
  };
  try {
    const langCodes = getRegionLanguageCodes(regionKeys);
    const langQuery = langCodes.length > 0 ? `&with_original_language=${langCodes.join("|")}` : "";
    let out = await fill(langQuery);
    if (out.length === 0 && langQuery) out = await fill("");
    return filterRowsByProfileLanguageCodes(out, langCodes);
  } catch {
    return [];
  }
}

/** All services: movies **popular** = TMDB **trending** week (D). */
async function fetchStreamingPageMoviesPopularAllServices(regionKeys, includedHidableGenreIds = []) {
  try {
    const langCodes = getRegionLanguageCodes(regionKeys);
    const pages = await Promise.all([1, 2].map((p) => fetchTMDB(`/trending/movie/week?language=en-US&page=${p}`)));
    if (pages.some(isTmdbApiErrorPayload)) return [];
    const merged = filterStreamingPageExcludedGenres(pages.flatMap((p) => p.results || []), includedHidableGenreIds);
    const deduped = [...new Map(merged.map((item) => [item.id, item])).values()];
    const normalized = deduped.slice(0, STREAMING_PAGE_STRIP_CAP).map((m) => normalizeTMDBItem(m, "movie"));
    return filterRowsByProfileLanguageCodes(normalized, langCodes);
  } catch {
    return [];
  }
}

/** All services: TV **now** = US `flatrate`, `first_air_date` desc (new to SVOD; no 90d). */
async function fetchStreamingPageTvNowAllServices(regionKeys, includedHidableGenreIds = []) {
  const fill = async (langSuffix) => {
    const out = [];
    const seen = new Set();
    for (let page = 1; page <= 5 && out.length < STREAMING_PAGE_STRIP_CAP; page++) {
      const path = `/discover/tv?language=en-US&sort_by=first_air_date.desc&page=${page}&watch_region=US&with_watch_monetization_types=flatrate${langSuffix}`;
      const data = await fetchTMDB(path);
      if (isTmdbApiErrorPayload(data)) break;
      for (const item of filterStreamingPageExcludedGenres(data?.results || [], includedHidableGenreIds)) {
        if (out.length >= STREAMING_PAGE_STRIP_CAP) break;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(normalizeTMDBItem(item, "tv"));
      }
      if ((data?.results || []).length < 1) break;
    }
    return out;
  };
  try {
    const langCodes = getRegionLanguageCodes(regionKeys);
    const langQuery = langCodes.length > 0 ? `&with_original_language=${langCodes.join("|")}` : "";
    let out = await fill(langQuery);
    if (out.length === 0 && langQuery) out = await fill("");
    return filterRowsByProfileLanguageCodes(out, langCodes);
  } catch {
    return [];
  }
}

/** All services: TV **popular** = `trending/tv/week` (excl. talk/news like elsewhere). */
async function fetchStreamingPageTvPopularAllServices(regionKeys, includedHidableGenreIds = []) {
  try {
    const langCodes = getRegionLanguageCodes(regionKeys);
    const excludedTrendingGenres = new Set([10767, 10763]);
    const pages = await Promise.all([1, 2].map((p) => fetchTMDB(`/trending/tv/week?language=en-US&page=${p}`)));
    if (pages.some(isTmdbApiErrorPayload)) return [];
    const merged = filterStreamingPageExcludedGenres(
      pages.flatMap((p) => p.results || []).filter((item) => {
        const genreIds = Array.isArray(item?.genre_ids) ? item.genre_ids : [];
        return !genreIds.some((g) => excludedTrendingGenres.has(Number(g)));
      }),
      includedHidableGenreIds,
    );
    const deduped = [...new Map(merged.map((item) => [item.id, item])).values()];
    const normalized = deduped.slice(0, STREAMING_PAGE_STRIP_CAP).map((m) => normalizeTMDBItem(m, "tv"));
    return filterRowsByProfileLanguageCodes(normalized, langCodes);
  } catch {
    return [];
  }
}

/* ─── V1.3.0: Secondary “Region” home strip (Hollywood / US remains primary Now Playing + Streaming). ─── */

/** V1.3.3: Max titles per Region-block tab (no “Load more”; tabs scope the list). */
const SECONDARY_STRIP_TAB_CAP = 25;
/** V1.3.0: Profile keys allowed for {@link profiles.secondary_region_key}; excludes hollywood (primary). */
const V130_SECONDARY_REGION_IDS = ["indian", "asian", "latam", "european"];

/**
 * V1.3.0: TMDB `region` / `watch_region` for “where you can watch” on the secondary Region screen (US = primary app market).
 * Taste (Indian, Asian, etc.) comes from `secondary_region_key` via {@link getRegionLanguageCodes} — not from this ISO code.
 * **Indian** uses broad discover + client `original_language` filter (6.0.11); other buckets may still use TMDB `with_original_language` on discover where helpful.
 */
const SECONDARY_AVAILABILITY_TMDB_REGION = "US";

/** Indian secondary: TMDB US-catalog majors; taste filter still applies (Hulu has almost no IN JustWatch rows). */
const SECONDARY_INDIAN_STREAMING_US_MAJOR_PROVIDER_IDS = new Set([8, 9, 15]);

function watchRegionForIndianSecondaryProvider(providerId) {
  const id = Number(providerId);
  return SECONDARY_INDIAN_STREAMING_US_MAJOR_PROVIDER_IDS.has(id)
    ? SECONDARY_AVAILABILITY_TMDB_REGION
    : SECONDARY_INDIAN_STREAMING_WATCH_REGION;
}

function secondaryRegionPerServiceWatchRegion(secondaryRegionKey, providerId) {
  if (secondaryRegionKey !== "indian") return SECONDARY_AVAILABILITY_TMDB_REGION;
  return watchRegionForIndianSecondaryProvider(providerId);
}

/** V1.3.0: Home section title — plain region words (friend-testing copy). */
const V130_SECONDARY_HOME_TITLE = {
  indian: "Indian",
  asian: "Asian",
  latam: "Latin / Iberian",
  european: "European",
};

/** V1.3.2: Dedupe normalized catalogue rows by `id` (secondary block catalogue union). */
function dedupeMediaRowsById(rows) {
  return [...new Map((rows || []).map((m) => [m.id, m])).values()];
}

/** V1.3.2: Top-level tabs on the secondary Region home block. */
const SECONDARY_BLOCK_THEATERS = "theaters";
const SECONDARY_BLOCK_STREAMING = "streaming";

/** Theatrical `region` = viewer market. Secondary Region uses {@link SECONDARY_AVAILABILITY_TMDB_REGION} + `langCodes` for taste. */
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
      .filter((item) => {
        if (langCodes.length === 0) return true;
        if (langCodes.includes(String(item?.original_language || "").toLowerCase())) return true;
        return rawTmdbItemHasOriginIn(item);
      });

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

const SECONDARY_INDIAN_FLATRATE_DISCOVER_MAX_PAGE = 5;
/** Shallow 1 page / small cap each — when All-services pool is still short after flatrate (Indian TV + movies; non-Indian movies). */
const SECONDARY_INDIAN_BROAD_PROVIDERS_TAKE = 6;
/** After base + US `flatrate` merge, run per-provider discover if unique count is still below this (matches Series). */
const SECONDARY_ALLSVC_MOVIE_PROVIDER_WIDEN_BELOW = 12;
const noopStreamingRefill = () => {};

/**
 * **Indian secondary, All services, movies:** US `flatrate` discover (no single `with_watch_providers`) to pad the
 * 90d/trending pool when taste leaves too few rows.
 */
async function fetchDiscoverMovieUsSubscriptionFlatrateBroad(
  tmdbRegionIso,
  clientLangs,
  maxCollect,
) {
  if (!Array.isArray(clientLangs) || clientLangs.length < 1) return [];
  const reg = encodeURIComponent(tmdbRegionIso);
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= SECONDARY_INDIAN_FLATRATE_DISCOVER_MAX_PAGE && out.length < maxCollect; page++) {
    const path = `/discover/movie?language=en-US&sort_by=primary_release_date.desc&page=${page}&region=${reg}&watch_region=${reg}&with_watch_monetization_types=flatrate`;
    const data = await fetchTMDB(path);
    if (isTmdbApiErrorPayload(data)) break;
    const results = filterDefaultExcludedGenres(data?.results || []);
    for (const item of results) {
      if (out.length >= maxCollect) break;
      if (seen.has(item.id)) continue;
      const norm = normalizeTMDBItem(item, "movie");
      if (!filterNormalizedRowsByIndianSecondaryTaste([norm], clientLangs).length) continue;
      seen.add(item.id);
      out.push(norm);
    }
    if ((data?.results || []).length < 1) break;
  }
  return out;
}

/**
 * **Non-Indian** secondary, All services **movies:** US `flatrate` discover with optional
 * `&with_original_language=…` (same shape as 90d paths) — no calendar window; sorts newest first, paged.
 */
async function fetchDiscoverMovieUsFlatrateBroadWithLangSuffix(
  tmdbRegionIso,
  langQuerySuffix,
  maxCollect,
) {
  const reg = encodeURIComponent(tmdbRegionIso);
  const suff = typeof langQuerySuffix === "string" ? langQuerySuffix : "";
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= SECONDARY_INDIAN_FLATRATE_DISCOVER_MAX_PAGE && out.length < maxCollect; page++) {
    const path = `/discover/movie?language=en-US&sort_by=primary_release_date.desc&page=${page}&region=${reg}&watch_region=${reg}&with_watch_monetization_types=flatrate${suff}`;
    const data = await fetchTMDB(path);
    if (isTmdbApiErrorPayload(data)) break;
    const results = filterDefaultExcludedGenres(data?.results || []);
    for (const item of results) {
      if (out.length >= maxCollect) break;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(normalizeTMDBItem(item, "movie"));
    }
    if ((data?.results || []).length < 1) break;
  }
  return out;
}

/**
 * Shallow per-provider US `discover` for **movies** (All services) — same as service strip, small cap per service.
 * @param {string} tmdbRegionIso
 * @param {string[]|null} clientLangs — Indian allowlist, or `null` / empty to use `originalLanguageQuery` on discover only.
 * @param {string} [originalLanguageQuery] — e.g. `&with_original_language=ko` for non-Indian secondary.
 */
async function fetchDiscoverSecondaryMovieShallowFromTopProviders(
  tmdbRegionIso,
  clientLangs,
  originalLanguageQuery = "",
) {
  const isIndian = Array.isArray(clientLangs) && clientLangs.length > 0;
  const slice = isIndian
    ? SECONDARY_INDIAN_STREAMING_SERVICES
    : STREAMING_SERVICES.slice(0, SECONDARY_INDIAN_BROAD_PROVIDERS_TAKE);
  const q = typeof originalLanguageQuery === "string" ? originalLanguageQuery : "";
  const pools = await Promise.all(
    slice.map((s) =>
      fetchStreamingPageProviderRefillPool(
        "movie",
        s.id,
        noopStreamingRefill,
        isIndian ? watchRegionForIndianSecondaryProvider(s.id) : tmdbRegionIso,
        isIndian ? "" : q,
        isIndian ? clientLangs : null,
        { maxPage: 1, cap: 8 },
      ),
    ),
  );
  return pools.flat();
}

/**
 * Widen the **All services** movie pool: US `flatrate` (no 90d cap), then per-provider if still thin — Indian and non-Indian.
 */
async function widenSecondaryAllServicesMoviePool(
  tmdbRegionIso,
  tmdbLangSuffix,
  clientLangs,
  baseRows,
) {
  let merged = mergeSecondaryStripByNewestUnique(
    [...(baseRows || [])],
    SECONDARY_STRIP_TAB_CAP * 2,
  );
  if (merged.length >= SECONDARY_STRIP_TAB_CAP) {
    return merged.slice(0, SECONDARY_STRIP_TAB_CAP);
  }
  if (clientLangs) {
    const flat = await fetchDiscoverMovieUsSubscriptionFlatrateBroad(
      tmdbRegionIso,
      clientLangs,
      SECONDARY_STRIP_TAB_CAP * 2,
    );
    merged = mergeSecondaryStripByNewestUnique([...merged, ...flat], SECONDARY_STRIP_TAB_CAP * 2);
    if (merged.length < SECONDARY_ALLSVC_MOVIE_PROVIDER_WIDEN_BELOW) {
      const prov = await fetchDiscoverSecondaryMovieShallowFromTopProviders(
        tmdbRegionIso,
        clientLangs,
        "",
      );
      merged = mergeSecondaryStripByNewestUnique([...merged, ...prov], SECONDARY_STRIP_TAB_CAP * 2);
    }
    return mergeSecondaryStripByNewestUnique(merged, SECONDARY_STRIP_TAB_CAP);
  }
  const flat = await fetchDiscoverMovieUsFlatrateBroadWithLangSuffix(
    tmdbRegionIso,
    tmdbLangSuffix || "",
    SECONDARY_STRIP_TAB_CAP * 2,
  );
  merged = mergeSecondaryStripByNewestUnique([...merged, ...flat], SECONDARY_STRIP_TAB_CAP * 2);
  if (merged.length < SECONDARY_ALLSVC_MOVIE_PROVIDER_WIDEN_BELOW) {
    const prov = await fetchDiscoverSecondaryMovieShallowFromTopProviders(
      tmdbRegionIso,
      null,
      tmdbLangSuffix || "",
    );
    merged = mergeSecondaryStripByNewestUnique([...merged, ...prov], SECONDARY_STRIP_TAB_CAP * 2);
  }
  return mergeSecondaryStripByNewestUnique(merged, SECONDARY_STRIP_TAB_CAP);
}

/**
 * **Indian secondary, All services, TV:** US subscription discover without a single provider id (broad `flatrate` pool).
 * Falls back to nothing if TMDB returns an error for this query shape in some regions.
 */
async function fetchDiscoverTvUsSubscriptionFlatrateBroad(
  tmdbRegionIso,
  clientLangs,
  maxCollect,
) {
  if (!Array.isArray(clientLangs) || clientLangs.length < 1) return [];
  const reg = encodeURIComponent(tmdbRegionIso);
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= SECONDARY_INDIAN_FLATRATE_DISCOVER_MAX_PAGE && out.length < maxCollect; page++) {
    const path = `/discover/tv?language=en-US&sort_by=first_air_date.desc&page=${page}&watch_region=${reg}&with_watch_monetization_types=flatrate`;
    const data = await fetchTMDB(path);
    if (isTmdbApiErrorPayload(data)) break;
    const results = filterDefaultExcludedGenres(data?.results || []);
    for (const item of results) {
      if (out.length >= maxCollect) break;
      if (seen.has(item.id)) continue;
      const norm = normalizeTMDBItem(item, "tv");
      if (!filterNormalizedRowsByIndianSecondaryTaste([norm], clientLangs).length) continue;
      seen.add(item.id);
      out.push(norm);
    }
    if ((data?.results || []).length < 1) break;
  }
  return out;
}

/**
 * Shallow per-provider US `discover` (same as service strip) — used only to widen the Indian **All services** TV pool.
 */
async function fetchDiscoverIndianSecondaryTvShallowFromTopProviders(
  _tmdbRegionIso,
  clientLangs,
) {
  if (!Array.isArray(clientLangs) || clientLangs.length < 1) return [];
  const slice = SECONDARY_INDIAN_STREAMING_SERVICES;
  const pools = await Promise.all(
    slice.map((s) =>
      fetchStreamingPageProviderRefillPool(
        "tv",
        s.id,
        noopStreamingRefill,
        watchRegionForIndianSecondaryProvider(s.id),
        "",
        clientLangs,
        { maxPage: 1, cap: 8 },
      ),
    ),
  );
  return pools.flat();
}

/**
 * 180d new + trending with detail gate; **non-Indian** = full path; for **Indian** this pool is **merged** with
 * US subscription discover so the All-services strip is not limited to the tight gate.
 */
async function fetchStreamingTVTightPoolForMarket(
  tmdbRegionIso,
  tmdbLangSuffix,
  langSet,
) {
  const reg = encodeURIComponent(tmdbRegionIso);
  const tvNewSeriesStart = dateDaysAgo(180);
  const excludedTrendingGenres = new Set([10767, 10763]);
  const tvNewSeriesBase = `/discover/tv?language=en-US&region=${reg}&sort_by=popularity.desc&first_air_date.gte=${tvNewSeriesStart}&first_air_date.lte=${formatIsoDate(new Date())}${tmdbLangSuffix}`;
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
  let tvResults = tvCandidates.filter((item) => {
    const detail = tvDetailsMap.get(item.id);
    const seasons = Number(detail?.number_of_seasons ?? 0);
    const isNewSeries = seasons === 1 && withinPastDays(item?.first_air_date, 180);
    const isNewSeason = seasons > 1 && withinPastDays(detail?.last_air_date, 7);
    const trendingEligible = tvTrendingCandidates.some((t) => t.id === item.id);
    return isNewSeries || isNewSeason || trendingEligible;
  });
  if (langSet) {
    tvResults = tvResults.filter((item) => {
      if (langSet.has(String(item?.original_language || "").toLowerCase())) return true;
      return rawTmdbItemHasOriginIn(item);
    });
  }

  const dedupeByTmdbId = (arr) => [...new Map(arr.map((item) => [item.id, item])).values()];
  return filterDefaultExcludedGenres(dedupeByTmdbId(tvResults)).map((m) => normalizeTMDBItem(m, "tv"));
}

/**
 * Streaming movie discover: `tmdbRegionIso` = availability market (US for secondary). `langQuery` = `&with_original_language=…` for TMDB.
 * Optional `clientOriginalLanguageCodes` (e.g. **Indian** secondary): omit TMDB language filter, then {@link filterNormalizedRowsByIndianSecondaryTaste} (language or **`IN`** origin) — `with_original_language` + discover is too sparse, and many Indian SVOD rows are `en` in TMDB.
 * **All services:** after 90d/trending attempts, {@link widenSecondaryAllServicesMoviePool} adds US `flatrate` (no 90d cap) and, if the merged unique count is still under **12**, shallow per-provider movie discover (6.0.17+) — **Indian** and **non-Indian** secondaries.
 */
async function fetchStreamingMoviesForMarket(tmdbRegionIso, langQuery, clientOriginalLanguageCodes = null) {
  const clientLangs =
    Array.isArray(clientOriginalLanguageCodes) && clientOriginalLanguageCodes.length > 0
      ? clientOriginalLanguageCodes.map((c) => String(c).toLowerCase())
      : null;
  const tmdbLangSuffix = clientLangs ? "" : (langQuery || "");
  const taste = (rows) => (clientLangs
    ? filterNormalizedRowsByIndianSecondaryTaste(rows, clientLangs)
    : rows);

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

    let out = taste(await discoverToMovies(`${digitalDiscoverBase}${tmdbLangSuffix}`));
    if (out.length > 0) {
      return await widenSecondaryAllServicesMoviePool(
        tmdbRegionIso, tmdbLangSuffix, clientLangs, out,
      );
    }
    if (tmdbLangSuffix) {
      out = taste(await discoverToMovies(`${digitalDiscoverBase}`));
      if (out.length > 0) {
        return await widenSecondaryAllServicesMoviePool(
          tmdbRegionIso, tmdbLangSuffix, clientLangs, out,
        );
      }
    }
    out = taste(await discoverToMovies(`${broadDateDiscoverBase}${tmdbLangSuffix}`));
    if (out.length > 0) {
      return await widenSecondaryAllServicesMoviePool(
        tmdbRegionIso, tmdbLangSuffix, clientLangs, out,
      );
    }
    if (tmdbLangSuffix) {
      out = taste(await discoverToMovies(`${broadDateDiscoverBase}`));
      if (out.length > 0) {
        return await widenSecondaryAllServicesMoviePool(
          tmdbRegionIso, tmdbLangSuffix, clientLangs, out,
        );
      }
    }
    return await widenSecondaryAllServicesMoviePool(
      tmdbRegionIso,
      tmdbLangSuffix,
      clientLangs,
      taste(await trendingToMovies()),
    );
  } catch {
    return [];
  }
}

/**
 * Streaming TV discover: `tmdbRegionIso` = US for secondary. `clientOriginalLanguageCodes` same as {@link fetchStreamingMoviesForMarket}.
 * **Indian (All services):** merges US `flatrate` discover (and shallow per-provider + tight 180d/trending gate) so the pool is
 * not only “new/7d + trending” after taste — 6.0.16+; stagger still only **reveals** (see `secondaryRegionAllServicesStreamDisplayLen`).
 */
async function fetchStreamingTVForMarket(tmdbRegionIso, langQuery, clientOriginalLanguageCodes = null) {
  const clientLangs =
    Array.isArray(clientOriginalLanguageCodes) && clientOriginalLanguageCodes.length > 0
      ? clientOriginalLanguageCodes.map((c) => String(c).toLowerCase())
      : null;
  const tmdbLangSuffix = clientLangs ? "" : (langQuery || "");
  const langSet = clientLangs ? new Set(clientLangs) : null;

  if (clientLangs) {
    try {
      const [tightNorm, flatBroad] = await Promise.all([
        fetchStreamingTVTightPoolForMarket(tmdbRegionIso, tmdbLangSuffix, langSet),
        fetchDiscoverTvUsSubscriptionFlatrateBroad(
          tmdbRegionIso,
          clientLangs,
          SECONDARY_STRIP_TAB_CAP * 2,
        ),
      ]);
      const mergedN = mergeSecondaryStripByNewestUnique(
        [...tightNorm, ...flatBroad],
        SECONDARY_STRIP_TAB_CAP * 2,
      );
      if (mergedN.length < 12) {
        const fromProv = await fetchDiscoverIndianSecondaryTvShallowFromTopProviders(
          tmdbRegionIso,
          clientLangs,
        );
        return mergeSecondaryStripByNewestUnique(
          [...mergedN, ...fromProv],
          SECONDARY_STRIP_TAB_CAP,
        );
      }
      return mergeSecondaryStripByNewestUnique(mergedN, SECONDARY_STRIP_TAB_CAP);
    } catch {
      return [];
    }
  }

  try {
    const rows = await fetchStreamingTVTightPoolForMarket(tmdbRegionIso, tmdbLangSuffix, langSet);
    return rows.slice(0, SECONDARY_STRIP_TAB_CAP);
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

/** US `flatrate` provider IDs; shares cache map with Your Picks (`worthProviderCacheRef`). */
async function getOrFetchFlatrateProviderIds(movie, cacheMap) {
  if (!movie || movie.tmdbId == null) return [];
  const key = `${movie.type}-${movie.tmdbId}`;
  if (cacheMap.has(key)) return cacheMap.get(key);
  const data = await fetchWatchProviders(movie.tmdbId, movie.type);
  const ids = Array.isArray(data?.flatrate)
    ? data.flatrate.map((p) => Number(p?.provider_id)).filter((n) => Number.isFinite(n))
    : [];
  cacheMap.set(key, ids);
  return ids;
}

/**
 * Main **Streaming** page strips: pool size **25**; stagger **5 → 25** in steps of 5.
 * Per-provider refill uses the same cap (in-service **date** row vs **popularity** row).
 */
const STREAMING_PAGE_STRIP_CAP = 25;
/** Main **In Theaters** screen (`fetchInTheaters`): max titles per row (Now Playing + Popular). */
const IN_THEATERS_PAGE_STRIP_CAP = 20;
/** @deprecated name — use {@link STREAMING_PAGE_STRIP_CAP}. */
const STREAMING_PAGE_PROVIDER_REFILL_CAP = STREAMING_PAGE_STRIP_CAP;
const STREAMING_PAGE_REVEAL_FIRST = 5;
const STREAMING_PAGE_REVEAL_STEPS = [5, 10, 15, 20, 25];
/**
 * **Secondary Region screen → Streaming** strip only: first wave 5, then 9…20 with delay (main **Streaming** page keeps 4,9,14,19,20).
 * Applies to **All services** and **per-provider** pools on that screen.
 */
const SECONDARY_REGION_STREAM_REVEAL_MAX = 20;
const SECONDARY_REGION_STREAM_REVEAL_FIRST = 5;
const SECONDARY_REGION_STREAM_REVEAL_STEPS = [5, 9, 14, 19, 20];

/**
 * Paged discover with a single watch provider; `onProgress` receives cumulative rows (pre-cap).
 * `watchRegion` = TMDB ISO (e.g. `US`, `IN`) — same as `watch_region` in discover.
 * `originalLanguageQuery` = optional `&with_original_language=…` (omit for **Indian** when passing `originalLanguageAllowlist` — see 6.0.11).
 * `originalLanguageAllowlist` = e.g. Indian codes: broad US+provider discover, then keep rows that match **Indian** taste (see {@link filterNormalizedRowsByIndianSecondaryTaste}).
 * **Indian + TV + Netflix only:** `with_origin_country=IN` on discover (list payloads omit `IN` often; need dense India slice). **Prime / Hulu** omit that param so licensed Indian shows (non-`IN` origin in TMDB) still surface.
 * `options.discoverSort`: **`date`** (default) = newest US release or first air; **`popularity`** = in-service TMDB popularity (main Streaming “What’s popular” with a service selected). Movies + **date** use a **90-day** `primary_release_date` window.
 * `options.excludedGenreIds`: TMDB `genre_ids` to drop (default **animation-only**); main Streaming page passes **`streamingPageExcludedGenreIds(…)`**.
 */
async function fetchStreamingPageProviderRefillPool(
  mediaType,
  providerId,
  onProgress,
  watchRegion = "US",
  originalLanguageQuery = "",
  originalLanguageAllowlist = null,
  options = {},
) {
  const {
    maxPage: maxPageLimit = 5,
    cap: resultCap = STREAMING_PAGE_STRIP_CAP,
    discoverSort = "date",
    excludedGenreIds = DEFAULT_EXCLUDED_GENRE_IDS,
  } = options;
  const type = mediaType === "movie" ? "movie" : "tv";
  const reg = encodeURIComponent(String(watchRegion || "US").toUpperCase());
  const sortBy =
    discoverSort === "popularity"
      ? "popularity.desc"
      : (mediaType === "movie" ? "primary_release_date.desc" : "first_air_date.desc");
  const movie90dWindow =
    type === "movie" && discoverSort === "date"
      ? `&primary_release_date.gte=${dateDaysAgo(90)}&primary_release_date.lte=${formatIsoDate(new Date())}`
      : "";
  const allow =
    Array.isArray(originalLanguageAllowlist) && originalLanguageAllowlist.length > 0
      ? new Set(originalLanguageAllowlist.map((c) => String(c).toLowerCase()))
      : null;
  const langSuffix = allow
    ? ""
    : (typeof originalLanguageQuery === "string" ? originalLanguageQuery : "");
  const useIndianOriginInDiscover =
    allow
    && type === "tv"
    && Number(providerId) === INDIAN_SECONDARY_TV_USE_ORIGIN_COUNTRY_IN_PROVIDER_ID;
  const indianTvDiscoverOrigin = useIndianOriginInDiscover ? "&with_origin_country=IN" : "";
  const all = [];
  const seen = new Set();
  let page = 1;
  while (all.length < resultCap && page <= maxPageLimit) {
    const path = `/discover/${type}?language=en-US&sort_by=${sortBy}&page=${page}&watch_region=${reg}&with_watch_providers=${providerId}&with_watch_monetization_types=flatrate${langSuffix}${indianTvDiscoverOrigin}${movie90dWindow}`;
    const data = await fetchTMDB(path);
    if (isTmdbApiErrorPayload(data)) break;
    const results = data?.results || [];
    for (const item of results) {
      if (all.length >= resultCap) break;
      if (seen.has(item.id)) continue;
      if (hasExcludedGenre(item, excludedGenreIds)) continue;
      const norm = normalizeTMDBItem(item, type);
      if (allow) {
        const okLang = allow.has(String(norm.language || "").toLowerCase());
        if (!okLang && !normalizedTmdbItemHasOriginIn(norm) && !rawTmdbItemHasOriginIn(item)) {
          continue;
        }
      }
      seen.add(item.id);
      all.push(norm);
    }
    onProgress([...all]);
    if (results.length < 1) break;
    page += 1;
  }
  return all.slice(0, resultCap);
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
// Where to Watch
// ---------------------------------------------------------------------------
function googleTheatricalShowtimesSearchUrl(title, year) {
  const t = String(title || "").trim();
  const y = year != null && String(year).trim() !== "" ? String(year).trim() : "";
  const q = [t, y, "movie showtimes"].filter((p) => p.length > 0).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function WhereToWatch({ tmdbId, type, movieTitle, movieYear, showTheatricalShowtimesFallback }) {
  const [providers, setProviders] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchWatchProviders(tmdbId, type).then(data => { setProviders(data); setLoading(false); });
  }, [tmdbId, type]);

  const theatricalHref =
    type === "movie" &&
    showTheatricalShowtimesFallback &&
    String(movieTitle || "").trim().length > 0
      ? googleTheatricalShowtimesSearchUrl(movieTitle, movieYear)
      : null;
  const theatricalBlock = theatricalHref ? (
    <>
      <a className="wtw-link" href={theatricalHref} target="_blank" rel="noopener noreferrer">
        Find showtimes near you (Google) →
      </a>
      <div className="wtw-theatrical-hint">Opens Google search; theaters and times depend on your location.</div>
    </>
  ) : null;

  if (loading) return <div className="wtw-section"><div className="wtw-title">Where to Watch</div><div className="wtw-loading">Checking availability…</div></div>;
  if (!providers) {
    return (
      <div className="wtw-section">
        <div className="wtw-title">Where to Watch</div>
        <div className="wtw-none">Availability not found</div>
        {theatricalBlock}
      </div>
    );
  }
  const groups = [
    { label: "Free", data: providers.free },
    { label: "Subscription", data: providers.flatrate },
    { label: "Rent", data: providers.rent },
    { label: "Buy", data: providers.buy },
  ].filter(g => g.data.length > 0);
  const streamingEmpty = groups.length === 0;
  return (
    <div className="wtw-section">
      <div className="wtw-title">Where to Watch</div>
      {streamingEmpty ? <div className="wtw-none">Not currently available for streaming</div> : groups.map(g => (
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
      {streamingEmpty ? theatricalBlock : null}
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

function ratingScoreHasHalfStep(v) {
  if (!Number.isFinite(v)) return false;
  return Math.abs(v - Math.trunc(v) - 0.5) < 1e-6;
}

/**
 * Two-row score picker — row **1:** integers **1–10**; row **2:** one **.5** chip.
 * Pick **3** then **.5** → **3.5**; pick **7** then **.5** → **7.5**. Without **.5**, the score is the integer alone. **10** cannot get a half. Tapping **.5** again removes the half (e.g. **7.5** → **7**).
 * Shows **—** until the user picks an integer (`touched` false).
 */
function RatingScoreChips({ value, touched, onPick, variant = "default" }) {
  const display = touched && Number.isFinite(value) ? formatScore(value) : "—";
  const ints = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const intChipActive = (n) =>
    touched &&
    Number.isFinite(value) &&
    (value === n || (ratingScoreHasHalfStep(value) && Math.trunc(value) === n));
  const halfUsable =
    touched &&
    Number.isFinite(value) &&
    (ratingScoreHasHalfStep(value) || (Number.isInteger(value) && value >= 1 && value <= 9));
  const halfActive = touched && ratingScoreHasHalfStep(value);

  function onHalfChipClick() {
    if (!halfUsable) return;
    const intPart = Math.trunc(value);
    if (ratingScoreHasHalfStep(value)) {
      onPick(intPart);
      return;
    }
    if (Number.isInteger(value) && intPart >= 1 && intPart <= 9) {
      onPick(intPart + 0.5);
    }
  }

  return (
    <div className={`rating-score-chips rating-score-chips--${variant}`}>
      <div className={`rating-score-chips__display${touched ? "" : " rating-score-chips__display--unset"}`}>{display}</div>
      <div className="rating-score-chips__row rating-score-chips__row--int" role="group" aria-label="Score from 1 to 10">
        {ints.map((n) => (
          <button
            key={`int-${n}`}
            type="button"
            className={`rating-score-chips__chip${intChipActive(n) ? " rating-score-chips__chip--active" : ""}`}
            aria-pressed={intChipActive(n)}
            onClick={() => onPick(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="rating-score-chips__row rating-score-chips__row--half-single">
        <button
          type="button"
          className={`rating-score-chips__chip rating-score-chips__chip--half${halfActive ? " rating-score-chips__chip--active" : ""}`}
          aria-label="Add or remove half point"
          aria-pressed={halfActive}
          disabled={!halfUsable}
          onClick={onHalfChipClick}
        >
          .5
        </button>
      </div>
    </div>
  );
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

/** TMDB `original_language` (ISO 639-1) → human-readable for strip meta (e.g. secondary Region). */
function formatOriginalLanguageDisplay(iso639_1) {
  const raw = String(iso639_1 || "")
    .trim()
    .toLowerCase();
  if (raw.length < 2 || raw === "und" || raw === "xx") return "";
  if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
    try {
      for (const loc of [undefined, "en"]) {
        const dn = new Intl.DisplayNames(loc, { type: "language" });
        const name = dn.of(raw);
        if (typeof name === "string" && name.length > 0) return name;
      }
    } catch {
      /* ignore */
    }
  }
  return raw;
}

/** Secondary Region page: same as {@link formatStripMediaMeta} plus original-language label. */
function formatSecondaryRegionStripMeta(movie, tvMetaByTmdbId) {
  const base = formatStripMediaMeta(movie, tvMetaByTmdbId);
  const lang = formatOriginalLanguageDisplay(movie?.language);
  return lang ? `${base} · ${lang}` : base;
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

/** Same 24×24 path for circle (orange) and Cinemastro (gold) in strip + list — `currentColor` from parent. */
const CIRCLE_PILL_STAR_D =
  "M12,17.27L18.18,21l-1.64-7.03L22,9.24l-7.19-0.61L12,2L9.19,8.63L2,9.24l5.46,4.73L5.82,21L12,17.27z";

function CirclePillStarGlyph({ variant = "strip" }) {
  const sz = variant === "list" ? "circle-pill-star-glyph--list" : "circle-pill-star-glyph--strip";
  return (
    <svg
      className={`circle-pill-star-glyph ${sz}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={CIRCLE_PILL_STAR_D} />
    </svg>
  );
}

function CircleGroupScoreIcon({ variant = "strip" }) {
  return (
    <span className="circle-group-score-icon" aria-hidden="true" title="Circle group score">
      <CirclePillStarGlyph variant={variant} />
    </span>
  );
}

/**
 * Circles — Recent strip: under the title — orange star (SVG)+circle score · gold ⭐+Cinemastro (row fields).
 * Omits if both scores are missing.
 * When `onWhoPublished` is set, the row is tappable to open who-published overlay (3b).
 */
function CircleStripRingCineBelowTitle({ groupRating, siteRating, onWhoPublished }) {
  const hasGr = groupRating != null && Number.isFinite(Number(groupRating));
  const hasSr = siteRating != null && Number.isFinite(Number(siteRating));
  if (!hasGr && !hasSr) return null;
  const a11y = [
    hasGr ? `Circle ${formatScore(Number(groupRating))}` : null,
    hasSr ? `Cinemastro ${formatScore(Number(siteRating))}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const tappable = typeof onWhoPublished === "function";
  const a11yTap = tappable ? `${a11y}. Open who rated in this circle.` : a11y;
  const inner = (
    <>
      {hasGr ? (
        <span className="circle-strip-below-title-scores__seg circle-strip-below-title-scores__seg--circle">
          <CircleGroupScoreIcon />
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
          <CirclePillStarGlyph variant="strip" />
          <span className="circle-strip-below-title-scores__num">{formatScore(Number(siteRating))}</span>
        </span>
      ) : null}
    </>
  );
  if (tappable) {
    return (
      <button
        type="button"
        className="circle-strip-below-title-scores circle-strip-below-title-scores--tappable"
        title={a11yTap}
        aria-label={a11yTap}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onWhoPublished();
        }}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="circle-strip-below-title-scores" title={a11y} aria-label={a11y}>
      {inner}
    </div>
  );
}

/** Circle All/Top list row: orange ⭐+Circle score · gold ⭐+Cinemastro · “You”+score (order; omit when missing). */
function CircleAllTopRatingsLine({ row, showRaterParen, onWhoPublished }) {
  const gr = row.group_rating;
  const vs = row.viewer_score;
  const sr = row.site_rating;
  const distinctRaters = Number(row.distinct_circle_raters ?? 0);
  const hasCircle = gr != null && Number.isFinite(Number(gr));
  const hasYou = vs != null && Number.isFinite(Number(vs));
  const hasCine = sr != null && Number.isFinite(Number(sr));
  const showParen = Boolean(showRaterParen) && hasCircle && distinctRaters > 0;
  const canWhoPub =
    (hasCircle || hasCine) && typeof onWhoPublished === "function";
  const circleCineA11y = [
    hasCircle
      ? showParen
        ? `Circle ${formatScore(Number(gr))}, ${distinctRaters} rated in this circle`
        : `Circle ${formatScore(Number(gr))}`
      : null,
    hasCine ? `Cinemastro ${formatScore(Number(sr))}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  if (!hasCircle && !hasCine && !hasYou) {
    return <div className="circle-rated-list-ratings circle-rated-list-ratings--empty">—</div>;
  }

  const youBlock = hasYou ? (
    <span className="circle-list-rating circle-list-rating--you">
      <span className="circle-list-rating__lbl">You</span>
      <span className="circle-list-rating__num">{formatScore(Number(vs))}</span>
    </span>
  ) : null;

  if (canWhoPub) {
    const a11yBtn = `Rated by. ${circleCineA11y}`;
    return (
      <div className="circle-rated-list-ratings">
        <button
          type="button"
          className="circle-who-published-hit"
          aria-label={a11yBtn}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onWhoPublished();
          }}
        >
          {hasCircle ? (
            <span
              className="circle-list-rating circle-list-rating--circle"
              aria-hidden={true}
            >
              <CircleGroupScoreIcon variant="list" />
              <span className="circle-list-rating__num">{formatScore(Number(gr))}</span>
              {showParen ? (
                <span className="circle-list-rating__paren" aria-hidden="true">
                  ({distinctRaters})
                </span>
              ) : null}
            </span>
          ) : null}
          {hasCircle && hasCine ? (
            <span className="circle-rated-list-ratings-sep" aria-hidden="true">
              ·
            </span>
          ) : null}
          {hasCine ? (
            <span className="circle-list-rating circle-list-rating--cine" aria-hidden="true">
              <CirclePillStarGlyph variant="list" />
              <span className="circle-list-rating__num">{formatScore(Number(sr))}</span>
            </span>
          ) : null}
        </button>
        {hasYou && (hasCircle || hasCine) ? (
          <span className="circle-rated-list-ratings-sep" aria-hidden="true">
            ·
          </span>
        ) : null}
        {youBlock}
      </div>
    );
  }

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
        <CircleGroupScoreIcon variant="list" />
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
        <CirclePillStarGlyph variant="list" />
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
  const [detailRating, setDetailRating] = useState(7);
  const [detailTouched, setDetailTouched] = useState(false);
  const [detailEditRating, setDetailEditRating] = useState(false);
  /** `openDetail` snapshot: **circle** vs **discover** vs **other** — gates **Rate this** / **Rate more** (6.1.0). */
  const [detailRateEntry, setDetailRateEntry] = useState(null);
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
  /** Merged `now ∪ popular` for match / catalogue (deduped). */
  const [streamingMovies, setStreamingMovies] = useState([]);
  const [streamingTV, setStreamingTV] = useState([]);
  const [streamingMoviesNow, setStreamingMoviesNow] = useState([]);
  const [streamingMoviesPopular, setStreamingMoviesPopular] = useState([]);
  const [streamingTVNow, setStreamingTVNow] = useState([]);
  const [streamingTVPopular, setStreamingTVPopular] = useState([]);
  /** Two-phase streaming fetch: movies (now+popular) first, then TV. */
  const [streamingMoviesReady, setStreamingMoviesReady] = useState(false);
  const [streamingTvReady, setStreamingTvReady] = useState(false);
  const [whatsHot, setWhatsHot] = useState([]);
  const [_whatsHotReady, setWhatsHotReady] = useState(false);
  const [pulseTrending, setPulseTrending] = useState([]);
  const [pulsePopular, setPulsePopular] = useState([]);
  const [pulseCatalogReady, setPulseCatalogReady] = useState(false);
  /** In Theaters page second strip: weekly trending + same theatrical gates as Now ({@link fetchInTheaters}). */
  const [inTheatersPopularRanked, setInTheatersPopularRanked] = useState([]);
  const [streamingTab, setStreamingTab] = useState("tv"); // "movie" | "tv"
  /** Streaming page only — optional one service; refill via discover (not profile). */
  const [streamingPageProviderId, setStreamingPageProviderId] = useState(null);
  /** TMDB genre ids from {@link STREAMING_PAGE_HIDABLE_GENRE_IDS} the user chose to **include** (show); default [] = hide all four. */
  const [streamingPageIncludedHidableGenreIds, setStreamingPageIncludedHidableGenreIds] = useState([]);
  const toggleStreamingPageIncludedGenre = useCallback((genreId) => {
    setStreamingPageIncludedHidableGenreIds((prev) => {
      if (prev.includes(genreId)) return prev.filter((x) => x !== genreId);
      return [...prev, genreId].sort((a, b) => a - b);
    });
  }, []);
  const [streamingPageRefillLoading, setStreamingPageRefillLoading] = useState(false);
  const [streamingPageRefillMoviesNow, setStreamingPageRefillMoviesNow] = useState([]);
  const [streamingPageRefillMoviesPopular, setStreamingPageRefillMoviesPopular] = useState([]);
  const [streamingPageRefillTvNow, setStreamingPageRefillTvNow] = useState([]);
  const [streamingPageRefillTvPopular, setStreamingPageRefillTvPopular] = useState([]);
  const [streamingPageNowDisplayLen, setStreamingPageNowDisplayLen] = useState(0);
  const [streamingPagePopularDisplayLen, setStreamingPagePopularDisplayLen] = useState(0);
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
  const [showEditCircleSheet, setShowEditCircleSheet] = useState(false);
  const [editCircleId, setEditCircleId] = useState(null);
  const [editCircleName, setEditCircleName] = useState("");
  const [editCircleDescription, setEditCircleDescription] = useState("");
  const [editCircleVibe, setEditCircleVibe] = useState("Mixed Bag");
  const [editCircleSubmitting, setEditCircleSubmitting] = useState(false);
  const [editCircleError, setEditCircleError] = useState("");
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
  /** Per circle: others' unpublishes since last mark_circle_last_seen; powers list card badge (5.6.33). */
  const [circleUnseenById, setCircleUnseenById] = useState(() => ({}));
  const circleDetailActivityWatermarkRef = useRef(null);
  const checkRemoteCircleNewActivityRef = useRef(null);
  const [circleDetailShowNewActivityBar, setCircleDetailShowNewActivityBar] = useState(false);
  /** Recent strip: which row key has the ⋯ / long-press menu open. */
  const [circleRecentStripMenuRowKey, setCircleRecentStripMenuRowKey] = useState(null);
  const circleRecentStripLongPressTimerRef = useRef(null);
  const circleRecentStripLongPressStartRef = useRef({ x: 0, y: 0 });
  const circleRecentStripSuppressClickRef = useRef(false);
  const [circleStripUnpublishBusy, setCircleStripUnpublishBusy] = useState(false);
  const [showCircleInfoSheet, setShowCircleInfoSheet] = useState(false);
  /** Rated-by modal (3b): null | { status, displayTitle?, rows?, message? } */
  const [whoPublishedModal, setWhoPublishedModal] = useState(null);
  /** Pending in-app invites (moderators) for Circle info — refetched when sheet opens. */
  const [circleInfoPendingInvites, setCircleInfoPendingInvites] = useState([]);
  const [circleInfoPendingInvitesLoading, setCircleInfoPendingInvitesLoading] = useState(false);

  /** `user_id` → display name for Circle info sheet (`get_circle_member_names` RPC + profiles fallback). */
  const [circleInfoNamesById, setCircleInfoNamesById] = useState({});
  // v5.1.0: Circles Phase B — invites.
  const [pendingInvites, setPendingInvites] = useState([]);
  const [pendingInvitesLoaded, setPendingInvitesLoaded] = useState(false);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
  const [pendingInvitesError, setPendingInvitesError] = useState("");
  const firstPendingInviteRowRef = useRef(null);
  const capPendingInvitesHintRef = useRef(null);
  /** Map<inviteId, "accepting" | "declining">. Per-invite, so multiple rows can animate. */
  const [inviteActionBusy, setInviteActionBusy] = useState({});
  const [inviteActionError, setInviteActionError] = useState("");
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [inviteEmailDraft, setInviteEmailDraft] = useState("");
  const [inviteSheetSubmitting, setInviteSheetSubmitting] = useState(false);
  const [inviteSheetError, setInviteSheetError] = useState("");
  /** After send fails with no matching account: show prefilled copy-to-mail (Circles item 2). */
  const [inviteSheetNoAccountCopy, setInviteSheetNoAccountCopy] = useState(false);
  const [inviteCopyMailStatus, setInviteCopyMailStatus] = useState("");
  /** `profiles.name` from `loadUserData` — for copy-to-mail “friend” name. */
  const [profileName, setProfileName] = useState("");
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
  /** Secondary Region screen, Streaming only — optional one service; discover refill for that market’s `watch_region` (not profile). */
  const [secondaryRegionStreamingProviderId, setSecondaryRegionStreamingProviderId] = useState(null);
  const [secondaryRegionRefillLoading, setSecondaryRegionRefillLoading] = useState(false);
  const [secondaryRegionRefillMovies, setSecondaryRegionRefillMovies] = useState([]);
  const [secondaryRegionRefillTv, setSecondaryRegionRefillTv] = useState([]);
  const [secondaryRegionRefillDisplayLen, setSecondaryRegionRefillDisplayLen] = useState(0);
  /** Secondary Region → Streaming, **All services** only: staggered visible count (see `SECONDARY_REGION_STREAM_REVEAL_*`). */
  const [secondaryRegionAllServicesStreamDisplayLen, setSecondaryRegionAllServicesStreamDisplayLen] = useState(0);
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
  /** Deduplicate main Streaming page stagger for **Now** and **Popular** rows (all services + per-provider). */
  const streamingPageNowRevealSigRef = useRef("");
  const streamingPagePopularRevealSigRef = useRef("");
  const secondaryRegionRefillRevealSigRef = useRef("");
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
    languageLabel: null,
  });
  useEffect(() => {
    if (screen !== "detail" || !selectedMovie?.movie) {
      setDetailMeta({
        tagline: null,
        genresLine: null,
        certification: null,
        runtimeLabel: null,
        releaseLabel: null,
        languageLabel: null,
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
      languageLabel: null,
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
        const pool = mergeInTheatersStripsForCatalogue(th.nowPlaying, th.popularInTheaters);
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
          const pool = mergeInTheatersStripsForCatalogue(th.nowPlaying, th.popularInTheaters);
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

  /**
   * Main **Streaming** page — All services: separate **now** and **popular** pools (B + D for movies, flatrate+date
   * and trending week for TV). Merged into `streamingMovies` / `streamingTV` for match + catalogue.
   */
  useEffect(() => {
    if (!user || screen !== "streaming-page") return;
    let cancelled = false;
    setStreamingMoviesReady(false);
    setStreamingTvReady(false);
    const defer = setTimeout(() => {
      (async () => {
        let mNow = [];
        let mPop = [];
        let tNow = [];
        let tPop = [];
        try {
          [mNow, mPop] = await Promise.all([
            fetchStreamingPageMoviesNowAllServices(showRegionKeys, streamingPageIncludedHidableGenreIds),
            fetchStreamingPageMoviesPopularAllServices(showRegionKeys, streamingPageIncludedHidableGenreIds),
          ]);
        } catch (e) {
          console.error(e);
        }
        if (cancelled) return;
        setStreamingMoviesNow(mNow);
        setStreamingMoviesPopular(mPop);
        const sm = dedupeMediaRowsById([...mNow, ...mPop]);
        setStreamingMovies(sm);
        setStreamingMoviesReady(true);
        setCatalogue((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const added = sm.filter((m) => !seen.has(m.id));
          if (added.length === 0) return prev;
          return [...prev, ...added];
        });

        try {
          [tNow, tPop] = await Promise.all([
            fetchStreamingPageTvNowAllServices(showRegionKeys, streamingPageIncludedHidableGenreIds),
            fetchStreamingPageTvPopularAllServices(showRegionKeys, streamingPageIncludedHidableGenreIds),
          ]);
        } catch (e) {
          console.error(e);
        }
        if (cancelled) return;
        setStreamingTVNow(tNow);
        setStreamingTVPopular(tPop);
        const st = dedupeMediaRowsById([...tNow, ...tPop]);
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
  }, [user, showRegionKeys, screen, streamingPageIncludedHidableGenreIds]);

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

  /**
   * V1.3.0: Hydrate `secondary_region_key` as soon as session + bootstrap allow — it was only set at
   * the end of `loadUserData()` (after ratings/watchlist + full profile), so the secondary strip effect
   * often started with `null` and raced slow networks. Single-field read keeps TMDB fetches in sync.
   */
  useEffect(() => {
    if (!user || !catalogueBootstrapDone) return;
    let cancelled = false;
    (async () => {
      const { data: row, error } = await supabase
        .from("profiles")
        .select("secondary_region_key")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn("Could not read secondary_region_key:", error.message);
        return;
      }
      const sk = row?.secondary_region_key;
      setSecondaryRegionKey(
        typeof sk === "string" && V130_SECONDARY_REGION_IDS.includes(sk) ? sk : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, catalogueBootstrapDone]);

  /** V1.3.0: US availability + secondary bucket languages; V1.3.2: separate pools for tabs. */
  useEffect(() => {
    if (!user || !secondaryRegionKey || !V130_SECONDARY_REGION_IDS.includes(secondaryRegionKey)) {
      setSecondaryTheaterRows([]);
      setSecondaryStreamingMovieRows([]);
      setSecondaryStreamingTvRows([]);
      setSecondaryBlockSegment(SECONDARY_BLOCK_THEATERS);
      setSecondaryBlockStreamingTab("tv");
      setSecondaryRegionStreamingProviderId(null);
      setSecondaryRegionRefillLoading(false);
      setSecondaryRegionRefillMovies([]);
      setSecondaryRegionRefillTv([]);
      setSecondaryRegionRefillDisplayLen(0);
      secondaryRegionRefillRevealSigRef.current = "";
      setSecondaryRegionAllServicesStreamDisplayLen(0);
      setSecondaryStripReady(true);
      return;
    }
    let cancelled = false;
    setSecondaryStripReady(false);
    const defer = setTimeout(() => {
      (async () => {
        try {
          const langCodes = getRegionLanguageCodes([secondaryRegionKey]);
          /** Indian: TMDB `with_original_language` on discover is too thin; use broad US discover + client language filter. */
          const useIndianClientTaste = secondaryRegionKey === "indian";
          const langQuery =
            useIndianClientTaste || langCodes.length === 0
              ? ""
              : `&with_original_language=${langCodes.join("|")}`;
          const clientLangTaste = useIndianClientTaste ? langCodes : null;
          const [theaters, sm, st] = await Promise.all([
            fetchInTheatersForMarket(SECONDARY_AVAILABILITY_TMDB_REGION, langCodes),
            fetchStreamingMoviesForMarket(SECONDARY_AVAILABILITY_TMDB_REGION, langQuery, clientLangTaste),
            fetchStreamingTVForMarket(SECONDARY_AVAILABILITY_TMDB_REGION, langQuery, clientLangTaste),
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
        } catch (e) {
          if (!cancelled) {
            console.warn("Secondary region strip fetch failed:", e);
            setSecondaryTheaterRows([]);
            setSecondaryStreamingMovieRows([]);
            setSecondaryStreamingTvRows([]);
          }
        } finally {
          if (!cancelled) setSecondaryStripReady(true);
        }
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

  const streamingMoviesNowForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return streamingMoviesNow;
    return streamingMoviesNow.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [streamingMoviesNow, user, showGenreIds, showRegionKeys]);
  const streamingMoviesPopularForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return streamingMoviesPopular;
    return streamingMoviesPopular.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [streamingMoviesPopular, user, showGenreIds, showRegionKeys]);
  const streamingTVNowForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return streamingTVNow;
    return streamingTVNow.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [streamingTVNow, user, showGenreIds, showRegionKeys]);
  const streamingTVPopularForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return streamingTVPopular;
    return streamingTVPopular.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [streamingTVPopular, user, showGenreIds, showRegionKeys]);

  const streamingPageRefillMoviesNowFiltered = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return streamingPageRefillMoviesNow;
    return streamingPageRefillMoviesNow.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [streamingPageRefillMoviesNow, user, showGenreIds, showRegionKeys]);
  const streamingPageRefillMoviesPopularFiltered = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return streamingPageRefillMoviesPopular;
    return streamingPageRefillMoviesPopular.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [streamingPageRefillMoviesPopular, user, showGenreIds, showRegionKeys]);
  const streamingPageRefillTvNowFiltered = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return streamingPageRefillTvNow;
    return streamingPageRefillTvNow.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [streamingPageRefillTvNow, user, showGenreIds, showRegionKeys]);
  const streamingPageRefillTvPopularFiltered = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return streamingPageRefillTvPopular;
    return streamingPageRefillTvPopular.filter((m) => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [streamingPageRefillTvPopular, user, showGenreIds, showRegionKeys]);

  /** Secondary Region service refill: do not apply profile `showGenreIds` / `showRegionKeys` (taste = secondary bucket + TMDB). */
  const secondaryRegionRefillMoviesFiltered = useMemo(() => {
    if (!user) return [];
    return secondaryRegionRefillMovies;
  }, [secondaryRegionRefillMovies, user]);
  const secondaryRegionRefillTvFiltered = useMemo(() => {
    if (!user) return [];
    return secondaryRegionRefillTv;
  }, [secondaryRegionRefillTv, user]);

  const streamingMoviesForPredict = useMemo(() => {
    if (streamingPageProviderId == null) {
      return dedupeMediaRowsById([...streamingMoviesNowForRecs, ...streamingMoviesPopularForRecs]);
    }
    return dedupeMediaRowsById([
      ...streamingPageRefillMoviesNowFiltered,
      ...streamingPageRefillMoviesPopularFiltered,
    ]);
  }, [
    streamingPageProviderId,
    streamingMoviesNowForRecs,
    streamingMoviesPopularForRecs,
    streamingPageRefillMoviesNowFiltered,
    streamingPageRefillMoviesPopularFiltered,
  ]);
  const streamingTVForPredict = useMemo(() => {
    if (streamingPageProviderId == null) {
      return dedupeMediaRowsById([...streamingTVNowForRecs, ...streamingTVPopularForRecs]);
    }
    return dedupeMediaRowsById([
      ...streamingPageRefillTvNowFiltered,
      ...streamingPageRefillTvPopularFiltered,
    ]);
  }, [
    streamingPageProviderId,
    streamingTVNowForRecs,
    streamingTVPopularForRecs,
    streamingPageRefillTvNowFiltered,
    streamingPageRefillTvPopularFiltered,
  ]);

  useEffect(() => {
    if (screen !== "streaming-page" || streamingPageProviderId == null) {
      setStreamingPageRefillLoading(false);
      setStreamingPageRefillMoviesNow([]);
      setStreamingPageRefillMoviesPopular([]);
      setStreamingPageRefillTvNow([]);
      setStreamingPageRefillTvPopular([]);
      setStreamingPageNowDisplayLen(0);
      setStreamingPagePopularDisplayLen(0);
      // All-services stagger dedupes by sig; clear when leaving or on All services so return-from-detail can reveal again.
      streamingPageNowRevealSigRef.current = "";
      streamingPagePopularRevealSigRef.current = "";
      return;
    }
    const media = streamingTab === "movie" ? "movie" : "tv";
    const langCodes = getRegionLanguageCodes(showRegionKeys);
    const langQuery = langCodes.length > 0 ? `&with_original_language=${langCodes.join("|")}` : "";
    let cancelled = false;
    streamingPageNowRevealSigRef.current = "";
    streamingPagePopularRevealSigRef.current = "";
    setStreamingPageRefillLoading(true);
    setStreamingPageNowDisplayLen(0);
    setStreamingPagePopularDisplayLen(0);
    const streamingExcludedIds = streamingPageExcludedGenreIds(streamingPageIncludedHidableGenreIds);
    if (media === "movie") {
      setStreamingPageRefillMoviesNow([]);
      setStreamingPageRefillMoviesPopular([]);
    } else {
      setStreamingPageRefillTvNow([]);
      setStreamingPageRefillTvPopular([]);
    }

    (async () => {
      if (media === "movie") {
        const [poolNow, poolPop] = await Promise.all([
          fetchStreamingPageProviderRefillPool(
            "movie",
            streamingPageProviderId,
            (partial) => {
              if (cancelled) return;
              setStreamingPageRefillMoviesNow(partial.slice(0, STREAMING_PAGE_STRIP_CAP));
            },
            "US",
            langQuery,
            null,
            { discoverSort: "date", excludedGenreIds: streamingExcludedIds },
          ),
          fetchStreamingPageProviderRefillPool(
            "movie",
            streamingPageProviderId,
            (partial) => {
              if (cancelled) return;
              setStreamingPageRefillMoviesPopular(partial.slice(0, STREAMING_PAGE_STRIP_CAP));
            },
            "US",
            langQuery,
            null,
            { discoverSort: "popularity", excludedGenreIds: streamingExcludedIds },
          ),
        ]);
        if (cancelled) return;
        setStreamingPageRefillMoviesNow(poolNow);
        setStreamingPageRefillMoviesPopular(poolPop);
      } else {
        const [poolNow, poolPop] = await Promise.all([
          fetchStreamingPageProviderRefillPool(
            "tv",
            streamingPageProviderId,
            (partial) => {
              if (cancelled) return;
              setStreamingPageRefillTvNow(partial.slice(0, STREAMING_PAGE_STRIP_CAP));
            },
            "US",
            langQuery,
            null,
            { discoverSort: "date", excludedGenreIds: streamingExcludedIds },
          ),
          fetchStreamingPageProviderRefillPool(
            "tv",
            streamingPageProviderId,
            (partial) => {
              if (cancelled) return;
              setStreamingPageRefillTvPopular(partial.slice(0, STREAMING_PAGE_STRIP_CAP));
            },
            "US",
            langQuery,
            null,
            { discoverSort: "popularity", excludedGenreIds: streamingExcludedIds },
          ),
        ]);
        if (cancelled) return;
        setStreamingPageRefillTvNow(poolNow);
        setStreamingPageRefillTvPopular(poolPop);
      }
      setStreamingPageRefillLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [screen, streamingPageProviderId, streamingTab, showRegionKeys, streamingPageIncludedHidableGenreIds]);

  useEffect(() => {
    if (screen !== "streaming-page" || streamingPageProviderId == null) return;
    const n =
      (streamingTab === "movie" ? streamingPageRefillMoviesNowFiltered : streamingPageRefillTvNowFiltered)
        .length;
    if (n === 0) {
      setStreamingPageNowDisplayLen(0);
      return;
    }
    if (streamingPageRefillLoading) {
      setStreamingPageNowDisplayLen((p) => Math.max(p, Math.min(STREAMING_PAGE_REVEAL_FIRST, n)));
      return;
    }
    const sig = `pnow-${streamingPageProviderId}-${streamingTab}-${n}`;
    if (streamingPageNowRevealSigRef.current === sig) return;
    streamingPageNowRevealSigRef.current = sig;
    const cap = Math.min(n, STREAMING_PAGE_STRIP_CAP);
    const first = Math.min(STREAMING_PAGE_REVEAL_FIRST, cap);
    setStreamingPageNowDisplayLen(first);
    const rest = STREAMING_PAGE_REVEAL_STEPS
      .map((s) => Math.min(s, cap))
      .filter((s) => s > first);
    const timers = rest.map(
      (step, i) => setTimeout(() => setStreamingPageNowDisplayLen(step), 120 * (i + 1)),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [
    screen,
    streamingPageProviderId,
    streamingTab,
    streamingPageRefillLoading,
    streamingPageRefillMoviesNowFiltered,
    streamingPageRefillTvNowFiltered,
  ]);

  useEffect(() => {
    if (screen !== "streaming-page" || streamingPageProviderId == null) return;
    const n =
      (streamingTab === "movie"
        ? streamingPageRefillMoviesPopularFiltered
        : streamingPageRefillTvPopularFiltered).length;
    if (n === 0) {
      setStreamingPagePopularDisplayLen(0);
      return;
    }
    if (streamingPageRefillLoading) {
      setStreamingPagePopularDisplayLen((p) => Math.max(p, Math.min(STREAMING_PAGE_REVEAL_FIRST, n)));
      return;
    }
    const sig = `ppop-${streamingPageProviderId}-${streamingTab}-${n}`;
    if (streamingPagePopularRevealSigRef.current === sig) return;
    streamingPagePopularRevealSigRef.current = sig;
    const cap = Math.min(n, STREAMING_PAGE_STRIP_CAP);
    const first = Math.min(STREAMING_PAGE_REVEAL_FIRST, cap);
    setStreamingPagePopularDisplayLen(first);
    const rest = STREAMING_PAGE_REVEAL_STEPS
      .map((s) => Math.min(s, cap))
      .filter((s) => s > first);
    const timers = rest.map(
      (step, i) => setTimeout(() => setStreamingPagePopularDisplayLen(step), 120 * (i + 1)),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [
    screen,
    streamingPageProviderId,
    streamingTab,
    streamingPageRefillLoading,
    streamingPageRefillMoviesPopularFiltered,
    streamingPageRefillTvPopularFiltered,
  ]);

  /** Movies and TV hydrate at different times; only the active tab’s ready flag should retrigger All-services stagger. */
  const streamingPageAllServicesStaggerReady = useMemo(
    () => (streamingTab === "movie" ? streamingMoviesReady : streamingTvReady),
    [streamingTab, streamingMoviesReady, streamingTvReady],
  );

  useEffect(() => {
    if (screen !== "streaming-page") {
      setStreamingPageNowDisplayLen(0);
      return;
    }
    if (streamingPageProviderId != null) return;
    if (!streamingPageAllServicesStaggerReady) return;
    const nNow =
      streamingTab === "movie"
        ? streamingMoviesNowForRecs.length
        : streamingTVNowForRecs.length;
    if (nNow === 0) {
      setStreamingPageNowDisplayLen(0);
      return;
    }
    const cap = Math.min(nNow, STREAMING_PAGE_STRIP_CAP);
    const sig = `anow-${streamingTab}-${nNow}-${String(showRegionKeys)}`;
    if (streamingPageNowRevealSigRef.current === sig) return;
    streamingPageNowRevealSigRef.current = sig;
    const first = Math.min(STREAMING_PAGE_REVEAL_FIRST, cap);
    setStreamingPageNowDisplayLen(first);
    const rest = STREAMING_PAGE_REVEAL_STEPS
      .map((s) => Math.min(s, cap))
      .filter((s) => s > first);
    const timers = rest.map(
      (step, i) => setTimeout(() => setStreamingPageNowDisplayLen(step), 120 * (i + 1)),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [
    screen,
    streamingPageProviderId,
    streamingTab,
    streamingPageAllServicesStaggerReady,
    streamingMoviesNowForRecs,
    streamingTVNowForRecs,
    showRegionKeys,
  ]);

  useEffect(() => {
    if (screen !== "streaming-page") {
      setStreamingPagePopularDisplayLen(0);
      return;
    }
    if (streamingPageProviderId != null) return;
    if (!streamingPageAllServicesStaggerReady) return;
    const nPop =
      streamingTab === "movie"
        ? streamingMoviesPopularForRecs.length
        : streamingTVPopularForRecs.length;
    if (nPop === 0) {
      setStreamingPagePopularDisplayLen(0);
      return;
    }
    const cap = Math.min(nPop, STREAMING_PAGE_STRIP_CAP);
    const sig = `apop-${streamingTab}-${nPop}-${String(showRegionKeys)}`;
    if (streamingPagePopularRevealSigRef.current === sig) return;
    streamingPagePopularRevealSigRef.current = sig;
    const first = Math.min(STREAMING_PAGE_REVEAL_FIRST, cap);
    setStreamingPagePopularDisplayLen(first);
    const rest = STREAMING_PAGE_REVEAL_STEPS
      .map((s) => Math.min(s, cap))
      .filter((s) => s > first);
    const timers = rest.map(
      (step, i) => setTimeout(() => setStreamingPagePopularDisplayLen(step), 120 * (i + 1)),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [
    screen,
    streamingPageProviderId,
    streamingTab,
    streamingPageAllServicesStaggerReady,
    streamingMoviesPopularForRecs,
    streamingTVPopularForRecs,
    showRegionKeys,
  ]);

  useEffect(() => {
    if (screen !== "secondary-region" || secondaryRegionStreamingProviderId == null || !secondaryRegionKey || !V130_SECONDARY_REGION_IDS.includes(secondaryRegionKey)) {
      setSecondaryRegionRefillLoading(false);
      setSecondaryRegionRefillMovies([]);
      setSecondaryRegionRefillTv([]);
      setSecondaryRegionRefillDisplayLen(0);
      secondaryRegionRefillRevealSigRef.current = "";
      return;
    }
    const langCodes = getRegionLanguageCodes([secondaryRegionKey]);
    const useIndianClientTaste = secondaryRegionKey === "indian";
    const secondaryRefillLangQuery =
      useIndianClientTaste || langCodes.length === 0
        ? ""
        : `&with_original_language=${langCodes.join("|")}`;
    const secondaryRefillLangAllow = useIndianClientTaste ? langCodes : null;
    const media = secondaryBlockStreamingTab === "movie" ? "movie" : "tv";
    let cancelled = false;
    secondaryRegionRefillRevealSigRef.current = "";
    setSecondaryRegionRefillLoading(true);
    setSecondaryRegionRefillDisplayLen(0);
    if (media === "movie") setSecondaryRegionRefillMovies([]);
    else setSecondaryRegionRefillTv([]);

    (async () => {
      const pool = await fetchStreamingPageProviderRefillPool(
        media,
        secondaryRegionStreamingProviderId,
        (partial) => {
          if (cancelled) return;
          const next = partial.slice(0, STREAMING_PAGE_PROVIDER_REFILL_CAP);
          if (media === "movie") setSecondaryRegionRefillMovies(next);
          else setSecondaryRegionRefillTv(next);
        },
        secondaryRegionPerServiceWatchRegion(secondaryRegionKey, secondaryRegionStreamingProviderId),
        secondaryRefillLangQuery,
        secondaryRefillLangAllow,
      );
      if (cancelled) return;
      if (media === "movie") setSecondaryRegionRefillMovies(pool);
      else setSecondaryRegionRefillTv(pool);
      setSecondaryRegionRefillLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [screen, secondaryRegionKey, secondaryRegionStreamingProviderId, secondaryBlockStreamingTab]);

  useEffect(() => {
    if (secondaryRegionStreamingProviderId == null) return;
    const poolF =
      secondaryBlockStreamingTab === "movie"
        ? secondaryRegionRefillMoviesFiltered
        : secondaryRegionRefillTvFiltered;
    const n = poolF.length;
    if (n === 0) {
      setSecondaryRegionRefillDisplayLen(0);
      return;
    }
    if (secondaryRegionRefillLoading) {
      setSecondaryRegionRefillDisplayLen((p) => Math.max(p, Math.min(SECONDARY_REGION_STREAM_REVEAL_FIRST, n)));
      return;
    }
    const sig = `${secondaryRegionKey}-${secondaryRegionStreamingProviderId}-${secondaryBlockStreamingTab}-${n}`;
    if (secondaryRegionRefillRevealSigRef.current === sig) return;
    secondaryRegionRefillRevealSigRef.current = sig;
    const cap = Math.min(n, STREAMING_PAGE_PROVIDER_REFILL_CAP);
    const first = Math.min(SECONDARY_REGION_STREAM_REVEAL_FIRST, cap);
    setSecondaryRegionRefillDisplayLen(first);
    const rest = SECONDARY_REGION_STREAM_REVEAL_STEPS
      .map((s) => Math.min(s, cap))
      .filter((s) => s > first);
    const uniq = [...new Set(rest)].sort((a, b) => a - b);
    const timers = [];
    let delay = 0;
    uniq.forEach((step) => {
      delay += 120;
      timers.push(setTimeout(() => setSecondaryRegionRefillDisplayLen(step), delay));
    });
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [
    secondaryRegionKey,
    secondaryRegionStreamingProviderId,
    secondaryBlockStreamingTab,
    secondaryRegionRefillLoading,
    secondaryRegionRefillMoviesFiltered,
    secondaryRegionRefillTvFiltered,
  ]);

  useEffect(() => {
    if (screen !== "secondary-region") {
      setSecondaryRegionAllServicesStreamDisplayLen(0);
      return;
    }
    if (secondaryBlockSegment !== SECONDARY_BLOCK_STREAMING) {
      setSecondaryRegionAllServicesStreamDisplayLen(0);
      return;
    }
    if (secondaryRegionStreamingProviderId != null) {
      setSecondaryRegionAllServicesStreamDisplayLen(0);
      return;
    }
    if (!user || !secondaryRegionKey || !V130_SECONDARY_REGION_IDS.includes(secondaryRegionKey)) {
      setSecondaryRegionAllServicesStreamDisplayLen(0);
      return;
    }
    const poolF =
      secondaryBlockStreamingTab === "movie"
        ? secondaryStreamingMovieRows
        : secondaryStreamingTvRows;
    const n = poolF.length;
    if (n === 0) {
      setSecondaryRegionAllServicesStreamDisplayLen(0);
      return;
    }
    if (!secondaryStripReady) return;
    const cap = Math.min(n, SECONDARY_REGION_STREAM_REVEAL_MAX);
    const first = Math.min(SECONDARY_REGION_STREAM_REVEAL_FIRST, cap);
    setSecondaryRegionAllServicesStreamDisplayLen(first);
    const rest = SECONDARY_REGION_STREAM_REVEAL_STEPS
      .map((s) => Math.min(s, cap))
      .filter((s) => s > first);
    const uniq = [...new Set(rest)].sort((a, b) => a - b);
    const timers = [];
    let delay = 0;
    uniq.forEach((step) => {
      delay += 120;
      timers.push(setTimeout(() => setSecondaryRegionAllServicesStreamDisplayLen(step), delay));
    });
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [
    screen,
    user,
    secondaryBlockSegment,
    secondaryRegionKey,
    secondaryBlockStreamingTab,
    secondaryRegionStreamingProviderId,
    secondaryStreamingMovieRows,
    secondaryStreamingTvRows,
    secondaryStripReady,
  ]);

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

  /** V1.3.2: Union of secondary strip rows. **Indian** per-service streaming uses US majors + {@link SECONDARY_INDIAN_STREAMING_WATCH_REGION} for Indian OTT ids; other secondaries use {@link SECONDARY_AVAILABILITY_TMDB_REGION}. */
  const secondaryStripCatalogRows = useMemo(() => {
    if (secondaryRegionStreamingProviderId != null) {
      return dedupeMediaRowsById([
        ...secondaryTheaterRows,
        ...secondaryRegionRefillMoviesFiltered,
        ...secondaryRegionRefillTvFiltered,
      ]);
    }
    return dedupeMediaRowsById([...secondaryTheaterRows, ...secondaryStreamingMovieRows, ...secondaryStreamingTvRows]);
  }, [
    secondaryTheaterRows,
    secondaryStreamingMovieRows,
    secondaryStreamingTvRows,
    secondaryRegionStreamingProviderId,
    secondaryRegionRefillMoviesFiltered,
    secondaryRegionRefillTvFiltered,
  ]);

  /**
   * V1.3.4: When `secondary_region_key` is set, merge secondary shelf titles into the CF catalogue even if
   * “Regions to show” would exclude them (e.g. Hollywood-only + Indian secondary). Secondary rows ignore profile genre too.
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
    if (secondaryRegionStreamingProviderId == null) {
      const rows =
        secondaryBlockStreamingTab === "movie"
          ? secondaryStreamingMovieRows
          : secondaryStreamingTvRows;
      const k = Math.min(
        rows.length,
        secondaryRegionAllServicesStreamDisplayLen,
        SECONDARY_REGION_STREAM_REVEAL_MAX,
      );
      return rows.slice(0, k);
    }
    const cap = Math.min(secondaryRegionRefillDisplayLen, STREAMING_PAGE_PROVIDER_REFILL_CAP);
    return secondaryBlockStreamingTab === "movie"
      ? secondaryRegionRefillMoviesFiltered.slice(0, cap)
      : secondaryRegionRefillTvFiltered.slice(0, cap);
  }, [
    secondaryBlockSegment,
    secondaryBlockStreamingTab,
    secondaryTheaterRows,
    secondaryStreamingMovieRows,
    secondaryStreamingTvRows,
    secondaryRegionStreamingProviderId,
    secondaryRegionRefillMoviesFiltered,
    secondaryRegionRefillTvFiltered,
    secondaryRegionRefillDisplayLen,
    secondaryRegionAllServicesStreamDisplayLen,
  ]);
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
          await predictStripThenMerge(streamingMoviesForPredict, "streamingMovieRecs", true);
          await predictStripThenMerge(streamingTVForPredict, "streamingTvRecs", true);
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
    streamingMoviesForPredict,
    streamingTVForPredict,
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
    const profName = profileRow?.name;
    setProfileName(
      typeof profName === "string" && profName.trim() ? profName.trim() : "",
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
    setProfileName("");
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
    setStreamingMoviesNow([]);
    setStreamingMoviesPopular([]);
    setStreamingTVNow([]);
    setStreamingTVPopular([]);
    setStreamingPageRefillMoviesNow([]);
    setStreamingPageRefillMoviesPopular([]);
    setStreamingPageRefillTvNow([]);
    setStreamingPageRefillTvPopular([]);
    setStreamingPageNowDisplayLen(0);
    setStreamingPagePopularDisplayLen(0);
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
      const pool = mergeInTheatersStripsForCatalogue(th.nowPlaying, th.popularInTheaters);
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
   * Streaming page: **Now** and **Popular** use **different** TMDB pools (all services: B+D for movies, etc.);
   * with a service: date-ordered vs in-service popularity. Stagger **5→25** via `streamingPage*DisplayLen`.
   */
  const streamingMoviesNowResolved = useMemo(() => {
    const fromMatch = matchData?.streamingMovieRecs;
    const byId = fromMatch?.length ? Object.fromEntries(fromMatch.map((r) => [r.movie.id, r])) : null;
    const base =
      streamingPageProviderId == null
        ? streamingMoviesNowForRecs
        : streamingPageRefillMoviesNowFiltered;
    const sorted = sortStreamingByReleaseDateDesc(base);
    const cap = Math.min(streamingPageNowDisplayLen, STREAMING_PAGE_STRIP_CAP, sorted.length);
    return sorted.slice(0, cap).map((m) => byId?.[m.id] ?? tmdbOnlyRec(m));
  }, [
    matchData?.streamingMovieRecs,
    streamingPageProviderId,
    streamingMoviesNowForRecs,
    streamingPageRefillMoviesNowFiltered,
    streamingPageNowDisplayLen,
  ]);

  const streamingMoviesPopularResolved = useMemo(() => {
    const fromMatch = matchData?.streamingMovieRecs;
    const byId = fromMatch?.length ? Object.fromEntries(fromMatch.map((r) => [r.movie.id, r])) : null;
    const base =
      streamingPageProviderId == null
        ? streamingMoviesPopularForRecs
        : streamingPageRefillMoviesPopularFiltered;
    const sorted = sortStreamingByPopularityDesc(base);
    const cap = Math.min(streamingPagePopularDisplayLen, STREAMING_PAGE_STRIP_CAP, sorted.length);
    return sorted.slice(0, cap).map((m) => byId?.[m.id] ?? tmdbOnlyRec(m));
  }, [
    matchData?.streamingMovieRecs,
    streamingPageProviderId,
    streamingMoviesPopularForRecs,
    streamingPageRefillMoviesPopularFiltered,
    streamingPagePopularDisplayLen,
  ]);

  const streamingTvNowResolved = useMemo(() => {
    const fromMatch = matchData?.streamingTvRecs;
    const byId = fromMatch?.length ? Object.fromEntries(fromMatch.map((r) => [r.movie.id, r])) : null;
    const base = streamingPageProviderId == null ? streamingTVNowForRecs : streamingPageRefillTvNowFiltered;
    const sorted = sortStreamingByReleaseDateDesc(base);
    const cap = Math.min(streamingPageNowDisplayLen, STREAMING_PAGE_STRIP_CAP, sorted.length);
    return sorted.slice(0, cap).map((m) => byId?.[m.id] ?? tmdbOnlyRec(m));
  }, [
    matchData?.streamingTvRecs,
    streamingPageProviderId,
    streamingTVNowForRecs,
    streamingPageRefillTvNowFiltered,
    streamingPageNowDisplayLen,
  ]);

  const streamingTvPopularResolved = useMemo(() => {
    const fromMatch = matchData?.streamingTvRecs;
    const byId = fromMatch?.length ? Object.fromEntries(fromMatch.map((r) => [r.movie.id, r])) : null;
    const base =
      streamingPageProviderId == null
        ? streamingTVPopularForRecs
        : streamingPageRefillTvPopularFiltered;
    const sorted = sortStreamingByPopularityDesc(base);
    const cap = Math.min(streamingPagePopularDisplayLen, STREAMING_PAGE_STRIP_CAP, sorted.length);
    return sorted.slice(0, cap).map((m) => byId?.[m.id] ?? tmdbOnlyRec(m));
  }, [
    matchData?.streamingTvRecs,
    streamingPageProviderId,
    streamingTVPopularForRecs,
    streamingPageRefillTvPopularFiltered,
    streamingPagePopularDisplayLen,
  ]);

  const streamingNowRecs = streamingTab === "movie" ? streamingMoviesNowResolved : streamingTvNowResolved;
  const streamingPopularRecs = streamingTab === "movie" ? streamingMoviesPopularResolved : streamingTvPopularResolved;
  const streamingDisplayNowRecs = streamingNowRecs;
  const streamingDisplayPopularRecs = streamingPopularRecs;

  /**
   * Movies fetch completes before TV; default streaming tab is Series. Users who switch to Movies often
   * already have streamingMoviesReady=true, so the old !streamingMoviesReady skeleton never ran — empty strip.
   * Also show skeleton while match is in flight and there are no movie rows yet (TMDB pool empty until match fills).
   */
  const showStreamingMovieSkeleton =
    streamingTab === "movie" &&
    (!streamingMoviesReady ||
      (matchLoading && streamingMovieRecsResolved.length === 0));

  const showStreamingRefillEmptySkeleton = Boolean(
    streamingPageProviderId != null &&
      streamingPageRefillLoading &&
      (streamingTab === "movie"
        ? streamingPageRefillMoviesNowFiltered.length === 0
          && streamingPageRefillMoviesPopularFiltered.length === 0
        : streamingPageRefillTvNowFiltered.length === 0
          && streamingPageRefillTvPopularFiltered.length === 0),
  );
  const showStreamingStripsSkeleton =
    showStreamingMovieSkeleton ||
    (streamingTab === "tv" && !streamingTvReady) ||
    showStreamingRefillEmptySkeleton;

  const showSecondaryRefillEmptySkeleton = Boolean(
    screen === "secondary-region" &&
      secondaryBlockSegment === SECONDARY_BLOCK_STREAMING &&
      secondaryRegionStreamingProviderId != null &&
      secondaryRegionRefillLoading &&
      (secondaryBlockStreamingTab === "movie"
        ? secondaryRegionRefillMoviesFiltered.length === 0
        : secondaryRegionRefillTvFiltered.length === 0),
  );

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
      if (ctx.mode === "forward") {
        await addRatingCircleShares(ctx.movieId, selectedIds);
      } else {
        await syncRatingCircleShares(ctx.movieId, selectedIds);
      }
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
    let detailRateEntryNext = "other";
    if (s === "discover" && rateTitleReturnCircleIdRef.current != null) {
      detailReturnScreenRef.current = "circle-detail";
      detailRateEntryNext = "circle";
    } else if (s === "discover") {
      detailReturnScreenRef.current = s;
      detailRateEntryNext = "discover";
    } else if (s === "circle-detail") {
      detailReturnScreenRef.current = "circle-detail";
      detailRateEntryNext = "circle";
    } else {
      detailReturnScreenRef.current = s;
      detailRateEntryNext = "other";
    }
    setDetailRateEntry(detailRateEntryNext);
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
      setDetailRating(7);
      /** Chips: require an explicit pick; show **—** until then (6.1.0). */
      setDetailTouched(userRatings[movie.id] != null);
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
    setDetailRateEntry(null);
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
    setDetailRateEntry(null);
    setShowAvatarMenu(false);
  }

  // ============================================================================================
  // Circles (Phase A) — data loaders + actions. Uses the supabase client directly (no Edge yet).
  // ============================================================================================

  const refreshCircleUnseenBadges = useCallback(async () => {
    if (!user) {
      setCircleUnseenById({});
      return;
    }
    try {
      const rows = await fetchMyCircleUnseenActivity();
      const next = {};
      for (const r of rows) {
        next[r.circleId] = { unseenOthers: r.unseenOthers, latest: r.latestShareAt };
      }
      setCircleUnseenById(next);
    } catch (e) {
      console.warn("Circles: fetchMyCircleUnseenActivity failed", e);
    }
  }, [user]);

  const checkRemoteCircleNewActivity = useCallback(async () => {
    if (screen !== "circle-detail" || !selectedCircleId) return;
    if (circleDetailData && circleDetailData.memberCount < 2) return;
    if (circleStripLoading) return;
    const baseline = circleDetailActivityWatermarkRef.current;
    try {
      const remote = await getCircleOthersActivityWatermark(selectedCircleId);
      if (remote == null) return;
      if (baseline == null) {
        setCircleDetailShowNewActivityBar(true);
        return;
      }
      if (new Date(remote) > new Date(baseline)) {
        setCircleDetailShowNewActivityBar(true);
      }
    } catch (e) {
      console.warn("Circles: activity watermark check failed", e);
    }
  }, [screen, selectedCircleId, circleDetailData, circleStripLoading]);
  checkRemoteCircleNewActivityRef.current = checkRemoteCircleNewActivity;

  useEffect(() => {
    if (!user) {
      setCircleUnseenById({});
      return;
    }
    void refreshCircleUnseenBadges();
  }, [user, refreshCircleUnseenBadges]);

  useEffect(() => {
    if (!user) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void refreshCircleUnseenBadges();
      void checkRemoteCircleNewActivity();
      // iOS / PWA: first tick can run before the tab is fully active; re-check once.
      window.setTimeout(() => {
        void checkRemoteCircleNewActivity();
      }, 500);
    };
    const onFoc = () => {
      void refreshCircleUnseenBadges();
      void checkRemoteCircleNewActivity();
    };
    // pageshow: iOS and mobile often resume with persisted=false (bfcache is for back/forward).
    // Desktop alt-tab may use window focus; PWA/ Safari may not. Always resync on pageshow.
    const onPageShow = () => {
      void refreshCircleUnseenBadges();
      void checkRemoteCircleNewActivity();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFoc);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFoc);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [user, refreshCircleUnseenBadges, checkRemoteCircleNewActivity]);

  // In-foreground: no OS “resume” event while you stay on this screen — must poll. Ref keeps the
  // interval from resetting on every checkRemoteCircleNewActivity / circleDetailData reference churn.
  const circleDetailIdForPoll = circleDetailData?.id;
  const circleMemberCountForPoll = circleDetailData?.memberCount;
  useEffect(() => {
    if (!user || screen !== "circle-detail" || !selectedCircleId) return;
    if (!circleDetailIdForPoll || !circleMemberCountForPoll || circleMemberCountForPoll < 2) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const run = checkRemoteCircleNewActivityRef.current;
      if (typeof run === "function") void run();
    }, 10_000);
    return () => window.clearInterval(t);
  }, [user, screen, selectedCircleId, circleDetailIdForPoll, circleMemberCountForPoll]);

  useEffect(() => {
    if (screen !== "circle-detail" || !selectedCircleId || !user) return;
    let cancelled = false;
    (async () => {
      try {
        await markCircleLastSeen(selectedCircleId);
        if (cancelled) return;
        setCircleUnseenById((prev) => ({
          ...prev,
          [selectedCircleId]: { ...prev[selectedCircleId], unseenOthers: 0 },
        }));
        void refreshCircleUnseenBadges();
      } catch (e) {
        console.warn("Circles: markCircleLastSeen failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, selectedCircleId, user, refreshCircleUnseenBadges]);

  useEffect(() => {
    circleDetailActivityWatermarkRef.current = null;
    setCircleDetailShowNewActivityBar(false);
  }, [selectedCircleId]);

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
    void refreshCircleUnseenBadges();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const activeCirclesCount = circlesList.length;
  const atCircleCap = activeCirclesCount >= CIRCLE_CAP;
  /** Pending invites merged into the main list; hidden entirely at max circles (passdown). */
  const listInvitesShown = atCircleCap ? [] : pendingInvites;

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

  /** For “Forward”: active circles other than the source (current circle) — not toggles for the current group. */
  const publishModalForwardDestinations = useMemo(() => {
    const m = publishRatingModal;
    if (!m || m.mode !== "forward" || !m.forwardFromCircleId) return null;
    return publishModalCircles.filter((c) => c.id !== m.forwardFromCircleId);
  }, [publishModalCircles, publishRatingModal]);

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

  function openEditCircleSheet(circle, { closeInfo = false } = {}) {
    if (!circle?.id) return;
    if (!isCircleModerator(circle, user?.id) || circle.status !== "active") return;
    if (closeInfo) setShowCircleInfoSheet(false);
    setEditCircleId(circle.id);
    setEditCircleName(circle.name || "");
    setEditCircleDescription(circle.description || "");
    setEditCircleVibe(circle.vibe && VIBES.some((v) => v.id === circle.vibe) ? circle.vibe : "Mixed Bag");
    setEditCircleError("");
    setShowEditCircleSheet(true);
  }

  function closeEditCircleSheet() {
    if (editCircleSubmitting) return;
    setShowEditCircleSheet(false);
    setEditCircleId(null);
    setEditCircleError("");
  }

  async function submitEditCircle() {
    if (!user || !editCircleId || editCircleSubmitting) return;
    const nameCheck = validateCircleName(editCircleName);
    if (!nameCheck.ok) {
      setEditCircleError(nameCheck.error);
      return;
    }
    if (editCircleDescription.length > CIRCLE_DESCRIPTION_MAX) {
      setEditCircleError(`Description must be ${CIRCLE_DESCRIPTION_MAX} characters or fewer.`);
      return;
    }
    setEditCircleSubmitting(true);
    setEditCircleError("");
    try {
      await updateCircle({
        circleId: editCircleId,
        name: nameCheck.name,
        description: editCircleDescription,
        vibe: editCircleVibe,
      });
      const nextName = nameCheck.name;
      const nextDesc = editCircleDescription.trim() || "";
      setCirclesList((prev) =>
        prev.map((c) =>
          c.id === editCircleId
            ? { ...c, name: nextName, description: nextDesc, vibe: editCircleVibe }
            : c
        )
      );
      setCircleDetailData((d) =>
        d && d.id === editCircleId
          ? { ...d, name: nextName, description: nextDesc, vibe: editCircleVibe }
          : d
      );
      setShowEditCircleSheet(false);
      setEditCircleId(null);
    } catch (e) {
      console.error("Circles: updateCircle failed", e);
      setEditCircleError(e?.message || "Could not save changes. Please try again.");
    } finally {
      setEditCircleSubmitting(false);
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
        let w = null;
        try {
          w = await getCircleOthersActivityWatermark(selectedCircleId);
        } catch (we) {
          console.warn("Circles: activity watermark after strip", we);
        }
        if (cancelled) return;
        circleDetailActivityWatermarkRef.current = w;
        setCircleDetailShowNewActivityBar(false);
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
    if (publishRatingModal.mode === "forward") {
      setPublishModalSelection(new Set());
    } else if (publishRatingModal.mode === "manage") {
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

  const openWhoPublishedForCircleRow = useCallback(
    (row, titleText) => {
      if (!row || !selectedCircleId) return;
      const displayTitle = typeof titleText === "string" ? titleText.trim() : "";
      setWhoPublishedModal({ status: "loading", displayTitle });
      void (async () => {
        try {
          const pubRows = await fetchCircleTitlePublishers({
            circleId: selectedCircleId,
            tmdbId: row.tmdb_id,
            mediaType: row.media_type,
          });
          setWhoPublishedModal({ status: "ok", rows: pubRows || [], displayTitle });
        } catch (e) {
          setWhoPublishedModal({
            status: "err",
            displayTitle,
            message: e?.message || "Couldn’t load list.",
          });
        }
      })();
    },
    [selectedCircleId],
  );

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
    if (!showCircleInfoSheet || !circleDetailData?.id) {
      setCircleInfoPendingInvites([]);
      setCircleInfoPendingInvitesLoading(false);
      return;
    }
    if (!isCircleModerator(circleDetailData, user?.id) || circleDetailData.status !== "active") {
      setCircleInfoPendingInvites([]);
      setCircleInfoPendingInvitesLoading(false);
      return;
    }
    let cancelled = false;
    const circleId = circleDetailData.id;
    setCircleInfoPendingInvitesLoading(true);
    (async () => {
      try {
        const rows = await fetchCirclePendingInviteLabels(circleId);
        if (!cancelled) setCircleInfoPendingInvites(rows);
      } catch (e) {
        console.warn("Circles: pending invite labels failed", e);
        if (!cancelled) setCircleInfoPendingInvites([]);
      } finally {
        if (!cancelled) setCircleInfoPendingInvitesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showCircleInfoSheet, circleDetailData, user?.id]);

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
    setLeaveCircleBusy(true);
    setLeaveCircleError("");
    try {
      await leaveCircle({
        circleId: target.id,
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

  const inviterDisplayNameForCopy = useMemo(() => {
    if (profileName && profileName.trim()) return profileName.trim();
    const meta = user?.user_metadata?.name;
    if (typeof meta === "string" && meta.trim()) return meta.trim();
    const local = user?.email?.split("@")[0];
    if (local) return local;
    return "A friend";
  }, [profileName, user]);

  const copyToMailFullText = useMemo(
    () => buildCopyToMailCircleInviteText({ inviterDisplayName: inviterDisplayNameForCopy }).fullText,
    [inviterDisplayNameForCopy],
  );

  const copyToMailMailtoHref = useMemo(
    () =>
      buildCopyToMailCircleInviteMailto({
        inviterDisplayName: inviterDisplayNameForCopy,
        recipientEmail: inviteEmailDraft.trim(),
      }),
    [inviterDisplayNameForCopy, inviteEmailDraft],
  );

  function openInvitesPanel() {
    setInviteActionError("");
    if (user && !pendingInvitesLoading) void reloadPendingInvites();
    requestAnimationFrame(() => {
      if (listInvitesShown.length > 0 && firstPendingInviteRowRef.current) {
        firstPendingInviteRowRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (atCircleCap && pendingInvitesCount > 0 && capPendingInvitesHintRef.current) {
        capPendingInvitesHintRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
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
    setInviteSheetNoAccountCopy(false);
    setInviteCopyMailStatus("");
    setShowInviteSheet(true);
  }

  function closeInviteSheet() {
    if (inviteSheetSubmitting) return;
    setShowInviteSheet(false);
    setInviteSheetError("");
    setInviteSheetNoAccountCopy(false);
    setInviteCopyMailStatus("");
  }

  async function copyInviteMailToClipboard() {
    const text = copyToMailFullText;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setInviteCopyMailStatus("copied");
      window.setTimeout(() => setInviteCopyMailStatus(""), 2200);
    } catch (e) {
      console.warn("Cinemastro: copy invite message failed", e);
      setInviteCopyMailStatus("failed");
      window.setTimeout(() => setInviteCopyMailStatus(""), 2200);
    }
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
    setInviteSheetNoAccountCopy(false);
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
        if (showCircleInfoSheet && circleDetailData?.id) {
          try {
            const rows = await fetchCirclePendingInviteLabels(circleDetailData.id);
            setCircleInfoPendingInvites(rows);
          } catch {
            /* list refreshes when Circle info reopens */
          }
        }
      }
      setShowInviteSheet(false);
      setInviteEmailDraft("");
    } catch (e) {
      console.error("Circles: sendCircleInvite failed", e);
      const msg = e?.message || "Could not send the invite.";
      if (String(msg).includes(INVITE_NO_CINEMASTRO_ACCOUNT_ERR_PREFIX)) {
        setInviteSheetNoAccountCopy(true);
        setInviteSheetError("");
      } else {
        setInviteSheetError(msg);
      }
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
    setDetailRateEntry(null);
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
        setDetailRateEntry(null);
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

  /** `/privacy`, `/terms`, `/about`, or legacy `?legal=` when not showing a detail link. */
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get(SPA_QS_DETAIL)) return;
    let legal = pathnameLegalSegment(u.pathname);
    if (!legal) {
      const q = u.searchParams.get(SPA_QS_LEGAL);
      if (q && SPA_LEGAL_SCREENS.has(q)) legal = q;
    }
    if (!legal || deepLinkLegalAppliedRef.current) return;
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
            </div>
            <RatingScoreChips
              value={sliderVal}
              touched={sliderTouched}
              onPick={(v) => { setSliderVal(v); setSliderTouched(true); }}
            />
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
                        ? `Pending invites (${pendingInvitesCount}). Scroll to invites in list.`
                        : "Pending invites"
                    }
                    title={
                      pendingInvitesCount > 0
                        ? `${pendingInvitesCount} pending — jump to invites in list`
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
              {atCircleCap && pendingInvitesCount > 0 ? (
                <div
                  ref={capPendingInvitesHintRef}
                  className="circles-pending-at-cap-hint"
                  role="status"
                >
                  You have {pendingInvitesCount} pending invite{pendingInvitesCount === 1 ? "" : "s"}.
                  {" "}
                  Leave a circle to accept or decline them in your list.
                </div>
              ) : null}
              {circlesError && (
                <div className="circles-error-banner">{circlesError}</div>
              )}
              {inviteActionError && (
                <div className="circles-error-banner">{inviteActionError}</div>
              )}
              {pendingInvitesError && (
                <div className="circles-error-banner">{pendingInvitesError}</div>
              )}
            </div>

            {circlesLoading && !circlesLoaded && listInvitesShown.length === 0 ? (
              <div className="circles-skeleton">
                <div className="circles-skeleton-card" />
                <div className="circles-skeleton-card" />
                <div className="circles-skeleton-card" />
              </div>
            ) : circlesLoaded && pendingInvitesLoaded && activeCirclesCount === 0 && listInvitesShown.length === 0 ? (
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
            ) : activeCirclesCount > 0 || listInvitesShown.length > 0 ? (
              <div className="circles-list">
                {listInvitesShown.map((invite, inviteIdx) => {
                  const meta = vibeMeta(invite.circleVibe);
                  const busy = inviteActionBusy[invite.id];
                  return (
                    <div
                      key={invite.id}
                      ref={inviteIdx === 0 ? firstPendingInviteRowRef : undefined}
                      className="invite-card invite-card--list"
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
                            onClick={() => void handleDeclineInvite(invite)}
                            disabled={Boolean(busy)}
                          >
                            {busy === "declining" ? "Declining…" : "Decline"}
                          </button>
                          <button
                            type="button"
                            className="circles-btn-primary"
                            onClick={() => void handleAcceptInvite(invite)}
                            disabled={Boolean(busy)}
                          >
                            {busy === "accepting" ? "Joining…" : "Accept"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {circlesList.map((circle) => {
                  const meta = vibeMeta(circle.vibe);
                  const unseenN = Math.max(0, Number(circleUnseenById[circle.id]?.unseenOthers) || 0);
                  const lastActivityLabel = formatCircleListLastActivity(circleUnseenById[circle.id]?.latest);
                  let cardAria = `Open ${circle.name}`;
                  if (lastActivityLabel) cardAria += `. Last activity ${lastActivityLabel}`;
                  if (unseenN > 0) {
                    cardAria += `. ${unseenN === 1 ? "1 new" : `${unseenN} new`} from your circle`;
                  }
                  return (
                    <div
                      key={circle.id}
                      className="circle-card"
                      style={{
                        "--vibe-accent": meta.accent,
                        "--vibe-tint": meta.tint,
                      }}
                    >
                      <div className="circle-card__tint" aria-hidden="true" />
                      <div className="circle-card__row">
                        <button
                          type="button"
                          className="circle-card__open"
                          aria-label={cardAria}
                          onClick={() => openCircleDetail(circle.id)}
                        >
                          <div className="circle-card__body">
                            <div className="circle-card__top">
                              <div className="circle-card__name">{circle.name}</div>
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
                        {lastActivityLabel || unseenN > 0 ? (
                          <div className="circle-card__trail">
                            {lastActivityLabel ? (
                              <span className="circle-card__last-activity" title="Latest rating shared to this circle">
                                {lastActivityLabel}
                              </span>
                            ) : null}
                            {unseenN > 0 ? (
                              <div
                                className="circle-card__unseen"
                                title="New from other members"
                                aria-hidden="true"
                              >
                                <span className="circle-card__unseen-num">
                                  {unseenN > 99 ? "99+" : unseenN}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="circles-skeleton">
                <div className="circles-skeleton-card" />
                <div className="circles-skeleton-card" />
                <div className="circles-skeleton-card" />
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
                        tabIndex={0}
                        role="group"
                        aria-label={`${movie?.title || "Title"}. Open details, or use the score row for who rated in this circle.`}
                        onPointerDown={onStripCardPointerDown}
                        onPointerMove={onStripCardPointerMove}
                        onPointerUp={onStripCardPointerEnd}
                        onPointerLeave={onStripCardPointerEnd}
                        onPointerCancel={onStripCardPointerEnd}
                        onClick={(e) => {
                          const el = e.target;
                          if (el.closest?.(".strip-card__menu-btn")) return;
                          if (el.closest?.(".circle-recent-strip-menu")) return;
                          if (el.closest?.(".circle-strip-below-title-scores--tappable")) return;
                          if (circleRecentStripSuppressClickRef.current) {
                            circleRecentStripSuppressClickRef.current = false;
                            return;
                          }
                          openDetail(movie, predDetail);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (e.target !== e.currentTarget) return;
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
                                  setPublishRatingModal({
                                    movieId: movie.id,
                                    mode: "forward",
                                    forwardFromCircleId: selectedCircleId,
                                  });
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
                          onWhoPublished={() => openWhoPublishedForCircleRow(row, movie?.title)}
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
                      <div
                        key={rowKey}
                        role="group"
                        tabIndex={0}
                        className="circle-rated-list-row"
                        aria-label={`${movie?.title || "Title"}. Open details, or use circle and Cinemastro scores to see who rated in this group.`}
                        onClick={(e) => {
                          if (e.target?.closest?.(".circle-who-published-hit")) return;
                          openDetail(movie, predDetail);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (e.target !== e.currentTarget) return;
                            openDetail(movie, predDetail);
                          }
                        }}
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
                          <CircleAllTopRatingsLine
                            row={row}
                            showRaterParen={showStripRaterCounts}
                            onWhoPublished={() => openWhoPublishedForCircleRow(row, movie?.title)}
                          />
                        </div>
                      </div>
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
                  const newActivityOnOtherTab =
                    circleDetailShowNewActivityBar && selectedCircleId
                    && (circleRatingsView === "all" || circleRatingsView === "top") ? (
                      <div className="circle-new-activity-bar--other-tab" role="status" aria-live="polite">
                        <span className="circle-new-activity-bar--other-tab__text">New activity</span>
                        <button
                          type="button"
                          className="circle-new-activity-bar--other-tab__btn"
                          onClick={() => {
                            setCircleRatedRefreshKey((k) => k + 1);
                          }}
                        >
                          Refresh
                        </button>
                      </div>
                    ) : null;
                  return (
                    <>
                      <div className="circle-detail-strip-wrap">
                        <div className="section circle-detail-strip-section">
                          {ratingsTabs}
                          {newActivityOnOtherTab}
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
                                  {circleDetailShowNewActivityBar && selectedCircleId && circleDetailData.status === "active" ? (
                                    <div className="strip-card strip-card--circle-new-activity" role="status" aria-live="polite">
                                      <div className="strip-poster strip-poster--circle-new-activity">
                                        <span className="circle-new-activity-strip__label">New</span>
                                        <button
                                          type="button"
                                          className="circle-new-activity-strip__btn"
                                          onClick={() => {
                                            setCircleRatedRefreshKey((k) => k + 1);
                                          }}
                                        >
                                          Refresh
                                        </button>
                                      </div>
                                      <div className="strip-title strip-title--circle-new-activity">Activity</div>
                                      <div className="strip-genre strip-genre--spacer" aria-hidden="true">
                                        &nbsp;
                                      </div>
                                    </div>
                                  ) : null}
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
          <div className="circles-modal-panel circles-modal-panel--circle-info">
            <button
              type="button"
              className="circles-modal-close circles-modal-close--circle-info"
              aria-label="Close"
              onClick={() => setShowCircleInfoSheet(false)}
            >
              ×
            </button>
            <div className="circles-modal-head-centered">
              <h2 className="circles-modal-title circles-modal-title--circle-info">Circle info</h2>
              <div className="circles-modal-sub circles-modal-sub--circle-info-name">{circleDetailData.name}</div>
            </div>
            <div className="circle-info-roster">
            <div className="circle-info-member-list">
              {[...(circleDetailData.members || [])]
                .sort((a, b) => {
                  const rank = (r) => (r === "admin" ? 0 : 1);
                  const dr = rank(a.role) - rank(b.role);
                  if (dr !== 0) return dr;
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
                  const isAdminMember = m.role === "admin";
                  const roleLabel = isAdminMember ? "Host" : "Member";
                  return (
                    <div className="circle-info-member-row" key={m.id || `${m.user_id}`}>
                      <span className="circle-info-member-name">{label}</span>
                      <span
                        className={`circle-info-member-badge${
                          isAdminMember ? " circle-info-member-badge--with-star" : ""
                        }`}
                      >
                        <span className="circle-info-member-badge-text">{roleLabel}</span>
                        {isAdminMember ? (
                          <span
                            className="circle-info-member-star"
                            aria-label="Host"
                            title="Host"
                          >
                            ★
                          </span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
            </div>
            {isCircleModerator(circleDetailData, user?.id) &&
              circleDetailData.status === "active" &&
              (circleInfoPendingInvitesLoading || circleInfoPendingInvites.length > 0) && (
                <div className="circle-info-pending-invites" aria-label="Pending invites">
                  <div className="circle-info-pending-invites-heading">Invites pending</div>
                  {circleInfoPendingInvitesLoading ? (
                    <div className="circle-info-pending-invites-loading">Loading…</div>
                  ) : (
                    <div className="circle-info-pending-invites-list">
                      {circleInfoPendingInvites.map((row) => (
                        <div
                          className="circle-info-pending-invite-row"
                          key={row.inviteId || row.invitedUserId}
                        >
                          <span className="circle-info-pending-invite-name">{row.displayLabel}</span>
                          <span className="circle-info-pending-invite-status">Pending</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="circle-info-actions">
            {isCircleModerator(circleDetailData, user?.id) && circleDetailData.status === "active" && (
              <div className="circle-info-invite-block">
                <button
                  type="button"
                  className="circle-invite-btn circle-invite-btn--modal circle-invite-btn--primary-fill"
                  onClick={openInviteSheet}
                  disabled={circleDetailData.memberCount >= CIRCLE_MEMBER_CAP}
                >
                  + Invite more
                </button>
                {circleDetailData.memberCount >= CIRCLE_MEMBER_CAP && (
                  <p className="circle-info-invite-cap">This circle is full ({CIRCLE_MEMBER_CAP}/{CIRCLE_MEMBER_CAP}).</p>
                )}
                <div className="circle-info-actions-divider" aria-hidden="true" />
                <button
                  type="button"
                  className="circle-invite-btn circle-invite-btn--modal"
                  onClick={() => openEditCircleSheet(circleDetailData, { closeInfo: true })}
                >
                  Edit name & description
                </button>
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
        </div>
      )}

      {whoPublishedModal ? (
        <div
          className="circles-modal-root"
          role="dialog"
          aria-modal="true"
          aria-labelledby={whoPublishedModal.displayTitle ? "who-published-film-title" : undefined}
          aria-label={whoPublishedModal.displayTitle ? undefined : "Rated by in this circle"}
        >
          <button
            type="button"
            className="circles-modal-backdrop"
            aria-label="Close"
            onClick={() => setWhoPublishedModal(null)}
          />
          <div className="circles-modal-panel who-published-modal-panel">
            <div className="who-published-modal-header">
              <button
                type="button"
                className="circles-modal-close who-published-modal-close"
                aria-label="Close"
                onClick={() => setWhoPublishedModal(null)}
              >
                ×
              </button>
              {whoPublishedModal.displayTitle ? (
                <h2 className="who-published-modal-film-title" id="who-published-film-title">
                  {whoPublishedModal.displayTitle}
                </h2>
              ) : null}
              <p className="who-published-modal-byline">Rated by</p>
            </div>
            {whoPublishedModal.status === "loading" ? (
              <div className="who-published-modal-body who-published-modal-body--loading">Loading…</div>
            ) : whoPublishedModal.status === "err" ? (
              <div className="who-published-modal-body who-published-modal-error" role="alert">
                {whoPublishedModal.message}
              </div>
            ) : (whoPublishedModal.rows || []).length === 0 ? (
              <p className="who-published-modal-empty">No one in this group has a published rating for this title yet.</p>
            ) : (
              <ul className="who-published-modal-list" aria-label="Member scores in this circle">
                {(whoPublishedModal.rows || []).map((r) => {
                  const isYou = r.user_id && user?.id && r.user_id === user.id;
                  const name = isYou
                    ? "You"
                    : (r.member_name || "").trim() || "Member";
                  return (
                    <li key={r.user_id} className="who-published-modal-row">
                      <span className="who-published-modal-name">{name}</span>
                      <span className="who-published-modal-score">{formatScore(Number(r.score))}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              type="button"
              className="circle-invite-btn circle-invite-btn--modal who-published-modal-close-cta"
              onClick={() => setWhoPublishedModal(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

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

      {showEditCircleSheet && (
        <div className="circles-sheet-root" role="dialog" aria-modal="true" aria-label="Edit circle">
          <button
            type="button"
            className="circles-sheet-backdrop"
            aria-label="Close"
            onClick={closeEditCircleSheet}
          />
          <div className="circles-sheet">
            <div className="circles-sheet-handle" aria-hidden="true" />
            <div className="circles-sheet-title">Edit circle</div>
            <div className="circles-sheet-sub">Name, description, and vibe. Other members will see the updates.</div>

            <div className="circles-field">
              <label className="circles-field-label">
                Name <span className="circles-field-required">*</span>
              </label>
              <input
                className="circles-input"
                type="text"
                maxLength={CIRCLE_NAME_MAX}
                placeholder="e.g. Friday movie night"
                value={editCircleName}
                onChange={(e) => setEditCircleName(e.target.value)}
                disabled={editCircleSubmitting}
                autoFocus
              />
              <div className="circles-field-count">
                {editCircleName.length}/{CIRCLE_NAME_MAX}
              </div>
            </div>

            <div className="circles-field">
              <label className="circles-field-label">Description</label>
              <textarea
                className="circles-textarea"
                maxLength={CIRCLE_DESCRIPTION_MAX}
                placeholder="What's this circle about? (optional)"
                value={editCircleDescription}
                onChange={(e) => setEditCircleDescription(e.target.value)}
                disabled={editCircleSubmitting}
                rows={2}
              />
              <div className="circles-field-count">
                {editCircleDescription.length}/{CIRCLE_DESCRIPTION_MAX}
              </div>
            </div>

            <div className="circles-field">
              <label className="circles-field-label">Vibe</label>
              <select
                className="circles-input"
                value={editCircleVibe}
                onChange={(e) => setEditCircleVibe(e.target.value)}
                disabled={editCircleSubmitting}
              >
                {VIBES.map((v) => (
                  <option key={v.id} value={v.id}>{v.id}</option>
                ))}
              </select>
            </div>

            {editCircleError && <div className="circles-error-banner">{editCircleError}</div>}

            <div className="circles-sheet-actions">
              <button
                type="button"
                className="circles-btn-ghost"
                onClick={closeEditCircleSheet}
                disabled={editCircleSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="circles-btn-primary"
                onClick={() => void submitEditCircle()}
                disabled={editCircleSubmitting || !editCircleName.trim()}
              >
                {editCircleSubmitting ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase B: invite-by-email composer sheet (host = admin, circle-detail). */}
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
              If they already use Cinemastro with this email, we&apos;ll send an in-app invite. If not, try
              Send — then copy the message below and paste it into your own email app.
            </div>

            <div className="circles-field">
              <label className="circles-field-label">Email</label>
              <input
                className="circles-input"
                type="email"
                autoComplete="email"
                placeholder="friend@example.com"
                value={inviteEmailDraft}
                onChange={(e) => {
                  setInviteEmailDraft(e.target.value);
                  setInviteSheetNoAccountCopy(false);
                  setInviteCopyMailStatus("");
                }}
                disabled={inviteSheetSubmitting}
                autoFocus
              />
            </div>

            {inviteSheetError && <div className="circles-error-banner">{inviteSheetError}</div>}

            {inviteSheetNoAccountCopy && (
              <div className="circles-copy-mail-block">
                <div className="circles-info-banner">
                  No Cinemastro account for that address yet. Your friend can sign up, then you can share the circle from the app. For now, copy the text below and send it from your email.
                </div>
                <div className="circles-field">
                  <label className="circles-field-label" id="copy-mail-invite-label">
                    Message to copy (subject + body)
                  </label>
                  <textarea
                    className="circles-textarea circles-copy-mail-textarea"
                    readOnly
                    value={copyToMailFullText}
                    rows={20}
                    aria-labelledby="copy-mail-invite-label"
                  />
                </div>
                <p className="circles-copy-mail-instructions">
                  Copy the text, open your email app, start a new message, set the subject / paste the body, and
                  send to <strong>{inviteEmailDraft.trim() || "—"}</strong>.
                </p>
                {inviteCopyMailStatus === "failed" && (
                  <p className="circles-error-banner" role="status">
                    Copy failed — select the text in the box and copy manually.
                  </p>
                )}
                <div className="circles-copy-mail-actions">
                  {copyToMailMailtoHref ? (
                    <a
                      className="circles-btn-mailto circles-copy-mail-mailto"
                      href={copyToMailMailtoHref}
                    >
                      Open in email app
                    </a>
                  ) : (
                    <span
                      className="circles-btn-mailto circles-copy-mail-mailto"
                      aria-disabled="true"
                    >
                      Open in email app
                    </span>
                  )}
                  <button
                    type="button"
                    className="circles-btn-primary"
                    onClick={() => void copyInviteMailToClipboard()}
                    disabled={!copyToMailFullText}
                  >
                    {inviteCopyMailStatus === "copied"
                      ? "Copied"
                      : inviteCopyMailStatus === "failed"
                        ? "Try copy again"
                        : "Copy for email"}
                  </button>
                </div>
              </div>
            )}

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
              {(leaveConfirmCircle.memberCount ?? 0) > 1
                ? "You'll leave this circle. Picks you published only in this group are removed here. Your ratings on your account stay the same. Hosts stay; up to three longest-joined members can manage invites and circle details."
                : "You're the only member. Leaving deletes this circle for everyone — pending invites and shared picks for the group go away."}
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
                {publishRatingModal.mode === "forward"
                  ? "Forward to circles"
                  : publishRatingModal.mode === "manage"
                    ? "Circles for this title"
                    : "Publish to circles"}
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
              {publishRatingModal.mode === "forward"
                ? "Add this title to other groups. It stays in the circle you’re in; only new group picks are added."
                : publishRatingModal.mode === "manage"
                  ? "Choose which groups see this title with your score. Your rating stays the same everywhere."
                  : "Pick which groups see this title. You can skip and add circles later from the title detail."}
            </p>
            {publishRatingModal.mode === "forward" && (publishModalForwardDestinations == null || publishModalForwardDestinations.length === 0) ? (
              <p className="circles-modal-sub">You’re not in any other active circles. Join or create one to forward.</p>
            ) : publishModalCircles.length === 0 ? (
              <p className="circles-modal-sub">You’re not in any active circles yet.</p>
            ) : (
              <div className="publish-rating-circle-list">
                {(publishRatingModal.mode === "forward" && publishModalForwardDestinations != null
                  ? publishModalForwardDestinations
                  : publishModalCircles
                ).map((c) => (
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
                disabled={
                  publishModalBusy ||
                  (publishRatingModal.mode === "forward"
                    ? false
                    : publishModalCircles.length === 0)
                }
                onClick={() => void completePublishRatingModal([...publishModalSelection])}
              >
                {publishModalBusy ? "Saving…" : "Done"}
              </button>
            </div>
          </div>
        </div>
      )}

      {screen === "pulse" && (
        <PulsePage
          PageShell={PageShell}
          BottomNav={BottomNav}
          SkeletonStrip={SkeletonStrip}
          StripPosterBadge={StripPosterBadge}
          pulseCatalogReady={pulseCatalogReady}
          pulseTrendingRecsResolved={pulseTrendingRecsResolved}
          pulsePopularRecsResolved={pulsePopularRecsResolved}
          openDetail={openDetail}
          posterSrcThumb={posterSrcThumb}
          formatStripMeta={(movie) => formatStripMediaMeta(movie, tvStripMetaByTmdbId)}
          recNeighborCount={recNeighborCount}
          userRatings={userRatings}
          startDefaultRateMore={startDefaultRateMore}
          onPrivacy={() => openLegalPage("privacy")}
          onTerms={() => openLegalPage("terms")}
          onAbout={() => openLegalPage("about")}
          navProps={navProps}
        />
      )}

      {screen === "in-theaters" && (
        <InTheatersPage
          PageShell={PageShell}
          BottomNav={BottomNav}
          StripPosterBadge={StripPosterBadge}
          theaterRecs={theaterRecs}
          inTheatersPagePopularRecsResolved={inTheatersPagePopularRecsResolved}
          showRegionKeys={showRegionKeys}
          openDetail={openDetail}
          posterSrcThumb={posterSrcThumb}
          formatStripMeta={(movie) => formatStripMediaMeta(movie, tvStripMetaByTmdbId)}
          recNeighborCount={recNeighborCount}
          userRatings={userRatings}
          startDefaultRateMore={startDefaultRateMore}
          onPrivacy={() => openLegalPage("privacy")}
          onTerms={() => openLegalPage("terms")}
          onAbout={() => openLegalPage("about")}
          navProps={navProps}
        />
      )}

      {screen === "streaming-page" && (
        <div className="home">
          <PageShell
            title="Streaming"
            subtitle="New & popular — optional service filter (profile picks apply only in Your Picks). Scored for your taste."
          >
            <div className="section" style={{ paddingTop: 0 }}>
              <div className="filter-row streaming-page-filter-row" style={{ paddingTop: 0, paddingBottom: 4 }}>
                <div className="streaming-page-filter-scroll">
                  <select
                    id="streaming-page-service"
                    className={`streaming-page-service-select${streamingPageProviderId != null ? " streaming-page-service-select--active" : ""}`}
                    aria-label="Filter by streaming service"
                    value={streamingPageProviderId == null ? "" : String(streamingPageProviderId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStreamingPageProviderId(v === "" ? null : Number(v));
                    }}
                  >
                    <option value="">All services</option>
                    {STREAMING_SERVICES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <span className="streaming-page-service-pill-divider" aria-hidden />
                  <button type="button" className={`filter-pill ${streamingTab === "tv" ? "active" : ""}`} onClick={() => setStreamingTab("tv")}>
                    Series
                  </button>
                  <button type="button" className={`filter-pill ${streamingTab === "movie" ? "active" : ""}`} onClick={() => setStreamingTab("movie")}>
                    Movies
                  </button>
                </div>
                <span className="streaming-page-service-pill-divider" aria-hidden />
                <details className="streaming-page-genre-details">
                  <summary className={`streaming-page-genre-summary${streamingPageIncludedHidableGenreIds.length > 0 ? " streaming-page-genre-summary--active" : ""}`}>
                    Genres
                    {streamingPageIncludedHidableGenreIds.length > 0 ? ` · ${streamingPageIncludedHidableGenreIds.length}` : ""}
                  </summary>
                  <div className="streaming-page-genre-panel">
                    <div className="streaming-page-genre-hint">
                      Animation, documentary, reality &amp; kids are hidden by default (family stays). Check to include.
                    </div>
                    {STREAMING_PAGE_GENRE_TOGGLE_OPTIONS.map((opt) => (
                      <label key={opt.id} className="streaming-page-genre-option">
                        <input
                          type="checkbox"
                          checked={streamingPageIncludedHidableGenreIds.includes(opt.id)}
                          onChange={() => toggleStreamingPageIncludedGenre(opt.id)}
                        />
                        <span>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </details>
              </div>
              <div className="section-header">
                <div className="section-title">Now Streaming</div>
                <div className="section-meta">Newest {streamingTab === "movie" ? "releases" : "series & seasons"}</div>
              </div>
              {showStreamingStripsSkeleton ? (
                <SkeletonStrip />
              ) : streamingDisplayNowRecs.length === 0 ? (
                <div className="empty-box">
                  <div className="empty-text">
                    {streamingPageProviderId != null
                      ? `No ${streamingTab === "movie" ? "movies" : "series"} in this discover view for that service (US, subscription) — try All services or another.`
                      : `No streaming ${streamingTab === "movie" ? "movies" : "series"} right now`}
                  </div>
                </div>
              ) : (
                <div className="strip">
                  {streamingDisplayNowRecs.map((rec) => (
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
                <div className="section-meta">
                  {streamingPageProviderId == null
                    ? "Trending this week on TMDB"
                    : "Most popular on this service (US, subscription)"}
                </div>
              </div>
              {showStreamingStripsSkeleton ? (
                <SkeletonStrip />
              ) : streamingDisplayPopularRecs.length === 0 ? (
                <div className="empty-box">
                  <div className="empty-text">
                    {streamingPageProviderId != null
                      ? `No ${streamingTab === "movie" ? "movies" : "series"} in this discover view for that service (US, subscription) — try All services or another.`
                      : `No streaming ${streamingTab === "movie" ? "movies" : "series"} right now`}
                  </div>
                </div>
              ) : (
                <div className="strip">
                  {streamingDisplayPopularRecs.map((rec) => (
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
              streamingDisplayNowRecs.length + streamingDisplayPopularRecs.length > 0 && (
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
                    <button
                      type="button"
                      className="section-meta your-picks-refresh"
                      aria-label="Refresh Your Picks list"
                      onClick={() => setTopPickOffset((p) => p + 1)}
                    >
                      ↻ Refresh
                    </button>
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
        <SecondaryRegionPage
          PageShell={PageShell}
          BottomNav={BottomNav}
          StripPosterBadge={StripPosterBadge}
          SkeletonStrip={SkeletonStrip}
          pageTitle={V130_SECONDARY_HOME_TITLE[secondaryRegionKey] ?? "Region"}
          pageSubtitle={
            secondaryRegionKey === "indian"
              ? "US theaters and India (TMDB) streaming for this taste — scored for you"
              : "US theaters & streaming for this taste — scored for you"
          }
          hasValidSecondaryProfile={Boolean(secondaryRegionKey && V130_SECONDARY_REGION_IDS.includes(secondaryRegionKey))}
          segmentTheatersKey={SECONDARY_BLOCK_THEATERS}
          segmentStreamingKey={SECONDARY_BLOCK_STREAMING}
          secondaryBlockSegment={secondaryBlockSegment}
          onSelectTheatersSegment={() => setSecondaryBlockSegment(SECONDARY_BLOCK_THEATERS)}
          onSelectStreamingSegment={() => setSecondaryBlockSegment(SECONDARY_BLOCK_STREAMING)}
          secondaryRegionKey={secondaryRegionKey}
          secondaryRegionStreamingProviderId={secondaryRegionStreamingProviderId}
          onStreamingProviderIdChange={setSecondaryRegionStreamingProviderId}
          streamingServiceOptions={streamingServicesForSecondaryBlock(secondaryRegionKey)}
          secondaryBlockStreamingTab={secondaryBlockStreamingTab}
          onSelectStreamingTabTv={() => setSecondaryBlockStreamingTab("tv")}
          onSelectStreamingTabMovie={() => setSecondaryBlockStreamingTab("movie")}
          secondaryStripReady={secondaryStripReady}
          showSecondaryRefillEmptySkeleton={showSecondaryRefillEmptySkeleton}
          secondaryActiveRawRows={secondaryActiveRawRows}
          secondaryStripRecsVisible={secondaryStripRecsVisible}
          openDetail={openDetail}
          posterSrcThumb={posterSrcThumb}
          formatStripMeta={(movie) => formatSecondaryRegionStripMeta(movie, tvStripMetaByTmdbId)}
          recNeighborCount={recNeighborCount}
          userRatings={userRatings}
          startDefaultRateMore={startDefaultRateMore}
          onPrivacy={() => openLegalPage("privacy")}
          onTerms={() => openLegalPage("terms")}
          onAbout={() => openLegalPage("about")}
          navProps={navProps}
        />
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
            </div>
            <RatingScoreChips
              value={sliderVal}
              touched={sliderTouched}
              onPick={(v) => { setSliderVal(v); setSliderTouched(true); }}
            />
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
        const showRateMorePill =
          detailRateEntry === "discover" &&
          !myRating &&
          hasPersonalPrediction(prediction) &&
          !showPredSkeleton;
        const hasFactsBar = Boolean(
          detailMeta.certification ||
            detailMeta.releaseLabel ||
            detailMeta.runtimeLabel ||
            detailMeta.genresLine ||
            detailMeta.languageLabel,
        );
        const detailRatePrimaryLabel =
          detailRateEntry === "circle" ? "Rate this title" : "Select your rating and submit";
        const confInlineClass =
          prediction?.confidence === "high"
            ? "detail-score-conf-inline--high"
            : prediction?.confidence === "medium"
              ? "detail-score-conf-inline--medium"
              : "detail-score-conf-inline--low";
        const detailInTheatersPool =
          movie.type === "movie" &&
          movie.tmdbId != null &&
          (inTheaters.some((m) => m.tmdbId === movie.tmdbId) ||
            inTheatersPopularRanked.some((m) => m.tmdbId === movie.tmdbId) ||
            secondaryTheaterRows.some((m) => m.tmdbId === movie.tmdbId));
        const unratedDetailRateInner = (
          <>
            <div className="d-rate-label d-rate-label--sentence">{detailRatePrimaryLabel}</div>
            <RatingScoreChips
              variant="detail"
              value={detailRating}
              touched={detailTouched}
              onPick={(v) => { setDetailRating(v); setDetailTouched(true); }}
            />
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
          </>
        );
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
                {hasFactsBar ? (
                  <div className="detail-facts-bar">
                    {detailMeta.certification ||
                    detailMeta.releaseLabel ||
                    detailMeta.runtimeLabel ||
                    detailMeta.languageLabel ? (
                      <div className="detail-facts-row">
                        {detailMeta.certification ? (
                          <span className="detail-facts-cert">{detailMeta.certification}</span>
                        ) : null}
                        {detailMeta.certification &&
                        (detailMeta.releaseLabel || detailMeta.runtimeLabel || detailMeta.languageLabel) ? (
                          <span className="detail-facts-sep">·</span>
                        ) : null}
                        {detailMeta.releaseLabel ? <span>{detailMeta.releaseLabel}</span> : null}
                        {detailMeta.releaseLabel && (detailMeta.runtimeLabel || detailMeta.languageLabel) ? (
                          <span className="detail-facts-sep">·</span>
                        ) : null}
                        {detailMeta.runtimeLabel ? <span>{detailMeta.runtimeLabel}</span> : null}
                        {detailMeta.runtimeLabel && detailMeta.languageLabel ? (
                          <span className="detail-facts-sep">·</span>
                        ) : null}
                        {!detailMeta.runtimeLabel &&
                        detailMeta.languageLabel &&
                        (detailMeta.certification || detailMeta.releaseLabel) ? (
                          <span className="detail-facts-sep">·</span>
                        ) : null}
                        {detailMeta.languageLabel ? <span>{detailMeta.languageLabel}</span> : null}
                      </div>
                    ) : null}
                    {detailMeta.genresLine ? <div className="detail-facts-genres">{detailMeta.genresLine}</div> : null}
                  </div>
                ) : null}
                {showRateMorePill ? (
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
                      <RatingScoreChips
                        variant="detail"
                        value={detailRating}
                        touched={detailTouched}
                        onPick={(v) => { setDetailRating(v); setDetailTouched(true); }}
                      />
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
                      {detailRateEntry === "circle" ? (
                        <div className="d-rate-title-strip">{unratedDetailRateInner}</div>
                      ) : (
                        unratedDetailRateInner
                      )}
                    </div>
                  ) : null}
                </div>
                {detailMeta.tagline ? <p className="d-tagline">{detailMeta.tagline}</p> : null}
                <h2 className="d-overview-heading">Overview</h2>
                <div className="d-synopsis">{movie.synopsis}</div>
                <div className="detail-wtw-wrap">
                  <WhereToWatch
                    tmdbId={movie.tmdbId}
                    type={movie.type}
                    movieTitle={movie.title}
                    movieYear={movie.year}
                    showTheatricalShowtimesFallback={detailInTheatersPool}
                  />
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