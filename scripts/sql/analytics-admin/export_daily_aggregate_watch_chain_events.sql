-- CSV-friendly daily rollup: watch_chain_events only (no user ids).

select
  'watch_chain_events'::text as table_name,
  date_trunc('day', created_at AT TIME ZONE 'UTC')::date as day_utc,
  exposure_surface::text,
  event_type::text,
  count(*)::bigint as events,
  count(*) filter (where prior_rating_exists = false)::bigint as first_time_rater_events
from public.watch_chain_events
where created_at >= timestamptz '2026-01-01'
  and created_at <  timestamptz '2027-01-01'
group by 2, 3, 4
order by day_utc desc, events desc;
