-- Hotfix: get_circle_rated_strip reliability
--  * Archived circles: exclude ratings with NULL rated_at (cannot compare to archived_at).
--  * Build titles JSON via ordered subquery + jsonb_agg (avoids aggregate ORDER BY edge cases on some PG builds).
-- Apply in Supabase SQL editor if v20260426120000 already ran.

create or replace function public.get_circle_rated_strip(p_circle_id uuid)
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
      'titles', '[]'::jsonb
    );
  end if;

  select c.archived_at into v_archived_at
  from public.circles c
  where c.id = p_circle_id;

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
  )
  select coalesce(
    (
      select jsonb_agg(row_obj)
      from (
        select jsonb_build_object(
          'media_type', n.media_type,
          'tmdb_id', n.tmdb_id,
          'section', n.section,
          'distinct_circle_raters', n.distinct_raters,
          'group_rating', n.group_rating,
          'site_rating', n.site_rating,
          'last_activity_at', n.last_at,
          'viewer_score', n.viewer_score
        ) as row_obj
        from numbered n
        where n.rn <= 60
        order by
          case when n.section = 'together' then 0 else 1 end,
          n.last_at desc nulls last
      ) ordered_rows
    ),
    '[]'::jsonb
  )
  into v_titles;

  return jsonb_build_object(
    'member_count', v_member_count,
    'gated', false,
    'titles', coalesce(v_titles, '[]'::jsonb)
  );
end;
$$;

comment on function public.get_circle_rated_strip(uuid) is
  'Phase C circle strip (v2 hotfix): archived filter + ordered jsonb_agg via subquery.';

revoke all on function public.get_circle_rated_strip(uuid) from public;
revoke all on function public.get_circle_rated_strip(uuid) from anon;
grant execute on function public.get_circle_rated_strip(uuid) to authenticated;
