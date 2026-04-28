-- CSV-friendly daily rollup: analytics_events only (no user ids).

select
  'analytics_events'::text as table_name,
  date_trunc('day', created_at AT TIME ZONE 'UTC')::date as day_utc,
  event_type::text,
  exposure_surface::text,
  count(*)::bigint as events
from public.analytics_events
where created_at >= timestamptz '2026-01-01'
  and created_at <  timestamptz '2027-01-01'
group by 2, 3, 4
order by day_utc desc, events desc;
