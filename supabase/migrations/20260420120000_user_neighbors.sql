-- Precomputed cosine-similarity neighbors per real user (v3.5.0).
-- Written by compute-neighbors Edge Function; read by match (2-query predict path).

create table if not exists public.user_neighbors (
  user_id uuid not null,
  neighbor_id uuid not null,
  similarity double precision not null
    check (similarity >= 0::double precision and similarity <= 1::double precision),
  overlap_count integer not null
    check (overlap_count >= 1),
  computed_at timestamptz not null default now(),
  constraint user_neighbors_pkey primary key (user_id, neighbor_id),
  constraint user_neighbors_not_self check (user_id <> neighbor_id),
  constraint user_neighbors_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint user_neighbors_neighbor_id_fkey
    foreign key (neighbor_id) references public.profiles (id) on delete cascade
);

-- Hot path: match loads neighbors for one user, ordered by similarity (see cinemastro-match-architecture §3c).
create index if not exists user_neighbors_user_similarity_idx
  on public.user_neighbors (user_id, similarity desc);

-- Housekeeping: recompute job may delete/replace by neighbor when a profile is removed (cascade handles rows);
-- optional reverse lookup if we ever need "who lists X as a neighbor" (admin/diagnostics).
create index if not exists user_neighbors_neighbor_id_idx
  on public.user_neighbors (neighbor_id);

comment on table public.user_neighbors is
  'Pre-ranked CF neighbors per user (cosine similarity + overlap). Populated by compute-neighbors; consumed by match.';

comment on column public.user_neighbors.similarity is
  'Cosine similarity on shared rated titles; only neighbors at or above the job noise floor are stored.';

comment on column public.user_neighbors.overlap_count is
  'Count of titles rated by both user_id and neighbor_id among user_id''s ratings.';

alter table public.user_neighbors enable row level security;

drop policy if exists "user can read own neighbor rows" on public.user_neighbors;
create policy "user can read own neighbor rows"
  on public.user_neighbors
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Writes go through Edge Functions (service role). Authenticated clients may read their own list only.
grant select on public.user_neighbors to authenticated;
