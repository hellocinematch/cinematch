-- Watch chain: volume by month and surface; first-time vs prior rating flags.

select
  date_trunc('month', created_at AT TIME ZONE 'UTC') as month_utc,
  exposure_surface::text,
  count(*)::bigint as watch_chain_events,
  count(distinct user_id)::bigint as users,
  count(*) filter (where prior_rating_exists = false)::bigint as first_time_rater_events,
  count(*) filter (where prior_rating_exists = true)::bigint as had_prior_rating_events
from public.watch_chain_events
where created_at >= timestamptz '2026-01-01'
  and created_at <  timestamptz '2027-01-01'
group by 1, 2
order by 1 desc, watch_chain_events desc;
