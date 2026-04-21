-- Circle strip: true "recent activity" ordering (by last rating in circle, not together-before-solo).
-- Single-rater titles still expose circle average (= that score) for display; section solo/together
-- unchanged for site_avg + prediction plumbing.
-- Bump ratings.rated_at when score changes so upsert re-rates move titles to the front.

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
    inner join cm on cm.user_id = r.user_id
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
  'Circle strip: recent activity (last_at desc), circle avg for all titles; paginated, max 20 rows.';

alter function public.get_circle_rated_strip(uuid, int, int) set statement_timeout = '120s';

-- Re-rating via upsert updates score only; refresh rated_at so strip ordering reflects the edit.
create or replace function public.ratings_bump_rated_at_on_score_change()
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

drop trigger if exists trg_ratings_bump_rated_at on public.ratings;
create trigger trg_ratings_bump_rated_at
  before update on public.ratings
  for each row
  execute function public.ratings_bump_rated_at_on_score_change();
