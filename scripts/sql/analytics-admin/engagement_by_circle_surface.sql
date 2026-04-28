-- Engagement funnel: events with circle context, by circle and surface.

select
  circle_id,
  exposure_surface::text,
  count(*)::bigint as events,
  count(distinct user_id)::bigint as users
from public.analytics_events
where circle_id is not null
  and created_at >= timestamptz '2026-01-01'
  and created_at <  timestamptz '2027-01-01'
group by circle_id, exposure_surface
order by events desc
limit 100;
