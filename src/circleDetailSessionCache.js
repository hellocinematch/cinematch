/**
 * Session-only SWR cache for circle detail + recent-strip first page (offset 0) + All/Top grid merged payloads.
 * @see docs/PERFORMANCE-CIRCLE-CACHE.md
 */

const detailByCircleId = new Map();
const recentStripByCircleId = new Map();
/** Grid merged cache keys: `${circleId}\\u0004all` | `${circleId}\\u0004top` */
const gridMergedByKey = new Map();

function normId(id) {
  const s = (id ?? "").trim();
  return s || null;
}

/** Immutable copy for putting in React state. */
export function cloneCircleDetailForState(detail) {
  if (!detail) return null;
  return {
    ...detail,
    members: Array.isArray(detail.members) ? detail.members.map((m) => ({ ...m })) : [],
  };
}

function storeDetail(detail) {
  if (!detail?.id) return;
  detailByCircleId.set(String(detail.id), cloneCircleDetailForState(detail));
}

/** Recent strip RPC/Edge normalized payload ({@link fetchCircleRatedTitles}). */
function storeRecentStrip(circleId, payload) {
  const k = normId(circleId);
  if (!k || !payload) return;
  recentStripByCircleId.set(k, {
    ok: true,
    member_count: Number(payload.member_count ?? 0),
    gated: Boolean(payload.gated),
    total_eligible: Number(payload.total_eligible ?? 0),
    has_more: Boolean(payload.has_more),
    titles: Array.isArray(payload.titles) ? payload.titles.map((t) => ({ ...t })) : [],
  });
}

export function peekCircleDetailCache(circleId) {
  const k = normId(circleId);
  if (!k) return null;
  const row = detailByCircleId.get(k);
  return row ? cloneCircleDetailForState(row) : null;
}

export function peekRecentStripCache(circleId) {
  const k = normId(circleId);
  if (!k) return null;
  const row = recentStripByCircleId.get(k);
  if (!row) return null;
  return {
    ok: row.ok,
    member_count: row.member_count,
    gated: row.gated,
    total_eligible: row.total_eligible,
    has_more: row.has_more,
    titles: row.titles.map((t) => ({ ...t })),
  };
}

export function setCircleDetailCache(circleId, detail) {
  const k = normId(circleId);
  if (!k || !detail) return;
  if (detail.id !== k && String(detail.id) !== String(k)) return;
  storeDetail(detail);
}

export function setCircleRecentStripCache(circleId, payload) {
  storeRecentStrip(circleId, payload);
}

export function invalidateCircleDetailCache(circleId) {
  const k = normId(circleId);
  if (!k) return;
  detailByCircleId.delete(k);
}

export function invalidateCircleRecentStripCache(circleId) {
  const k = normId(circleId);
  if (!k) return;
  recentStripByCircleId.delete(k);
}

function gridCacheKey(circleId, view) {
  const k = normId(circleId);
  if (!k) return null;
  const v = view === "top" ? "top" : "all";
  return `${k}\u0004${v}`;
}

export function peekCircleGridMergedCache(circleId, view) {
  const key = gridCacheKey(circleId, view);
  if (!key) return null;
  const row = gridMergedByKey.get(key);
  if (!row) return null;
  return cloneRatedTitlesPayload(row);
}

function cloneRatedTitlesPayload(payload) {
  return {
    ok: true,
    member_count: Number(payload.member_count ?? 0),
    gated: Boolean(payload.gated),
    total_eligible: Number(payload.total_eligible ?? 0),
    has_more: Boolean(payload.has_more),
    titles: Array.isArray(payload.titles) ? payload.titles.map((t) => ({ ...t })) : [],
  };
}

/** Persist full merged grid (All or Top including “Load more” rows). */
export function setCircleGridMergedCache(circleId, view, payload) {
  const key = gridCacheKey(circleId, view);
  if (!key || !payload) return;
  gridMergedByKey.set(key, cloneRatedTitlesPayload(payload));
}

/** Drop cached All + Top payloads for one circle (e.g. ratings refresh key). */
export function invalidateCircleGridCaches(circleId) {
  const k = normId(circleId);
  if (!k) return;
  gridMergedByKey.delete(`${k}\u0004all`);
  gridMergedByKey.delete(`${k}\u0004top`);
}

export function invalidateCircleGridCacheSingle(circleId, view) {
  const key = gridCacheKey(circleId, view);
  if (key) gridMergedByKey.delete(key);
}

export function invalidateCircleSwrCaches(circleId) {
  invalidateCircleDetailCache(circleId);
  invalidateCircleRecentStripCache(circleId);
  invalidateCircleGridCaches(circleId);
}

export function clearCircleDetailSessionCaches() {
  detailByCircleId.clear();
  recentStripByCircleId.clear();
  gridMergedByKey.clear();
}

function jsonIsoPrimitive(v) {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

/** Stable string for comparing whether detail metadata changed. */
export function fingerprintCircleDetail(detail) {
  if (!detail?.id) return "";
  const members = [...(detail.members ?? [])].sort((a, b) =>
    String(a.user_id).localeCompare(String(b.user_id)),
  );
  const mPart = members
    .map((m) => `${m.user_id}:${m.role ?? ""}:${jsonIsoPrimitive(m.joined_at)}:${m.id ?? ""}`)
    .join("|");
  return [
    detail.name ?? "",
    detail.description ?? "",
    detail.vibe ?? "",
    detail.status ?? "",
    String(detail.memberCount ?? members.length ?? ""),
    detail.creatorId ?? "",
    jsonIsoPrimitive(detail.archivedAt),
    detail.createdAt != null ? jsonIsoPrimitive(detail.createdAt) : "",
    mPart,
  ].join("\u0001");
}

/** Recent strip plus All/Top grids: compares payload shape from `fetchCircleRatedTitles`. */
export function fingerprintRecentStripPayload(payload) {
  if (!payload || !Array.isArray(payload.titles)) return "";
  const preds = payload.titles.map((t) => {
    if (t.prediction == null || t.prediction === "") return "x";
    const n = Number(t.prediction);
    return Number.isFinite(n) ? String(n) : "x";
  });
  const ids = payload.titles.map((t) => `${t.media_type ?? ""}:${Number(t.tmdb_id)}`).join(",");
  return [
    payload.gated ? "1" : "0",
    String(payload.total_eligible ?? ""),
    payload.has_more ? "1" : "0",
    String(payload.member_count ?? ""),
    ids,
    preds.join("|"),
  ].join("\u0001");
}
