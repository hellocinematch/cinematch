// Circles — Phase A helpers.
// All calls hit supabase directly (no Edge functions yet). RLS policies live in
// supabase/migrations/20260422120000_circles_schema.sql.
//
// Active-circle user cap and member-per-circle cap are enforced here / in the
// server-side policies (cap math is UI-level in phase A; Phase B's send-circle-invite
// Edge function re-validates before minting new memberships).

import { FunctionsHttpError } from "@supabase/supabase-js";
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

/** Circle display name: letters (any script), spaces, hyphen, apostrophe; digits only after a leading letter; 2–32 chars after trim. */
export const CIRCLE_NAME_MIN = 2;
export const CIRCLE_NAME_MAX = 32;
export const CIRCLE_DESCRIPTION_MAX = 100;

/** After trim: first char letter, rest letters/digits/space/'/- only; max length enforced separately. */
const CIRCLE_NAME_CHARS_RE = /^[\p{L}][\p{L}0-9'\- ]{0,31}$/u;

/** Normalize pasted smart quotes / dashes; trim ends only. */
export function normalizeCircleNameInput(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, "-")
    .trim();
}

/**
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function validateCircleName(raw) {
  const s = normalizeCircleNameInput(raw);
  if (!s) {
    return { ok: false, error: "Give your circle a name." };
  }
  if (s.length < CIRCLE_NAME_MIN) {
    return { ok: false, error: "Use at least 2 characters." };
  }
  if (s.length > CIRCLE_NAME_MAX) {
    return { ok: false, error: `Use at most ${CIRCLE_NAME_MAX} characters.` };
  }
  if (!CIRCLE_NAME_CHARS_RE.test(s)) {
    return {
      ok: false,
      error:
        "Use letters, spaces, hyphens, and apostrophes. Numbers only after a letter. No emoji or symbols.",
    };
  }
  return { ok: true, name: s };
}

/** Two-letter placeholder initials for circle avatar (Unicode letters; duplicates if only one). */
export function circleAvatarInitials(name) {
  const s = String(name ?? "").trim();
  if (!s) return "?";
  const letters = s.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return "?";
  const a = letters[0];
  const b = letters.length >= 2 ? letters[1] : letters[0];
  return (a + b).toLocaleUpperCase();
}

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
      circle_members ( user_id, role, joined_at )
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
  const validation = validateCircleName(name);
  if (!validation.ok) throw new Error(validation.error);
  const trimmedName = validation.name;
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

/** Active circle only; RLS: current creator (`is_circle_creator`). */
export async function updateCircle({ circleId, name, description, vibe }) {
  const validation = validateCircleName(name);
  if (!validation.ok) throw new Error(validation.error);
  const trimmedName = validation.name;
  const trimmedDescription = (description || "").trim();
  if (trimmedDescription.length > CIRCLE_DESCRIPTION_MAX) {
    throw new Error(`Description must be ${CIRCLE_DESCRIPTION_MAX} characters or fewer.`);
  }
  const vibeId = vibe && VIBE_BY_ID.has(vibe) ? vibe : "Mixed Bag";
  const { data, error } = await supabase
    .from("circles")
    .update({
      name: trimmedName,
      description: trimmedDescription || null,
      vibe: vibeId,
    })
    .eq("id", circleId)
    .select("id, name, description, vibe, status, archived_at, created_at, creator_id")
    .maybeSingle();
  if (error) throw new Error(error.message || "Could not update circle.");
  if (!data) throw new Error("Could not update circle.");
  return data;
}

/** Leave flow.
 *  - Member (non-creator): delete the membership row.
 *  - Creator: RPC `creator_leave_circle` — if other members exist, **transfer** `circles.creator_id`
 *    to the **earliest** `joined_at` among remaining members, promote their role, then remove the
 *    leaver; if the creator is **solo**, **archive** the circle and delete membership (unchanged).
 */
export async function leaveCircle({ circleId, userId, isCreator }) {
  if (isCreator) {
    const { data, error: rpcErr } = await supabase.rpc("creator_leave_circle", { p_circle_id: circleId });
    if (rpcErr) throw new Error(rpcErr.message || "Could not leave circle.");
    return data;
  }
  const { error: deleteErr } = await supabase
    .from("circle_members")
    .delete()
    .eq("circle_id", circleId)
    .eq("user_id", userId);
  if (deleteErr) throw deleteErr;
  return { outcome: "left" };
}

function parseMovieIdForShare(movieId) {
  const [media_type, tmdbStr] = (movieId || "").split("-");
  const tmdb_id = parseInt(tmdbStr, 10);
  if (!media_type || !Number.isFinite(tmdb_id)) {
    throw new Error("Invalid title.");
  }
  return { media_type, tmdb_id };
}

/** Circle ids where this title is published (current user). */
export async function fetchRatingCircleShareIds(movieId) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { media_type, tmdb_id } = parseMovieIdForShare(movieId);
  const { data, error } = await supabase
    .from("rating_circle_shares")
    .select("circle_id")
    .eq("user_id", user.id)
    .eq("tmdb_id", tmdb_id)
    .eq("media_type", media_type);
  if (error) throw new Error(error.message || "Could not load circle picks.");
  return (data || []).map((r) => r.circle_id).filter(Boolean);
}

/** Replace publish set for this title: `circleIds` is the full desired set (diffed against DB). */
export async function syncRatingCircleShares(movieId, circleIds) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");
  const { media_type, tmdb_id } = parseMovieIdForShare(movieId);
  const ids = [...new Set((circleIds || []).filter(Boolean))];

  const { data: existing, error: selErr } = await supabase
    .from("rating_circle_shares")
    .select("circle_id")
    .eq("user_id", user.id)
    .eq("tmdb_id", tmdb_id)
    .eq("media_type", media_type);
  if (selErr) throw new Error(selErr.message || "Could not sync circles.");

  const existingSet = new Set((existing || []).map((r) => r.circle_id));
  const targetSet = new Set(ids);
  const toRemove = [...existingSet].filter((id) => !targetSet.has(id));
  const toAdd = [...targetSet].filter((id) => !existingSet.has(id));

  if (toRemove.length > 0) {
    const { error: delErr } = await supabase
      .from("rating_circle_shares")
      .delete()
      .eq("user_id", user.id)
      .eq("tmdb_id", tmdb_id)
      .eq("media_type", media_type)
      .in("circle_id", toRemove);
    if (delErr) throw new Error(delErr.message || "Could not update circles.");
  }
  if (toAdd.length > 0) {
    const rows = toAdd.map((circle_id) => ({
      user_id: user.id,
      tmdb_id,
      media_type,
      circle_id,
    }));
    const { error: insErr } = await supabase.from("rating_circle_shares").insert(rows);
    if (insErr) throw new Error(insErr.message || "Could not publish to circles.");
  }
}

/** Add shares only (no deletes). Used for “Forward” from a circle so the source circle is never removed. */
export async function addRatingCircleShares(movieId, circleIds) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");
  const { media_type, tmdb_id } = parseMovieIdForShare(movieId);
  const want = [...new Set((circleIds || []).filter(Boolean))];
  if (want.length === 0) return;

  const { data: existing, error: selErr } = await supabase
    .from("rating_circle_shares")
    .select("circle_id")
    .eq("user_id", user.id)
    .eq("tmdb_id", tmdb_id)
    .eq("media_type", media_type);
  if (selErr) throw new Error(selErr.message || "Could not load circles.");

  const have = new Set((existing || []).map((r) => r.circle_id));
  const toAdd = want.filter((id) => !have.has(id));
  if (toAdd.length === 0) return;

  const rows = toAdd.map((circle_id) => ({
    user_id: user.id,
    tmdb_id,
    media_type,
    circle_id,
  }));
  const { error: insErr } = await supabase.from("rating_circle_shares").insert(rows);
  if (insErr) throw new Error(insErr.message || "Could not add to circles.");
}

export function currentUserRole(circle, userId) {
  if (!circle || !userId) return null;
  const row = (circle.members || []).find((m) => m.user_id === userId);
  return row?.role ?? null;
}

// =================================================================================================
// Phase B (v5.1.0) — invites. Sending and accepting go through Edge functions because they need
// service-role writes into other users' circle_members rows and/or auth.users lookups. Declining
// stays a client-direct update (the recipient's own invite row is RLS-writable).
// =================================================================================================

/** Ordered by newest first. Backed by the `get_my_pending_invites()` SECURITY DEFINER RPC so
 *  we can pre-join circles + profiles without fighting their SELECT RLS. */
export async function fetchPendingInvites() {
  const { data, error } = await supabase.rpc("get_my_pending_invites");
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.invite_id,
    circleId: row.circle_id,
    createdAt: row.created_at,
    circleName: row.circle_name,
    circleVibe: row.circle_vibe ?? "Mixed Bag",
    circleStatus: row.circle_status,
    circleArchivedAt: row.circle_archived_at,
    memberCount: Number(row.member_count) || 0,
    inviterId: row.inviter_id,
    inviterName: row.inviter_name || "Someone",
  }));
}

/** Edge functions return JSON `{ error: string }` on 4xx/5xx. `supabase-js` surfaces that as
 *  `FunctionsHttpError` with a generic message — the real string lives on `error.context`
 *  (the Response). Parse it so the invite sheet shows the server message, not "non-2xx". */
async function invokeCirclesEdge(fnName, body) {
  const { data, error } = await supabase.functions.invoke(fnName, { body });
  if (error) {
    let msg = error.message || `Request failed (${fnName}).`;
    if (error instanceof FunctionsHttpError && error.context) {
      try {
        const errBody = await error.context.json();
        if (errBody && typeof errBody === "object" && typeof errBody.error === "string") {
          msg = errBody.error;
        }
      } catch {
        // Non-JSON body or empty — keep generic msg
      }
    }
    throw new Error(msg);
  }
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    throw new Error(data.error);
  }
  return data;
}

/** Sends (or resurrects) an invite for `invitedEmail` to `circleId`. If the recipient is at the
 *  Active-circle user cap: the Edge function auto-declines (spec §3.2) — we surface that as a
 *  dedicated status on the returned object so the UI can show the right toast. */
export async function sendCircleInvite({ circleId, invitedEmail }) {
  const email = (invitedEmail || "").trim();
  if (!email) throw new Error("Enter an email address.");
  return invokeCirclesEdge("send-circle-invite", {
    circle_id: circleId,
    invited_email: email,
  });
}

// -------------------------------------------------------------------------------------------------
// Copy-to-mail — non-user circle invite (master backlog item 2; no server-sent email in this path).
// -------------------------------------------------------------------------------------------------

/** App URL for the prefilled “download Cinemastro” line (production web; swap if deploy host changes). */
export const COPY_TO_MAIL_CINEMASTRO_URL = "https://cinematch-nine-sigma.vercel.app/";

/** `send-circle-invite` 404 when `resolve_profile_id_by_email` is empty; UI offers copy-to-mail. */
export const INVITE_NO_CINEMASTRO_ACCOUNT_ERR_PREFIX = "No Cinemastro account found for that email";

/**
 * @param {{ inviterDisplayName: string }} args — inviter from `profiles.name` with auth fallbacks in the client.
 * @returns {{ subject: string, body: string, fullText: string }} — `fullText` = Subject line + body for clipboard.
 */
export function buildCopyToMailCircleInviteText({ inviterDisplayName }) {
  const friend = (inviterDisplayName || "").trim() || "A friend";
  const subject = `You've been invited to join ${friend}'s circle (don't worry, it's about movies)`;
  const body = `Plot twist: ${friend} thinks your movie taste is so good, they invited you to join Cinemastro.

Cinemastro is what happens when a recommendation app stops guessing and starts knowing. It learns what you love and predicts your rating before you watch. No trending lists, no algorithm confusion. Just movies made for you.

Your circle gets:

  • Personalized predictions (scary accurate)
  • A group pick that actually works for everyone
  • Zero judgment about your guilty pleasure watches

Start with a few ratings of movies you actually love. That's it. The magic happens from there.

DOWNLOAD CINEMASTRO
${COPY_TO_MAIL_CINEMASTRO_URL}

Great taste is better shared — especially when it's this easy.`;
  const fullText = `Subject: ${subject}\n\n${body}`;
  return { subject, body, fullText };
}

const MAILTO_INVITE_EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `mailto:` for prefilled To / Subject / Body. Uses `encodeURIComponent` (spaces → `%20`), not
 * `URLSearchParams` / `+` — Apple Mail and others show literal `+` in the compose fields otherwise.
 * Length can be large — some clients truncate; copy remains the fallback.
 * @param {{ inviterDisplayName: string, recipientEmail: string }} args
 * @returns {string} `mailto:…` or `""` if the address is empty / invalid
 */
export function buildCopyToMailCircleInviteMailto({ inviterDisplayName, recipientEmail }) {
  const to = (recipientEmail || "").trim();
  if (!to || !MAILTO_INVITE_EMAIL_OK.test(to)) return "";
  const { subject, body } = buildCopyToMailCircleInviteText({ inviterDisplayName });
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Accepts a pending invite. Returns the full circle row (with members[]) so the caller can
 *  prepend it to the list without a refetch. */
export async function acceptCircleInvite({ inviteId }) {
  if (!inviteId) throw new Error("Missing invite.");
  return invokeCirclesEdge("accept-circle-invite", { invite_id: inviteId });
}

/** First page size for circle strip; subsequent pages use {@link CIRCLE_STRIP_PAGE}. Max rows server-side: {@link CIRCLE_STRIP_MAX}. */
export const CIRCLE_STRIP_INITIAL = 10;
export const CIRCLE_STRIP_PAGE = 5;
export const CIRCLE_STRIP_MAX = 20;

/** All / Top grid: page size (matches Discover-style first paint). Top view max rows: {@link CIRCLE_TOP_MAX}. */
export const CIRCLE_GRID_PAGE = 10;
export const CIRCLE_TOP_MAX = 25;

const CIRCLE_RATED_RPC = {
  recent: "get_circle_rated_strip",
  all: "get_circle_rated_all_grid",
  top: "get_circle_rated_top_grid",
};

function normalizeCircleRatedRpcPayload(data, fallbackMsg) {
  const strip = data && typeof data === "object" ? data : null;
  if (!strip) throw new Error(fallbackMsg || "Could not load circle titles.");
  const titles = Array.isArray(strip.titles) ? strip.titles : [];
  return {
    ok: true,
    member_count: Number(strip.member_count ?? 0),
    gated: Boolean(strip.gated),
    total_eligible: Number(strip.total_eligible ?? 0),
    has_more: Boolean(strip.has_more),
    titles: titles.map((t) => ({ ...t, prediction: null })),
  };
}

/** Circle rated titles: `view` recent (horizontal strip RPC), all (grid), or top (grid, cap 25). Edge + RPC fallback. */
// -------------------------------------------------------------------------------------------------
// Circle activity badges (5.6.33): per-user last_seen in DB; counts = others' rating_circle_shares
// with created_at > last_seen. See supabase/migrations/20260527120000_circle_member_last_seen.sql
// -------------------------------------------------------------------------------------------------

/**
 * @returns {Promise<Array<{ circle_id: string, unseen_others: number, latest_others_share_at: string | null }>>}
 */
export async function fetchMyCircleUnseenActivity() {
  const { data, error } = await supabase.rpc("get_my_circle_unseen_counts");
  if (error) throw new Error(error.message || "Could not load circle activity.");
  const root = data && typeof data === "object" ? data : null;
  const rows = root?.rows;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({
      circleId: r?.circle_id,
      unseenOthers: Number(r?.unseen_others) || 0,
      latestOthersShareAt:
        r?.latest_others_share_at == null
          ? null
          : typeof r.latest_others_share_at === "string"
            ? r.latest_others_share_at
            : String(r.latest_others_share_at),
    }))
    .filter((r) => r.circleId);
}

/** Call when the user opens a circle (list badge clears; server stores last_seen). */
export async function markCircleLastSeen(circleId) {
  const id = (circleId || "").trim();
  if (!id) return;
  const { error } = await supabase.rpc("mark_circle_last_seen", { p_circle_id: id });
  if (error) throw new Error(error.message || "Could not mark circle as seen.");
}

/**
 * @returns {Promise<string | null>} ISO time of the newest other member’s share in the circle, or null.
 */
export async function getCircleOthersActivityWatermark(circleId) {
  const id = (circleId || "").trim();
  if (!id) return null;
  const { data, error } = await supabase.rpc("get_circle_others_activity_watermark", {
    p_circle_id: id,
  });
  if (error) throw new Error(error.message || "Could not read activity time.");
  if (data == null) return null;
  if (data instanceof Date) return data.toISOString();
  return String(data);
}

export async function fetchCircleRatedTitles({ circleId, limit, offset, view = "recent" }) {
  const id = (circleId || "").trim();
  if (!id) throw new Error("Missing circle.");
  const v = view === "all" || view === "top" ? view : "recent";
  const pLimit =
    limit ??
    (v === "recent" ? CIRCLE_STRIP_INITIAL : CIRCLE_GRID_PAGE);
  const pOffset = offset ?? 0;
  const body = { circle_id: id, p_limit: pLimit, p_offset: pOffset, view: v };
  try {
    return await invokeCirclesEdge("get-circle-rated-titles", body);
  } catch (e) {
    const msg = e?.message || "";
    if (msg.includes("not a member") || msg.includes("Unauthorized")) throw e;
    console.warn("fetchCircleRatedTitles: Edge failed, trying RPC-only (no CF predictions)", msg);
    const rpcName = CIRCLE_RATED_RPC[v];
    const { data, error } = await supabase.rpc(rpcName, {
      p_circle_id: id,
      p_limit: pLimit,
      p_offset: pOffset,
    });
    if (error) throw new Error(error.message || msg || "Could not load circle titles.");
    return normalizeCircleRatedRpcPayload(data, msg);
  }
}

/** Decline runs directly under the "recipient can respond to invite" UPDATE policy. No Edge. */
export async function declineCircleInvite({ inviteId }) {
  if (!inviteId) throw new Error("Missing invite.");
  const { error } = await supabase
    .from("circle_invites")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", inviteId);
  if (error) throw error;
}
