-- v3.0.0: Batch community averages from public.ratings for poster/detail badges (Cinemastro vs TMDB in UI).
-- SECURITY DEFINER so anon/authenticated clients can read aggregates without per-row RLS on ratings.
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
  where (r.tmdb_id, r.media_type) in (
    select (e->>'tmdb_id')::bigint, e->>'media_type'
    from jsonb_array_elements(p_titles) as e
  )
  group by r.tmdb_id, r.media_type;
$$;

comment on function public.get_cinemastro_title_avgs(jsonb) is
  'v3.0.0: Returns avg(score) per (tmdb_id, media_type) for badge “Cinemastro rating”; client prefers over TMDB when present.';

revoke all on function public.get_cinemastro_title_avgs(jsonb) from public;
grant execute on function public.get_cinemastro_title_avgs(jsonb) to anon, authenticated;
