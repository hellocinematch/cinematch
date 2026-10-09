-- Pulse catalog per UTC day **and region**: `US` (worldwide trending + popular; also Canada) and `IN`
-- (India-origin popularity pools; Languages to show first is applied by the client when reading).
-- Existing rows become `US`. Edge `pulse-catalog` 1.1.0+ upserts on (utc_date, region).

alter table public.pulse_catalog_daily
  add column if not exists region text not null default 'US';

alter table public.pulse_catalog_daily
  drop constraint if exists pulse_catalog_daily_region_check;

alter table public.pulse_catalog_daily
  add constraint pulse_catalog_daily_region_check check (region in ('US', 'IN'));

alter table public.pulse_catalog_daily
  drop constraint if exists pulse_catalog_daily_pkey;

alter table public.pulse_catalog_daily
  add constraint pulse_catalog_daily_pkey primary key (utc_date, region);

comment on table public.pulse_catalog_daily is
  'Pulse screen: normalized TMDB strips per UTC date and region (US = worldwide trending week + popular; IN = India-origin popularity pools), filled on first request of the day.';
