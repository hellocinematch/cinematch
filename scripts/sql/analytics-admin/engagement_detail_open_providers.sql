-- Engagement funnel: title_detail_open counts vs providers flags.

select
  count(*) filter (where event_type = 'title_detail_open')::bigint as detail_opens,
  count(*) filter (where event_type = 'title_detail_open' and providers_visible is true)::bigint
    as detail_open_providers_visible_true,
  count(*) filter (where event_type = 'title_detail_open' and streaming_section_rendered is true)::bigint
    as detail_open_streaming_section_rendered_true
from public.analytics_events
where created_at >= timestamptz '2026-01-01'
  and created_at <  timestamptz '2027-01-01';
