-- Per-user per-circle "last time I opened the circle" for activity badges.
-- Unseen count = rating_circle_shares in that circle with user_id <> viewer
--   and created_at > last_seen_at (others' new publishes only; excludes your own
--   so the badge highlights others' new picks to discover).
-- Backfill last_seen to now() so we do not flood badges on first deploy.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.circle_member_last_seen (
  user_id uuid not null,
  circle_id uuid not null,
  last_seen_at timestamptz not null,
  constraint circle_member_last_seen_pkey primary key (user_id, circle_id),
  constraint circle_member_last_seen_user_fk
    foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint circle_member_last_seen_circle_fk
    foreign key (circle_id) references public.circles (id) on delete cascade,
  constraint circle_member_last_seen_member_fk
    foreign key (circle_id, user_id) references public.circle_members (circle_id, user_id) on delete cascade
);

comment on table public.circle_member_last_seen is
  'When the user last “visited” a circle; compared to other members’ rating_circle_shares.created_at for badge counts.';

create index if not exists rating_circle_shares_circle_created_at_idx
  on public.rating_circle_shares (circle_id, created_at desc);

alter table public.circle_member_last_seen enable row level security;

create policy "circle_member_last_seen select own"
  on public.circle_member_last_seen for select
  to authenticated
  using (auth.uid() = user_id);

-- Writes go through mark_circle_last_seen (security definer) only; no direct insert from client.
grant select on public.circle_member_last_seen to authenticated;

-- ---------------------------------------------------------------------------
-- New memberships: start “caught up” (no instant backlog of historical publishes)
-- ---------------------------------------------------------------------------

create or replace function public.trg_set_circle_last_seen_on_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.circle_member_last_seen (user_id, circle_id, last_seen_at)
  values (new.user_id, new.circle_id, now())
  on conflict (user_id, circle_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_circle_members_set_last_seen on public.circle_members;
create trigger trg_circle_members_set_last_seen
  after insert on public.circle_members
  for each row
  execute function public.trg_set_circle_last_seen_on_join();

-- ---------------------------------------------------------------------------
-- Backfill for existing members (one-time, no historical badge flood)
-- ---------------------------------------------------------------------------

insert into public.circle_member_last_seen (user_id, circle_id, last_seen_at)
select cm.user_id, cm.circle_id, now()
from public.circle_members cm
on conflict (user_id, circle_id) do nothing;

-- ---------------------------------------------------------------------------
-- get_my_circle_unseen_counts: logged-in, all active circle memberships
-- ---------------------------------------------------------------------------

create or replace function public.get_my_circle_unseen_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('rows', '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_build_object(
      'rows',
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'circle_id', x.circle_id,
            'unseen_others', x.unseen_others,
            'latest_others_share_at', to_jsonb(x.latest_others_share_at)
          )
          order by x.circle_id
        ) filter (where x.circle_id is not null),
        '[]'::jsonb
      )
    )
    from (
      select
        cm.circle_id,
        coalesce((
          select count(*)::int
          from public.rating_circle_shares sh
          where sh.circle_id = cm.circle_id
            and sh.user_id is distinct from v_uid
            and sh.created_at > coalesce(ls.last_seen_at, now())
        ), 0) as unseen_others,
        (
          select max(sh.created_at)
          from public.rating_circle_shares sh
          where sh.circle_id = cm.circle_id
            and sh.user_id is distinct from v_uid
        ) as latest_others_share_at
      from public.circle_members cm
      inner join public.circles c
        on c.id = cm.circle_id
       and c.status = 'active'
      left join public.circle_member_last_seen ls
        on ls.user_id = v_uid
       and ls.circle_id = cm.circle_id
      where cm.user_id = v_uid
    ) x
  ), jsonb_build_object('rows', '[]'::jsonb));
end;
$$;

comment on function public.get_my_circle_unseen_counts() is
  'For each active circle: unseen_others = count of others’ rating_circle_shares with created_at > last_seen.';

grant execute on function public.get_my_circle_unseen_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- mark_circle_last_seen: call when user opens a circle (clears list badge)
-- ---------------------------------------------------------------------------

create or replace function public.mark_circle_last_seen(
  p_circle_id uuid,
  p_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  v_t := coalesce(p_at, now());

  if not exists (
    select 1 from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
  ) then
    raise exception 'not a member of this circle';
  end if;

  insert into public.circle_member_last_seen (user_id, circle_id, last_seen_at)
  values (v_uid, p_circle_id, v_t)
  on conflict (user_id, circle_id) do update
    set last_seen_at = greatest(
      public.circle_member_last_seen.last_seen_at,
      excluded.last_seen_at
    );
end;
$$;

comment on function public.mark_circle_last_seen(uuid, timestamptz) is
  'User visited the circle: updates last_seen so Circles list badge clears.';

grant execute on function public.mark_circle_last_seen(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- get_circle_others_activity_watermark: max(created_at) of others’ shares
-- (client compares after loading feed to show “new activity — refresh”)
-- ---------------------------------------------------------------------------

create or replace function public.get_circle_others_activity_watermark(
  p_circle_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_m timestamptz;
begin
  if v_uid is null then
    return null;
  end if;

  if not exists (
    select 1 from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
  ) then
    raise exception 'not a member of this circle';
  end if;

  select max(sh.created_at)
    into v_m
  from public.rating_circle_shares sh
  where sh.circle_id = p_circle_id
    and sh.user_id is distinct from v_uid;

  return v_m;
end;
$$;

comment on function public.get_circle_others_activity_watermark(uuid) is
  'Latest created_at of other members’ rating_circle_shares in this circle; in-app refresh hint.';

grant execute on function public.get_circle_others_activity_watermark(uuid) to authenticated;
