-- Circles strip pagination: initial page (10), load more (+5), hard cap 20 total.
-- Replaces single-arg get_circle_rated_strip(uuid) with (uuid, int, int) defaults.

drop function if exists public.get_circle_rated_strip(uuid);

create function public.get_circle_rated_strip(
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
      case
        when a.distinct_raters >= 2 then round(a.group_avg_num, 1)
        else null
      end as group_rating,
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
  solo_payload as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('tmdb_id', v.tmdb_id, 'media_type', v.media_type)
      ) filter (where v.section = 'solo'),
      '[]'::jsonb
    ) as j
    from viewer v
  ),
  site_avgs as (
    select
      ga.tmdb_id,
      ga.media_type::text as media_type,
      ga.avg_score
    from solo_payload sp
    cross join lateral public.get_cinemastro_title_avgs(sp.j) ga
  ),
  numbered as (
    select
      vw.media_type,
      vw.tmdb_id,
      vw.section,
      vw.distinct_raters,
      vw.group_rating,
      case
        when vw.section = 'solo' and sa.avg_score is not null
          then round(sa.avg_score::numeric, 1)
        else null
      end as site_rating,
      vw.last_at,
      vw.viewer_score,
      row_number() over (
        order by
          case when vw.section = 'together' then 0 else 1 end,
          vw.last_at desc nulls last
      ) as rn
    from viewer vw
    left join site_avgs sa
      on vw.section = 'solo'
     and sa.media_type = vw.media_type
     and sa.tmdb_id = vw.tmdb_id
  ),
  counted as (
    select (select count(*)::int from numbered) as total_eligible
  ),
  page as (
    select n.*
    from numbered n
    where n.rn > v_off
      and n.rn <= v_off + v_eff
  )
  select
    c.total_eligible,
    coalesce(
      (
        select jsonb_agg(row_obj order by ord)
        from (
          select
            jsonb_build_object(
              'media_type', p.media_type,
              'tmdb_id', p.tmdb_id,
              'section', p.section,
              'distinct_circle_raters', p.distinct_raters,
              'group_rating', p.group_rating,
              'site_rating', p.site_rating,
              'last_activity_at', p.last_at,
              'viewer_score', p.viewer_score
            ) as row_obj,
            p.rn as ord
          from page p
        ) ordered_rows
      ),
      '[]'::jsonb
    ),
    (select count(*)::int from page)
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
  'Phase C circle strip: paginated (default 10 + offset), max 20 rows; total_eligible + has_more.';

alter function public.get_circle_rated_strip(uuid, int, int) set statement_timeout = '120s';

revoke all on function public.get_circle_rated_strip(uuid, int, int) from public;
revoke all on function public.get_circle_rated_strip(uuid, int, int) from anon;
grant execute on function public.get_circle_rated_strip(uuid, int, int) to authenticated;
