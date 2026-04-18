-- Watchlist: optional attribution when saved from a circle context (no circle name stored — UI shows a generic “group” hint).

alter table public.watchlist
  add column if not exists source_circle_id uuid references public.circles (id) on delete set null;

comment on column public.watchlist.source_circle_id is
  'Set when the user adds to watchlist from that circle’s flow; cleared on delete of the circle row (ON DELETE SET NULL).';

create index if not exists watchlist_source_circle_id_idx
  on public.watchlist (source_circle_id)
  where source_circle_id is not null;
