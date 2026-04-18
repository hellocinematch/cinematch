// Circles — Phase A helpers.
// All calls hit supabase directly (no Edge functions yet). RLS policies live in
// supabase/migrations/20260422120000_circles_schema.sql.
//
// The 10-active-circle user cap and 25-member-per-circle cap are enforced here / in the
// server-side policies (cap math is UI-level in phase A; Phase B's send-circle-invite
// Edge function re-validates before minting new memberships).

import { supabase } from "./supabase";

/** Maximum active circles per user. Archived circles don't count. */
export const CIRCLE_CAP = 10;

/** Maximum members per circle. Enforced in send/accept Edge (Phase B). */
export const CIRCLE_MEMBER_CAP = 25;

/** Vibe catalog — values match the `check` constraint on circles.vibe. Accent + tint match the
 *  design tokens from Architechture/cinemastro-circles-requirements.md §8. */
export const VIBES = [
  { id: "Mixed Bag",   accent: "#e8c96a", tint: "#3a2a0a" },
  { id: "Arthouse",    accent: "#6ab4e8", tint: "#0a1a2a" },
  { id: "Family",      accent: "#6ae8a8", tint: "#0a2a1a" },
  { id: "Horror",      accent: "#e86a6a", tint: "#2a0a0a" },
  { id: "Sci-Fi",      accent: "#a86ae8", tint: "#1a0a2a" },
  { id: "Documentary", accent: "#e8a86a", tint: "#2a1a0a" },
  { id: "Drama",       accent: "#e8e86a", tint: "#2a2a0a" },
  { id: "Comedy",      accent: "#6ae8e8", tint: "#0a2a2a" },
  { id: "Thriller",    accent: "#e86ab4", tint: "#2a0a1a" },
];

const VIBE_BY_ID = new Map(VIBES.map((v) => [v.id, v]));
const DEFAULT_VIBE = VIBES[0];

export function vibeMeta(vibeId) {
  if (!vibeId) return DEFAULT_VIBE;
  return VIBE_BY_ID.get(vibeId) ?? DEFAULT_VIBE;
}

export const CIRCLE_NAME_MAX = 40;
export const CIRCLE_DESCRIPTION_MAX = 100;

/** RLS on `circles` restricts selects to circles the current user belongs to, so the scope is
 *  naturally correct without a `where user_id = auth.uid()` clause. We embed circle_members so we
 *  can derive member_count and the current user's role (creator vs member) in one trip. */
export async function fetchMyCircles() {
  const { data, error } = await supabase
    .from("circles")
    .select(`
      id,
      name,
      description,
      vibe,
      status,
      archived_at,
      created_at,
      creator_id,
      circle_members ( user_id, role )
    `)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(normalizeCircleRow);
}

export async function fetchCircleDetail(circleId) {
  const { data, error } = await supabase
    .from("circles")
    .select(`
      id,
      name,
      description,
      vibe,
      status,
      archived_at,
      created_at,
      creator_id,
      circle_members ( id, user_id, role, joined_at )
    `)
    .eq("id", circleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return normalizeCircleRow(data);
}

function normalizeCircleRow(row) {
  const members = Array.isArray(row.circle_members) ? row.circle_members : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    vibe: row.vibe ?? "Mixed Bag",
    status: row.status,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    creatorId: row.creator_id,
    memberCount: members.length,
    members,
  };
}

/** Two sequential inserts. The "creator can seed own membership" RLS policy lets the second one
 *  pass. If it fails we best-effort roll the circle row back so we don't leave orphan circles. */
export async function createCircle({ name, description, vibe, creatorId }) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) throw new Error("Circle name is required.");
  if (trimmedName.length > CIRCLE_NAME_MAX) {
    throw new Error(`Name must be ${CIRCLE_NAME_MAX} characters or fewer.`);
  }
  const trimmedDescription = (description || "").trim();
  if (trimmedDescription.length > CIRCLE_DESCRIPTION_MAX) {
    throw new Error(`Description must be ${CIRCLE_DESCRIPTION_MAX} characters or fewer.`);
  }
  const vibeId = vibe && VIBE_BY_ID.has(vibe) ? vibe : "Mixed Bag";

  const { data: inserted, error: insertErr } = await supabase
    .from("circles")
    .insert({
      name: trimmedName,
      description: trimmedDescription || null,
      vibe: vibeId,
      creator_id: creatorId,
    })
    .select("id, name, description, vibe, status, archived_at, created_at, creator_id")
    .single();
  if (insertErr) throw insertErr;

  const { error: memberErr } = await supabase
    .from("circle_members")
    .insert({
      circle_id: inserted.id,
      user_id: creatorId,
      role: "creator",
    });
  if (memberErr) {
    await supabase.from("circles").delete().eq("id", inserted.id);
    throw memberErr;
  }

  return normalizeCircleRow({
    ...inserted,
    circle_members: [{ user_id: creatorId, role: "creator" }],
  });
}

/** Leave flow.
 *  - Member (non-creator): just delete the membership row.
 *  - Creator: flip status to archived first (RLS gates the UPDATE on status = 'active'), then
 *    delete the creator's own membership row. The circle row itself stays around as an archived
 *    read-only artefact; Phase B's Edge function will hard-delete once the last member leaves.
 */
export async function leaveCircle({ circleId, userId, isCreator }) {
  if (isCreator) {
    const { error: updateErr } = await supabase
      .from("circles")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", circleId);
    if (updateErr) throw updateErr;
  }
  const { error: deleteErr } = await supabase
    .from("circle_members")
    .delete()
    .eq("circle_id", circleId)
    .eq("user_id", userId);
  if (deleteErr) throw deleteErr;
}

export function currentUserRole(circle, userId) {
  if (!circle || !userId) return null;
  const row = (circle.members || []).find((m) => m.user_id === userId);
  return row?.role ?? null;
}
