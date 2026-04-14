-- Restore get_cinemastro_title_avgs to the v3.0.0 IN-list shape (known good with PostgREST).
-- Re-apply EXECUTE grants so anon/authenticated can call after any replace.
-- If you had applied20260415120000 only, grants may have been missing — this fixes that too.

create or replace function public.get_cinemastro_title_avgs(p_titles jsonb)
returns table (tmdb_id bigint, media_type text, avg_score double precision)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.tmdb_id,
    r.media_type::text,
    round(avg(r.score)::numeric, 1)::double precision as avg_score
  from public.ratings r
  where (r.tmdb_id, r.media_type::text) in (
    select (e->>'tmdb_id')::bigint, e->>'media_type'
    from jsonb_array_elements(p_titles) as e
  )
  group by r.tmdb_id, r.media_type;
$$;

comment on function public.get_cinemastro_title_avgs(jsonb) is
  'v3.0.0: Avg(score) per (tmdb_id, media_type); media_type compared as text to JSON payload.';

revoke all on function public.get_cinemastro_title_avgs(jsonb) from public;
grant execute on function public.get_cinemastro_title_avgs(jsonb) to anon, authenticated;
