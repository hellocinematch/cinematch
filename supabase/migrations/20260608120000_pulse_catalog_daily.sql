-- Shared Pulse catalog for all signed-in users: one row per UTC calendar day.
-- Populated lazily by Edge `pulse-catalog` (TMDB read + service-role upsert). Clients read via RLS.

create table if not exists public.pulse_catalog_daily (
  utc_date date primary key,
  trending jsonb not null default '[]'::jsonb,
  popular jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

comment on table public.pulse_catalog_daily is
  'Pulse screen: normalized TMDB trending (week) + popular strips, shared per UTC date; filled on first request of the day.';

alter table public.pulse_catalog_daily enable row level security;

create policy "pulse_catalog_daily_select_authenticated"
  on public.pulse_catalog_daily
  for select
  to authenticated
  using (true);

-- Writes: service role (Edge) only — no insert/update policy for authenticated.

grant select on public.pulse_catalog_daily to authenticated;
