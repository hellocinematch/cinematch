-- Engagement funnel: top titles by impressions / detail opens (TMDB ids).

select
  tmdb_id,
  media_type,
  count(*) filter (where event_type = 'circle_title_impression')::bigint as impressions,
  count(*) filter (where event_type = 'title_detail_open')::bigint as detail_opens,
  count(distinct user_id)::bigint as distinct_users
from public.analytics_events
where created_at >= timestamptz '2026-01-01'
  and created_at <  timestamptz '2027-01-01'
group by tmdb_id, media_type
order by impressions desc nulls last
limit 50;
