-- 7.0.115: Per-season TV scores.
--
-- Storage
--   public.season_ratings: one row per (user_id, tmdb_id, season_number), season_number >= 1
--   (season 0 = TMDB specials is rejected). Always media_type 'tv'.
--   public.ratings is unchanged for existing rows: a row there is the whole-title score
--   (movies and whole-show TV). Season scores live in their own table, not as a nullable
--   ratings.season_number, because the existing unique (user_id, tmdb_id, media_type) is the
--   ON CONFLICT target of every shipped client (including installed iOS/Android builds) and the
--   FK target of watch_chain_events; replacing it would break those.
--
-- Anchor row
--   Circles (rating_circle_shares insert policy), watch chain, and older clients all key on a
--   ratings row. When a user rates a season of a show they never scored as a whole, a trigger
--   inserts a ratings row flagged score_from_seasons = true whose score tracks the season mean.
--   Any client write to ratings.score clears the flag (the row becomes a real whole-show score).
--   Deleting the last season score deletes an anchor row (and its circle shares); a real
--   whole-show row is never rewritten or deleted by season activity.
--
-- One number per user per show
--   public.ratings_effective exposes one row per ratings row with
--     score = avg(that user's season scores for the show) when any exist, else ratings.score.
--   Circle strips/grids, circle "Rated by", community averages (get_cinemastro_title_avgs), and
--   match RPCs read ratings_effective, so four season scores never count as four raters.

-- ---------------------------------------------------------------------------
-- ratings.score_from_seasons
-- ---------------------------------------------------------------------------

alter table public.ratings
  add column if not exists score_from_seasons boolean not null default false;

comment on column public.ratings.score_from_seasons is
  'True when this row was created by season_ratings (no whole-show score from the user). Score tracks the season mean. Cleared by any client write to score.';

-- ---------------------------------------------------------------------------
-- season_ratings
-- ---------------------------------------------------------------------------

create table if not exists public.season_ratings (
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id integer not null,
  season_number integer not null,
  score numeric(3, 1) not null,
  rated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint season_ratings_pkey primary key (user_id, tmdb_id, season_number),
  constraint season_ratings_season_number_chk check (season_number >= 1),
  constraint season_ratings_score_chk check (score >= 1 and score <= 10)
);

comment on table public.season_ratings is
  'Per-season TV scores. Whole-show scores stay in public.ratings. Readers needing one number per user per show use public.ratings_effective.';

create index if not exists season_ratings_tmdb_user_idx
  on public.season_ratings (tmdb_id, user_id);

alter table public.season_ratings enable row level security;

drop policy if exists "season_ratings select own" on public.season_ratings;
create policy "season_ratings select own"
  on public.season_ratings for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "season_ratings insert own" on public.season_ratings;
create policy "season_ratings insert own"
  on public.season_ratings for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "season_ratings update own" on public.season_ratings;
create policy "season_ratings update own"
  on public.season_ratings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "season_ratings delete own" on public.season_ratings;
create policy "season_ratings delete own"
  on public.season_ratings for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.season_ratings to authenticated;
grant select on public.season_ratings to service_role;

-- Re-rating a season refreshes rated_at (circle recent ordering, archive cutoff).
create or replace function public.season_ratings_bump_rated_at()
returns trigger
language plpgsql
as $$
begin
  if new.score is distinct from old.score then
    new.rated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_season_ratings_bump_rated_at on public.season_ratings;
create trigger trg_season_ratings_bump_rated_at
  before update on public.season_ratings
  for each row
  execute function public.season_ratings_bump_rated_at();

-- ---------------------------------------------------------------------------
-- Client writes to ratings.score mark the row as a real whole-show score.
-- The season sync trigger sets cinematch.season_sync = 'on' for its own writes.
-- ---------------------------------------------------------------------------

create or replace function public.ratings_mark_whole_show_score()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('cinematch.season_sync', true), '') <> 'on' then
    new.score_from_seasons := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ratings_mark_whole_show_score on public.ratings;
create trigger trg_ratings_mark_whole_show_score
  before insert or update of score on public.ratings
  for each row
  execute function public.ratings_mark_whole_show_score();

-- ---------------------------------------------------------------------------
-- season_ratings → anchor ratings row + prediction cache invalidation
-- ---------------------------------------------------------------------------

create or replace function public.season_ratings_sync_show_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_tmdb integer := coalesce(new.tmdb_id, old.tmdb_id);
  v_avg numeric;
begin
  select avg(s.score) into v_avg
  from public.season_ratings s
  where s.user_id = v_user
    and s.tmdb_id = v_tmdb;

  perform set_config('cinematch.season_sync', 'on', true);

  if v_avg is null then
    delete from public.rating_circle_shares sh
    where sh.user_id = v_user
      and sh.tmdb_id = v_tmdb
      and sh.media_type = 'tv'
      and exists (
        select 1
        from public.ratings r
        where r.user_id = v_user
          and r.tmdb_id = v_tmdb
          and r.media_type = 'tv'
          and r.score_from_seasons
      );
    delete from public.ratings r
    where r.user_id = v_user
      and r.tmdb_id = v_tmdb
      and r.media_type = 'tv'
      and r.score_from_seasons;
  else
    insert into public.ratings (user_id, tmdb_id, media_type, score, score_from_seasons)
    values (v_user, v_tmdb, 'tv', round(v_avg, 1), true)
    on conflict (user_id, tmdb_id, media_type) do update
      set score = excluded.score
      where public.ratings.score_from_seasons;
  end if;

  perform set_config('cinematch.season_sync', 'off', true);

  delete from public.user_title_predictions
  where user_id = v_user;

  return null;
end;
$$;

comment on function public.season_ratings_sync_show_row() is
  'After season_ratings changes: create/refresh/delete the score_from_seasons anchor ratings row; invalidate cached predictions.';

drop trigger if exists trg_season_ratings_sync_show_row on public.season_ratings;
create trigger trg_season_ratings_sync_show_row
  after insert or update or delete on public.season_ratings
  for each row
  execute function public.season_ratings_sync_show_row();

-- ---------------------------------------------------------------------------
-- ratings_effective: one row per ratings row, score collapsed across seasons
-- ---------------------------------------------------------------------------

create or replace view public.ratings_effective
with (security_invoker = true)
as
select
  r.user_id,
  r.tmdb_id,
  r.media_type,
  coalesce(sa.avg_score, r.score::numeric) as score,
  case
    when sa.last_rated_at is null then r.rated_at
    else greatest(r.rated_at, sa.last_rated_at)
  end as rated_at,
  r.score::numeric as whole_show_score,
  r.score_from_seasons,
  coalesce(sa.season_count, 0)::int as season_count
from public.ratings r
left join lateral (
  select
    avg(s.score)::numeric as avg_score,
    max(s.rated_at) as last_rated_at,
    count(*)::int as season_count
  from public.season_ratings s
  where r.media_type = 'tv'
    and s.user_id = r.user_id
    and s.tmdb_id = r.tmdb_id
) sa on true;

comment on view public.ratings_effective is
  'One score per user per title: mean of season_ratings for that show when any exist, else ratings.score.';

grant select on public.ratings_effective to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Community average (one value per user per show)
-- ---------------------------------------------------------------------------

create or replace function public.get_cinemastro_title_avgs(p_titles jsonb)
returns table (
  tmdb_id bigint,
  media_type text,
  avg_score double precision,
  rating_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.tmdb_id,
    r.media_type::text,
    round(avg(r.score)::numeric, 1)::double precision as avg_score,
    count(*)::bigint as rating_count
  from public.ratings_effective r
  where (r.tmdb_id, r.media_type::text) in (
    select (e->>'tmdb_id')::bigint, e->>'media_type'
    from jsonb_array_elements(p_titles) as e
  )
  group by r.tmdb_id, r.media_type;
$$;

comment on function public.get_cinemastro_title_avgs(jsonb) is
  '7.0.115: Avg(score) and rating_count per (tmdb_id, media_type) from ratings_effective (season scores averaged per user first).';

alter function public.get_cinemastro_title_avgs(jsonb) set statement_timeout = '60s';

revoke all on function public.get_cinemastro_title_avgs(jsonb) from public;
grant execute on function public.get_cinemastro_title_avgs(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- match RPCs
-- ---------------------------------------------------------------------------

create or replace function public.match_predict_neighbor_raters(
  p_user_id uuid,
  p_media_type text,
  p_tmdb_id bigint,
  p_min_similarity double precision default 0.10
)
returns table (score numeric, similarity double precision)
language sql
stable
security definer
set search_path = public
as $$
  select r.score::numeric, un.similarity::double precision
  from public.ratings_effective r
  inner join public.user_neighbors un
    on un.neighbor_id = r.user_id
   and un.user_id = p_user_id
   and un.similarity >= p_min_similarity
  where r.media_type = p_media_type
    and r.tmdb_id = p_tmdb_id;
$$;

revoke all on function public.match_predict_neighbor_raters(uuid, text, bigint, double precision) from public;
grant execute on function public.match_predict_neighbor_raters(uuid, text, bigint, double precision) to service_role;

create or replace function public.match_recommendations_from_neighbors(
  p_user_id uuid,
  p_media_type text default null,
  p_limit integer default 60,
  p_min_similarity double precision default 0.10,
  p_min_contributors integer default 2
)
returns table (
  media_type text,
  tmdb_id bigint,
  weighted_score numeric,
  contributor_count integer,
  total_weight double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with candidate_rows as (
    select
      r.media_type,
      r.tmdb_id,
      r.score::double precision as score,
      un.similarity::double precision as similarity
    from public.user_neighbors un
    inner join public.ratings_effective r
      on r.user_id = un.neighbor_id
    left join public.ratings ur
      on ur.user_id = p_user_id
     and ur.media_type = r.media_type
     and ur.tmdb_id = r.tmdb_id
    where un.user_id = p_user_id
      and un.similarity >= p_min_similarity
      and (p_media_type is null or r.media_type = p_media_type)
      and ur.user_id is null
  ),
  aggregated as (
    select
      cr.media_type,
      cr.tmdb_id,
      sum(cr.score * cr.similarity) as weighted_sum,
      sum(cr.similarity) as total_weight,
      count(*)::integer as contributor_count
    from candidate_rows cr
    group by cr.media_type, cr.tmdb_id
  )
  select
    a.media_type,
    a.tmdb_id,
    case
      when a.total_weight > 0 then round((a.weighted_sum / a.total_weight)::numeric, 1)
      else null
    end as weighted_score,
    a.contributor_count,
    a.total_weight
  from aggregated a
  where a.contributor_count >= greatest(coalesce(p_min_contributors, 1), 1)
    and a.total_weight > 0
  order by
    (a.weighted_sum / a.total_weight) desc,
    a.contributor_count desc,
    a.total_weight desc,
    a.tmdb_id desc
  limit greatest(coalesce(p_limit, 60), 1);
$$;

revoke all on function public.match_recommendations_from_neighbors(uuid, text, integer, double precision, integer) from public;
grant execute on function public.match_recommendations_from_neighbors(uuid, text, integer, double precision, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Circle strip / All / Top: same bodies as 20260616120000, reading ratings_effective
-- (circle avg = one value per member per show; viewer_score = viewer's collapsed score).
-- ---------------------------------------------------------------------------

create or replace function public.get_circle_rated_strip(
  p_circle_id uuid,
  p_limit int default 10,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_member_count int;
  v_archived_at timestamptz;
  v_titles jsonb;
  v_total int;
  v_off int;
  v_eff int;
  v_returned int;
  v_has_more boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select count(*)::int
    into v_member_count
  from public.circle_members
  where circle_id = p_circle_id;

  if not exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
  ) then
    raise exception 'not a member of this circle';
  end if;

  if v_member_count < 2 then
    return jsonb_build_object(
      'member_count', v_member_count,
      'gated', true,
      'titles', '[]'::jsonb,
      'total_eligible', 0,
      'has_more', false
    );
  end if;

  select c.archived_at into v_archived_at
  from public.circles c
  where c.id = p_circle_id;

  v_off := greatest(coalesce(p_offset, 0), 0);
  v_eff := case
    when v_off >= 20 then 0
    else least(greatest(coalesce(p_limit, 10), 1), 20 - v_off)
  end;

  with
  cm as (
    select cm_inner.user_id
    from public.circle_members cm_inner
    where cm_inner.circle_id = p_circle_id
  ),
  base as (
    select
      r.user_id,
      r.media_type,
      r.tmdb_id,
      r.score,
      r.rated_at,
      greatest(r.rated_at, sh.created_at) as activity_at
    from public.ratings_effective r
    inner join public.circle_members cm
      on cm.user_id = r.user_id and cm.circle_id = p_circle_id
    inner join public.rating_circle_shares sh
      on sh.user_id = r.user_id
     and sh.media_type = r.media_type
     and sh.tmdb_id = r.tmdb_id
     and sh.circle_id = p_circle_id
    where (
      v_archived_at is null
      or (r.rated_at is not null and r.rated_at < v_archived_at)
    )
  ),
  agg as (
    select
      b.media_type,
      b.tmdb_id,
      count(distinct b.user_id) as distinct_raters,
      avg(b.score)::numeric as group_avg_num,
      max(b.activity_at) as last_at
    from base b
    group by b.media_type, b.tmdb_id
  ),
  classified as (
    select
      a.media_type,
      a.tmdb_id,
      a.distinct_raters,
      case when a.distinct_raters >= 2 then 'together' else 'solo' end as section,
      round(a.group_avg_num, 1) as group_rating,
      a.last_at
    from agg a
  ),
  viewer as (
    select
      c.media_type,
      c.tmdb_id,
      c.section,
      c.distinct_raters,
      c.group_rating,
      c.last_at,
      (
        select r2.score
        from public.ratings_effective r2
        inner join public.rating_circle_shares vsh
          on vsh.user_id = r2.user_id
         and vsh.media_type = r2.media_type
         and vsh.tmdb_id = r2.tmdb_id
         and vsh.circle_id = p_circle_id
        where r2.user_id = v_uid
          and r2.media_type = c.media_type
          and r2.tmdb_id = c.tmdb_id
        limit 1
      ) as viewer_score
    from classified c
  ),
  numbered as (
    select
      vw.media_type,
      vw.tmdb_id,
      vw.section,
      vw.distinct_raters,
      vw.group_rating,
      vw.last_at,
      vw.viewer_score,
      row_number() over (
        order by vw.last_at desc nulls last
      ) as rn
    from viewer vw
  ),
  counted as (
    select (select count(*)::int from numbered) as total_eligible
  ),
  page as (
    select n.*
    from numbered n
    where n.rn > v_off
      and n.rn <= v_off + v_eff
  ),
  page_payload_page as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('tmdb_id', d.tmdb_id, 'media_type', d.media_type)
        )
        from (select distinct p.media_type, p.tmdb_id from page p) d
      ),
      '[]'::jsonb
    ) as j
  ),
  site_avgs_page as (
    select
      ga.tmdb_id,
      ga.media_type::text as media_type,
      ga.avg_score
    from page_payload_page sp
    cross join lateral public.get_cinemastro_title_avgs(sp.j) ga
  ),
  page_enriched as (
    select
      p.media_type,
      p.tmdb_id,
      p.section,
      p.distinct_raters,
      p.group_rating,
      case
        when sa.avg_score is not null
          then round(sa.avg_score::numeric, 1)
        else null
      end as site_rating,
      p.last_at,
      p.viewer_score,
      p.rn
    from page p
    left join site_avgs_page sa
      on sa.media_type = p.media_type
     and sa.tmdb_id = p.tmdb_id
  )
  select
    c.total_eligible,
    coalesce(
      (
        select jsonb_agg(row_obj order by ord)
        from (
          select
            jsonb_build_object(
              'media_type', pe.media_type,
              'tmdb_id', pe.tmdb_id,
              'section', pe.section,
              'distinct_circle_raters', pe.distinct_raters,
              'group_rating', pe.group_rating,
              'site_rating', pe.site_rating,
              'last_activity_at', pe.last_at,
              'viewer_score', pe.viewer_score
            ) as row_obj,
            pe.rn as ord
          from page_enriched pe
        ) ordered_rows
      ),
      '[]'::jsonb
    ),
    (select count(*)::int from page_enriched)
  into v_total, v_titles, v_returned
  from counted c;

  if v_total is null then
    v_total := 0;
  end if;

  v_has_more := (v_off + coalesce(v_returned, 0)) < least(coalesce(v_total, 0), 20);

  return jsonb_build_object(
    'member_count', v_member_count,
    'gated', false,
    'titles', coalesce(v_titles, '[]'::jsonb),
    'total_eligible', coalesce(v_total, 0),
    'has_more', v_has_more
  );
end;
$$;

comment on function public.get_circle_rated_strip(uuid, int, int) is
  'Circle strip: recent activity = max(greatest(rated_at, share created_at)) per title; only published shares.';

alter function public.get_circle_rated_strip(uuid, int, int) set statement_timeout = '120s';


create or replace function public.get_circle_rated_all_grid(
  p_circle_id uuid,
  p_limit int default 10,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_member_count int;
  v_archived_at timestamptz;
  v_titles jsonb;
  v_total int;
  v_off int;
  v_eff int;
  v_returned int;
  v_has_more boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select count(*)::int
    into v_member_count
  from public.circle_members
  where circle_id = p_circle_id;

  if not exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
  ) then
    raise exception 'not a member of this circle';
  end if;

  if v_member_count < 2 then
    return jsonb_build_object(
      'member_count', v_member_count,
      'gated', true,
      'titles', '[]'::jsonb,
      'total_eligible', 0,
      'has_more', false
    );
  end if;

  select c.archived_at into v_archived_at
  from public.circles c
  where c.id = p_circle_id;

  v_off := greatest(coalesce(p_offset, 0), 0);
  v_eff := least(greatest(coalesce(p_limit, 10), 1), 50);

  with
  cm as (
    select cm_inner.user_id
    from public.circle_members cm_inner
    where cm_inner.circle_id = p_circle_id
  ),
  base as (
    select
      r.user_id,
      r.media_type,
      r.tmdb_id,
      r.score,
      r.rated_at
    from public.ratings_effective r
    inner join public.circle_members cm
      on cm.user_id = r.user_id and cm.circle_id = p_circle_id
    inner join public.rating_circle_shares sh
      on sh.user_id = r.user_id
     and sh.media_type = r.media_type
     and sh.tmdb_id = r.tmdb_id
     and sh.circle_id = p_circle_id
    where (
      v_archived_at is null
      or (r.rated_at is not null and r.rated_at < v_archived_at)
    )
  ),
  agg as (
    select
      b.media_type,
      b.tmdb_id,
      count(distinct b.user_id) as distinct_raters,
      avg(b.score)::numeric as group_avg_num,
      max(b.rated_at) as last_at
    from base b
    group by b.media_type, b.tmdb_id
  ),
  classified as (
    select
      a.media_type,
      a.tmdb_id,
      a.distinct_raters,
      case when a.distinct_raters >= 2 then 'together' else 'solo' end as section,
      round(a.group_avg_num, 1) as group_rating,
      a.last_at
    from agg a
  ),
  viewer as (
    select
      c.media_type,
      c.tmdb_id,
      c.section,
      c.distinct_raters,
      c.group_rating,
      c.last_at,
      (
        select r2.score
        from public.ratings_effective r2
        inner join public.rating_circle_shares vsh
          on vsh.user_id = r2.user_id
         and vsh.media_type = r2.media_type
         and vsh.tmdb_id = r2.tmdb_id
         and vsh.circle_id = p_circle_id
        where r2.user_id = v_uid
          and r2.media_type = c.media_type
          and r2.tmdb_id = c.tmdb_id
        limit 1
      ) as viewer_score
    from classified c
  ),
  numbered as (
    select
      vw.media_type,
      vw.tmdb_id,
      vw.section,
      vw.distinct_raters,
      vw.group_rating,
      vw.last_at,
      vw.viewer_score,
      row_number() over (order by vw.last_at desc nulls last) as rn
    from viewer vw
  ),
  counted as (
    select (select count(*)::int from numbered) as total_eligible
  ),
  page as (
    select n.*
    from numbered n
    where n.rn > v_off
      and n.rn <= v_off + v_eff
  ),
  page_payload_page as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('tmdb_id', d.tmdb_id, 'media_type', d.media_type)
        )
        from (select distinct p.media_type, p.tmdb_id from page p) d
      ),
      '[]'::jsonb
    ) as j
  ),
  site_avgs_page as (
    select
      ga.tmdb_id,
      ga.media_type::text as media_type,
      ga.avg_score
    from page_payload_page sp
    cross join lateral public.get_cinemastro_title_avgs(sp.j) ga
  ),
  page_enriched as (
    select
      p.media_type,
      p.tmdb_id,
      p.section,
      p.distinct_raters,
      p.group_rating,
      case
        when sa.avg_score is not null
          then round(sa.avg_score::numeric, 1)
        else null
      end as site_rating,
      p.last_at,
      p.viewer_score,
      p.rn
    from page p
    left join site_avgs_page sa
      on sa.media_type = p.media_type
     and sa.tmdb_id = p.tmdb_id
  )
  select
    c.total_eligible,
    coalesce(
      (
        select jsonb_agg(row_obj order by ord)
        from (
          select
            jsonb_build_object(
              'media_type', pe.media_type,
              'tmdb_id', pe.tmdb_id,
              'section', pe.section,
              'distinct_circle_raters', pe.distinct_raters,
              'group_rating', pe.group_rating,
              'site_rating', pe.site_rating,
              'last_activity_at', pe.last_at,
              'viewer_score', pe.viewer_score
            ) as row_obj,
            pe.rn as ord
          from page_enriched pe
        ) ordered_rows
      ),
      '[]'::jsonb
    ),
    (select count(*)::int from page_enriched)
  into v_total, v_titles, v_returned
  from counted c;

  if v_total is null then
    v_total := 0;
  end if;

  v_has_more := (v_off + coalesce(v_returned, 0)) < coalesce(v_total, 0);

  return jsonb_build_object(
    'member_count', v_member_count,
    'gated', false,
    'titles', coalesce(v_titles, '[]'::jsonb),
    'total_eligible', coalesce(v_total, 0),
    'has_more', v_has_more
  );
end;
$$;

comment on function public.get_circle_rated_all_grid(uuid, int, int) is
  'Circle grid: all published titles for this circle; last activity desc.';

alter function public.get_circle_rated_all_grid(uuid, int, int) set statement_timeout = '120s';

revoke all on function public.get_circle_rated_all_grid(uuid, int, int) from public;
revoke all on function public.get_circle_rated_all_grid(uuid, int, int) from anon;
grant execute on function public.get_circle_rated_all_grid(uuid, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- get_circle_rated_top_grid
-- ---------------------------------------------------------------------------

create or replace function public.get_circle_rated_top_grid(
  p_circle_id uuid,
  p_limit int default 10,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_member_count int;
  v_archived_at timestamptz;
  v_titles jsonb;
  v_total int;
  v_off int;
  v_eff int;
  v_returned int;
  v_has_more boolean;
  v_cap int := 25;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select count(*)::int
    into v_member_count
  from public.circle_members
  where circle_id = p_circle_id;

  if not exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
  ) then
    raise exception 'not a member of this circle';
  end if;

  if v_member_count < 2 then
    return jsonb_build_object(
      'member_count', v_member_count,
      'gated', true,
      'titles', '[]'::jsonb,
      'total_eligible', 0,
      'has_more', false
    );
  end if;

  select c.archived_at into v_archived_at
  from public.circles c
  where c.id = p_circle_id;

  v_off := greatest(coalesce(p_offset, 0), 0);
  v_eff := case
    when v_off >= v_cap then 0
    else least(
      least(greatest(coalesce(p_limit, 10), 1), 50),
      v_cap - v_off
    )
  end;

  with
  cm as (
    select cm_inner.user_id
    from public.circle_members cm_inner
    where cm_inner.circle_id = p_circle_id
  ),
  base as (
    select
      r.user_id,
      r.media_type,
      r.tmdb_id,
      r.score,
      r.rated_at
    from public.ratings_effective r
    inner join public.circle_members cm
      on cm.user_id = r.user_id and cm.circle_id = p_circle_id
    inner join public.rating_circle_shares sh
      on sh.user_id = r.user_id
     and sh.media_type = r.media_type
     and sh.tmdb_id = r.tmdb_id
     and sh.circle_id = p_circle_id
    where (
      v_archived_at is null
      or (r.rated_at is not null and r.rated_at < v_archived_at)
    )
  ),
  agg as (
    select
      b.media_type,
      b.tmdb_id,
      count(distinct b.user_id) as distinct_raters,
      avg(b.score)::numeric as group_avg_num,
      max(b.rated_at) as last_at
    from base b
    group by b.media_type, b.tmdb_id
  ),
  classified as (
    select
      a.media_type,
      a.tmdb_id,
      a.distinct_raters,
      case when a.distinct_raters >= 2 then 'together' else 'solo' end as section,
      round(a.group_avg_num, 1) as group_rating,
      a.last_at
    from agg a
  ),
  viewer as (
    select
      c.media_type,
      c.tmdb_id,
      c.section,
      c.distinct_raters,
      c.group_rating,
      c.last_at,
      (
        select r2.score
        from public.ratings_effective r2
        inner join public.rating_circle_shares vsh
          on vsh.user_id = r2.user_id
         and vsh.media_type = r2.media_type
         and vsh.tmdb_id = r2.tmdb_id
         and vsh.circle_id = p_circle_id
        where r2.user_id = v_uid
          and r2.media_type = c.media_type
          and r2.tmdb_id = c.tmdb_id
        limit 1
      ) as viewer_score
    from classified c
  ),
  scored as (
    select
      vw.*,
      row_number() over (
        order by
          vw.group_rating desc nulls last,
          vw.distinct_raters desc,
          vw.last_at desc nulls last
      ) as score_rn
    from viewer vw
  ),
  capped as (
    select * from scored s where s.score_rn <= v_cap
  ),
  counted as (
    select (select count(*)::int from capped) as total_eligible
  ),
  numbered as (
    select
      c.*,
      row_number() over (order by c.score_rn) as rn
    from capped c
  ),
  page as (
    select n.*
    from numbered n
    where n.rn > v_off
      and n.rn <= v_off + v_eff
  ),
  page_payload_page as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('tmdb_id', d.tmdb_id, 'media_type', d.media_type)
        )
        from (select distinct p.media_type, p.tmdb_id from page p) d
      ),
      '[]'::jsonb
    ) as j
  ),
  site_avgs_page as (
    select
      ga.tmdb_id,
      ga.media_type::text as media_type,
      ga.avg_score
    from page_payload_page sp
    cross join lateral public.get_cinemastro_title_avgs(sp.j) ga
  ),
  page_enriched as (
    select
      p.media_type,
      p.tmdb_id,
      p.section,
      p.distinct_raters,
      p.group_rating,
      case
        when sa.avg_score is not null
          then round(sa.avg_score::numeric, 1)
        else null
      end as site_rating,
      p.last_at,
      p.viewer_score,
      p.rn
    from page p
    left join site_avgs_page sa
      on sa.media_type = p.media_type
     and sa.tmdb_id = p.tmdb_id
  )
  select
    c.total_eligible,
    coalesce(
      (
        select jsonb_agg(row_obj order by ord)
        from (
          select
            jsonb_build_object(
              'media_type', pe.media_type,
              'tmdb_id', pe.tmdb_id,
              'section', pe.section,
              'distinct_circle_raters', pe.distinct_raters,
              'group_rating', pe.group_rating,
              'site_rating', pe.site_rating,
              'last_activity_at', pe.last_at,
              'viewer_score', pe.viewer_score
            ) as row_obj,
            pe.rn as ord
          from page_enriched pe
        ) ordered_rows
      ),
      '[]'::jsonb
    ),
    (select count(*)::int from page_enriched)
  into v_total, v_titles, v_returned
  from counted c;

  if v_total is null then
    v_total := 0;
  end if;

  v_has_more := (v_off + coalesce(v_returned, 0)) < least(coalesce(v_total, 0), v_cap);

  return jsonb_build_object(
    'member_count', v_member_count,
    'gated', false,
    'titles', coalesce(v_titles, '[]'::jsonb),
    'total_eligible', coalesce(v_total, 0),
    'has_more', v_has_more
  );
end;
$$;

comment on function public.get_circle_rated_top_grid(uuid, int, int) is
  'Circle grid: top averages among published titles (cap 25).';

alter function public.get_circle_rated_top_grid(uuid, int, int) set statement_timeout = '120s';

revoke all on function public.get_circle_rated_top_grid(uuid, int, int) from public;
revoke all on function public.get_circle_rated_top_grid(uuid, int, int) from anon;
grant execute on function public.get_circle_rated_top_grid(uuid, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Circle "Rated by"
--   get_circle_title_publishers (shipped clients): one row per member, collapsed score.
--   get_circle_title_publisher_lines (7.0.115+): one line per whole-show score
--   (season_number null) plus one line per rated season, each with its own score.
-- ---------------------------------------------------------------------------

create or replace function public.get_circle_title_publishers(
  p_circle_id uuid,
  p_tmdb_id integer,
  p_media_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_archived_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_media_type is null or p_media_type not in ('movie', 'tv') then
    return '[]'::jsonb;
  end if;

  if not exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
  ) then
    raise exception 'not a member of this circle';
  end if;

  select c.archived_at into v_archived_at
  from public.circles c
  where c.id = p_circle_id;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'user_id', y.user_id,
        'member_name', y.member_name,
        'score', y.score
      )
    )
    from (
      select
        r.user_id,
        coalesce(p.name, '')::text as member_name,
        round(r.score::numeric, 1) as score
      from public.ratings_effective r
      inner join public.circle_members cm
        on cm.user_id = r.user_id
       and cm.circle_id = p_circle_id
      inner join public.rating_circle_shares sh
        on sh.user_id = r.user_id
       and sh.media_type = r.media_type
       and sh.tmdb_id = r.tmdb_id
       and sh.circle_id = p_circle_id
      inner join public.profiles p
        on p.id = r.user_id
      where r.tmdb_id = p_tmdb_id
        and r.media_type = p_media_type
        and (
          v_archived_at is null
          or (r.rated_at is not null and r.rated_at < v_archived_at)
        )
      order by coalesce(p.name, '')::text asc, r.user_id
    ) y
  ), '[]'::jsonb);
end;
$$;

comment on function public.get_circle_title_publishers(uuid, integer, text) is
  'For a circle member: JSON array of { user_id, member_name, score } (score collapsed across seasons) for members who published this title to the circle.';

revoke all on function public.get_circle_title_publishers(uuid, integer, text) from public;
revoke all on function public.get_circle_title_publishers(uuid, integer, text) from anon;
grant execute on function public.get_circle_title_publishers(uuid, integer, text) to authenticated;

create or replace function public.get_circle_title_publisher_lines(
  p_circle_id uuid,
  p_tmdb_id integer,
  p_media_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_archived_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_media_type is null or p_media_type not in ('movie', 'tv') then
    return '[]'::jsonb;
  end if;

  if not exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
  ) then
    raise exception 'not a member of this circle';
  end if;

  select c.archived_at into v_archived_at
  from public.circles c
  where c.id = p_circle_id;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'user_id', y.user_id,
        'member_name', y.member_name,
        'season_number', y.season_number,
        'score', y.score
      )
      order by y.member_name, y.user_id, y.season_number nulls first
    )
    from (
      select
        r.user_id,
        coalesce(p.name, '')::text as member_name,
        null::int as season_number,
        round(r.score::numeric, 1) as score
      from public.ratings r
      inner join public.circle_members cm
        on cm.user_id = r.user_id
       and cm.circle_id = p_circle_id
      inner join public.rating_circle_shares sh
        on sh.user_id = r.user_id
       and sh.media_type = r.media_type
       and sh.tmdb_id = r.tmdb_id
       and sh.circle_id = p_circle_id
      inner join public.profiles p
        on p.id = r.user_id
      where r.tmdb_id = p_tmdb_id
        and r.media_type = p_media_type
        and not r.score_from_seasons
        and (
          v_archived_at is null
          or (r.rated_at is not null and r.rated_at < v_archived_at)
        )

      union all

      select
        s.user_id,
        coalesce(p.name, '')::text as member_name,
        s.season_number,
        round(s.score::numeric, 1) as score
      from public.season_ratings s
      inner join public.circle_members cm
        on cm.user_id = s.user_id
       and cm.circle_id = p_circle_id
      inner join public.rating_circle_shares sh
        on sh.user_id = s.user_id
       and sh.media_type = 'tv'
       and sh.tmdb_id = s.tmdb_id
       and sh.circle_id = p_circle_id
      inner join public.profiles p
        on p.id = s.user_id
      where p_media_type = 'tv'
        and s.tmdb_id = p_tmdb_id
        and (
          v_archived_at is null
          or s.rated_at < v_archived_at
        )
    ) y
  ), '[]'::jsonb);
end;
$$;

comment on function public.get_circle_title_publisher_lines(uuid, integer, text) is
  'Circle "Rated by" lines: { user_id, member_name, season_number, score }. season_number null = whole-show score; one line per rated season otherwise.';

revoke all on function public.get_circle_title_publisher_lines(uuid, integer, text) from public;
revoke all on function public.get_circle_title_publisher_lines(uuid, integer, text) from anon;
grant execute on function public.get_circle_title_publisher_lines(uuid, integer, text) to authenticated;
