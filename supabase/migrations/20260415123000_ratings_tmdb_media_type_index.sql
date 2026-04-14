-- Speed lookups by title for diagnostics and get_cinemastro_title_avgs (filter on tmdb_id + media_type).
-- Without this, "where tmdb_id = ?" scans the whole ratings table.

create index if not exists ratings_tmdb_id_media_type_idx
  on public.ratings (tmdb_id, media_type);
