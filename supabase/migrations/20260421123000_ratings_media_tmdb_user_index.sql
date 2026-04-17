-- Optional: speeds match_predict_neighbor_raters when many rows exist per (media_type, tmdb_id).

create index if not exists ratings_media_type_tmdb_id_user_id_idx
  on public.ratings (media_type, tmdb_id, user_id);
