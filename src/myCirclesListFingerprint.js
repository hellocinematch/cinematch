/**
 * Compare My Circles payloads from `fetchMyCircles` / `normalizeCircleRow` without relying on references.
 * See `docs/PERFORMANCE-CIRCLE-CACHE.md` (step 3).
 */

function isoPiece(v) {
  if (v == null || v === "") return "";
  return typeof v === "string" ? v : String(v);
}

function fingerprintCircleRow(c) {
  if (!c?.id) return "";
  const mem = [...(c.members ?? [])].sort((a, b) =>
    String(a?.user_id ?? "").localeCompare(String(b?.user_id ?? "")),
  );
  const mPart = mem
    .map((m) => `${m.user_id}:${m.role ?? ""}:${isoPiece(m.joined_at)}:${m.id ?? ""}`)
    .join("|");
  return [
    c.id,
    c.name ?? "",
    c.description ?? "",
    c.vibe ?? "",
    c.status ?? "",
    String(c.memberCount ?? mem.length ?? ""),
    c.creatorId ?? "",
    isoPiece(c.archivedAt),
    isoPiece(c.createdAt),
    mPart,
  ].join("\u0001");
}

/** Stable string for detecting list changes across silent refreshes. */
export function fingerprintMyCirclesList(rows) {
  if (!Array.isArray(rows)) return "";
  return [...rows]
    .sort((a, b) => String(a?.id ?? "").localeCompare(String(b?.id ?? "")))
    .map(fingerprintCircleRow)
    .join("\u0002");
}
