-- Self-service account deletion (7.0.86).
-- Circle rule (locked): sole member → delete the circle; others remain → move
-- circles.creator_id to the next host (earliest remaining joined_at, then user_id)
-- then remove membership. Also reassign leftover founder circles they already left
-- (creator_id is ON DELETE CASCADE and is not updated on leave).
-- Ratings / watchlist / profile are wiped here so they do not linger if auth delete
-- is delayed; Edge delete-account then removes auth.users.

create or replace function public.prepare_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_circle_id uuid;
  v_count int;
  v_next uuid;
  v_deleted int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Memberships first (active and archived).
  for v_circle_id in
    select cm.circle_id
    from public.circle_members cm
    where cm.user_id = v_uid
  loop
    select count(*)::int
      into v_count
    from public.circle_members
    where circle_id = v_circle_id;

    if v_count <= 1 then
      delete from public.circles where id = v_circle_id;
    else
      select cm.user_id
        into v_next
      from public.circle_members cm
      where cm.circle_id = v_circle_id
        and cm.user_id is distinct from v_uid
      order by cm.joined_at asc nulls last, cm.user_id asc
      limit 1;

      if v_next is null then
        raise exception 'prepare_account_deletion: missing successor for circle %', v_circle_id;
      end if;

      update public.circles
      set creator_id = v_next, updated_at = now()
      where id = v_circle_id
        and creator_id = v_uid;

      update public.circle_invites
      set invited_by = v_next
      where circle_id = v_circle_id
        and invited_by = v_uid;

      delete from public.circle_members
      where circle_id = v_circle_id
        and user_id = v_uid;
      get diagnostics v_deleted = row_count;
      if v_deleted <> 1 then
        raise exception 'prepare_account_deletion: could not leave circle %', v_circle_id;
      end if;
    end if;
  end loop;

  -- Circles they founded but already left (creator_id still points at them).
  for v_circle_id in
    select c.id
    from public.circles c
    where c.creator_id = v_uid
  loop
    select cm.user_id
      into v_next
    from public.circle_members cm
    where cm.circle_id = v_circle_id
      and cm.user_id is distinct from v_uid
    order by cm.joined_at asc nulls last, cm.user_id asc
    limit 1;

    if v_next is null then
      delete from public.circles where id = v_circle_id;
    else
      update public.circles
      set creator_id = v_next, updated_at = now()
      where id = v_circle_id;

      update public.circle_invites
      set invited_by = v_next
      where circle_id = v_circle_id
        and invited_by = v_uid;
    end if;
  end loop;

  -- Belt: any leftover invites they sent (circle now has a different founder).
  update public.circle_invites ci
  set invited_by = c.creator_id
  from public.circles c
  where ci.circle_id = c.id
    and ci.invited_by = v_uid
    and c.creator_id is distinct from v_uid;

  delete from public.circle_invites
  where invited_by = v_uid
     or invited_user_id = v_uid;

  if to_regclass('public.watch_chain_events') is not null then
    execute 'update public.watch_chain_events set influencer_user_id = null where influencer_user_id = $1'
      using v_uid;
    execute 'delete from public.watch_chain_events where user_id = $1'
      using v_uid;
  end if;

  if to_regclass('public.analytics_events') is not null then
    execute 'delete from public.analytics_events where user_id = $1'
      using v_uid;
  end if;

  if to_regclass('public.rating_circle_shares') is not null then
    delete from public.rating_circle_shares where user_id = v_uid;
  end if;

  if to_regclass('public.user_title_predictions') is not null then
    delete from public.user_title_predictions where user_id = v_uid;
  end if;

  if to_regclass('public.user_neighbors') is not null then
    delete from public.user_neighbors
    where user_id = v_uid or neighbor_id = v_uid;
  end if;

  if to_regclass('public.user_neighbors_staging') is not null then
    delete from public.user_neighbors_staging
    where user_id = v_uid or neighbor_id = v_uid;
  end if;

  if to_regclass('public.device_push_tokens') is not null then
    delete from public.device_push_tokens where user_id = v_uid;
  end if;

  if to_regclass('public.watchlist') is not null then
    delete from public.watchlist where user_id = v_uid;
  end if;

  delete from public.ratings where user_id = v_uid;

  delete from public.profiles where id = v_uid;

  return jsonb_build_object('ok', true, 'user_id', v_uid);
end;
$$;

comment on function public.prepare_account_deletion() is
  'Caller-only: leave/transfer circles (next host = earliest remaining joined_at), wipe public user rows. Edge then deletes auth.users.';

revoke all on function public.prepare_account_deletion() from public;
revoke all on function public.prepare_account_deletion() from anon;
grant execute on function public.prepare_account_deletion() to authenticated;
