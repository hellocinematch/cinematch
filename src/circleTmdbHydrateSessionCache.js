/**
 * Session-only TMDB rows for titles shown on circle detail strip/grids when missing from catalogue.
 * @see docs/PERFORMANCE-CIRCLE-CACHE.md (step 2)
 */

/** @type {Map<string, Record<string, unknown>>} normalized TMDB items (`normalizeTMDBItem`). */
const normalizedByMovieId = new Map();

/**
 * Composite id **`movie-{n}` | `tv-{n}`**.
 * @returns {object | null} shallow clone for safe React reads
 */
export function peekCircleTmdbHydrateCache(movieId) {
  const k = String(movieId ?? "").trim();
  if (!k) return null;
  const row = normalizedByMovieId.get(k);
  return row ? { ...row } : null;
}

/** @param {Map<string, object>} fetchedMap */
export function mergeCircleTmdbHydrateCache(fetchedMap) {
  if (!fetchedMap || fetchedMap.size === 0) return;
  for (const [k, v] of fetchedMap) {
    if (k && v && typeof v === "object") normalizedByMovieId.set(String(k), { ...v });
  }
}

export function clearCircleTmdbHydrateSessionCache() {
  normalizedByMovieId.clear();
}
