import { useState, useMemo, useEffect } from "react";
import { supabase } from "./supabase";

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');`;

const TMDB_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiOThhYjJlMThiODdjZmQyODFhY2JlYWZmNDhkMjE0ZSIsIm5iZiI6MTc3NDY0MTcxMS4yNDYsInN1YiI6IjY5YzZlMjJmYWRkOGNkNzhkMTUzNzgyOSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.jJhQu5G7iVJyW4MqDttCqiGestEHZjsrUKe73baRO7A";
const TMDB_BASE = "https://api.themoviedb.org/3";
/** Direct TMDB CDN URLs work on Vercel; `/tmdb-images` only works via Vite dev proxy. */
const TMDB_IMG_HOST = "https://image.tmdb.org";
const TMDB_IMG = `${TMDB_IMG_HOST}/t/p/w500`;
const TMDB_IMG_BACKDROP = `${TMDB_IMG_HOST}/t/p/w780`;

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

function normalizeTMDBItem(item, type) {
  return {
    id: `${type}-${item.id}`,
    tmdbId: item.id,
    type,
    title: item.title || item.name,
    year: (item.release_date || item.first_air_date || "").slice(0, 4),
    genre: type === "movie" ? "Movie" : "TV Show",
    genreIds: item.genre_ids || [],
    synopsis: item.overview || "",
    poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
    backdrop: item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : null,
    tmdbRating: Math.round(item.vote_average * 10) / 10,
    popularity: item.popularity,
    language: item.original_language || "en",
  };
}

async function fetchInTheaters(regionKeys = []) {
  try {
    const langCodes = getRegionLanguageCodes(regionKeys);
    if (langCodes.length > 0) {
      const now = new Date();
      const end = now.toISOString().slice(0, 10);
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 210);
      const start = startDate.toISOString().slice(0, 10);
      const base = `/discover/movie?language=en-US&sort_by=popularity.desc&region=US&with_original_language=${langCodes.join("|")}&primary_release_date.gte=${start}&primary_release_date.lte=${end}`;
      const [p1, p2, p3] = await Promise.all([
        fetchTMDB(`${base}&page=1`),
        fetchTMDB(`${base}&page=2`),
        fetchTMDB(`${base}&page=3`),
      ]);
      const merged = [...(p1.results || []), ...(p2.results || []), ...(p3.results || [])];
      const unique = [...new Map(merged.map(item => [item.id, item])).values()];
      if (unique.length > 0) return unique.slice(0, 15).map(m => normalizeTMDBItem(m, "movie"));
    }
    const data = await fetchTMDB("/movie/now_playing?language=en-US&page=1&region=US");
    return (data.results || []).slice(0, 15).map(m => normalizeTMDBItem(m, "movie"));
  } catch {
    return [];
  }
}

/**
 * Subscription streaming in the US (TMDB discover).
 * @param {number[]|null|undefined} providerIds - TMDB watch provider_ids; pipe = OR. Empty/null = any flatrate service.
 */
async function fetchStreamingSplit(providerIds, regionKeys) {
  try {
    const y = new Date().getFullYear();
    const seriesRecentCutoff = `${y - 2}-01-01`;
    const langCodes = getRegionLanguageCodes(regionKeys);
    const langQuery = langCodes.length > 0 ? `&with_original_language=${langCodes.join("|")}` : "";
    const providerQuery =
      Array.isArray(providerIds) && providerIds.length > 0
        ? `&with_watch_providers=${providerIds.join("|")}`
        : "";
    const moviePathBase = `/discover/movie?language=en-US&watch_region=US&with_watch_monetization_types=flatrate&sort_by=popularity.desc${providerQuery}${langQuery}`;
    const tvPathBase = `/discover/tv?language=en-US&watch_region=US&with_watch_monetization_types=flatrate&sort_by=first_air_date.desc&first_air_date.gte=${seriesRecentCutoff}${providerQuery}${langQuery}`;
    const fetchPageNums = langCodes.length > 0 ? [1, 2] : [1];
    const [moviePages, tvPages] = await Promise.all([
      Promise.all(fetchPageNums.map(page => fetchTMDB(`${moviePathBase}&page=${page}`))),
      Promise.all(fetchPageNums.map(page => fetchTMDB(`${tvPathBase}&page=${page}`))),
    ]);
    const movieResults = moviePages.flatMap(page => page.results || []);
    const tvResults = tvPages.flatMap(page => page.results || []);
    const dedupeByTmdbId = (arr) => [...new Map(arr.map(item => [item.id, item])).values()];
    const movies = dedupeByTmdbId(movieResults).slice(0, 16).map(m => normalizeTMDBItem(m, "movie"));
    const shows = dedupeByTmdbId(tvResults).slice(0, 16).map(m => normalizeTMDBItem(m, "tv"));
    return { movies, shows };
  } catch {
    return { movies: [], shows: [] };
  }
}

async function fetchCatalogue() {
  const [popMovies, topMovies, popTV, topTV] = await Promise.all([
    fetchTMDB("/movie/popular?language=en-US&page=1"),
    fetchTMDB("/movie/top_rated?language=en-US&page=1"),
    fetchTMDB("/tv/popular?language=en-US&page=1"),
    fetchTMDB("/tv/top_rated?language=en-US&page=1"),
  ]);
  const normalize = (item, type) => ({
    id: `${type}-${item.id}`, tmdbId: item.id, type,
    title: item.title || item.name,
    year: (item.release_date || item.first_air_date || "").slice(0, 4),
    genre: type === "movie" ? "Movie" : "TV Show",
    genreIds: item.genre_ids || [],
    synopsis: item.overview || "",
    poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
    backdrop: item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : null,
    tmdbRating: Math.round(item.vote_average * 10) / 10,
    popularity: item.popularity,
    language: item.original_language || "en",
  });
  const movies = [...(popMovies.results || []).map(m => normalize(m, "movie")), ...(topMovies.results || []).map(m => normalize(m, "movie"))];
  const shows = [...(popTV.results || []).map(m => normalize(m, "tv")), ...(topTV.results || []).map(m => normalize(m, "tv"))];
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
      genre: type === "movie" ? "Movie" : "TV Show",
      genreIds: item.genre_ids || [],
      synopsis: item.overview || "",
      poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
      backdrop: item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : null,
      tmdbRating: Math.round(item.vote_average * 10) / 10,
      popularity: item.popularity,
      language: item.original_language || langCode,
    });
    return [
      ...(movies.results || []).slice(0, 15).map(m => normalize(m, "movie")),
      ...(shows.results || []).slice(0, 10).map(m => normalize(m, "tv")),
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
  if (!lang) return false;
  return PROFILE_REGION_OPTIONS
    .filter(option => showRegionKeys.includes(option.id))
    .some(option => option.languages.includes(lang));
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
      { id: "very_recent", label: "🆕 Just released" },
      { id: "recent", label: "📅 Last 3 years" },
      { id: "classic", label: "🎬 Classic (pre-2000)" },
      { id: "short", label: "⚡ Quick watch" },
    ]
  }
];

const MOOD_GENRE_IDS_FROM_PROFILE = new Set(MOOD_CARDS.find(c => c.id === "genre").options.map(o => o.id));

function BottomNav({ navTab, setNavTab, setScreen, setMoodStep, setMoodSelections, setMoodResults, showGenreIds }) {
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
              const gFromProfile = (showGenreIds || []).filter(id => MOOD_GENRE_IDS_FROM_PROFILE.has(id));
              setMoodSelections({ region: [], indian_lang: [], genre: gFromProfile, vibe: [] });
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = `
  ${FONTS}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; }
  /* Shell: use % not 100vw — iOS Safari can treat 100vw wider than the paint area and allow sideways pan */
  .app { --shell:480px; font-family:'DM Sans',sans-serif; background:#0a0a0a; color:#f0ebe0; min-height:100vh; min-height:100dvh; width:100%; max-width:min(100%,var(--shell)); margin:0 auto; overflow-x:hidden; min-width:0; }

  .splash { height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; animation:fadeIn 0.8s ease; }
  .splash-logo { line-height:0; display:flex; justify-content:center; align-items:center; margin-bottom:32px; }
  .app-brand.brand-logo { display:block; max-width:100%; object-fit:contain; object-position:left center; }
  /* Mobile-first header sizing by width to prevent right-side overflow with wide logo/tagline assets. */
  .app-brand.brand-logo--header { width:min(220px, calc(100vw - 124px)); height:auto; }
  /* Taller on splash so wordmark + tagline stay readable (full logo viewBox 400×120). */
  .app-brand.brand-logo--splash { width:min(86vw, 380px); height:auto; }
  .home-header .app-brand { margin-bottom:10px; }
  .discover-header .app-brand { margin-bottom:10px; }
  .mood-header .app-brand { margin-bottom:8px; }
  .profile-brand { padding:52px 24px 6px; }
  .mood-results-brand { padding:52px 24px 8px; }
  .mood-results-header { padding:0 24px 20px; display:flex; align-items:center; gap:12px; }
  .detail-sticky-brand { position:sticky; top:0; z-index:25; background:#0a0a0a; padding:14px 24px 12px; text-align:center; border-bottom:1px solid #1a1a1a; }
  .detail .back-btn { top:58px; }
  .btn-primary { background:#e8c96a; color:#0a0a0a; border:none; padding:16px 48px; font-family:'DM Sans',sans-serif; font-size:15px; font-weight:500; letter-spacing:1px; cursor:pointer; border-radius:2px; transition:all 0.2s; width:220px; }
  .btn-primary:hover { background:#f0d880; transform:translateY(-1px); }
  .btn-ghost { background:transparent; color:#888; border:1px solid #333; padding:14px 48px; font-family:'DM Sans',sans-serif; font-size:14px; cursor:pointer; border-radius:2px; margin-top:12px; transition:all 0.2s; width:220px; }
  .btn-ghost:hover { border-color:#666; color:#ccc; }

  .auth { height:100vh; display:flex; flex-direction:column; justify-content:center; padding:0 32px; animation:fadeIn 0.5s ease; }
  .auth-back { position:absolute; top:52px; left:24px; background:none; border:none; color:#666; font-size:14px; cursor:pointer; font-family:'DM Sans',sans-serif; }
  .auth-back:hover { color:#ccc; }
  .auth-title { font-family:'DM Serif Display',serif; font-size:32px; color:#f0ebe0; margin-bottom:8px; }
  .auth-sub { font-size:14px; color:#666; margin-bottom:36px; }
  .auth-field { margin-bottom:16px; }
  .auth-label { font-size:12px; color:#888; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px; display:block; }
  .auth-input { width:100%; background:#141414; border:1px solid #2a2a2a; border-radius:8px; padding:13px 16px; font-family:'DM Sans',sans-serif; font-size:14px; color:#f0ebe0; outline:none; transition:border-color 0.2s; }
  .auth-input:focus { border-color:#e8c96a; }
  .auth-input::placeholder { color:#444; }
  .auth-error { font-size:13px; color:#cc4444; margin-bottom:16px; padding:10px 14px; background:#1a0808; border:1px solid #441111; border-radius:8px; }
  .auth-btn { width:100%; background:#e8c96a; color:#0a0a0a; border:none; padding:15px; font-family:'DM Sans',sans-serif; font-size:15px; font-weight:500; cursor:pointer; border-radius:2px; transition:all 0.2s; margin-top:8px; }
  .auth-btn:hover { background:#f0d880; }
  .auth-btn:disabled { opacity:0.5; cursor:default; }
  .auth-switch { text-align:center; margin-top:20px; font-size:13px; color:#666; }
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

  .onboarding { height:100vh; display:flex; flex-direction:column; background:#0a0a0a; animation:fadeIn 0.5s ease; }
  .ob-header { padding:52px 24px 16px; display:flex; flex-direction:column; gap:6px; }
  .ob-step { font-size:11px; letter-spacing:3px; text-transform:uppercase; color:#e8c96a; }
  .ob-title { font-family:'DM Serif Display',serif; font-size:26px; color:#f0ebe0; line-height:1.2; }
  .ob-subtitle { font-size:13px; color:#666; margin-top:2px; }
  .ob-dots { display:flex; gap:6px; padding:0 24px; margin-bottom:12px; }
  .ob-dot { height:3px; border-radius:2px; transition:all 0.3s; background:#222; flex:1; }
  .ob-dot.active { background:#e8c96a; }
  .ob-dot.done { background:#666; }
  .card-area { flex:1; padding:0 24px; display:flex; flex-direction:column; min-height:0; }
  .movie-card { background:#141414; border-radius:16px; overflow:hidden; border:1px solid #222; flex:1; display:flex; flex-direction:column; max-height:380px; animation:slideUp 0.4s ease; }
  .card-poster { flex:1; position:relative; overflow:hidden; min-height:180px; }
  .card-poster img { width:100%; height:100%; object-fit:cover; }
  .card-poster-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:64px; background:#1a1a1a; }
  .card-type-badge { position:absolute; top:10px; left:10px; background:rgba(0,0,0,0.75); border:1px solid #333; padding:3px 8px; border-radius:10px; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#aaa; }
  .card-lang-badge { position:absolute; top:10px; right:10px; background:rgba(0,0,0,0.75); border:1px solid #555; padding:3px 8px; border-radius:10px; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#e8c96a; }
  .card-info { padding:12px 16px; }
  .card-title { font-family:'DM Serif Display',serif; font-size:20px; color:#f0ebe0; line-height:1.1; }
  .card-year { font-size:12px; color:#555; margin-top:2px; }
  .rating-area { padding:12px 24px 20px; }
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

  .home { min-height:100vh; min-height:100dvh; background:#0a0a0a; padding-bottom:80px; animation:fadeIn 0.5s ease; overflow-x:hidden; overflow-y:auto; min-width:0; }
  .home-topbar { display:none; }
  .home-desktop-nav-row { display:none; }
  .page-topbar { display:none; }
  .home-topnav { display:flex; gap:3px; padding:4px; background:#141414; border-radius:11px; border:1px solid #222; width:100%; max-width:620px; }
  .home-topnav .home-segment { flex:1; }
  .home-header { padding:48px 24px 16px; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start; column-gap:12px; }
  .home-hero-copy { padding:0; display:inline-block; max-width:100%; }
  .home-greeting { font-family:'DM Sans',sans-serif; font-size:52px; font-weight:600; color:#f0ebe0; margin-top:2px; line-height:1.02; letter-spacing:-0.6px; }
  .home-subtitle { font-family:'DM Sans',sans-serif; font-size:42px; font-weight:500; color:#e6e6e6; margin-top:8px; line-height:1.1; max-width:960px; letter-spacing:-0.4px; }
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
  .section-header { padding:0 24px; display:flex; justify-content:space-between; align-items:baseline; margin-bottom:12px; }
  .section-title { font-family:'DM Serif Display',serif; font-size:22px; color:#f0ebe0; }
  .section-meta { font-size:12px; color:#555; letter-spacing:1px; text-transform:uppercase; }
  .top-picks-block { margin-top:24px; }
  .top-picks-block:first-of-type { margin-top:0; }
  .top-picks-block .section-header { margin-bottom:10px; }
  .top-picks-block .section-title { font-size:22px; }

  .strip { padding-left:24px; padding-right:24px; display:flex; gap:14px; overflow-x:auto; overflow-y:hidden; scrollbar-width:none; -webkit-overflow-scrolling:touch; overscroll-behavior-x:contain; max-width:100%; min-width:0; scroll-padding-left:24px; }
  .strip::-webkit-scrollbar { display:none; }
  .strip-card { flex-shrink:0; width:152px; cursor:pointer; transition:transform 0.2s; }
  .strip-card:hover { transform:translateY(-3px); }
  .strip-poster { width:152px; height:212px; border-radius:12px; overflow:hidden; position:relative; border:1px solid #1e1e1e; background:#1a1a1a; }
  .strip-poster img { width:100%; height:100%; object-fit:cover; }
  .strip-poster-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:40px; }
  .strip-badge { position:absolute; bottom:6px; right:6px; background:rgba(0,0,0,0.82); padding:4px 8px; border-radius:10px; font-size:12px; color:#e8c96a; font-family:'DM Serif Display',serif; z-index:2; }
  .strip-title { font-size:14px; color:#ccc; margin-top:9px; line-height:1.35; }
  .strip-genre { font-size:11px; color:#555; margin-top:2px; }
  .strip-range { font-size:10px; color:#666; margin-top:1px; }

  .wl-card { flex-shrink:0; width:100px; cursor:pointer; transition:transform 0.2s; }
  .wl-card:hover { transform:translateY(-3px); }
  .wl-poster { width:100px; height:140px; border-radius:10px; overflow:hidden; position:relative; border:1px solid #1e1e1e; background:#1a1a1a; }
  .wl-poster img { width:100%; height:100%; object-fit:cover; }
  .empty-box { margin:0 24px; padding:24px; border:1px dashed #222; border-radius:10px; text-align:center; }
  .empty-text { font-size:13px; color:#444; }

  .bottom-nav { position:fixed; bottom:0; left:50%; transform:translateX(-50%); width:100%; max-width:var(--shell); box-sizing:border-box; background:rgba(10,10,10,0.95); border-top:1px solid #1a1a1a; display:flex; padding:12px 0 calc(20px + env(safe-area-inset-bottom,0px)); padding-left:env(safe-area-inset-left,0px); padding-right:env(safe-area-inset-right,0px); backdrop-filter:blur(20px); z-index:100; }
  .nav-item { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; cursor:pointer; opacity:0.4; transition:opacity 0.2s; }
  .nav-item.active { opacity:1; }
  .nav-icon { font-size:20px; }
  .nav-label { font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#e8c96a; }

  .discover { min-height:100vh; min-height:100dvh; background:#0a0a0a; padding-bottom:80px; animation:fadeIn 0.4s ease; overflow-x:hidden; overflow-y:auto; min-width:0; }
  .discover-header { padding:48px 24px 12px; }
  .discover-title { font-family:'DM Serif Display',serif; font-size:30px; color:#f0ebe0; }
  .search-box { position:relative; margin-top:12px; }
  .search-input { width:100%; background:#141414; border:1px solid #2a2a2a; border-radius:10px; padding:12px 16px 12px 42px; font-family:'DM Sans',sans-serif; font-size:14px; color:#f0ebe0; outline:none; transition:border-color 0.2s; }
  .search-input::placeholder { color:#444; }
  .search-input:focus { border-color:#555; }
  .search-icon { position:absolute; left:14px; top:50%; transform:translateY(-50%); font-size:16px; pointer-events:none; }
  .filter-row { display:flex; gap:8px; padding:10px 24px 14px; overflow-x:auto; overflow-y:hidden; scrollbar-width:none; -webkit-overflow-scrolling:touch; overscroll-behavior-x:contain; max-width:100%; min-width:0; }
  .filter-row::-webkit-scrollbar { display:none; }
  .filter-pill { flex-shrink:0; padding:7px 14px; border-radius:20px; font-size:12px; font-family:'DM Sans',sans-serif; cursor:pointer; border:1px solid #2a2a2a; background:transparent; color:#888; transition:all 0.2s; white-space:nowrap; }
  .filter-pill.active { background:#e8c96a; color:#0a0a0a; border-color:#e8c96a; font-weight:500; }
  .filter-pill:not(.active):hover { border-color:#555; color:#ccc; }
  .search-status { padding:8px 24px; font-size:12px; color:#666; }
  .disc-grid { padding:0 24px; display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .disc-card { cursor:pointer; transition:transform 0.2s; }
  .disc-card:hover { transform:translateY(-3px); }
  .disc-poster { width:100%; aspect-ratio:2/3; border-radius:12px; overflow:hidden; position:relative; border:1px solid #1e1e1e; background:#1a1a1a; }
  .disc-poster img { width:100%; height:100%; object-fit:cover; }
  .disc-poster-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:48px; }
  .disc-badge { position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.82); padding:4px 8px; border-radius:10px; font-size:11px; font-family:'DM Serif Display',serif; z-index:2; }
  .disc-type { position:absolute; top:8px; left:8px; background:rgba(0,0,0,0.75); border:1px solid #333; padding:2px 7px; border-radius:8px; font-size:9px; letter-spacing:1px; text-transform:uppercase; color:#aaa; }
  .disc-rated-badge { color:#88cc88; }
  .disc-pred-badge { color:#e8c96a; }
  .disc-unseen-badge { color:#555; font-size:10px; font-family:'DM Sans',sans-serif; }
  .disc-title { font-size:13px; color:#ccc; margin-top:8px; line-height:1.3; font-weight:500; }
  .disc-meta { font-size:11px; color:#555; margin-top:2px; }
  .disc-empty { padding:48px 24px; text-align:center; }
  .disc-empty-text { font-size:14px; color:#444; }

  .mood { min-height:100vh; min-height:100dvh; background:#0a0a0a; padding-bottom:80px; animation:fadeIn 0.4s ease; overflow-x:hidden; overflow-y:auto; min-width:0; }
  .mood-header { padding:52px 24px 20px; }
  .mood-back { background:none; border:none; color:#666; font-size:14px; cursor:pointer; font-family:'DM Sans',sans-serif; margin-bottom:16px; display:block; padding:0; }
  .mood-back:hover { color:#ccc; }
  .mood-step { font-size:11px; letter-spacing:3px; text-transform:uppercase; color:#e8c96a; margin-bottom:8px; }
  .mood-title { font-family:'DM Serif Display',serif; font-size:28px; color:#f0ebe0; line-height:1.2; }
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

  .mood-results { min-height:100vh; min-height:100dvh; background:#0a0a0a; padding-bottom:80px; animation:fadeIn 0.4s ease; overflow-x:hidden; overflow-y:auto; min-width:0; }
  .mood-results-back { background:none; border:none; color:#666; font-size:20px; cursor:pointer; padding:0; }
  .mood-results-title { font-family:'DM Serif Display',serif; font-size:26px; color:#f0ebe0; }
  .mood-result-card { margin:0 24px 16px; border-radius:16px; overflow:hidden; border:1px solid #1e1e1e; background:#141414; }
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

  .detail { min-height:100vh; min-height:100dvh; background:#0a0a0a; animation:fadeIn 0.3s ease; padding-bottom:80px; overflow-x:hidden; overflow-y:auto; min-width:0; position:relative; }
  .back-btn { position:fixed; top:calc(50px + env(safe-area-inset-top,0px)); left:max(10px, calc(50% - min(100%, var(--shell)) / 2 + 10px)); z-index:10; background:rgba(0,0,0,0.7); border:1px solid #333; color:#f0ebe0; padding:8px 14px; font-size:13px; cursor:pointer; border-radius:20px; backdrop-filter:blur(10px); max-width:calc(100% - 20px); }
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
  .d-pred-label { font-size:12px; color:#666; }
  .d-pred-sub { font-size:11px; color:#444; margin-top:3px; }
  .d-pred-val { font-family:'DM Serif Display',serif; font-size:38px; color:#e8c96a; line-height:1; text-align:right; }
  .d-pred-range { font-size:12px; color:#a89040; margin-top:2px; text-align:right; }
  .d-tmdb { font-size:11px; color:#555; margin-top:3px; text-align:right; }
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

  .profile { min-height:100vh; min-height:100dvh; background:#0a0a0a; padding-bottom:80px; animation:fadeIn 0.4s ease; overflow-x:hidden; overflow-y:auto; min-width:0; }
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
    .home-header { padding-left:20px; padding-right:20px; }
    .home-hero-copy { padding:0; }
    .home-greeting { font-size:40px; letter-spacing:-0.4px; }
    .home-subtitle { font-size:24px; max-width:none; line-height:1.14; }
    .strip { padding-left:20px; padding-right:20px; scroll-padding-left:20px; }
    .strip-card { width:144px; }
    .strip-poster { width:144px; height:200px; }
    .section-header { padding-left:20px; padding-right:20px; }
    .home-segments { margin-left:20px; margin-right:20px; }
    .discover-header { padding-left:20px; padding-right:20px; }
    .filter-row { padding-left:20px; padding-right:20px; }
    .disc-grid { padding-left:20px; padding-right:20px; }
  }

  /* Desktop/tablet: let app breathe beyond the mobile shell while keeping phone UX unchanged. */
  @media (min-width: 900px) {
    .app { --shell:1120px; }
    .app-brand.brand-logo--header { width:320px; }
    .home-topbar { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:20px; padding:14px 32px; border-bottom:1px solid #1a1a1a; }
    .home-topbar .app-brand { margin:0; }
    .home-topbar .avatar-wrap { justify-self:end; align-self:center; }
    .page-topbar { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:20px; padding:14px 32px; border-bottom:1px solid #1a1a1a; }
    .page-topbar .app-brand { margin:0; }
    .page-topbar .avatar-wrap { justify-self:end; align-self:center; }
    .home-desktop-nav-row { display:flex; justify-content:center; padding:8px 32px 8px; }
    .home .section-divider { margin:0 32px 10px !important; }
    .home-desktop-nav-row .home-topnav { max-width:620px; }
    .home-header { padding:18px 32px 10px; display:block; }
    .home-header .app-brand,
    .home-header .avatar-wrap { display:none; }
    .home-greeting { font-size:56px; }
    .home-subtitle { font-size:36px; max-width:none; white-space:nowrap; }
    .discover-header,
    .mood-header { padding-left:32px; padding-right:32px; }
    .discover-header .app-brand,
    .mood-header .app-brand,
    .profile-brand { display:none; }
    .home-segments { display:none; }
    .section-header { padding:0 32px; }
    .strip { padding-left:32px; padding-right:32px; gap:18px; }
    .strip-card { width:184px; }
    .strip-poster { width:184px; height:256px; }
    .strip-title { font-size:15px; line-height:1.32; }
    .strip-genre { font-size:12px; }
    .filter-row { padding-left:32px; padding-right:32px; }
    .disc-grid { padding:0 32px; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:16px; }
    .profile-brand,
    .profile-top,
    .profile-settings,
    .profile-section,
    .rated-search-wrap,
    .mood-results-brand,
    .mood-results-header { padding-left:32px; padding-right:32px; }
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
  }

  @keyframes fadeIn { from{opacity:0} to{opacity:1} }
  @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spin { to{transform:rotate(360deg)} }
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
function AppBrand({ variant = "header" }) {
  const splash = variant === "splash";
  return (
    <img
      className={`app-brand brand-logo ${splash ? "brand-logo--splash" : "brand-logo--header"}`}
      src="/cinemastro-logo.svg"
      alt="Cinemastro"
      decoding="async"
    />
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
  const [authLoading, setAuthLoading] = useState(false);
  const [catalogue, setCatalogue] = useState([]);
  const [matchData, setMatchData] = useState(null);
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
  const [ratedSearchQuery, setRatedSearchQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [moodStep, setMoodStep] = useState(0);
  const [moodSelections, setMoodSelections] = useState({ region: [], indian_lang: [], genre: [], vibe: [] });
  const [moodResults, setMoodResults] = useState([]);
  const [topPickOffset, setTopPickOffset] = useState(0);
  const [inTheaters, setInTheaters] = useState([]);
  const [streamingMovies, setStreamingMovies] = useState([]);
  const [streamingTV, setStreamingTV] = useState([]);
  const [streamingTab, setStreamingTab] = useState("movie"); // "movie" | "tv"
  const [selectedStreamingProviderIds, setSelectedStreamingProviderIds] = useState([]);
  const [homeSegment, setHomeSegment] = useState("picks"); // "picks" | "more" | "friends"
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  /** TMDB genre ids to include (Settings). Empty = all genres. Logged-out users ignore. */
  const [showGenreIds, setShowGenreIds] = useState([]);
  /** Region buckets to include (Settings). Empty = all regions. Logged-out users ignore. */
  const [showRegionKeys, setShowRegionKeys] = useState([]);

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
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUser(session.user); setScreen("loading-catalogue"); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [data, theaters] = await Promise.all([fetchCatalogue(), fetchInTheaters([])]);
        if (cancelled) return;
        const seen = new Set(data.map(m => m.id));
        const addedTheaters = theaters.filter(m => !seen.has(m.id));
        const merged = [...data, ...addedTheaters];
        setCatalogue(merged);
        setObCatalogue(data);
        setInTheaters(theaters);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
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

  /** Home streaming strip: TMDB discover with optional with_watch_providers (OR). No selection = all flatrate US. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const ids = selectedStreamingProviderIds.length > 0 ? selectedStreamingProviderIds : null;
        const { movies: sm, shows: st } = await fetchStreamingSplit(ids, showRegionKeys);
        if (cancelled) return;
        setStreamingMovies(sm);
        setStreamingTV(st);
        setCatalogue(prev => {
          const combined = [...sm, ...st];
          const seen = new Set(prev.map(m => m.id));
          const added = combined.filter(m => !seen.has(m.id));
          if (added.length === 0) return prev;
          return [...prev, ...added];
        });
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, [user, selectedStreamingProviderIds, showRegionKeys]);

  const catalogueForRecs = useMemo(() => {
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return catalogue;
    return catalogue.filter(m => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [catalogue, user, showGenreIds, showRegionKeys]);

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

  /** Collaborative filtering runs in Edge Function `match` (neighbour ratings loaded server-side; not in the client bundle). */
  useEffect(() => {
    if (!user) {
      setMatchData(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("match", {
          body: {
            action: "full",
            userRatings,
            catalogue: catalogueForRecs,
            inTheaters: inTheatersForRecs,
            streamingMovies: streamingMoviesForRecs,
            streamingTV: streamingTVForRecs,
            topPickOffset,
          },
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
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [user, userRatings, catalogueForRecs, inTheatersForRecs, streamingMoviesForRecs, streamingTVForRecs, topPickOffset]);

  useEffect(() => {
    if (screen === "loading-catalogue" && catalogue.length > 0 && user) {
      loadUserData().then(() => { setScreen("home"); setNavTab("home"); });
    }
  }, [screen, catalogue, user]);

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

  async function loadUserData() {
    if (!user) return;
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

    const { data: profileRow } = await supabase.from("profiles").select("streaming_provider_ids, show_genre_ids, show_region_keys").eq("id", user.id).maybeSingle();
    let providerIds = [];
    if (Array.isArray(profileRow?.streaming_provider_ids) && profileRow.streaming_provider_ids.length) {
      providerIds = profileRow.streaming_provider_ids;
    } else {
      try {
        const raw = localStorage.getItem(`cinematch_streaming_providers_${user.id}`);
        if (raw) providerIds = JSON.parse(raw);
      } catch (_) { /* ignore */ }
    }
    setSelectedStreamingProviderIds(Array.isArray(providerIds) ? providerIds.filter(n => typeof n === "number") : []);
    if (Array.isArray(profileRow?.show_genre_ids) && profileRow.show_genre_ids.length) {
      setShowGenreIds(profileRow.show_genre_ids.filter(n => typeof n === "number"));
    } else {
      try {
        const raw = localStorage.getItem(`cinematch_show_genres_${user.id}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          setShowGenreIds(Array.isArray(parsed) ? parsed.filter(n => typeof n === "number") : []);
        } else {
          setShowGenreIds([]);
        }
      } catch (_) {
        setShowGenreIds([]);
      }
    }
    if (Array.isArray(profileRow?.show_region_keys) && profileRow.show_region_keys.length) {
      const allowed = new Set(PROFILE_REGION_OPTIONS.map(o => o.id));
      setShowRegionKeys(profileRow.show_region_keys.filter(k => typeof k === "string" && allowed.has(k)));
    } else {
      try {
        const raw = localStorage.getItem(`cinematch_show_regions_${user.id}`);
        const allowed = new Set(PROFILE_REGION_OPTIONS.map(o => o.id));
        if (raw) {
          const parsed = JSON.parse(raw);
          setShowRegionKeys(Array.isArray(parsed) ? parsed.filter(k => typeof k === "string" && allowed.has(k)) : []);
        } else {
          setShowRegionKeys([]);
        }
      } catch (_) {
        setShowRegionKeys([]);
      }
    }
  }

  async function persistStreamingProviders(ids) {
    if (!user) return;
    const clean = [...new Set(ids.filter(n => typeof n === "number"))].sort((a, b) => a - b);
    setSelectedStreamingProviderIds(clean);
    try {
      localStorage.setItem(`cinematch_streaming_providers_${user.id}`, JSON.stringify(clean));
    } catch (_) { /* ignore */ }
    const { error } = await supabase.from("profiles").upsert(
      { id: user.id, streaming_provider_ids: clean },
      { onConflict: "id" },
    );
    if (error) console.warn("Could not save streaming providers to profile:", error.message);
  }

  async function persistShowGenreIds(ids) {
    if (!user) return;
    const clean = [...new Set(ids.filter(n => typeof n === "number"))].sort((a, b) => a - b);
    setShowGenreIds(clean);
    try {
      localStorage.setItem(`cinematch_show_genres_${user.id}`, JSON.stringify(clean));
    } catch (_) { /* ignore */ }
    const { error } = await supabase.from("profiles").upsert(
      { id: user.id, show_genre_ids: clean },
      { onConflict: "id" },
    );
    if (error) console.warn("Could not save genre preferences:", error.message);
  }

  async function persistShowRegionKeys(keys) {
    if (!user) return;
    const allowed = new Set(PROFILE_REGION_OPTIONS.map(o => o.id));
    const clean = [...new Set(keys.filter(k => typeof k === "string" && allowed.has(k)))].sort();
    setShowRegionKeys(clean);
    try {
      localStorage.setItem(`cinematch_show_regions_${user.id}`, JSON.stringify(clean));
    } catch (_) { /* ignore */ }
    const { error } = await supabase.from("profiles").upsert(
      { id: user.id, show_region_keys: clean },
      { onConflict: "id" },
    );
    if (error) console.warn("Could not save region preferences:", error.message);
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
    const { data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { data: { name: authName } } });
    setAuthLoading(false);
    if (error) { setAuthError(error.message); return; }
    if (data.user) {
      await supabase.from("profiles").update({ name: authName }).eq("id", data.user.id);
      setUser(data.user);
      setScreen("pref-primary"); // Go to cinema preference screen first
    }
  }

  async function handleSignIn() {
    setAuthError(""); setAuthLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setAuthLoading(false);
    if (error) { setAuthError(error.message); return; }
    if (data.user) { setUser(data.user); setScreen("loading-catalogue"); }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setUser(null); setUserRatings({}); setWatchlist([]);
    setMatchData(null);
    setSelectedStreamingProviderIds([]);
    setShowGenreIds([]);
    setShowRegionKeys([]);
    setStreamingMovies([]);
    setStreamingTV([]);
    setCinemaPreference(null); setOtherCinema(null);
    setScreen("splash"); setNavTab("home");
  }

  // Handle cinema preference confirmation
  async function confirmPrimaryPreference() {
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
    if (searchQuery.length < 2) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const normalize = (item, type) => ({
          id: `${type}-${item.id}`, tmdbId: item.id, type,
          title: item.title || item.name,
          year: (item.release_date || item.first_air_date || "").slice(0, 4),
          synopsis: item.overview || "",
          poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
          backdrop: item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : null,
          tmdbRating: Math.round(item.vote_average * 10) / 10,
          genreIds: item.genre_ids || [],
          language: item.original_language || "en",
        });
        const filterType = activeFilter === "Movies" ? "movie" : activeFilter === "TV Shows" ? "tv" : null;
        const searches = filterType
          ? [fetchTMDB(`/search/${filterType}?query=${encodeURIComponent(searchQuery)}&page=1`)]
          : [fetchTMDB(`/search/movie?query=${encodeURIComponent(searchQuery)}&page=1`), fetchTMDB(`/search/tv?query=${encodeURIComponent(searchQuery)}&page=1`)];
        const results = await Promise.all(searches);
        const combined = filterType
          ? (results[0].results || []).slice(0, 20).map(m => normalize(m, filterType))
          : [...(results[0].results || []).slice(0, 10).map(m => normalize(m, "movie")), ...(results[1].results || []).slice(0, 10).map(m => normalize(m, "tv"))];
        setSearchResults(combined);
      } catch (e) { console.error(e); }
      finally { setSearching(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, activeFilter]);

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

  const recommendations = matchData?.recommendations ?? [];

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

  const worthALookRecs = matchData?.worthALookRecs ?? [];

  const morePicks = useMemo(() => {
    const recs = recommendations;
    if (recs.length === 0) return [];
    const n = recs.length;
    const start = topPickOffset % n;
    const out = [];
    for (let i = 0; i < Math.min(9, n); i++) out.push(recs[(start + i) % n]);
    return out;
  }, [recommendations, topPickOffset]);

  /** Unrated catalogue titles sorted by TMDB popularity (for two-strip More tab when CF/match is thin). */
  const unratedPopularRecs = useMemo(() => {
    const seen = new Set(Object.keys(userRatings));
    const byPop = (a, b) => (b.popularity || 0) - (a.popularity || 0);
    return catalogueForRecs.filter(m => !seen.has(m.id)).sort(byPop).map(m => tmdbOnlyRec(m));
  }, [userRatings, catalogueForRecs]);

  /** Strip 1: personalised rotation when we have CF recs; otherwise first popularity chunk (same heading as before). */
  const moreForYouStrip = useMemo(() => {
    if (morePicks.length > 0) return morePicks;
    return unratedPopularRecs.slice(0, 9);
  }, [morePicks, unratedPopularRecs]);

  const moreForYouIds = useMemo(() => new Set(moreForYouStrip.map(r => r.movie.id)), [moreForYouStrip]);

  /** Strip 2: server “Worth a Look” minus overlap with strip 1; else next popularity chunk — keeps two rows like the original layout. */
  const worthLookStrip = useMemo(() => {
    const fromServer = worthALookRecs.filter(r => !moreForYouIds.has(r.movie.id));
    if (fromServer.length > 0) return fromServer.slice(0, 9);
    return unratedPopularRecs.filter(r => !moreForYouIds.has(r.movie.id)).slice(0, 9);
  }, [worthALookRecs, unratedPopularRecs, moreForYouIds]);

  const recMap = useMemo(() => ({
    ...Object.fromEntries(worthALookRecs.map(r => [r.movie.id, r])),
    ...Object.fromEntries(streamingMovieRecsResolved.map(r => [r.movie.id, r])),
    ...Object.fromEntries(streamingTvRecsResolved.map(r => [r.movie.id, r])),
    ...Object.fromEntries(theaterRecs.map(r => [r.movie.id, r])),
    ...Object.fromEntries(moreForYouStrip.map(r => [r.movie.id, r])),
    ...Object.fromEntries(worthLookStrip.map(r => [r.movie.id, r])),
    ...Object.fromEntries(recommendations.map(r => [r.movie.id, r])),
  }), [worthALookRecs, streamingMovieRecsResolved, streamingTvRecsResolved, theaterRecs, moreForYouStrip, worthLookStrip, recommendations]);
  const FILTERS = ["All", "Movies", "TV Shows"];

  const discoverItems = useMemo(() => {
    let base;
    if (searchQuery.length >= 2) base = searchResults;
    else base = catalogue.filter(m => activeFilter === "All" ? true : activeFilter === "Movies" ? m.type === "movie" : m.type === "tv");
    if (!user || (!showGenreIds.length && !showRegionKeys.length)) return base;
    return base.filter(m => passesProfileFilters(m, showGenreIds, showRegionKeys));
  }, [catalogue, searchQuery, searchResults, activeFilter, user, showGenreIds, showRegionKeys]);

  async function addRating(movieId, score) {
    setUserRatings(prev => ({ ...prev, [movieId]: score }));
    setWatchlist(prev => prev.filter(m => m.id !== movieId));
    setSelectedToWatch(prev => { const n = { ...prev }; delete n[movieId]; return n; });
    if (user) {
      const [type, tmdbId] = movieId.split("-");
      await supabase.from("ratings").upsert({ user_id: user.id, tmdb_id: parseInt(tmdbId), media_type: type, score }, { onConflict: "user_id,tmdb_id,media_type" });
      await supabase.from("watchlist").delete().eq("user_id", user.id).eq("tmdb_id", parseInt(tmdbId)).eq("media_type", type);
    }
  }

  function advanceOb() {
    setSliderVal(7); setSliderTouched(false);
    if (obStep < obMovies.length - 1) {
      setObStep(s => s + 1);
    } else {
      if (screen === "rate-more") { setNavTab("home"); setScreen("home"); }
      else { setScreen("loading-recs"); setTimeout(() => { setNavTab("home"); setScreen("home"); }, 2200); }
    }
  }

  function confirmRating() {
    if (obMovies[obStep]) addRating(obMovies[obStep].id, sliderVal);
    advanceOb();
  }

  async function openDetail(movie, prediction, opts = {}) {
    let pred = prediction;
    if (!pred && user && Object.keys(userRatings).length > 0) {
      try {
        const { data, error } = await supabase.functions.invoke("match", {
          body: { action: "predict", userRatings, catalogue, movieId: movie.id },
        });
        if (!error && data?.prediction) pred = data.prediction;
      } catch (_) { /* optional prediction */ }
    }
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
    setDetailEditRating(false);
    setScreen(navTab === "mood" ? "mood-results" : navTab);
  }

  useEffect(() => {
    if (!showAvatarMenu) return;
    const close = () => setShowAvatarMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showAvatarMenu]);

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
    if (vibe.includes("acclaimed")) params.set("vote_average.gte", "7.5");
    if (vibe.includes("very_recent")) params.set("primary_release_date.gte", `${currentYear - 1}-01-01`);
    if (vibe.includes("recent")) params.set("primary_release_date.gte", `${currentYear - 3}-01-01`);
    if (vibe.includes("classic")) params.set("primary_release_date.lte", "2000-12-31");
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
      } else {
        const tvParams = tmdbTvParamsFromMovieParams(params);
        const [movieData, tvData] = await Promise.all([
          fetchTMDB(`/discover/movie?${params.toString()}`),
          fetchTMDB(`/discover/tv?${tvParams.toString()}`),
        ]);
        allMovieResults = (movieData.results || []).slice(0, 10);
        allTVResults = (tvData.results || []).slice(0, 10);
      }
      const normalize = (item, type) => ({
        id: `${type}-${item.id}`, tmdbId: item.id, type,
        title: item.title || item.name,
        year: (item.release_date || item.first_air_date || "").slice(0, 4),
        synopsis: item.overview || "",
        poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `${TMDB_IMG_BACKDROP}${item.backdrop_path}` : null,
        tmdbRating: Math.round((item.vote_average || 0) * 10) / 10 || 7,
        genreIds: item.genre_ids || [],
        language: item.original_language || "en",
        popularity: item.popularity,
      });
      let combined = [
        ...allMovieResults.slice(0, 10).map(m => normalize(m, "movie")),
        ...allTVResults.slice(0, 10).map(m => normalize(m, "tv")),
      ];
      if (combined.length === 0) {
        const [mFb, tFb] = await Promise.all([
          fetchTMDB("/discover/movie?language=en-US&page=1&sort_by=popularity.desc"),
          fetchTMDB("/discover/tv?language=en-US&page=1&sort_by=popularity.desc"),
        ]);
        combined = [
          ...(mFb.results || []).slice(0, 8).map(m => normalize(m, "movie")),
          ...(tFb.results || []).slice(0, 8).map(m => normalize(m, "tv")),
        ];
      }
      function scoreMoodFromTmdb() {
        const seen = new Set(Object.keys(userRatings));
        let pool = combined.filter(m => !seen.has(m.id));
        if (pool.length === 0) pool = combined.slice();
        return pool
          .map(m => ({
            movie: m,
            predicted: m.tmdbRating,
            low: Math.max(1, m.tmdbRating - 1),
            high: Math.min(10, m.tmdbRating + 1),
            confidence: "low",
            neighborCount: 0,
          }))
          .sort((a, b) => b.predicted - a.predicted)
          .slice(0, 5);
      }
      let scored = [];
      if (user) {
        const { data, error } = await supabase.functions.invoke("match", {
          body: { action: "mood", userRatings, catalogue, movies: combined },
        });
        if (!error && data?.scored?.length) scored = data.scored;
        else {
          if (error) console.warn("mood match function:", error.message);
          scored = scoreMoodFromTmdb();
        }
      } else {
        scored = scoreMoodFromTmdb();
      }
      setMoodResults(scored);
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

  const navProps = { navTab, setNavTab, setScreen, setMoodStep, setMoodSelections, setMoodResults, showGenreIds };

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
          <div className="auth-title">{authMode === "signup" ? "Create account" : "Welcome back"}</div>
          <div className="auth-sub">{authMode === "signup" ? "Join Cinemastro to get personalised picks" : "Sign in to your Cinemastro account"}</div>
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
            <label className="auth-label">Password</label>
            <input className="auth-input" type="password" placeholder="Min. 6 characters" value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
          </div>
          <button className="auth-btn" disabled={authLoading} onClick={authMode === "signup" ? handleSignUp : handleSignIn}>
            {authLoading ? "Please wait…" : authMode === "signup" ? "Create Account" : "Sign In"}
          </button>
          <div className="auth-switch">
            {authMode === "signup"
              ? <>Already have an account? <span onClick={() => { setAuthMode("signin"); setAuthError(""); }}>Sign in</span></>
              : <>New to Cinemastro? <span onClick={() => { setAuthMode("signup"); setAuthError(""); }}>Create account</span></>}
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
          <button className="pref-btn" disabled={!cinemaPreference} onClick={confirmPrimaryPreference}>
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
      {screen === "onboarding" && obMovie && (
        <div className="onboarding">
          <div className="ob-header">
            <AppBrand />
            <div className="ob-step">Step {obStep + 1} of {obMovies.length}</div>
            <div className="ob-title">Rate what you've seen</div>
            <div className="ob-subtitle">We'll find your taste matches</div>
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
          <div className="loading-title">Finding your matches</div>
          <div className="loading-sub">Running taste analysis…</div>
        </div>
      )}

      {/* HOME */}
      {screen === "home" && (
        <div className="home">
          <div className="home-topbar">
            <AppBrand />
            <div />
            <AccountAvatarMenu />
          </div>
          <div className="home-header">
            <div className="home-hero">
              <AppBrand />
              <div className="home-hero-copy">
                <div className="home-greeting">Welcome.</div>
                <div className="home-subtitle">Movies and TV shows curated and picked for YOU!</div>
              </div>
            </div>
            <AccountAvatarMenu />
          </div>
          <div className="section-divider" style={{ margin: "0 24px 10px", borderTop: "1px solid #1a1a1a" }} />
          <div className="home-desktop-nav-row">
            <div className="home-topnav" role="tablist" aria-label="Home sections desktop">
              {[
                ["picks", "Picks"],
                ["more", "More"],
                ["friends", "Friends"],
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
          <div className="home-segments" role="tablist" aria-label="Home sections">
            {[
              ["picks", "Picks"],
              ["more", "More"],
              ["friends", "Friends"],
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

          {homeSegment === "picks" && (
            <div className="section">
              {theaterRecs.length === 0 && streamingRecs.length === 0 ? (
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
                                {userRatings[rec.movie.id] ? `★ ${userRatings[rec.movie.id]}` : rec.predicted}
                              </div>
                            </div>
                            <div className="strip-title">{rec.movie.title}</div>
                            <div className="strip-genre">Movie · {rec.movie.year || "—"}</div>
                            <div className="strip-range">{rec.low}–{rec.high}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="top-picks-block">
                    <div className="section-header">
                      <div className="section-title">Streaming</div>
                      <div className="section-meta">Subscription</div>
                    </div>
                    <div className="filter-row" style={{ paddingTop: 0, paddingBottom: 4 }}>
                      <button type="button" className={`filter-pill ${streamingTab === "movie" ? "active" : ""}`} onClick={() => setStreamingTab("movie")}>
                        Movies
                      </button>
                      <button type="button" className={`filter-pill ${streamingTab === "tv" ? "active" : ""}`} onClick={() => setStreamingTab("tv")}>
                        Series
                      </button>
                    </div>
                    {streamingRecs.length === 0 ? (
                      <div className="empty-box"><div className="empty-text">No streaming {streamingTab === "movie" ? "movies" : "series"} right now</div></div>
                    ) : (
                      <div className="strip">
                        {streamingRecs.map(rec => (
                          <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                            <div className="strip-poster">
                              {rec.movie.poster ? <img src={rec.movie.poster} alt={rec.movie.title} /> : <div className="strip-poster-fallback">🎬</div>}
                              <div className="strip-badge" style={{ color: userRatings[rec.movie.id] ? "#88cc88" : "#e8c96a" }}>
                                {userRatings[rec.movie.id] ? `★ ${userRatings[rec.movie.id]}` : rec.predicted}
                              </div>
                            </div>
                            <div className="strip-title">{rec.movie.title}</div>
                            <div className="strip-genre">{rec.movie.type === "movie" ? "Movie" : "TV"} · {rec.movie.year || "—"}</div>
                            <div className="strip-range">{rec.low}–{rec.high}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              {Object.keys(userRatings).length === 0 && theaterRecs.length + streamingRecs.length > 0 && (
                <div className="no-recs" style={{ marginTop: 16, border: "none", padding: "12px 0 0" }}>
                  <div className="no-recs-text" style={{ fontSize: 12 }}>Rate a few titles for tighter predictions</div>
                  <button className="btn-confirm" style={{ marginTop: 12, width: "100%" }} onClick={() => setScreen("rate-more")}>Rate More Titles</button>
                </div>
              )}
            </div>
          )}

          {homeSegment === "more" && (
            <>
              {moreForYouStrip.length > 0 && (
                <div className="section">
                  <div className="section-header">
                    <div className="section-title">🔥 More For You</div>
                    <div
                      className="section-meta"
                      style={{ cursor: morePicks.length > 0 ? "pointer" : undefined }}
                      onClick={() => morePicks.length > 0 && setTopPickOffset(p => p + 3)}
                    >
                      {morePicks.length > 0 ? "↻ Refresh" : "Popular — rate for personal picks"}
                    </div>
                  </div>
                  <div className="strip">
                    {moreForYouStrip.map(rec => (
                      <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                        <div className="strip-poster">
                          {rec.movie.poster ? <img src={rec.movie.poster} alt={rec.movie.title} /> : <div className="strip-poster-fallback">🎬</div>}
                          <div className="strip-badge" style={{ color: userRatings[rec.movie.id] ? "#88cc88" : "#e8c96a" }}>
                            {userRatings[rec.movie.id] ? `★ ${userRatings[rec.movie.id]}` : rec.predicted}
                          </div>
                        </div>
                        <div className="strip-title">{rec.movie.title}</div>
                        <div className="strip-genre">{rec.movie.type === "movie" ? "Movie" : "TV"} · {rec.movie.year}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {worthLookStrip.length > 0 && (
                <div className="section">
                  <div className="section-header">
                    <div className="section-title">✨ Worth a Look</div>
                    <div className="section-meta">
                      {worthALookRecs.length > 0 ? "Popular picks" : "More popular titles"}
                    </div>
                  </div>
                  <div className="strip">
                    {worthLookStrip.map(rec => (
                      <div className="strip-card" key={rec.movie.id} onClick={() => openDetail(rec.movie, rec)}>
                        <div className="strip-poster">
                          {rec.movie.poster ? <img src={rec.movie.poster} alt={rec.movie.title} /> : <div className="strip-poster-fallback">🎬</div>}
                          <div className="strip-badge" style={{ color: userRatings[rec.movie.id] ? "#88cc88" : "#e8c96a" }}>
                            {userRatings[rec.movie.id] ? `★ ${userRatings[rec.movie.id]}` : rec.predicted}
                          </div>
                        </div>
                        <div className="strip-title">{rec.movie.title}</div>
                        <div className="strip-genre">{rec.movie.type === "movie" ? "Movie" : "TV"} · {rec.movie.year}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {moreForYouStrip.length === 0 && worthLookStrip.length === 0 && (
                <div className="section">
                  <div className="no-recs">
                    <div className="no-recs-text">Rate more titles to unlock recommendations<br />and discovery picks.</div>
                    <button className="btn-confirm" style={{ marginTop: 16, width: "100%" }} onClick={() => setScreen("rate-more")}>Rate More Titles</button>
                  </div>
                </div>
              )}
            </>
          )}

          {homeSegment === "friends" && (
            <div className="friends-placeholder">
              <div className="friends-placeholder-title">Friends</div>
              <p className="friends-placeholder-text">Groups, shared lists, and watching with people you know will show up here.</p>
              <p className="friends-placeholder-text" style={{ marginTop: 12, color: "#555" }}>Coming soon.</p>
            </div>
          )}

          <BottomNav {...navProps} />
        </div>
      )}

      {/* RATE MORE */}
      {screen === "rate-more" && obMovie && (
        <div className="onboarding">
          <div className="ob-header">
            <AppBrand />
            <div className="ob-step">Rating {obStep + 1}</div>
            <div className="ob-title">Rate more titles</div>
            <div className="ob-subtitle">Improve your recommendations</div>
          </div>
          <div className="card-area">
            <div className="movie-card" key={obStep}>
              <div className="card-poster">
                {obMovie.poster ? <img src={obMovie.poster} alt={obMovie.title} /> : <div className="card-poster-fallback">🎬</div>}
                <div className="card-type-badge">{obMovie.type === "movie" ? "Movie" : "TV Show"}</div>
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
              <button className="btn-confirm" onClick={() => { confirmRating(); setSliderVal(7); setSliderTouched(false); if (obStep >= obMovies.length - 1) { setNavTab("home"); setScreen("home"); } }} disabled={!sliderTouched}>Confirm Rating</button>
              <button className="btn-skip" onClick={() => { advanceOb(); if (obStep >= obMovies.length - 1) { setNavTab("home"); setScreen("home"); } }}>Skip</button>
            </div>
            <button className="btn-ghost" style={{ width: "100%", marginTop: 12 }} onClick={() => { setNavTab("home"); setScreen("home"); }}>Done for now</button>
          </div>
        </div>
      )}

      {/* DISCOVER */}
      {screen === "discover" && (
        <div className="discover">
          <div className="page-topbar">
            <AppBrand />
            <div />
            <AccountAvatarMenu />
          </div>
          <div className="discover-header">
            <AppBrand />
            <div className="discover-title">Discover</div>
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input className="search-input" type="text" placeholder="Search any movie or show…"
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
          </div>
          <div className="filter-row">
            {FILTERS.map(f => (
              <button key={f} className={`filter-pill ${activeFilter === f ? "active" : ""}`} onClick={() => setActiveFilter(f)}>{f}</button>
            ))}
          </div>
          {searching && <div className="search-status">Searching…</div>}
          {!searching && searchQuery.length >= 2 && (
            <div className="search-status">{discoverItems.length} result{discoverItems.length !== 1 ? "s" : ""} for "{searchQuery}"</div>
          )}
          {discoverItems.length === 0 && !searching ? (
            <div className="disc-empty"><div className="disc-empty-text">{searchQuery.length >= 2 ? `No results for "${searchQuery}"` : "No titles found"}</div></div>
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
                          : rec ? <span className="disc-pred-badge">{rec.predicted}</span>
                            : <span className="disc-unseen-badge">Unrated</span>}
                      </div>
                    </div>
                    <div className="disc-title">{m.title}</div>
                    <div className="disc-meta">{m.type === "movie" ? "Movie" : "TV"} · {m.year}</div>
                  </div>
                );
              })}
            </div>
          )}
          <BottomNav {...navProps} />
        </div>
      )}

      {/* MOOD PICKER */}
      {screen === "mood-picker" && currentMoodCard && (
        <div className="mood">
          <div className="page-topbar">
            <AppBrand />
            <div />
            <AccountAvatarMenu />
          </div>
          <div className="mood-header">
            <AppBrand />
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
          <BottomNav {...navProps} />
        </div>
      )}

      {/* MOOD RESULTS */}
      {screen === "mood-results" && (
        <div className="mood-results">
          <div className="mood-results-brand"><AppBrand /></div>
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
            moodResults.map(rec => (
              <div className="mood-result-card" key={rec.movie.id}>
                <div className="mood-result-poster">
                  {rec.movie.backdrop || rec.movie.poster
                    ? <img src={rec.movie.backdrop || rec.movie.poster} alt={rec.movie.title} />
                    : <div className="mood-result-poster-fallback">🎬</div>}
                  <div className="mood-result-overlay" />
                  <div className="mood-result-type">{rec.movie.type === "movie" ? "Movie" : "TV"}</div>
                  <div className="mood-result-badge">{rec.predicted}</div>
                </div>
                <div className="mood-result-info">
                  <div className="mood-result-title">{rec.movie.title}</div>
                  <div className="mood-result-meta">{rec.movie.year} · Predicted {rec.predicted} ({rec.low}–{rec.high})</div>
                  <div className="mood-result-synopsis">{(rec.movie.synopsis || "").slice(0, 100)}…</div>
                  <div className="mood-result-actions">
                    <button className={`btn-select-watch ${selectedToWatch[rec.movie.id] ? "selected" : ""}`}
                      onClick={() => selectToWatch(rec.movie.id)}>
                      {selectedToWatch[rec.movie.id] ? "✓ Selected to Watch" : "🎬 Select to Watch"}
                    </button>
                    <button className="btn-detail" onClick={() => openDetail(rec.movie, rec)}>Details</button>
                  </div>
                </div>
              </div>
            ))
          )}
          <BottomNav {...navProps} />
        </div>
      )}

      {/* RATED */}
      {screen === "rated" && (
        <div className="discover">
          <div className="discover-header">
            <AppBrand />
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
          <BottomNav {...navProps} />
        </div>
      )}

      {/* PROFILE */}
      {screen === "profile" && (
        <div className="profile">
          <div className="page-topbar">
            <AppBrand />
            <div />
            <AccountAvatarMenu />
          </div>
          <div className="profile-brand"><AppBrand /></div>
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
              <p className="settings-providers-hint">Recommendations and Discover use TMDB genres. A title appears if it has at least one of the genres you select. Leave none selected to show all genres — including animation.</p>
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
              <p className="settings-providers-hint">Recommendations and Discover can be narrowed by original language buckets like Hollywood, Indian, and Asian cinema. Leave none selected to show all regions.</p>
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
              <div className="profile-settings-label" style={{ marginTop: 20 }}>Email</div>
              <div className="profile-settings-email">{user?.email || "—"}</div>
            </div>
          </div>
          <BottomNav {...navProps} />
        </div>
      )}

      {/* DETAIL */}
      {screen === "detail" && selectedMovie && (() => {
        const { movie, prediction } = selectedMovie;
        const myRating = userRatings[movie.id];
        return (
          <div className="detail">
            <div className="detail-sticky-brand"><AppBrand /></div>
            <button className="back-btn" onClick={goBack}>← Back</button>
            <div className="d-poster">
              {movie.backdrop || movie.poster ? <img src={movie.backdrop || movie.poster} alt={movie.title} /> : <div className="d-poster-fallback">🎬</div>}
              <div className="d-overlay" />
            </div>
            <div className="d-body">
              <div className="d-type-genre">
                <span className="d-type-pill">{movie.type === "movie" ? "Movie" : "TV Show"}</span>
                {movie.year && <span className="d-genre-text">{movie.year}</span>}
              </div>
              <div className="d-title">{movie.title}</div>
              {prediction && (
                <div className="d-pred-box">
                  <div>
                    <div className="d-pred-label">Predicted rating for you</div>
                    <div className="d-pred-sub">Based on {prediction.neighborCount} taste {prediction.neighborCount === 1 ? "match" : "matches"}</div>
                    <span className={confClass(prediction.confidence)}>{confLabel(prediction.confidence)}</span>
                  </div>
                  <div>
                    <div className="d-pred-val">{prediction.predicted}</div>
                    <div className="d-pred-range">{prediction.low}–{prediction.high}</div>
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
              {myRating && !detailEditRating ? (
                <div className="rated-box" style={{ marginTop: 20 }}>
                  <div className="rated-score">{myRating}</div>
                  <div className="rated-label">Your rating saved ✓</div>
                  {prediction && <div className="rated-pred">Predicted was {prediction.predicted} ({prediction.low}–{prediction.high})</div>}
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
        );
      })()}
    </div>
  );
}