-- Engagement funnel: counts by month (UTC), event_type, exposure_surface.
-- Reporting window — edit bounds:
--   start: inclusive   end: exclusive

select
  date_trunc('month', created_at AT TIME ZONE 'UTC') as month_utc,
  event_type::text,
  exposure_surface::text,
  count(*)::bigint as events,
  count(distinct user_id)::bigint as users
from public.analytics_events
where created_at >= timestamptz '2026-01-01'
  and created_at <  timestamptz '2027-01-01'
group by 1, 2, 3
order by 1 desc, events desc;
