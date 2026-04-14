-- Fix Cinemastro RPC: match ratings rows even when media_type is an enum or mixed case.
-- Replaces tuple IN (bigint, text) which can fail to match (enum vs text composite compare).
-- Normalizes both sides with lower(trim(...)) so payload "movie" matches stored Movie/movie.

create or replace function public.get_cinemastro_title_avgs(p_titles jsonb)
returns table (tmdb_id bigint, media_type text, avg_score double precision)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.tmdb_id,
    trim(lower(r.media_type::text)) as media_type,
    round(avg(r.score)::numeric, 1)::double precision as avg_score
  from public.ratings r
  where exists (
    select 1
    from jsonb_array_elements(p_titles) as e
    where r.tmdb_id = (e->>'tmdb_id')::bigint
      and trim(lower(r.media_type::text)) = trim(lower(e->>'media_type'))
  )
  group by r.tmdb_id, trim(lower(r.media_type::text));
$$;

comment on function public.get_cinemastro_title_avgs(jsonb) is
  'v3.0.0+: Avg(score) per (tmdb_id, media_type); media_type normalized to lowercase text for matching.';
