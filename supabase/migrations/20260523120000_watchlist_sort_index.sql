-- User-controlled watchlist order (syncs across devices; client orders by this column).

alter table public.watchlist
  add column if not exists sort_index integer not null default 0;

comment on column public.watchlist.sort_index is
  'Display order within a user list; lower = earlier. Set on insert and when reordering.';

-- Backfill existing rows with stable per-user indices (0 .. n-1).
with ranked as (
  select
    ctid,
    row_number() over (
      partition by user_id
      order by tmdb_id asc, media_type asc
    ) - 1 as idx
  from public.watchlist
)
update public.watchlist w
set sort_index = ranked.idx
from ranked
where w.ctid = ranked.ctid;

create index if not exists watchlist_user_sort_index_idx
  on public.watchlist (user_id, sort_index);
