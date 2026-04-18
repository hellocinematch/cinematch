-- Circles RLS hotfix (v5.0.0): break infinite recursion + unblock the create-circle seed path.
--
-- ================================================================================================
-- WHAT BROKE
-- ================================================================================================
--
-- The Phase A schema migration (20260422120000_circles_schema.sql) had two policies that inlined
-- EXISTS subqueries against public.circle_members:
--
--   1. public.circles         — "circle members can read circle"  (SELECT)
--   2. public.circle_members  — "member can read own memberships" (SELECT)
--   3. public.circles         — "creator can update own circle"   (UPDATE, USING + WITH CHECK)
--   4. public.circles         — "creator can delete own circle"   (DELETE)
--   5. public.circle_invites  — "recipient or creator can read invite" (SELECT)
--   6. public.circle_invites  — "active circle creator can invite"     (INSERT)
--
-- Any statement that touches circle_members under RLS causes Postgres to evaluate
-- "member can read own memberships" on the result rows. That policy's USING clause runs
-- `select 1 from public.circle_members cm2 where ...`, which is itself an RLS-gated read of
-- circle_members, which re-triggers the same policy, which runs another read, and so on —
-- infinite recursion. The SELECT policies on circles and circle_invites inherit the problem
-- because they also query circle_members in their USING clauses.
--
-- The original SQL-editor smoke test didn't flag this because the editor runs as `postgres`
-- (service role), which bypasses RLS entirely. Only an `authenticated`-role session surfaces
-- the error, which is what `supabase-js` uses from the client.
--
-- ================================================================================================
-- FIX
-- ================================================================================================
--
-- Move the membership/role checks into SECURITY DEFINER helper functions that bypass RLS for
-- the inner read. Policies then call the helper instead of inlining an EXISTS against the same
-- table. This is the canonical Supabase pattern for intra-table RLS chains.
--
-- Additionally: add a "creator can read own circle" SELECT policy on circles. Without it, the
-- "creator can seed own membership" policy's EXISTS against public.circles can never succeed
-- during createCircle — the circle row was just inserted but the caller has no membership row
-- yet, so circles' SELECT RLS hides it. The new policy lets creators see their own circles
-- independent of membership (also cleanly handles archived circles where the creator has left
-- and thus lost their circle_members row).
--
-- All policies are declared with `drop policy if exists ... create policy ...` so re-running
-- this migration is safe. The helper functions use `create or replace function`.
-- ================================================================================================

-- ------------------------------------------------------------------------------------------------
-- SECURITY DEFINER helpers
-- ------------------------------------------------------------------------------------------------

create or replace function public.is_circle_member(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.circle_members
    where circle_id = cid
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_circle_creator(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.circle_members
    where circle_id = cid
      and user_id = auth.uid()
      and role = 'creator'
  );
$$;

-- Used by the creator-seed membership policy (avoids circles-table RLS at seed time) and by
-- the invite-insert policy (checks the circle is active + owned by caller).
create or replace function public.circle_owned_by_caller(cid uuid, require_active boolean default false)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.circles
    where id = cid
      and creator_id = auth.uid()
      and (not require_active or status = 'active')
  );
$$;

comment on function public.is_circle_member(uuid) is
  'RLS helper: does auth.uid() have any circle_members row for this circle? SECURITY DEFINER so inner read bypasses circle_members SELECT policy (prevents infinite recursion).';

comment on function public.is_circle_creator(uuid) is
  'RLS helper: does auth.uid() have a creator-role circle_members row for this circle? SECURITY DEFINER, same recursion rationale as is_circle_member.';

comment on function public.circle_owned_by_caller(uuid, boolean) is
  'RLS helper: does the circles row exist with creator_id = auth.uid()? Optional require_active flag also gates on status = ''active''. SECURITY DEFINER so create-circle seed and invite-insert can check ownership without needing circles SELECT RLS to clear first.';

grant execute on function public.is_circle_member(uuid) to authenticated;
grant execute on function public.is_circle_creator(uuid) to authenticated;
grant execute on function public.circle_owned_by_caller(uuid, boolean) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- circles
-- ------------------------------------------------------------------------------------------------

drop policy if exists "circle members can read circle" on public.circles;
create policy "circle members can read circle"
  on public.circles
  for select
  to authenticated
  using (public.is_circle_member(id));

-- NEW: creators always see their own circles, including archived ones and the freshly-inserted
-- circle during the two-step createCircle seed (before the membership row exists).
drop policy if exists "creator can read own circle" on public.circles;
create policy "creator can read own circle"
  on public.circles
  for select
  to authenticated
  using (creator_id = auth.uid());

drop policy if exists "creator can update own circle" on public.circles;
create policy "creator can update own circle"
  on public.circles
  for update
  to authenticated
  using (status = 'active' and public.is_circle_creator(id))
  with check (public.is_circle_creator(id));

drop policy if exists "creator can delete own circle" on public.circles;
create policy "creator can delete own circle"
  on public.circles
  for delete
  to authenticated
  using (public.is_circle_creator(id));

-- (circles INSERT "creator can insert own circle" stays as-is — no cross-table EXISTS.)

-- ------------------------------------------------------------------------------------------------
-- circle_members
-- ------------------------------------------------------------------------------------------------

drop policy if exists "member can read own memberships" on public.circle_members;
create policy "member can read own memberships"
  on public.circle_members
  for select
  to authenticated
  using (public.is_circle_member(circle_id));

-- Swap the EXISTS against public.circles for the SECURITY DEFINER helper, so this doesn't
-- depend on circles' SELECT RLS at seed time.
drop policy if exists "creator can seed own membership" on public.circle_members;
create policy "creator can seed own membership"
  on public.circle_members
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'creator'
    and public.circle_owned_by_caller(circle_members.circle_id)
  );

-- (circle_members DELETE "member can leave circle" stays as-is — user_id = auth.uid() only.)

-- ------------------------------------------------------------------------------------------------
-- circle_invites
-- ------------------------------------------------------------------------------------------------

drop policy if exists "recipient or creator can read invite" on public.circle_invites;
create policy "recipient or creator can read invite"
  on public.circle_invites
  for select
  to authenticated
  using (
    invited_user_id = auth.uid()
    or public.is_circle_creator(circle_id)
  );

drop policy if exists "active circle creator can invite" on public.circle_invites;
create policy "active circle creator can invite"
  on public.circle_invites
  for insert
  to authenticated
  with check (
    invited_by = auth.uid()
    and public.circle_owned_by_caller(circle_invites.circle_id, true)
  );

-- (circle_invites UPDATE "recipient can respond to invite" stays as-is — invited_user_id = auth.uid().)
