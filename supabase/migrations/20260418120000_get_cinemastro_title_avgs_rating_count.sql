-- v3.1.0: Community avg + rating_count for badge confidence (underline meter in client).
-- Replaces function return shape: adds rating_count = count(*) per (tmdb_id, media_type).
-- Keeps statement_timeout generous for large public.ratings until a rollup table exists.
--
-- Postgres does not allow CREATE OR REPLACE when the RETURNS TABLE / OUT row type changes;
-- drop first, then create (see ERROR42P13).

drop function if exists public.get_cinemastro_title_avgs(jsonb);

create function public.get_cinemastro_title_avgs(p_titles jsonb)
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
  from public.ratings r
  where (r.tmdb_id, r.media_type::text) in (
    select (e->>'tmdb_id')::bigint, e->>'media_type'
    from jsonb_array_elements(p_titles) as e
  )
  group by r.tmdb_id, r.media_type;
$$;

comment on function public.get_cinemastro_title_avgs(jsonb) is
  'v3.1.0: Avg(score) and rating_count per (tmdb_id, media_type); media_type compared as text to JSON payload.';

alter function public.get_cinemastro_title_avgs(jsonb) set statement_timeout = '60s';

revoke all on function public.get_cinemastro_title_avgs(jsonb) from public;
grant execute on function public.get_cinemastro_title_avgs(jsonb) to anon, authenticated;
