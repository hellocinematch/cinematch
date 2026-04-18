-- Circles strip perf: avoid statement timeout on large public.ratings
--  * Index on ratings(user_id) — join pattern is circle_members.user_id = ratings.user_id
--  * Generous statement_timeout on get_circle_rated_strip (same idea as get_cinemastro_title_avgs)

create index if not exists ratings_user_id_idx
  on public.ratings (user_id);

comment on index public.ratings_user_id_idx is
  'Circle strip + any “all ratings for these users” paths; complements (media_type, tmdb_id, user_id).';

alter function public.get_circle_rated_strip(uuid) set statement_timeout = '120s';
