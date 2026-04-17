-- Fast path for match `predict`: neighbor ∩ title raters in one indexed join (avoids 100+ Edge round-trips).

create or replace function public.match_predict_neighbor_raters(
  p_user_id uuid,
  p_media_type text,
  p_tmdb_id bigint,
  p_min_similarity double precision default 0.10
)
returns table (score numeric, similarity double precision)
language sql
stable
security definer
set search_path = public
as $$
  select r.score::numeric, un.similarity::double precision
  from public.ratings r
  inner join public.user_neighbors un
    on un.neighbor_id = r.user_id
   and un.user_id = p_user_id
   and un.similarity >= p_min_similarity
  where r.media_type = p_media_type
    and r.tmdb_id = p_tmdb_id;
$$;

comment on function public.match_predict_neighbor_raters is
  'Returns scores + stored similarities for neighbors of p_user_id who rated (p_media_type, p_tmdb_id). Used by match Edge predict only.';

revoke all on function public.match_predict_neighbor_raters(uuid, text, bigint, double precision) from public;
grant execute on function public.match_predict_neighbor_raters(uuid, text, bigint, double precision) to service_role;
