-- Region buckets to surface in recommendations/discover. Empty = no filter (all regions).

alter table public.profiles
  add column if not exists show_region_keys text[] default '{}';

comment on column public.profiles.show_region_keys is 'Region preference keys (hollywood/indian/asian/latam/european); title must match selected language bucket(s) when non-empty; empty = show all regions';
