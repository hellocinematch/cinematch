-- Watch chain: cohort with prior_rating_exists = false, by exposure_surface.

select
  exposure_surface::text,
  count(*)::bigint as events,
  count(distinct user_id)::bigint as users
from public.watch_chain_events
where prior_rating_exists = false
  and created_at >= timestamptz '2026-01-01'
  and created_at <  timestamptz '2027-01-01'
group by exposure_surface
order by events desc;
