import { supabase } from "./supabase.js";

/**
 * Weekend home: Thursday 6:00pm local through Sunday.
 * The release list is Monday–Sunday of that same week, so Friday openings
 * are already on the page Thursday night.
 */

export const NEW_THIS_WEEK_THURSDAY_HOUR = 18;
const TALK_NEWS_GENRE_IDS = new Set([10763, 10767]);
/** TMDB Animation. Japanese animation is left off New this week; other animation stays. */
const ANIMATION_GENRE_ID = 16;
/** Same Indian languages as In Theaters. Where you watch India uses these, not the US list. */
const INDIA_LANGS = ["hi", "ta", "te", "ml", "kn", "bn", "mr", "pa", "gu", "or", "as", "ur"];
const INDIA_LANG_SET = new Set(INDIA_LANGS);
const ROW_CAP = 12;
const PIN_KEY = "cinemastro_new_this_week_feature";

function localIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True from Thursday 6:00pm through Sunday, in the device's local time. */
export function isNewThisWeekWindow(date = new Date()) {
  const day = date.getDay();
  if (day === 5 || day === 6 || day === 0) return true;
  return day === 4 && date.getHours() >= NEW_THIS_WEEK_THURSDAY_HOUR;
}

/** Where the app opens. Weekend → New this week. Monday–Wednesday → Circles. */
export function weekendHomeScreen(date = new Date()) {
  return isNewThisWeekWindow(date) ? "new-this-week" : "circles";
}

/** Thursday–Sunday of the weekend that contains `date`. Null outside the window. */
export function weekendEdition(date = new Date()) {
  if (!isNewThisWeekWindow(date)) return null;
  const day = date.getDay();
  const back = day === 4 ? 0 : day === 5 ? 1 : day === 6 ? 2 : 3;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - back);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 3);
  return { start, end, key: localIso(start) };
}

/** Monday through Sunday of the edition week. */
export function releaseWeekBounds(edition) {
  const monday = new Date(edition.start.getFullYear(), edition.start.getMonth(), edition.start.getDate() - 3);
  return { gte: localIso(monday), lte: localIso(edition.end) };
}

/**
 * India streaming dates often land just before the calendar week, so a Monday–Sunday
 * filter comes back empty. Look back 14 days from today, through this Sunday.
 */
export function indiaStreamingBounds(edition, date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 14);
  return { gte: localIso(start), lte: localIso(edition.end) };
}

export function formatWeekendRange(start, end) {
  const month = (d) => d.toLocaleDateString("en-US", { month: "short" });
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${month(start)} ${start.getDate()} – ${end.getDate()}`;
  }
  return `${month(start)} ${start.getDate()} – ${month(end)} ${end.getDate()}`;
}

export function weekdayName(iso) {
  if (!iso || iso.length < 10) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" });
}

/** "Opened Friday" / "Opens Friday" for theaters, "Started" / "Starts" for streaming. */
export function arrivalPhrase(iso, todayIso, row) {
  const day = weekdayName(iso);
  if (!day) return "";
  const future = iso > todayIso;
  if (row === "theater") return future ? `Opens ${day}` : `Opened ${day}`;
  return future ? `Starts ${day}` : `Started ${day}`;
}

function isTalkOrNews(item) {
  const ids = Array.isArray(item?.genre_ids) ? item.genre_ids : [];
  return ids.some((id) => TALK_NEWS_GENRE_IDS.has(Number(id)));
}

function isJapaneseAnimation(item) {
  const ids = Array.isArray(item?.genre_ids) ? item.genre_ids : [];
  const animation = ids.some((id) => Number(id) === ANIMATION_GENRE_ID);
  return animation && String(item?.original_language || "").toLowerCase() === "ja";
}

function toTitle(item, type, row, wide) {
  const date = String(item.release_date || item.first_air_date || "").slice(0, 10);
  const vote = Number(item.vote_average);
  const votes = Number(item.vote_count) || 0;
  return {
    id: `${type}-${item.id}`,
    tmdbId: item.id,
    type,
    row,
    wide: Boolean(wide),
    title: item.title || item.name || "",
    year: date.slice(0, 4),
    releaseDate: date.length === 10 ? date : "",
    genre: type === "tv" ? "TV Show" : "Movie",
    genreIds: Array.isArray(item.genre_ids) ? item.genre_ids.map(Number) : [],
    synopsis: String(item.overview || "").trim(),
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
    backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
    tmdbRating: Number.isFinite(vote) ? Math.round(vote * 10) / 10 : null,
    tmdbPercent: Number.isFinite(vote) && votes > 0 && vote > 0 ? Math.round(vote * 10) : null,
    popularity: Number(item.popularity) || 0,
    language: item.original_language || "en",
    originCountries: [],
    where: row === "theater" ? "In theaters" : "Streaming",
  };
}

function comparePopularity(a, b) {
  const pop = (b.popularity || 0) - (a.popularity || 0);
  if (pop) return pop;
  return String(a.id).localeCompare(String(b.id));
}

function compareReleaseDesc(a, b) {
  const da = a.releaseDate || "";
  const db = b.releaseDate || "";
  if (da !== db) return db < da ? -1 : 1;
  return String(a.title).localeCompare(String(b.title));
}

function indiaLanguageRank(language, languageFirst) {
  const lang = String(language || "").toLowerCase();
  const first = (languageFirst || []).map((code) => String(code).toLowerCase());
  const preferred = first.indexOf(lang);
  if (preferred !== -1) return preferred;
  const rest = INDIA_LANGS.indexOf(lang);
  return rest === -1 ? first.length + INDIA_LANGS.length : first.length + rest;
}

function compareIndiaRelease(languageFirst) {
  return (a, b) => {
    const rank = indiaLanguageRank(a.language, languageFirst) - indiaLanguageRank(b.language, languageFirst);
    if (rank) return rank;
    return compareReleaseDesc(a, b);
  };
}

/**
 * Feature for the weekend.
 * A circle-rated new release wins. If one was already pinned this weekend, it stays.
 * Otherwise the biggest streaming premiere, then the widest theatrical opening.
 * `circleScores` maps title id → { score, others }.
 */
/** Row under the feature. Keeps the incoming order and the popularity lead. */
export function displayRow(list, featureId, cap = 12) {
  const rest = (list || []).filter((title) => title.id !== featureId);
  const capped = rest.slice(0, cap);
  const lead = rest.find((title) => title.lead && !capped.some((row) => row.id === title.id));
  if (lead) capped.push(lead);
  return capped;
}

export function chooseFeature({ streaming, theaters, circleScores, pinnedId }) {
  const scores = circleScores instanceof Map ? circleScores : new Map();
  const all = [...(streaming || []), ...(theaters || [])];
  const byId = new Map(all.map((t) => [t.id, t]));
  const circleHits = all.filter((t) => (scores.get(t.id)?.others || 0) > 0);
  const pinned = pinnedId ? byId.get(pinnedId) : null;
  const pinnedIsCircle = pinned && (scores.get(pinned.id)?.others || 0) > 0;
  if (pinned && (pinnedIsCircle || circleHits.length === 0)) return pinned;
  if (circleHits.length) {
    return [...circleHits].sort((a, b) => {
      const sa = scores.get(a.id)?.score || 0;
      const sb = scores.get(b.id)?.score || 0;
      if (sb !== sa) return sb - sa;
      const oa = scores.get(a.id)?.others || 0;
      const ob = scores.get(b.id)?.others || 0;
      if (ob !== oa) return ob - oa;
      return comparePopularity(a, b);
    })[0];
  }
  if ((streaming || []).length) return [...streaming].sort(comparePopularity)[0];
  const wide = (theaters || []).filter((t) => t.wide);
  const pool = wide.length ? wide : (theaters || []);
  if (!pool.length) return null;
  return [...pool].sort(comparePopularity)[0];
}

export function readFeaturePin(editionKey, region, viewerKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(PIN_KEY) || "null");
    if (!raw || raw.editionKey !== editionKey || raw.region !== region || raw.viewerKey !== viewerKey) return null;
    return raw.id || null;
  } catch {
    return null;
  }
}

export function writeFeaturePin(editionKey, region, viewerKey, id) {
  if (!id) return;
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify({ editionKey, region, viewerKey, id }));
  } catch {
    /* ignore quota / private mode */
  }
}

async function discoverPages(fetchTmdb, path, pages = 2) {
  const out = [];
  for (let page = 1; page <= pages; page += 1) {
    let data;
    try {
      data = await fetchTmdb(`${path}&page=${page}`);
    } catch {
      break;
    }
    if (!data || data.success === false) break;
    const results = Array.isArray(data.results) ? data.results : [];
    out.push(...results);
    if (results.length < 1 || page >= (Number(data.total_pages) || 1)) break;
  }
  return out;
}

function collect(rawItems, type, row, wide, gte, lte) {
  const seen = new Set();
  const out = [];
  for (const item of rawItems) {
    if (item?.id == null || !item.poster_path || isTalkOrNews(item) || isJapaneseAnimation(item)) continue;
    const title = toTitle(item, type, row, wide);
    if (!title.title || !title.releaseDate) continue;
    if (title.releaseDate < gte || title.releaseDate > lte) continue;
    if (seen.has(title.id)) continue;
    seen.add(title.id);
    out.push(title);
  }
  return out;
}

async function attachStreamingServices(titles, region, services, fetchTmdb) {
  const known = new Map((services || []).map((s) => [Number(s.id), s.label]));
  await Promise.all(titles.map(async (title) => {
    const kind = title.type === "tv" ? "tv" : "movie";
    let data;
    try {
      data = await fetchTmdb(`/${kind}/${title.tmdbId}/watch/providers`);
    } catch {
      return;
    }
    const flat = data?.results?.[region]?.flatrate;
    if (!Array.isArray(flat) || flat.length === 0) return;
    const match = flat.find((p) => known.has(Number(p.provider_id)));
    const provider = match || flat[0];
    const name = match ? known.get(Number(match.provider_id)) : (provider?.provider_name || "");
    if (name) title.where = name;
    const logoPath = typeof provider?.logo_path === "string" ? provider.logo_path : "";
    if (logoPath.startsWith("/")) title.serviceLogo = `https://image.tmdb.org/t/p/w92${logoPath}`;
  }));
}

/**
 * Just arrived (streaming) and In theaters for one region.
 * Theatrical titles are left out of Just arrived.
 */
export async function loadNewThisWeekCatalog({
  region = "US",
  fetchTmdb,
  services = [],
  languageFirst = [],
  date = new Date(),
}) {
  const edition = weekendEdition(date);
  if (!edition || typeof fetchTmdb !== "function") {
    return { edition, streaming: [], theaters: [], todayIso: localIso(date) };
  }
  const market = region === "IN" || region === "CA" ? region : "US";
  const week = releaseWeekBounds(edition);
  const streamWindow = market === "IN" ? indiaStreamingBounds(edition, date) : week;
  const indiaOnly = market === "IN" ? `&with_original_language=${INDIA_LANGS.join("|")}` : "";
  const movieStream = `/discover/movie?language=en-US&sort_by=popularity.desc&region=${market}&watch_region=${market}&with_watch_monetization_types=flatrate&primary_release_date.gte=${streamWindow.gte}&primary_release_date.lte=${streamWindow.lte}${indiaOnly}`;
  const tvStream = `/discover/tv?language=en-US&sort_by=popularity.desc&watch_region=${market}&with_watch_monetization_types=flatrate&first_air_date.gte=${streamWindow.gte}&first_air_date.lte=${streamWindow.lte}${indiaOnly}`;
  const wide = `/discover/movie?language=en-US&sort_by=popularity.desc&region=${market}&with_release_type=3&primary_release_date.gte=${week.gte}&primary_release_date.lte=${week.lte}${indiaOnly}`;
  const limited = `/discover/movie?language=en-US&sort_by=popularity.desc&region=${market}&with_release_type=2&primary_release_date.gte=${week.gte}&primary_release_date.lte=${week.lte}${indiaOnly}`;
  const [movieRaw, tvRaw, wideRaw, limitedRaw] = await Promise.all([
    discoverPages(fetchTmdb, movieStream, 2),
    discoverPages(fetchTmdb, tvStream, 2),
    discoverPages(fetchTmdb, wide, 1),
    discoverPages(fetchTmdb, limited, 1),
  ]);
  const theaterIds = new Set();
  const theaters = [];
  for (const title of [
    ...collect(wideRaw, "movie", "theater", true, week.gte, week.lte),
    ...collect(limitedRaw, "movie", "theater", false, week.gte, week.lte),
  ]) {
    if (theaterIds.has(title.id)) continue;
    theaterIds.add(title.id);
    theaters.push(title);
  }
  const keepForMarket = (title) => market !== "IN" || INDIA_LANG_SET.has(String(title.language || "").toLowerCase());
  const streaming = [
    ...collect(movieRaw, "movie", "streaming", false, streamWindow.gte, streamWindow.lte),
    ...collect(tvRaw, "tv", "streaming", false, streamWindow.gte, streamWindow.lte),
  ].filter((title) => keepForMarket(title) && !theaterIds.has(title.id));
  for (const title of streaming) {
    title.inWeek = title.releaseDate >= week.gte && title.releaseDate <= week.lte;
  }
  theaters.splice(0, theaters.length, ...theaters.filter(keepForMarket));
  const byMarket = market === "IN" ? compareIndiaRelease(languageFirst) : compareReleaseDesc;
  streaming.sort(byMarket);
  theaters.sort(byMarket);
  const streamingLeader = [...streaming].sort(comparePopularity)[0];
  if (streamingLeader) streamingLeader.lead = true;
  const streamingRow = streaming.slice(0, ROW_CAP);
  if (streamingLeader && !streamingRow.some((title) => title.id === streamingLeader.id)) {
    streamingRow.push(streamingLeader);
  }
  const wideLeader = [...theaters.filter((title) => title.wide)].sort(comparePopularity)[0]
    || [...theaters].sort(comparePopularity)[0];
  if (wideLeader) wideLeader.lead = true;
  const theaterRow = theaters.slice(0, ROW_CAP);
  if (wideLeader && !theaterRow.some((title) => title.id === wideLeader.id)) {
    theaterRow.push(wideLeader);
  }
  streamingRow.sort(byMarket);
  theaterRow.sort(byMarket);
  await attachStreamingServices(streamingRow, market, services, fetchTmdb);
  return {
    edition,
    streaming: streamingRow,
    theaters: theaterRow,
    todayIso: localIso(date),
    region: market,
  };
}

/**
 * Paint shape for a saved or freshly built catalog.
 * India reorders by Languages to show first. The feature is the regional premiere, not a circle score.
 */
export function presentNewThisWeekCatalog(catalog, languageFirst = []) {
  const market = catalog?.region === "IN" || catalog?.region === "CA" ? catalog.region : "US";
  const byMarket = market === "IN" ? compareIndiaRelease(languageFirst) : compareReleaseDesc;
  const streaming = (catalog?.streaming || []).map((title) => ({ ...title, lead: false }));
  const theaters = (catalog?.theaters || []).map((title) => ({ ...title, lead: false }));
  streaming.sort(byMarket);
  theaters.sort(byMarket);
  const streamingLeader = [...streaming].sort(comparePopularity)[0];
  if (streamingLeader) streamingLeader.lead = true;
  const wideLeader = [...theaters.filter((title) => title.wide)].sort(comparePopularity)[0]
    || [...theaters].sort(comparePopularity)[0];
  if (wideLeader) wideLeader.lead = true;
  const feature = chooseFeature({
    streaming: streaming.filter((title) => title.inWeek !== false),
    theaters,
    circleScores: new Map(),
    pinnedId: null,
  });
  return {
    feature,
    streaming: displayRow(streaming, feature?.id),
    theaters: displayRow(theaters, feature?.id),
    todayIso: catalog?.todayIso || localIso(new Date()),
    region: market,
    edition: catalog?.edition || null,
  };
}

function weekendMarket(region) {
  return region === "IN" || region === "CA" ? region : "US";
}

/**
 * Shared weekend list for this region. The first open builds it; later opens read the saved row.
 * Returns null when the table or the function is not there yet, so the caller can build on the phone.
 */
export async function loadSharedNewThisWeekCatalog({ region, edition, date = new Date() }) {
  if (!edition?.key) return null;
  const market = weekendMarket(region);
  const week = releaseWeekBounds(edition);
  const streamWindow = market === "IN" ? indiaStreamingBounds(edition, date) : week;
  try {
    const { data, error } = await supabase
      .from("new_this_week_catalog")
      .select("streaming, theaters")
      .eq("edition_key", edition.key)
      .eq("region", market)
      .maybeSingle();
    if (!error && data && Array.isArray(data.streaming) && Array.isArray(data.theaters)) {
      return {
        edition,
        streaming: data.streaming,
        theaters: data.theaters,
        todayIso: localIso(date),
        region: market,
      };
    }
  } catch {
    /* table missing or offline — fall through */
  }
  try {
    const { data: inv, error: invErr } = await supabase.functions.invoke("new-this-week-catalog", {
      body: {
        region: market,
        edition_key: edition.key,
        week_gte: week.gte,
        week_lte: week.lte,
        stream_gte: streamWindow.gte,
        stream_lte: streamWindow.lte,
      },
    });
    if (!invErr && inv?.ok && Array.isArray(inv.streaming) && Array.isArray(inv.theaters)) {
      return {
        edition,
        streaming: inv.streaming,
        theaters: inv.theaters,
        todayIso: localIso(date),
        region: market,
      };
    }
  } catch {
    /* function not deployed */
  }
  return null;
}

/**
 * Published circle scores for titles someone else in the viewer's circles rated.
 * The viewer's own score alone does not count. Recent strip (newest first, 20)
 * is enough for a release from this week.
 * @returns {Promise<Map<string, { score: number, others: number }>>}
 */
export async function loadCircleScores() {
  const map = new Map();
  let fetchMyCircles;
  let fetchCircleRatedTitles;
  try {
    ({ fetchMyCircles, fetchCircleRatedTitles } = await import("./circles.js"));
  } catch {
    return map;
  }
  let circles = [];
  try {
    circles = (await fetchMyCircles()).filter((c) => c?.status === "active" && c?.id);
  } catch {
    return map;
  }
  const payloads = await Promise.all(circles.map(async (circle) => {
    try {
      return await fetchCircleRatedTitles({ circleId: circle.id, view: "recent", limit: 20 });
    } catch {
      return null;
    }
  }));
  for (const payload of payloads) {
    for (const row of payload?.titles || []) {
      const raters = Number(row?.distinct_circle_raters) || 0;
      const viewerRated = row?.viewer_score != null && row.viewer_score !== "";
      const others = raters - (viewerRated ? 1 : 0);
      if (others < 1 || row?.tmdb_id == null) continue;
      const id = `${row.media_type === "tv" ? "tv" : "movie"}-${row.tmdb_id}`;
      const score = Number(row.group_rating);
      if (!Number.isFinite(score)) continue;
      const prev = map.get(id);
      if (!prev || score > prev.score) map.set(id, { score, others });
    }
  }
  return map;
}
