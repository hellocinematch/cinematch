-- Max 30 watchlist rows per user (matches client WATCHLIST_MAX).
-- Pre-launch: trim any user over the cap, then enforce on insert.

delete from public.watchlist w
where w.ctid in (
  select ctid
  from (
    select
      ctid,
      row_number() over (
        partition by user_id
        order by sort_index asc nulls last, tmdb_id asc, media_type asc
      ) as rn
    from public.watchlist
  ) x
  where x.rn > 30
);

create or replace function public.enforce_watchlist_max_per_user()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if (
    select count(*)::int from public.watchlist w where w.user_id = new.user_id
  ) >= 30 then
    raise exception 'Watchlist limit reached (30 titles). Remove a title to add more.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.enforce_watchlist_max_per_user() is
  'BEFORE INSERT on watchlist: reject when user already has 30 rows.';

drop trigger if exists watchlist_enforce_max_per_user on public.watchlist;
create trigger watchlist_enforce_max_per_user
  before insert on public.watchlist
  for each row
  execute function public.enforce_watchlist_max_per_user();
