-- Title detail "Clear my rating": allow authenticated users to delete their own row.
-- Client deletes matching rating_circle_shares first (existing policy); then ratings.

drop policy if exists "ratings delete own" on public.ratings;
create policy "ratings delete own"
  on public.ratings
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant delete on table public.ratings to authenticated;

comment on policy "ratings delete own" on public.ratings is
  'User may remove their global rating for a title (and app removes circle shares first).';
