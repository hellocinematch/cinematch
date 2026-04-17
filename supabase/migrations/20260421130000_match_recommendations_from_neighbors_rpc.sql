-- Lightweight recommendations path for match "For you / Worth a look".
-- Computes recs directly in SQL from precomputed neighbors + ratings, avoiding large neighbor maps in Edge.

create or replace function public.match_recommendations_from_neighbors(
  p_user_id uuid,
  p_media_type text default null,
  p_limit integer default 60,
  p_min_similarity double precision default 0.10,
  p_min_contributors integer default 2
)
returns table (
  media_type text,
  tmdb_id bigint,
  weighted_score numeric,
  contributor_count integer,
  total_weight double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with candidate_rows as (
    select
      r.media_type,
      r.tmdb_id,
      r.score::double precision as score,
      un.similarity::double precision as similarity
    from public.user_neighbors un
    inner join public.ratings r
      on r.user_id = un.neighbor_id
    left join public.ratings ur
      on ur.user_id = p_user_id
     and ur.media_type = r.media_type
     and ur.tmdb_id = r.tmdb_id
    where un.user_id = p_user_id
      and un.similarity >= p_min_similarity
      and (p_media_type is null or r.media_type = p_media_type)
      and ur.user_id is null
  ),
  aggregated as (
    select
      cr.media_type,
      cr.tmdb_id,
      sum(cr.score * cr.similarity) as weighted_sum,
      sum(cr.similarity) as total_weight,
      count(*)::integer as contributor_count
    from candidate_rows cr
    group by cr.media_type, cr.tmdb_id
  )
  select
    a.media_type,
    a.tmdb_id,
    case
      when a.total_weight > 0 then round((a.weighted_sum / a.total_weight)::numeric, 1)
      else null
    end as weighted_score,
    a.contributor_count,
    a.total_weight
  from aggregated a
  where a.contributor_count >= greatest(coalesce(p_min_contributors, 1), 1)
    and a.total_weight > 0
  order by
    (a.weighted_sum / a.total_weight) desc,
    a.contributor_count desc,
    a.total_weight desc,
    a.tmdb_id desc
  limit greatest(coalesce(p_limit, 60), 1);
$$;

comment on function public.match_recommendations_from_neighbors is
  'Returns top weighted neighbor-based title recommendations for a user, excluding titles already rated by that user.';

revoke all on function public.match_recommendations_from_neighbors(uuid, text, integer, double precision, integer) from public;
grant execute on function public.match_recommendations_from_neighbors(uuid, text, integer, double precision, integer) to service_role;
