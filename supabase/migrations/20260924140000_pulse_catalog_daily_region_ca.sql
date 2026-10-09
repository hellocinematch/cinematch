-- Pulse catalog: allow region `CA` (Canada-market popularity). Requires `20260924130000_pulse_catalog_daily_region.sql`.
-- Edge `pulse-catalog` 1.2.0+ upserts (utc_date, 'CA'); before this migration it returns the Canada list uncached.

alter table public.pulse_catalog_daily
  drop constraint if exists pulse_catalog_daily_region_check;

alter table public.pulse_catalog_daily
  add constraint pulse_catalog_daily_region_check check (region in ('US', 'IN', 'CA'));

comment on table public.pulse_catalog_daily is
  'Pulse screen: normalized TMDB strips per UTC date and region (US = worldwide trending week + popular; IN = India-origin popularity pools; CA = Canada-market popularity), filled on first request of the day.';
