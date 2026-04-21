-- Circle rating publish: a user's score is global (public.ratings) but each circle only sees
-- titles the user has published to that circle (public.rating_circle_shares).
-- On circle_members DELETE, shares for (user, circle) are removed (leave = take picks out of group).
-- No backfill: existing deployments start with empty shares until users publish.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.rating_circle_shares (
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id integer not null,
  media_type text not null,
  circle_id uuid not null references public.circles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint rating_circle_shares_media_type_chk
    check (media_type in ('movie', 'tv')),
  constraint rating_circle_shares_pkey primary key (user_id, tmdb_id, media_type, circle_id)
);

comment on table public.rating_circle_shares is
  'Which circles surface each user''s rating for a title. One global ratings row; many share rows per title.';

create index if not exists rating_circle_shares_circle_title_idx
  on public.rating_circle_shares (circle_id, media_type, tmdb_id);

create index if not exists rating_circle_shares_user_title_idx
  on public.rating_circle_shares (user_id, media_type, tmdb_id);

alter table public.rating_circle_shares enable row level security;

create policy "rating_circle_shares select own"
  on public.rating_circle_shares for select
  using (auth.uid() = user_id);

create policy "rating_circle_shares insert own if member and rated"
  on public.rating_circle_shares for insert
  with check (
    auth.uid() = user_id
    and public.is_circle_member(circle_id)
    and exists (
      select 1
      from public.ratings r
      where r.user_id = user_id
        and r.tmdb_id = tmdb_id
        and r.media_type = media_type
    )
  );

create policy "rating_circle_shares delete own"
  on public.rating_circle_shares for delete
  using (auth.uid() = user_id);

grant select, insert, delete on public.rating_circle_shares to authenticated;

-- ---------------------------------------------------------------------------
-- Leave circle: remove published picks for that membership only
-- ---------------------------------------------------------------------------

create or replace function public.clear_rating_shares_on_circle_member_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.rating_circle_shares
  where user_id = old.user_id
    and circle_id = old.circle_id;
  return old;
end;
$$;

drop trigger if exists trg_circle_members_delete_clear_rating_shares on public.circle_members;
create trigger trg_circle_members_delete_clear_rating_shares
  after delete on public.circle_members
  for each row
  execute function public.clear_rating_shares_on_circle_member_leave();

comment on function public.clear_rating_shares_on_circle_member_leave() is
  'After a user leaves a circle, drop all rating_circle_shares for that (user_id, circle_id).';

-- ---------------------------------------------------------------------------
-- get_circle_rated_strip: join through rating_circle_shares
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
      r.rated_at
    from public.ratings r
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
        from public.ratings r2
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
  solo_payload_page as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('tmdb_id', p.tmdb_id, 'media_type', p.media_type)
      ) filter (where p.section = 'solo'),
      '[]'::jsonb
    ) as j
    from page p
  ),
  site_avgs_page as (
    select
      ga.tmdb_id,
      ga.media_type::text as media_type,
      ga.avg_score
    from solo_payload_page sp
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
        when p.section = 'solo' and sa.avg_score is not null
          then round(sa.avg_score::numeric, 1)
        else null
      end as site_rating,
      p.last_at,
      p.viewer_score,
      p.rn
    from page p
    left join site_avgs_page sa
      on p.section = 'solo'
     and sa.media_type = p.media_type
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
  'Circle strip: recent activity; only titles published to this circle (rating_circle_shares ∩ ratings).';

alter function public.get_circle_rated_strip(uuid, int, int) set statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- get_circle_rated_all_grid
-- ---------------------------------------------------------------------------

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
    from public.ratings r
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
        from public.ratings r2
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
  solo_payload_page as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('tmdb_id', p.tmdb_id, 'media_type', p.media_type)
      ) filter (where p.section = 'solo'),
      '[]'::jsonb
    ) as j
    from page p
  ),
  site_avgs_page as (
    select
      ga.tmdb_id,
      ga.media_type::text as media_type,
      ga.avg_score
    from solo_payload_page sp
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
        when p.section = 'solo' and sa.avg_score is not null
          then round(sa.avg_score::numeric, 1)
        else null
      end as site_rating,
      p.last_at,
      p.viewer_score,
      p.rn
    from page p
    left join site_avgs_page sa
      on p.section = 'solo'
     and sa.media_type = p.media_type
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
    from public.ratings r
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
        from public.ratings r2
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
  solo_payload_page as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('tmdb_id', p.tmdb_id, 'media_type', p.media_type)
      ) filter (where p.section = 'solo'),
      '[]'::jsonb
    ) as j
    from page p
  ),
  site_avgs_page as (
    select
      ga.tmdb_id,
      ga.media_type::text as media_type,
      ga.avg_score
    from solo_payload_page sp
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
        when p.section = 'solo' and sa.avg_score is not null
          then round(sa.avg_score::numeric, 1)
        else null
      end as site_rating,
      p.last_at,
      p.viewer_score,
      p.rn
    from page p
    left join site_avgs_page sa
      on p.section = 'solo'
     and sa.media_type = p.media_type
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
