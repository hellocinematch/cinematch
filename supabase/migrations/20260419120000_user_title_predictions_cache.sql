-- Durable per-user prediction cache for detail-level personal predictions.
-- Keeps predictions stable across runtime sampling variance in edge invocation.

create table if not exists public.user_title_predictions (
  user_id uuid not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  tmdb_id bigint not null,
  predicted numeric(4,1) not null,
  low numeric(4,1) not null,
  high numeric(4,1) not null,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  neighbor_count integer not null default 0,
  computed_at timestamptz not null default now(),
  model_version text not null,
  source_hash text null,
  constraint user_title_predictions_pkey primary key (user_id, media_type, tmdb_id)
);

create index if not exists user_title_predictions_user_computed_idx
  on public.user_title_predictions (user_id, computed_at desc);

comment on table public.user_title_predictions is
  'Durable read-through cache of personal CF predictions by (user_id, media_type, tmdb_id).';

comment on column public.user_title_predictions.model_version is
  'Match edge model/version stamp used for invalidation after major algorithm changes.';

alter table public.user_title_predictions enable row level security;

drop policy if exists "user can read own predictions" on public.user_title_predictions;
create policy "user can read own predictions"
  on public.user_title_predictions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user can delete own predictions" on public.user_title_predictions;
create policy "user can delete own predictions"
  on public.user_title_predictions
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, delete on public.user_title_predictions to authenticated;

create or replace function public.invalidate_user_prediction_cache_from_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  target_user_id := coalesce(new.user_id, old.user_id);
  if target_user_id is null then
    return coalesce(new, old);
  end if;

  delete from public.user_title_predictions
  where user_id = target_user_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_invalidate_user_prediction_cache_from_rating on public.ratings;
create trigger trg_invalidate_user_prediction_cache_from_rating
after insert or update or delete on public.ratings
for each row execute function public.invalidate_user_prediction_cache_from_rating();
