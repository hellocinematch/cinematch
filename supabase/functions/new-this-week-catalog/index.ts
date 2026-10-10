import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ------------------------------------------------------------------------------------------------
// New this week — one shared list per weekend edition and region (US, IN, CA).
// First open builds it. Later opens read the row. Ratings are not stored.
// ------------------------------------------------------------------------------------------------

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EDGE_FUNCTION_SLUG = "new-this-week-catalog";
const EDGE_FUNCTION_VERSION = "1.0.0";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TALK_NEWS = new Set([10763, 10767]);
const ANIMATION_GENRE_ID = 16;
const INDIA_LANGS = ["hi", "ta", "te", "ml", "kn", "bn", "mr", "pa", "gu", "or", "as", "ur"];
const INDIA_LANG_SET = new Set(INDIA_LANGS);
const STORE_CAP = 36;

const SERVICES: Record<string, { id: number; label: string }[]> = {
  US: [
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
  ],
  IN: [
    { id: 8, label: "Netflix" },
    { id: 119, label: "Prime Video" },
    { id: 2336, label: "JioHotstar" },
    { id: 237, label: "Sony LIV" },
    { id: 232, label: "Zee5" },
    { id: 532, label: "Aha" },
    { id: 1898, label: "MX Player" },
    { id: 11, label: "Mubi" },
  ],
  CA: [
    { id: 8, label: "Netflix" },
    { id: 119, label: "Prime Video" },
    { id: 337, label: "Disney+" },
    { id: 350, label: "Apple TV+" },
    { id: 230, label: "Crave" },
    { id: 531, label: "Paramount+" },
    { id: 146, label: "ICI TOU.TV" },
  ],
};

type Market = "US" | "IN" | "CA";

type Title = {
  id: string;
  tmdbId: number;
  type: "movie" | "tv";
  row: "streaming" | "theater";
  wide: boolean;
  title: string;
  year: string;
  releaseDate: string;
  genre: string;
  genreIds: number[];
  synopsis: string;
  poster: string | null;
  backdrop: string | null;
  tmdbRating: number | null;
  tmdbPercent: number | null;
  popularity: number;
  language: string;
  originCountries: string[];
  where: string;
  inWeek?: boolean;
  lead?: boolean;
  serviceLogo?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  const payload =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), edge: { name: EDGE_FUNCTION_SLUG, version: EDGE_FUNCTION_VERSION } }
      : body;
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isoDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function daySpan(gte: string, lte: string): number {
  const a = Date.parse(`${gte}T00:00:00Z`);
  const b = Date.parse(`${lte}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.round((b - a) / 86400000);
}

function parseMarket(raw: unknown): Market {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return code === "IN" || code === "CA" ? code : "US";
}

async function fetchTMDB(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${TMDB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  return res.json();
}

async function discoverPages(token: string, path: string, pages: number): Promise<{ items: Record<string, unknown>[]; ok: boolean }> {
  const out: Record<string, unknown>[] = [];
  let ok = false;
  for (let page = 1; page <= pages; page += 1) {
    let data: unknown;
    try {
      data = await fetchTMDB(`${path}&page=${page}`, token);
    } catch {
      break;
    }
    if (!data || (typeof data === "object" && (data as { success?: boolean }).success === false)) break;
    ok = true;
    const results = Array.isArray((data as { results?: unknown }).results)
      ? (data as { results: Record<string, unknown>[] }).results
      : [];
    out.push(...results);
    const total = Number((data as { total_pages?: number }).total_pages) || 1;
    if (results.length < 1 || page >= total) break;
  }
  return { items: out, ok };
}

function isJapaneseAnimation(item: Record<string, unknown>): boolean {
  const ids = Array.isArray(item.genre_ids) ? item.genre_ids : [];
  const animation = ids.some((id) => Number(id) === ANIMATION_GENRE_ID);
  return animation && String(item.original_language || "").toLowerCase() === "ja";
}

function isTalkOrNews(item: Record<string, unknown>): boolean {
  const ids = Array.isArray(item.genre_ids) ? item.genre_ids : [];
  return ids.some((id) => TALK_NEWS.has(Number(id)));
}

function toTitle(item: Record<string, unknown>, type: "movie" | "tv", row: "streaming" | "theater", wide: boolean, gte: string, lte: string): Title | null {
  if (item.id == null || typeof item.poster_path !== "string" || !item.poster_path) return null;
  if (isTalkOrNews(item) || isJapaneseAnimation(item)) return null;
  const date = String(item.release_date || item.first_air_date || "").slice(0, 10);
  if (date.length !== 10 || date < gte || date > lte) return null;
  const name = String(item.title || item.name || "");
  if (!name) return null;
  const vote = Number(item.vote_average);
  const votes = Number(item.vote_count) || 0;
  return {
    id: `${type}-${item.id}`,
    tmdbId: Number(item.id),
    type,
    row,
    wide,
    title: name,
    year: date.slice(0, 4),
    releaseDate: date,
    genre: type === "tv" ? "TV Show" : "Movie",
    genreIds: Array.isArray(item.genre_ids) ? item.genre_ids.map((id) => Number(id)) : [],
    synopsis: String(item.overview || "").trim(),
    poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
    backdrop: typeof item.backdrop_path === "string" && item.backdrop_path
      ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}`
      : null,
    tmdbRating: Number.isFinite(vote) ? Math.round(vote * 10) / 10 : null,
    tmdbPercent: Number.isFinite(vote) && votes > 0 && vote > 0 ? Math.round(vote * 10) : null,
    popularity: Number(item.popularity) || 0,
    language: String(item.original_language || "en"),
    originCountries: [],
    where: row === "theater" ? "In theaters" : "Streaming",
  };
}

function collect(items: Record<string, unknown>[], type: "movie" | "tv", row: "streaming" | "theater", wide: boolean, gte: string, lte: string): Title[] {
  const seen = new Set<string>();
  const out: Title[] = [];
  for (const item of items) {
    const title = toTitle(item, type, row, wide, gte, lte);
    if (!title || seen.has(title.id)) continue;
    seen.add(title.id);
    out.push(title);
  }
  return out;
}

function byRelease(a: Title, b: Title): number {
  if (a.releaseDate !== b.releaseDate) return a.releaseDate < b.releaseDate ? 1 : -1;
  return a.title.localeCompare(b.title);
}

function byPopularity(a: Title, b: Title): number {
  const pop = (b.popularity || 0) - (a.popularity || 0);
  if (pop) return pop;
  return a.id.localeCompare(b.id);
}

function capWithLead(list: Title[]): Title[] {
  const leader = [...list].sort(byPopularity)[0];
  if (leader) leader.lead = true;
  const row = list.slice(0, STORE_CAP);
  if (leader && !row.some((title) => title.id === leader.id)) row.push(leader);
  return row;
}

async function attachWhere(titles: Title[], region: Market, token: string): Promise<void> {
  const known = new Map((SERVICES[region] || []).map((service) => [service.id, service.label]));
  await Promise.all(titles.map(async (title) => {
    const kind = title.type === "tv" ? "tv" : "movie";
    let data: unknown;
    try {
      data = await fetchTMDB(`/${kind}/${title.tmdbId}/watch/providers`, token);
    } catch {
      return;
    }
    const flat = (data as { results?: Record<string, { flatrate?: { provider_id?: number; provider_name?: string; logo_path?: string }[] }> })
      ?.results?.[region]?.flatrate;
    if (!Array.isArray(flat) || flat.length === 0) return;
    const match = flat.find((provider) => known.has(Number(provider.provider_id)));
    const provider = match || flat[0];
    const name = match ? known.get(Number(match.provider_id)) : (provider?.provider_name || "");
    if (name) title.where = name;
    const logoPath = typeof provider?.logo_path === "string" ? provider.logo_path : "";
    if (logoPath.startsWith("/")) title.serviceLogo = `https://image.tmdb.org/t/p/w92${logoPath}`;
  }));
}

async function buildCatalog(token: string, market: Market, weekGte: string, weekLte: string, streamGte: string, streamLte: string): Promise<{ streaming: Title[]; theaters: Title[]; fetched: boolean }> {
  const indiaOnly = market === "IN" ? `&with_original_language=${INDIA_LANGS.join("|")}` : "";
  const movieStream = `/discover/movie?language=en-US&sort_by=popularity.desc&region=${market}&watch_region=${market}&with_watch_monetization_types=flatrate&primary_release_date.gte=${streamGte}&primary_release_date.lte=${streamLte}${indiaOnly}`;
  const tvStream = `/discover/tv?language=en-US&sort_by=popularity.desc&watch_region=${market}&with_watch_monetization_types=flatrate&first_air_date.gte=${streamGte}&first_air_date.lte=${streamLte}${indiaOnly}`;
  const wide = `/discover/movie?language=en-US&sort_by=popularity.desc&region=${market}&with_release_type=3&primary_release_date.gte=${weekGte}&primary_release_date.lte=${weekLte}${indiaOnly}`;
  const limited = `/discover/movie?language=en-US&sort_by=popularity.desc&region=${market}&with_release_type=2&primary_release_date.gte=${weekGte}&primary_release_date.lte=${weekLte}${indiaOnly}`;
  const [movieRaw, tvRaw, wideRaw, limitedRaw] = await Promise.all([
    discoverPages(token, movieStream, 2),
    discoverPages(token, tvStream, 2),
    discoverPages(token, wide, 1),
    discoverPages(token, limited, 1),
  ]);
  const fetched = movieRaw.ok || tvRaw.ok || wideRaw.ok || limitedRaw.ok;
  const theaterIds = new Set<string>();
  const theaters: Title[] = [];
  for (const title of [
    ...collect(wideRaw.items, "movie", "theater", true, weekGte, weekLte),
    ...collect(limitedRaw.items, "movie", "theater", false, weekGte, weekLte),
  ]) {
    if (theaterIds.has(title.id)) continue;
    theaterIds.add(title.id);
    theaters.push(title);
  }
  const keep = (title: Title) => market !== "IN" || INDIA_LANG_SET.has(title.language.toLowerCase());
  const streaming = [
    ...collect(movieRaw.items, "movie", "streaming", false, streamGte, streamLte),
    ...collect(tvRaw.items, "tv", "streaming", false, streamGte, streamLte),
  ].filter((title) => keep(title) && !theaterIds.has(title.id));
  for (const title of streaming) {
    title.inWeek = title.releaseDate >= weekGte && title.releaseDate <= weekLte;
  }
  const theaterKept = theaters.filter(keep);
  streaming.sort(byRelease);
  theaterKept.sort(byRelease);
  const streamingRow = capWithLead(streaming);
  const theaterRow = capWithLead(theaterKept);
  await attachWhere(streamingRow, market, token);
  return { streaming: streamingRow, theaters: theaterRow, fetched };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const tmdbToken = Deno.env.get("TMDB_READ_ACCESS_TOKEN");
    if (!supabaseUrl || !serviceKey || !tmdbToken) {
      console.error("new-this-week-catalog: missing env");
      return jsonResponse({ error: "Server misconfigured." }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const market = parseMarket((body as { region?: unknown }).region);
    const editionKey = isoDate((body as { edition_key?: unknown }).edition_key);
    const weekGte = isoDate((body as { week_gte?: unknown }).week_gte);
    const weekLte = isoDate((body as { week_lte?: unknown }).week_lte);
    const streamGte = isoDate((body as { stream_gte?: unknown }).stream_gte);
    const streamLte = isoDate((body as { stream_lte?: unknown }).stream_lte);
    if (!editionKey || !weekGte || !weekLte || !streamGte || !streamLte) {
      return jsonResponse({ error: "Missing dates." }, 400);
    }
    if (weekGte > weekLte || streamGte > streamLte || daySpan(weekGte, weekLte) > 8 || daySpan(streamGte, streamLte) > 21) {
      return jsonResponse({ error: "Bad date window." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const existing = await admin
      .from("new_this_week_catalog")
      .select("streaming, theaters")
      .eq("edition_key", editionKey)
      .eq("region", market)
      .maybeSingle();
    if (!existing.error && existing.data && Array.isArray(existing.data.streaming) && Array.isArray(existing.data.theaters)) {
      return jsonResponse({
        ok: true,
        region: market,
        edition_key: editionKey,
        streaming: existing.data.streaming,
        theaters: existing.data.theaters,
        saved: true,
      });
    }

    const built = await buildCatalog(tmdbToken, market, weekGte, weekLte, streamGte, streamLte);
    if (!built.fetched) {
      return jsonResponse({ ok: false, error: "Could not load titles." }, 502);
    }

    const inserted = await admin.from("new_this_week_catalog").insert({
      edition_key: editionKey,
      region: market,
      streaming: built.streaming,
      theaters: built.theaters,
    });
    if (inserted.error && inserted.error.code !== "23505") {
      console.error("new-this-week-catalog insert", inserted.error.message);
      return jsonResponse({
        ok: true,
        region: market,
        edition_key: editionKey,
        streaming: built.streaming,
        theaters: built.theaters,
        saved: false,
      });
    }
    if (inserted.error?.code === "23505") {
      const again = await admin
        .from("new_this_week_catalog")
        .select("streaming, theaters")
        .eq("edition_key", editionKey)
        .eq("region", market)
        .maybeSingle();
      if (!again.error && again.data && Array.isArray(again.data.streaming) && Array.isArray(again.data.theaters)) {
        return jsonResponse({
          ok: true,
          region: market,
          edition_key: editionKey,
          streaming: again.data.streaming,
          theaters: again.data.theaters,
          saved: true,
        });
      }
    }
    return jsonResponse({
      ok: true,
      region: market,
      edition_key: editionKey,
      streaming: built.streaming,
      theaters: built.theaters,
      saved: !inserted.error,
    });
  } catch (err) {
    console.error("new-this-week-catalog", err);
    return jsonResponse({ error: "Could not load the weekend list." }, 500);
  }
});
