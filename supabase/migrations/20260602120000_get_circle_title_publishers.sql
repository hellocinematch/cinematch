-- Who published (Circles 3b): list members who published a title to a circle, with their scores.
-- Callable only by active circle members. Mirrors get_circle_rated_* archive cutoff (rated_at < archived_at).

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
  'For a circle member: returns JSON array of { user_id, member_name, score } for members who published this title to the circle.';

revoke all on function public.get_circle_title_publishers(uuid, integer, text) from public;
revoke all on function public.get_circle_title_publishers(uuid, integer, text) from anon;
grant execute on function public.get_circle_title_publishers(uuid, integer, text) to authenticated;
