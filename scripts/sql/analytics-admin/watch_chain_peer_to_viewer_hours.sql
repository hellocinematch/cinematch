-- Watch chain: peer → viewer time when influencer fields are present (hours).

select
  exposure_surface::text,
  count(*)::bigint as rows_with_influencer,
  percentile_disc(0.5) within group (
    order by extract(epoch from (viewer_rated_at - influencer_rated_at))
  ) / 3600.0 as median_hours_peer_to_viewer_rating,
  percentile_disc(0.9) within group (
    order by extract(epoch from (viewer_rated_at - influencer_rated_at))
  ) / 3600.0 as p90_hours
from public.watch_chain_events
where influencer_user_id is not null
  and influencer_rated_at is not null
  and viewer_rated_at >= influencer_rated_at
  and created_at >= timestamptz '2026-01-01'
  and created_at <  timestamptz '2027-01-01'
group by exposure_surface
order by rows_with_influencer desc;
