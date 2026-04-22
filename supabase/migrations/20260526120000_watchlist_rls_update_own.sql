-- Reorder and other `sort_index` updates require an UPDATE RLS policy when RLS is enabled on `watchlist`.
-- (SELECT / INSERT / DELETE may already be allowed; missing UPDATE can surface as “moves do nothing” in the client when RETURNING is empty.)

drop policy if exists "watchlist update own" on public.watchlist;
create policy "watchlist update own"
  on public.watchlist
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
