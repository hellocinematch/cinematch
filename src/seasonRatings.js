/**
 * Per-season TV scores (`season_ratings`). A show's `ratings` row stays the whole-show score;
 * season rows sit beside it. Anything that needs ONE number per user per show (match, neighbors,
 * community / circle averages, strip badges) uses {@link effectiveTitleScore}: the mean of that
 * user's season scores when any exist, else the whole-show score.
 */

/** TMDB `/tv/{id}` → season rows for display. Season 0 (specials) is skipped. */
export function tvSeasonsFromTmdbDetail(raw) {
  const list = Array.isArray(raw?.seasons) ? raw.seasons : [];
  const out = [];
  for (const s of list) {
    const n = Number(s?.season_number);
    if (!Number.isInteger(n) || n < 1) continue;
    const airRaw = typeof s?.air_date === "string" ? s.air_date : "";
    const airDate = /^\d{4}-\d{2}-\d{2}/.test(airRaw) ? airRaw.slice(0, 10) : "";
    const ep = Number(s?.episode_count);
    const vote = Number(s?.vote_average);
    out.push({
      seasonNumber: n,
      name: typeof s?.name === "string" && s.name.trim() ? s.name.trim() : `Season ${n}`,
      posterPath: typeof s?.poster_path === "string" && s.poster_path ? s.poster_path : null,
      airDate: airDate || null,
      airYear: airDate ? airDate.slice(0, 4) : null,
      episodeCount: Number.isFinite(ep) && ep > 0 ? ep : null,
      overview: typeof s?.overview === "string" ? s.overview.trim() : "",
      voteAverage: Number.isFinite(vote) && vote > 0 ? vote : null,
    });
  }
  out.sort((a, b) => a.seasonNumber - b.seasonNumber);
  return out;
}

/**
 * Latest season whose premiere is on or before `todayIso` (YYYY-MM-DD).
 * A later season that has not started yet is skipped. No aired season → null.
 */
export function currentAiredSeason(seasons, todayIso) {
  const today = String(todayIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  let best = null;
  for (const s of Array.isArray(seasons) ? seasons : []) {
    const d = typeof s?.airDate === "string" ? s.airDate.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today) continue;
    const n = Number(s?.seasonNumber);
    if (!Number.isInteger(n) || n < 1) continue;
    if (!best || n > best.seasonNumber) best = s;
  }
  return best;
}

/** `{ [seasonNumber]: score }` → mean, or null when there are no valid season scores. */
export function seasonScoresAverage(seasonScores) {
  if (!seasonScores || typeof seasonScores !== "object") return null;
  let sum = 0;
  let n = 0;
  for (const v of Object.values(seasonScores)) {
    const x = Number(v);
    if (!Number.isFinite(x)) continue;
    sum += x;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

/** One number per user per show: season mean if any season is rated, else the whole-show score. */
export function effectiveTitleScore(wholeScore, seasonScores) {
  const avg = seasonScoresAverage(seasonScores);
  if (avg != null) return avg;
  const w = Number(wholeScore);
  return wholeScore != null && Number.isFinite(w) ? w : null;
}

/** `season_ratings` rows → `{ "tv-<id>": { [seasonNumber]: score } }`. */
export function seasonRatingsMapFromRows(rows) {
  const out = {};
  for (const r of rows || []) {
    const tid = Number(r?.tmdb_id);
    const n = Number(r?.season_number);
    const sc = Number(r?.score);
    if (!Number.isFinite(tid) || !Number.isInteger(n) || n < 1 || !Number.isFinite(sc)) continue;
    const key = `tv-${tid}`;
    if (!out[key]) out[key] = {};
    out[key][n] = sc;
  }
  return out;
}

/**
 * Effective map for every title the user has scored. `wholeMap` holds whole-title scores
 * (movies + whole-show TV rows); `seasonMapByKey` holds per-season TV scores.
 */
export function buildEffectiveRatingsMap(wholeMap, seasonMapByKey) {
  const out = {};
  for (const [key, score] of Object.entries(wholeMap || {})) {
    const eff = effectiveTitleScore(score, seasonMapByKey?.[key]);
    if (eff != null) out[key] = eff;
  }
  for (const [key, seasons] of Object.entries(seasonMapByKey || {})) {
    if (key in out) continue;
    const eff = effectiveTitleScore(null, seasons);
    if (eff != null) out[key] = eff;
  }
  return out;
}

/**
 * Rated list lines: one line per whole-title score (no season label) plus one line per rated season.
 * Lines whose title is not in `movieById` are dropped (same as the pre-season list).
 */
export function buildRatedLines({ wholeMap, seasonMapByKey, movieById, seasonsByTmdbId }) {
  const lines = [];
  for (const [key, score] of Object.entries(wholeMap || {})) {
    const movie = movieById.get(key);
    const sc = Number(score);
    if (!movie || !Number.isFinite(sc)) continue;
    lines.push({ lineKey: key, movie, seasonNumber: null, season: null, score: sc });
  }
  for (const [key, seasons] of Object.entries(seasonMapByKey || {})) {
    const movie = movieById.get(key);
    if (!movie) continue;
    const meta = seasonsByTmdbId?.[movie.tmdbId] || [];
    for (const [nRaw, score] of Object.entries(seasons || {})) {
      const n = Number(nRaw);
      const sc = Number(score);
      if (!Number.isInteger(n) || n < 1 || !Number.isFinite(sc)) continue;
      const season = meta.find((s) => s.seasonNumber === n) || null;
      lines.push({ lineKey: `${key}-s${n}`, movie, seasonNumber: n, season, score: sc });
    }
  }
  lines.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const t = String(a.movie.title || "").localeCompare(String(b.movie.title || ""));
    if (t !== 0) return t;
    return (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0);
  });
  return lines;
}

/**
 * Circle Recent / All / Top display rows for one aggregated show row. `lines` are that show's
 * `get_circle_title_publisher_lines` rows (per member: `season_number` null = whole-show score).
 * Returns one row per rated season (ascending), preceded by a whole-show row only when some member
 * gave a whole-show score. Each row carries that line group's circle average, rater count, and the
 * viewer's own score; `show_row` keeps the original aggregated row (prediction, publish state).
 * Movies, whole-show-only TV, and rows whose lines are not loaded come back unchanged.
 */
export function expandCircleRowBySeason(row, lines, viewerId) {
  if (row?.media_type !== "tv" || !Array.isArray(lines) || lines.length === 0) return [row];
  const groups = new Map();
  for (const l of lines) {
    const sc = Number(l?.score);
    if (!Number.isFinite(sc)) continue;
    const n = l?.season_number == null ? null : Number(l.season_number);
    if (n != null && (!Number.isInteger(n) || n < 1)) continue;
    const k = n ?? 0;
    let g = groups.get(k);
    if (!g) {
      g = { seasonNumber: n, sum: 0, count: 0, users: new Set(), viewerScore: null };
      groups.set(k, g);
    }
    g.sum += sc;
    g.count += 1;
    if (l.user_id) g.users.add(l.user_id);
    if (viewerId && l.user_id === viewerId) g.viewerScore = sc;
  }
  if (![...groups.keys()].some((k) => k > 0)) return [row];
  return [...groups.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const g = groups.get(k);
      const raters = g.users.size || g.count;
      return {
        ...row,
        season_number: g.seasonNumber,
        group_rating: Math.round((g.sum / g.count) * 10) / 10,
        distinct_circle_raters: raters,
        section: raters >= 2 ? "together" : "solo",
        viewer_score: g.viewerScore,
        show_row: row,
      };
    });
}

/** TMDB season `vote_average` (0–10) → "77%". */
export function formatSeasonVotePercent(voteAverage) {
  const v = Number(voteAverage);
  if (!Number.isFinite(v) || v <= 0) return null;
  return `${Math.round(v * 10)}%`;
}

/** "2022 • 8 Episodes" (either half optional). */
export function seasonYearEpisodesLine(season) {
  if (!season) return "";
  const parts = [];
  if (season.airYear) parts.push(season.airYear);
  if (season.episodeCount) parts.push(`${season.episodeCount} Episode${season.episodeCount === 1 ? "" : "s"}`);
  return parts.join(" • ");
}
