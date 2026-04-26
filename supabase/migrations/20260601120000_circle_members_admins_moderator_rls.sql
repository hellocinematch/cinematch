-- Circle "admins" (4a): 2nd and 3rd joiners (by joined_at) get role = 'admin' with the same
-- privileges as the creator for edit + invite. circles.creator_id row keeps role = 'creator'.
-- Trigger keeps roles in sync on membership changes.

-- 1) Allow 'admin' on circle_members.role
alter table public.circle_members
  drop constraint if exists circle_members_role_check;
alter table public.circle_members
  add constraint circle_members_role_check
  check (role in ('creator', 'member', 'admin'));

comment on table public.circle_members is
  'Membership rows. role=creator for circles.creator_id; 2nd/3rd by joined_at = admin; else member.';

-- 2) Recompute roles for one circle: creator_id always "creator"; join positions 2 and 3 = "admin". 
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
      c.creator_id,
      row_number() over (
        partition by cm.circle_id
        order by cm.joined_at asc nulls last, cm.user_id asc
      ) as rn
    from public.circle_members cm
    join public.circles c on c.id = cm.circle_id
    where cm.circle_id = p_circle_id
  ),
  computed as (
    select
      o.id,
      case
        when o.user_id = o.creator_id then 'creator'
        when o.rn in (2, 3) then 'admin'
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
  'Sets circle_members roles: creator_id -> creator; 2nd/3rd by joined_at -> admin; else member.';

-- 3) After insert or delete, resync the affected circle.
create or replace function public.trg_sync_circle_member_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'delete' then
    perform public.sync_circle_member_roles(old.circle_id);
  else
    perform public.sync_circle_member_roles(new.circle_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_circle_member_roles on public.circle_members;
create trigger trg_sync_circle_member_roles
  after insert or delete on public.circle_members
  for each row
  execute function public.trg_sync_circle_member_roles();

-- 4) one-time resync (trigger only runs on new inserts/deletes, not on existing data)
do $$
declare
  r record;
begin
  for r in select distinct id as circle_id from public.circles where status = 'active' loop
    perform public.sync_circle_member_roles(r.circle_id);
  end loop;
end;
$$;

-- 5) RLS helpers: moderator = creator or admin in membership
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
      and role in ('creator', 'admin')
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
      and cm.role in ('creator', 'admin')
  );
$$;

comment on function public.is_circle_moderator(uuid) is
  'RLS: auth.uid() is creator or admin for this circle.';

comment on function public.is_active_circle_moderator(uuid) is
  'RLS: active circle and auth.uid() is creator or admin.';

revoke all on function public.is_circle_moderator(uuid) from public;
revoke all on function public.is_active_circle_moderator(uuid) from public;
grant execute on function public.is_circle_moderator(uuid) to authenticated;
grant execute on function public.is_active_circle_moderator(uuid) to authenticated;

revoke all on function public.sync_circle_member_roles(uuid) from public;

-- 6) policies: allow moderators to update circles; keep delete creator-only; invites for moderators
drop policy if exists "creator can update own circle" on public.circles;
create policy "creator can update own circle"
  on public.circles
  for update
  to authenticated
  using (status = 'active' and public.is_circle_moderator(id))
  with check (public.is_circle_moderator(id));

drop policy if exists "recipient or creator can read invite" on public.circle_invites;
create policy "recipient or creator can read invite"
  on public.circle_invites
  for select
  to authenticated
  using (
    invited_user_id = auth.uid()
    or public.is_circle_moderator(circle_id)
  );

drop policy if exists "active circle creator can invite" on public.circle_invites;
create policy "active circle creator can invite"
  on public.circle_invites
  for insert
  to authenticated
  with check (
    invited_by = auth.uid()
    and public.is_active_circle_moderator(circle_id)
  );
