-- Engagement funnel: total events by exposure_surface (compare strip vs push, etc.).

select
  exposure_surface::text,
  count(*)::bigint as events
from public.analytics_events
where created_at >= timestamptz '2026-01-01'
  and created_at <  timestamptz '2027-01-01'
group by exposure_surface
order by events desc;
