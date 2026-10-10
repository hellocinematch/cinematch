-- New this week: one shared list per weekend edition and region.
-- The first open builds the row (Edge `new-this-week-catalog`). Later opens read it.
-- Ratings are not stored here.

create table if not exists public.new_this_week_catalog (
  edition_key text not null,
  region text not null,
  streaming jsonb not null default '[]'::jsonb,
  theaters jsonb not null default '[]'::jsonb,
  built_at timestamptz not null default now(),
  constraint new_this_week_catalog_pkey primary key (edition_key, region),
  constraint new_this_week_catalog_region_check check (region in ('US', 'IN', 'CA'))
);

comment on table public.new_this_week_catalog is
  'Weekend home list shared per edition (local Thursday date) and region. Filled on the first open. No ratings.';

alter table public.new_this_week_catalog enable row level security;

create policy "new_this_week_catalog_select"
  on public.new_this_week_catalog
  for select
  to anon, authenticated
  using (true);

grant select on public.new_this_week_catalog to anon, authenticated;
