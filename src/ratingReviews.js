/**
 * Reviews beside a score (`rating_reviews`).
 * season_number 0 in the database is the whole title. The circle RPCs use null
 * for that same whole-title review. Words save only when the matching score exists.
 */

import { supabase } from "./supabase";

export const REVIEW_MAX_CHARS = 500;

export const REVIEW_AGREEMENT_LINE_1 =
  "A review can appear on the Cinemastro page. No names will be used.";
export const REVIEW_AGREEMENT_LINE_2 = "Saving is the agreement.";

export function normalizeReviewBody(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

/** Empty string when the text can be saved. */
export function reviewBodyError(value) {
  const body = normalizeReviewBody(value);
  if (!body) return "Write a review first.";
  if (body.length > REVIEW_MAX_CHARS) return "A review can be 500 characters.";
  return "";
}

export function reviewWriteError(error, fallback) {
  const msg = String(error?.message || "");
  if (error?.code === "42P01" || error?.code === "PGRST205" || (/rating_reviews/i.test(msg) && /does not exist|schema cache|could not find/i.test(msg))) {
    return "Reviews are not available yet (database update pending).";
  }
  if (/review requires a score/i.test(msg)) return "Save a rating first.";
  if (/review requires a season score/i.test(msg)) return "Save a season score first.";
  if (/500 characters/i.test(msg)) return "A review can be 500 characters.";
  return msg || fallback;
}

function missingReviewRpc(error) {
  const msg = String(error?.message || "");
  const code = String(error?.code || "");
  return code === "PGRST202" || code === "42883" || /schema cache/i.test(msg) || /could not find the function/i.test(msg);
}

/** Rows → `{ titles: { "movie-1": "…" }, seasons: { "tv-2": { 1: "…" } } }`. */
export function mapsFromReviewRows(rows) {
  const titles = {};
  const seasons = {};
  for (const row of rows || []) {
    const type = row?.media_type === "tv" ? "tv" : row?.media_type === "movie" ? "movie" : "";
    const tmdbId = Number(row?.tmdb_id);
    const body = typeof row?.body === "string" ? row.body.trim() : "";
    if (!type || !Number.isFinite(tmdbId) || !body) continue;
    const id = `${type}-${tmdbId}`;
    const season = Number(row?.season_number);
    if (!Number.isInteger(season) || season < 1) {
      titles[id] = body;
    } else {
      if (!seasons[id]) seasons[id] = {};
      seasons[id][season] = body;
    }
  }
  return { titles, seasons };
}

/** Count map key. Whole title uses 0. */
export function circleReviewCountKey(mediaType, tmdbId, seasonNumber) {
  const mt = mediaType === "tv" ? "tv" : "movie";
  const id = Number(tmdbId);
  const sn = seasonNumber == null || seasonNumber === "" ? 0 : Number(seasonNumber);
  return `${mt}|${id}|${Number.isInteger(sn) && sn >= 1 ? sn : 0}`;
}

/**
 * How many published whole-show reviews belong on this circle card.
 * A review on a season stays on the title and is not counted here.
 */
export function circleCardReviewCount(counts, row) {
  if (!counts || !row) return 0;
  const mt = row.media_type === "tv" ? "tv" : "movie";
  const id = Number(row.tmdb_id);
  if (!Number.isFinite(id)) return 0;
  return Number(counts[circleReviewCountKey(mt, id, 0)]) || 0;
}

export function countsFromCircleReviewRows(rows) {
  const counts = {};
  for (const row of rows || []) {
    const key = circleReviewCountKey(row?.media_type, row?.tmdb_id, row?.season_number);
    const n = Number(row?.review_count);
    if (Number.isFinite(n) && n > 0) counts[key] = n;
  }
  return counts;
}

/** Copy `review_body` onto publisher lines that share the person and the season. */
export function attachReviewBodies(lines, reviews) {
  const map = new Map();
  for (const row of reviews || []) {
    const body = typeof row?.body === "string" ? row.body.trim() : "";
    if (!body || !row?.user_id) continue;
    const sn = row.season_number == null ? "show" : Number(row.season_number);
    map.set(`${row.user_id}|${sn}`, body);
  }
  if (map.size === 0) return lines || [];
  return (lines || []).map((line) => {
    const sn = line?.season_number == null ? "show" : Number(line.season_number);
    const body = map.get(`${line?.user_id || ""}|${sn}`);
    return body ? { ...line, review_body: body } : line;
  });
}

export async function fetchCircleTitleReviews({ circleId, tmdbId, mediaType }) {
  const cid = (circleId || "").trim();
  if (!cid) throw new Error("Missing circle.");
  const tid = Number(tmdbId);
  if (!Number.isFinite(tid)) throw new Error("Missing title.");
  const mt = mediaType === "tv" ? "tv" : "movie";
  const { data, error } = await supabase.rpc("get_circle_title_reviews", {
    p_circle_id: cid,
    p_tmdb_id: Math.floor(tid),
    p_media_type: mt,
  });
  if (error) {
    if (missingReviewRpc(error)) return [];
    throw new Error(error.message || "Could not load reviews.");
  }
  return Array.isArray(data) ? data : [];
}

export async function fetchCircleReviewCounts(circleId) {
  const cid = (circleId || "").trim();
  if (!cid) return {};
  const { data, error } = await supabase.rpc("get_circle_review_counts", {
    p_circle_id: cid,
  });
  if (error) {
    if (missingReviewRpc(error)) return {};
    if (String(error.message || "").includes("not a member")) return {};
    console.warn("Circle reviews:", error.message);
    return {};
  }
  return countsFromCircleReviewRows(Array.isArray(data) ? data : []);
}
