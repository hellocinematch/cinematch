-- A published TV show is one score: the average of that person's seasons when
-- any season is scored, otherwise the whole-show score. Season scores stay on
-- the title. They are not separate circle cards, and a season review stays
-- on the title too.
--
-- Released clients split a show into season cards from get_circle_title_publisher_lines.
-- Returning one line per person, with season_number null, makes those apps show
-- one card. Do not apply until asked. Production is separate from staging.

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
      order by y.member_name, y.user_id
    )
    from (
      select
        r.user_id,
        coalesce(p.name, '')::text as member_name,
        null::int as season_number,
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
    ) y
  ), '[]'::jsonb);
end;
$$;

comment on function public.get_circle_title_publisher_lines(uuid, integer, text) is
  'Circle scores for one title. One line per person. season_number is null. For a show the score is the season average when any season is scored, otherwise the whole-show score.';

revoke all on function public.get_circle_title_publisher_lines(uuid, integer, text) from public;
revoke all on function public.get_circle_title_publisher_lines(uuid, integer, text) from anon;
grant execute on function public.get_circle_title_publisher_lines(uuid, integer, text) to authenticated;

-- Whole-show reviews only. A season review stays on the title.

create or replace function public.get_circle_title_reviews(
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
        'season_number', null,
        'body', y.body
      )
      order by y.member_name, y.user_id
    )
    from (
      select
        rr.user_id,
        coalesce(p.name, '')::text as member_name,
        rr.body
      from public.rating_reviews rr
      inner join public.ratings r
        on r.user_id = rr.user_id
       and r.tmdb_id = rr.tmdb_id
       and r.media_type::text = rr.media_type
       and not r.score_from_seasons
      inner join public.circle_members cm
        on cm.user_id = rr.user_id
       and cm.circle_id = p_circle_id
      inner join public.rating_circle_shares sh
        on sh.user_id = rr.user_id
       and sh.tmdb_id = rr.tmdb_id
       and sh.media_type::text = rr.media_type
       and sh.circle_id = p_circle_id
      inner join public.profiles p
        on p.id = rr.user_id
      where rr.tmdb_id = p_tmdb_id
        and rr.media_type = p_media_type
        and rr.season_number = 0
        and (
          v_archived_at is null
          or (r.rated_at is not null and r.rated_at < v_archived_at)
        )
    ) y
  ), '[]'::jsonb);
end;
$$;

comment on function public.get_circle_title_reviews(uuid, integer, text) is
  'Whole-show reviews by people who published this title to the circle. Season reviews stay on the title.';

revoke all on function public.get_circle_title_reviews(uuid, integer, text) from public;
revoke all on function public.get_circle_title_reviews(uuid, integer, text) from anon;
grant execute on function public.get_circle_title_reviews(uuid, integer, text) to authenticated;

create or replace function public.get_circle_review_counts(p_circle_id uuid)
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
        'tmdb_id', y.tmdb_id,
        'media_type', y.media_type,
        'season_number', null,
        'review_count', y.review_count
      )
    )
    from (
      select
        rr.tmdb_id,
        rr.media_type,
        count(*)::int as review_count
      from public.rating_reviews rr
      inner join public.ratings r
        on r.user_id = rr.user_id
       and r.tmdb_id = rr.tmdb_id
       and r.media_type::text = rr.media_type
       and not r.score_from_seasons
      inner join public.circle_members cm
        on cm.user_id = rr.user_id
       and cm.circle_id = p_circle_id
      inner join public.rating_circle_shares sh
        on sh.user_id = rr.user_id
       and sh.tmdb_id = rr.tmdb_id
       and sh.media_type::text = rr.media_type
       and sh.circle_id = p_circle_id
      where rr.season_number = 0
        and (
          v_archived_at is null
          or (r.rated_at is not null and r.rated_at < v_archived_at)
        )
      group by rr.tmdb_id, rr.media_type
    ) y
  ), '[]'::jsonb);
end;
$$;

comment on function public.get_circle_review_counts(uuid) is
  'How many whole-show reviews each published title has in this circle. Season reviews are not counted.';

revoke all on function public.get_circle_review_counts(uuid) from public;
revoke all on function public.get_circle_review_counts(uuid) from anon;
grant execute on function public.get_circle_review_counts(uuid) to authenticated;
