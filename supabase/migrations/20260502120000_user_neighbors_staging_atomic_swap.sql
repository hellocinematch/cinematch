-- Atomic replace of user_neighbors per user: DELETE + INSERT in one transaction via staging.
-- Prevents stranded empty graphs when batched inserts fail mid-way after DELETE (compute-neighbors Edge).

create table if not exists public.user_neighbors_staging (
  run_id uuid not null,
  user_id uuid not null,
  neighbor_id uuid not null,
  similarity double precision not null
    check (similarity >= 0::double precision and similarity <= 1::double precision),
  overlap_count integer not null
    check (overlap_count >= 1),
  computed_at timestamptz not null,
  constraint user_neighbors_staging_pkey primary key (run_id, neighbor_id),
  constraint user_neighbors_staging_not_self check (user_id <> neighbor_id),
  constraint user_neighbors_staging_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint user_neighbors_staging_neighbor_id_fkey
    foreign key (neighbor_id) references public.profiles (id) on delete cascade
);

create index if not exists user_neighbors_staging_run_id_idx
  on public.user_neighbors_staging (run_id);

comment on table public.user_neighbors_staging is
  'Short-lived rows for compute-neighbors; swapped into user_neighbors via commit_user_neighbors_swap.';

alter table public.user_neighbors_staging enable row level security;

-- No authenticated policies; Edge uses service_role only.
revoke all on public.user_neighbors_staging from public;
grant select, insert, delete on public.user_neighbors_staging to service_role;

create or replace function public.commit_user_neighbors_swap(
  p_user_id uuid,
  p_run_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.user_neighbors where user_id = p_user_id;

  insert into public.user_neighbors (user_id, neighbor_id, similarity, overlap_count, computed_at)
  select s.user_id, s.neighbor_id, s.similarity, s.overlap_count, s.computed_at
  from public.user_neighbors_staging s
  where s.run_id = p_run_id and s.user_id = p_user_id;

  get diagnostics n = row_count;

  delete from public.user_neighbors_staging where run_id = p_run_id;

  return n;
end;
$$;

comment on function public.commit_user_neighbors_swap(uuid, uuid) is
  'Replaces all user_neighbors for p_user_id with staging rows for p_run_id in one transaction.';

revoke all on function public.commit_user_neighbors_swap(uuid, uuid) from public;
grant execute on function public.commit_user_neighbors_swap(uuid, uuid) to service_role;
