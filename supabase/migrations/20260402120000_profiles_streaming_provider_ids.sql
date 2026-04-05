-- Stores TMDB watch provider IDs the user selected in Settings (US major services).
-- Run in Supabase SQL editor if this column is not already present.

alter table public.profiles
  add column if not exists streaming_provider_ids integer[] default '{}';

comment on column public.profiles.streaming_provider_ids is 'TMDB provider_id values for subscription services the user selected';
