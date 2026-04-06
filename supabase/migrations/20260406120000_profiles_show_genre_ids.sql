-- Genres to surface in recommendations (TMDB genre_id values). Empty = no filter (all genres).

alter table public.profiles
  add column if not exists show_genre_ids integer[] default '{}';

comment on column public.profiles.show_genre_ids is 'TMDB genre_ids: title must match at least one when non-empty; empty = show all genres';
