-- Circles: admin-only membership roles (no creator role). Leave via `leave_circle` RPC:
--   * Multiple members: remove caller; trigger resyncs roles — top 3 by joined_at = admin, rest member;
--     if n < 3, all admins.
--   * Last member: delete the circle row (CASCADE: members, invites, rating_circle_shares, last_seen).
-- `circles.creator_id` stays set to the founding user for INSERT RLS / legacy reads; it is not updated on leave.

-- 1) Normalize existing data
update public.circle_members
set role = 'admin'
where role = 'creator';

alter table public.circle_members
  drop constraint if exists circle_members_role_check;
alter table public.circle_members
  add constraint circle_members_role_check
  check (role in ('admin', 'member'));

comment on table public.circle_members is
  'Membership rows. role=admin for hosts (up to 3 most senior by joined_at, or all members when n < 3); else member.';

-- 2) Role sync: seniority only (no circles.creator_id)
create or replace function public.sync_circle_member_roles(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with ord as (
    select
      cm.id,
      cm.user_id,
      count(*) over (partition by cm.circle_id) as cnt,
      row_number() over (
        partition by cm.circle_id
        order by cm.joined_at asc nulls last, cm.user_id asc
      ) as rn
    from public.circle_members cm
    where cm.circle_id = p_circle_id
  ),
  computed as (
    select
      o.id,
      case
        when o.cnt < 3 then 'admin'
        when o.rn <= 3 then 'admin'
        else 'member'
      end as new_role
    from ord o
  )
  update public.circle_members cm
  set role = c.new_role
  from computed c
  where cm.id = c.id
    and cm.role is distinct from c.new_role;
end;
$$;

comment on function public.sync_circle_member_roles(uuid) is
  'Sets circle_members: all admin if n<3; else three most senior by joined_at = admin; rest member.';

-- 3) Moderators = admin only
create or replace function public.is_circle_moderator(cid uuid)
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
      and role = 'admin'
  );
$$;

create or replace function public.is_active_circle_moderator(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.circles c
    join public.circle_members cm on cm.circle_id = c.id
    where c.id = cid
      and c.status = 'active'
      and cm.user_id = auth.uid()
      and cm.role = 'admin'
  );
$$;

comment on function public.is_circle_moderator(uuid) is
  'RLS: auth.uid() is admin (host) for this circle.';

comment on function public.is_active_circle_moderator(uuid) is
  'RLS: active circle and auth.uid() is admin.';

-- 4) Legacy helper: treat "creator" UI checks as host (admin-only roles now)
create or replace function public.is_circle_creator(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_circle_moderator(cid);
$$;

comment on function public.is_circle_creator(uuid) is
  'Deprecated alias for is_circle_moderator (admin-only circles).';

-- 5) Seed first membership as admin
drop policy if exists "creator can seed own membership" on public.circle_members;
create policy "creator can seed own membership"
  on public.circle_members
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'admin'
    and public.circle_owned_by_caller(circle_members.circle_id)
  );

drop policy if exists "creator can delete own circle" on public.circles;
create policy "creator can delete own circle"
  on public.circles
  for delete
  to authenticated
  using (public.is_circle_moderator(id));

-- 6) Replace creator_leave_circle with leave_circle
drop function if exists public.creator_leave_circle(uuid);

create or replace function public.leave_circle(p_circle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.circles c
    where c.id = p_circle_id
      and c.status = 'active'
  ) then
    raise exception 'circle not found or not active';
  end if;

  if not exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
  ) then
    raise exception 'not a member';
  end if;

  select count(*)::int
    into v_count
  from public.circle_members
  where circle_id = p_circle_id;

  if v_count <= 1 then
    delete from public.circles
    where id = p_circle_id;
    return jsonb_build_object('outcome', 'circle_deleted', 'deleted', true);
  end if;

  delete from public.circle_members
  where circle_id = p_circle_id
    and user_id = v_uid;

  return jsonb_build_object('outcome', 'left', 'deleted', false);
end;
$$;

comment on function public.leave_circle(uuid) is
  'Member leaves: if last member, delete circle (cascade); else remove membership (roles resync via trigger).';

revoke all on function public.leave_circle(uuid) from public;
grant execute on function public.leave_circle(uuid) to authenticated;

-- 7) Resync all active circles
do $$
declare
  r record;
begin
  for r in select id as circle_id from public.circles where status = 'active' loop
    perform public.sync_circle_member_roles(r.circle_id);
  end loop;
end;
$$;
