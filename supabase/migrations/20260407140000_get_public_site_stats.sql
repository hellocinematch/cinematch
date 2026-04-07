-- Public aggregate counts for marketing (anon-safe). Uses SECURITY DEFINER so RLS on profiles/ratings does not block.
create or replace function public.get_public_site_stats()
returns table (community_count bigint, ratings_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*)::bigint from public.profiles),
    (select count(*)::bigint from public.ratings);
$$;

revoke all on function public.get_public_site_stats() from public;
grant execute on function public.get_public_site_stats() to anon, authenticated;
