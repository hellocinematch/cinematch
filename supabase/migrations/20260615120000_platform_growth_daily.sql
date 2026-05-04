-- Platform growth: daily cumulative totals + explicit deltas (UTC calendar days).
-- Sources: auth.users (accounts), public.ratings (rows; uses created_at — see below), public.circles (created).
-- Backfill anchor: 2026-04-30. Nightly pg_cron refreshes through yesterday UTC (if pg_cron enabled).
--
-- Query (dashboard SQL): select * from public.platform_growth_daily order by stat_date;

-- ---------------------------------------------------------------------------
-- ratings.created_at — first insert time; rated_at still bumps on score change
-- ---------------------------------------------------------------------------

alter table public.ratings add column if not exists created_at timestamptz;

update public.ratings r
set created_at = r.rated_at
where r.created_at is null;

alter table public.ratings alter column created_at set default now();

alter table public.ratings alter column created_at set not null;

comment on column public.ratings.created_at is
  'Row insert time (UTC). Distinct from rated_at which updates when the score changes. Used for growth stats.';

create index if not exists ratings_created_at_idx
  on public.ratings (created_at);

-- ---------------------------------------------------------------------------
-- Snapshot table
-- ---------------------------------------------------------------------------

create table if not exists public.platform_growth_daily (
  stat_date date primary key,
  cumulative_users bigint not null,
  cumulative_ratings bigint not null,
  cumulative_circles bigint not null,
  new_users bigint not null,
  new_ratings bigint not null,
  new_circles bigint not null,
  computed_at timestamptz not null default now()
);

comment on table public.platform_growth_daily is
  'UTC dates: cumulative_* = counts with created_at < (stat_date + 1 day) UTC; new_* = rows whose timestamp falls on stat_date UTC.';

alter table public.platform_growth_daily enable row level security;

revoke all on table public.platform_growth_daily from public;

-- ---------------------------------------------------------------------------
-- Refresh helpers (SECURITY DEFINER reads auth.users)
-- ---------------------------------------------------------------------------

create or replace function public.platform_growth_refresh_range(p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d date;
  v_start timestamptz;
  v_end timestamptz;
  v_cu bigint;
  v_cr bigint;
  v_cc bigint;
  v_new_u bigint;
  v_new_r bigint;
  v_new_c bigint;
begin
  if p_to < p_from then
    return;
  end if;

  for d in
    select gs::date
    from generate_series(p_from, p_to, interval '1 day') gs
  loop
    v_start := (d::timestamp at time zone 'UTC');
    v_end := ((d + 1)::timestamp at time zone 'UTC');

    select count(*)::bigint into v_cu from auth.users u where u.created_at < v_end;
    select count(*)::bigint into v_cr from public.ratings r where r.created_at < v_end;
    select count(*)::bigint into v_cc from public.circles c where c.created_at < v_end;

    select count(*)::bigint into v_new_u from auth.users u
      where u.created_at >= v_start and u.created_at < v_end;

    select count(*)::bigint into v_new_r from public.ratings r
      where r.created_at >= v_start and r.created_at < v_end;

    select count(*)::bigint into v_new_c from public.circles c
      where c.created_at >= v_start and c.created_at < v_end;

    insert into public.platform_growth_daily (
      stat_date,
      cumulative_users,
      cumulative_ratings,
      cumulative_circles,
      new_users,
      new_ratings,
      new_circles,
      computed_at
    )
    values (
      d,
      v_cu,
      v_cr,
      v_cc,
      v_new_u,
      v_new_r,
      v_new_c,
      now()
    )
    on conflict (stat_date) do update set
      cumulative_users = excluded.cumulative_users,
      cumulative_ratings = excluded.cumulative_ratings,
      cumulative_circles = excluded.cumulative_circles,
      new_users = excluded.new_users,
      new_ratings = excluded.new_ratings,
      new_circles = excluded.new_circles,
      computed_at = excluded.computed_at;
  end loop;
end;
$$;

comment on function public.platform_growth_refresh_range(date, date) is
  'Recomputes rows for each UTC date in [p_from, p_to] from live tables (idempotent upsert).';

revoke all on function public.platform_growth_refresh_range(date, date) from public;

create or replace function public.platform_growth_refresh_through_yesterday()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor constant date := '2026-04-30'::date;
  v_yesterday date;
begin
  v_yesterday := (timezone('utc', now()))::date - 1;
  perform public.platform_growth_refresh_range(v_anchor, v_yesterday);
end;
$$;

comment on function public.platform_growth_refresh_through_yesterday() is
  'pg_cron entrypoint: refresh platform_growth_daily from 2026-04-30 through yesterday UTC.';

revoke all on function public.platform_growth_refresh_through_yesterday() from public;

-- Initial backfill (no-op if anchor > yesterday)
select public.platform_growth_refresh_through_yesterday();

-- ---------------------------------------------------------------------------
-- pg_cron (optional — skip when extension/schema missing e.g. local CLI)
-- ---------------------------------------------------------------------------

do $cron$
declare
  jid bigint;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    select j.jobid into jid from cron.job j where j.jobname = 'platform-growth-daily-utc' limit 1;
    if jid is not null then
      perform cron.unschedule(jid);
    end if;
    perform cron.schedule(
      'platform-growth-daily-utc',
      '15 0 * * *',
      'select public.platform_growth_refresh_through_yesterday()'
    );
  end if;
end
$cron$;
