# Analytics admin queries (Supabase Postgres)

Run in **SQL Editor** as a privileged role (postgres / service role context bypasses RLS).

Edit the **reporting window** in each file where noted (`timestamptz` literals).

No client instrumentation required to *run* these—only rows that exist will appear.

## Files

| File | Purpose |
|------|---------|
| `engagement_funnel_by_month_surface.sql` | Funnel events by month, `event_type`, `exposure_surface` |
| `engagement_detail_open_providers.sql` | Detail opens vs `providers_visible` / `streaming_section_rendered` |
| `engagement_top_titles.sql` | Top titles by impressions + detail opens |
| `engagement_by_circle_surface.sql` | Events with `circle_id`, by surface |
| `watch_chain_by_month_surface.sql` | Watch-chain volume + first-time vs prior rating |
| `watch_chain_first_time_rater_by_surface.sql` | `prior_rating_exists = false` by surface |
| `watch_chain_peer_to_viewer_hours.sql` | Median/P90 hours peer → viewer when influencer present |
| `engagement_surface_totals.sql` | Total funnel events by `exposure_surface` |
| `export_daily_aggregate_analytics_events.sql` | Daily rollup (`analytics_events`), CSV-friendly |
| `export_daily_aggregate_watch_chain_events.sql` | Daily rollup (`watch_chain_events`), CSV-friendly |
