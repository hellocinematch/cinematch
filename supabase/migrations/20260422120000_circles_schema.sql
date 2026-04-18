-- Circles feature (v4.1 phase A): schema + RLS only. No Edge functions, no UI, no data.
-- Spec: Architechture/cinemastro-circles-requirements.md
--
-- ================================================================================================
-- PRODUCT RULES BAKED INTO THIS MIGRATION
-- ================================================================================================
--   * Users belong to at most 10 ACTIVE circles (archived do not count). Enforced in app code / Edge
--     functions (not at the DB constraint level — a multi-row check is impractical in CHECK).
--   * Circles hold at most 25 members. Same enforcement point as above.
--   * Creator leaving does NOT dissolve the circle — it flips status = 'archived', archived_at = now().
--     Archived circles are read-only: no new invites, no new ratings propagate past archived_at,
--     archived circles do not count toward the 10-circle cap.
--   * Creator deleting their account cascades: ON DELETE CASCADE on circles.creator_id -> profiles(id)
--     triggers removal of circles, which cascades to circle_members and circle_invites.
--   * When the last member leaves an archived circle the circle row is hard-deleted (app/Edge rule).
--   * A newly-created circle with only the creator (1 member) does not surface ratings. Ratings
--     strip is only populated once member_count >= 2 (app/Edge rule, see display contract below).
--   * Accept-time cap race: if a recipient at the 10-active-circle cap taps "Join Circle", the
--     Edge function returns an error and LEAVES the invite status = 'pending' (not auto_declined).
--     Send-time cap breach DOES auto-decline (spec §3.2).
--
-- ================================================================================================
-- PHASE C DISPLAY CONTRACT — "Rated in this circle" strip (get-circle-rated-titles Edge function)
-- ================================================================================================
-- Gate on the whole strip:
--   * Hidden entirely when the circle has < 2 members.
--
-- Two sections inside the strip, both derived from circle_members JOIN ratings:
--
--   Section 1 — "Rated in this circle"
--     * Titles where >= 2 distinct circle members have a ratings row.
--     * Per card: poster · title · GROUP rating (avg across circle members' ratings) ·
--                 YOUR score (actual in gold if you rated, else predicted CF score).
--
--   Section 2 — "Also watched here"
--     * Titles where exactly 1 circle member has a ratings row.
--     * Per card: poster · title · CINEMASTRO site-wide rating (fallback; no group rating possible
--                 without leaking the single rater's score) · YOUR score (actual or predicted).
--
-- Never displayed in either section:
--   * Any individual member's rating value (only your own).
--   * The "X rated" count (product decision: counts are suppressed in the strip UI even though
--     spec §2.3 permits them).
--
-- Archived circle modifier:
--   * When circles.status = 'archived', both sections filter ratings to rated_at < archived_at.
--     Ratings made by members after the archive timestamp are excluded.
--
-- ================================================================================================
-- DEFERRED (NOT in this migration)
-- ================================================================================================
--   * watchlist.source_circle_id column (Phase C — when dashboard UI adds a title with attribution).
--   * circles.icon_emoji (Phase A UI — add when CreateCircleSheet picks one).
--   * circles.color (Phase 2 — MVP derives color from vibe in the design tokens).
--   * Storage bucket for cover_image_url (Phase E — when upload UI ships).

-- ------------------------------------------------------------------------------------------------
-- circles
-- ------------------------------------------------------------------------------------------------

create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null
    check (char_length(name) between 1 and 40),
  description text
    check (description is null or char_length(description) <= 100),
  vibe text
    check (
      vibe is null or vibe in (
        'Mixed Bag', 'Arthouse', 'Family', 'Horror', 'Sci-Fi',
        'Documentary', 'Drama', 'Comedy', 'Thriller'
      )
    ),
  cover_image_url text,
  creator_id uuid not null,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint circles_creator_id_fkey
    foreign key (creator_id) references public.profiles (id) on delete cascade,
  constraint circles_archived_consistency
    check (
      (status = 'active'   and archived_at is null) or
      (status = 'archived' and archived_at is not null)
    )
);

comment on table public.circles is
  'Private taste-sharing groups. Max 25 members, max 10 active per user (enforced in app/Edge). Archived circles are read-only and do not count toward the user cap.';

comment on column public.circles.status is
  'active | archived. Flipped to archived when the creator leaves (ownership transfer is Phase 2).';

comment on column public.circles.archived_at is
  'Timestamp when status became archived. Used by get-circle-rated-titles to cut off ratings propagation (ratings.rated_at < archived_at only).';

create index if not exists circles_creator_id_idx
  on public.circles (creator_id);

-- updated_at trigger
create or replace function public.set_circles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists circles_set_updated_at on public.circles;
create trigger circles_set_updated_at
  before update on public.circles
  for each row
  execute function public.set_circles_updated_at();

-- ------------------------------------------------------------------------------------------------
-- circle_members
-- ------------------------------------------------------------------------------------------------

create table if not exists public.circle_members (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null,
  user_id uuid not null,
  role text not null
    check (role in ('creator', 'member')),
  joined_at timestamptz not null default now(),
  constraint circle_members_circle_id_fkey
    foreign key (circle_id) references public.circles (id) on delete cascade,
  constraint circle_members_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint circle_members_unique_membership
    unique (circle_id, user_id)
);

comment on table public.circle_members is
  'Membership rows. Creator has role=creator; when creator leaves we delete their row and flip circles.status=archived.';

-- Hot path: "list my circles" + "my pending invite count math" + member_count per circle.
create index if not exists circle_members_user_id_idx
  on public.circle_members (user_id);
create index if not exists circle_members_circle_id_idx
  on public.circle_members (circle_id);

-- ------------------------------------------------------------------------------------------------
-- circle_invites
-- ------------------------------------------------------------------------------------------------

create table if not exists public.circle_invites (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null,
  invited_by uuid not null,
  invited_user_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'auto_declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint circle_invites_circle_id_fkey
    foreign key (circle_id) references public.circles (id) on delete cascade,
  constraint circle_invites_invited_by_fkey
    foreign key (invited_by) references public.profiles (id) on delete cascade,
  constraint circle_invites_invited_user_id_fkey
    foreign key (invited_user_id) references public.profiles (id) on delete cascade,
  -- Prevent duplicate active invites. Resolved invites (accepted/declined/auto_declined) that later
  -- need a fresh send must UPDATE the row's status back to 'pending' rather than insert a new row.
  constraint circle_invites_unique_pending
    unique (circle_id, invited_user_id),
  constraint circle_invites_responded_consistency
    check (
      (status = 'pending'  and responded_at is null) or
      (status <> 'pending' and responded_at is not null)
    )
);

comment on table public.circle_invites is
  'Invites into a circle. status=pending|accepted|declined|auto_declined. auto_declined fires at send-time if recipient is at 10-active-circle cap (spec §3.2). Accept-time cap race returns an error and leaves status=pending (spec §3.3 + Phase A confirmation).';

create index if not exists circle_invites_invited_user_id_status_idx
  on public.circle_invites (invited_user_id, status);
create index if not exists circle_invites_circle_id_idx
  on public.circle_invites (circle_id);

-- ================================================================================================
-- Row Level Security
-- ================================================================================================

alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.circle_invites enable row level security;

-- circles ----------------------------------------------------------------------------------------

drop policy if exists "circle members can read circle" on public.circles;
create policy "circle members can read circle"
  on public.circles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.circle_members cm
      where cm.circle_id = circles.id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "creator can update own circle" on public.circles;
create policy "creator can update own circle"
  on public.circles
  for update
  to authenticated
  using (
    status = 'active'
    and exists (
      select 1
      from public.circle_members cm
      where cm.circle_id = circles.id
        and cm.user_id = auth.uid()
        and cm.role = 'creator'
    )
  )
  with check (
    exists (
      select 1
      from public.circle_members cm
      where cm.circle_id = circles.id
        and cm.user_id = auth.uid()
        and cm.role = 'creator'
    )
  );

drop policy if exists "creator can insert own circle" on public.circles;
create policy "creator can insert own circle"
  on public.circles
  for insert
  to authenticated
  with check (auth.uid() = creator_id and status = 'active');

drop policy if exists "creator can delete own circle" on public.circles;
create policy "creator can delete own circle"
  on public.circles
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.circle_members cm
      where cm.circle_id = circles.id
        and cm.user_id = auth.uid()
        and cm.role = 'creator'
    )
  );

-- circle_members ---------------------------------------------------------------------------------

drop policy if exists "member can read own memberships" on public.circle_members;
create policy "member can read own memberships"
  on public.circle_members
  for select
  to authenticated
  using (
    -- A user sees every row of any circle they belong to (so we can render the avatar stack /
    -- members sheet). They do NOT see memberships of circles they are not part of.
    exists (
      select 1
      from public.circle_members cm2
      where cm2.circle_id = circle_members.circle_id
        and cm2.user_id = auth.uid()
    )
  );

-- Creator seed-insert when a circle is created. The initial row that makes the creator a member.
-- Additional member rows are inserted by the accept-circle-invite Edge function (service role,
-- bypasses RLS). Members cannot self-insert into circles they aren't invited to.
drop policy if exists "creator can seed own membership" on public.circle_members;
create policy "creator can seed own membership"
  on public.circle_members
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'creator'
    and exists (
      select 1
      from public.circles c
      where c.id = circle_members.circle_id
        and c.creator_id = auth.uid()
    )
  );

drop policy if exists "member can leave circle" on public.circle_members;
create policy "member can leave circle"
  on public.circle_members
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    -- NOTE: creator-leave side effect (flip circles.status=archived, archived_at=now()) is handled
    -- by a Phase B Edge function, not a DB trigger, so we keep the schema trigger-free for now.
  );

-- circle_invites ---------------------------------------------------------------------------------

drop policy if exists "recipient or creator can read invite" on public.circle_invites;
create policy "recipient or creator can read invite"
  on public.circle_invites
  for select
  to authenticated
  using (
    invited_user_id = auth.uid()
    or exists (
      select 1
      from public.circle_members cm
      where cm.circle_id = circle_invites.circle_id
        and cm.user_id = auth.uid()
        and cm.role = 'creator'
    )
  );

drop policy if exists "active circle creator can invite" on public.circle_invites;
create policy "active circle creator can invite"
  on public.circle_invites
  for insert
  to authenticated
  with check (
    invited_by = auth.uid()
    and exists (
      select 1
      from public.circles c
      join public.circle_members cm on cm.circle_id = c.id
      where c.id = circle_invites.circle_id
        and c.status = 'active'
        and cm.user_id = auth.uid()
        and cm.role = 'creator'
    )
  );

-- Recipient can accept/decline their own invite. Senders cannot modify invites they sent; all other
-- transitions (auto_declined at send-time cap breach) happen via the service-role Edge function.
drop policy if exists "recipient can respond to invite" on public.circle_invites;
create policy "recipient can respond to invite"
  on public.circle_invites
  for update
  to authenticated
  using (invited_user_id = auth.uid())
  with check (invited_user_id = auth.uid());

-- ================================================================================================
-- Grants
-- ================================================================================================

grant select, insert, update, delete on public.circles to authenticated;
grant select, insert, delete on public.circle_members to authenticated;
grant select, insert, update on public.circle_invites to authenticated;
