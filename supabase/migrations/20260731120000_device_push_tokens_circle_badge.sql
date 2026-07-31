-- Phase 2 (badge-only): store native device push tokens + server-side unseen total for APNs badge.

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  constraint device_push_tokens_token_unique unique (token)
);

create index if not exists device_push_tokens_user_id_idx
  on public.device_push_tokens (user_id);

comment on table public.device_push_tokens is
  'Native push device tokens (APNs/FCM). Used for home-screen badge sync when app is killed.';

alter table public.device_push_tokens enable row level security;

drop policy if exists "device_push_tokens_select_own" on public.device_push_tokens;
create policy "device_push_tokens_select_own"
  on public.device_push_tokens for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "device_push_tokens_insert_own" on public.device_push_tokens;
create policy "device_push_tokens_insert_own"
  on public.device_push_tokens for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "device_push_tokens_update_own" on public.device_push_tokens;
create policy "device_push_tokens_update_own"
  on public.device_push_tokens for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "device_push_tokens_delete_own" on public.device_push_tokens;
create policy "device_push_tokens_delete_own"
  on public.device_push_tokens for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.register_device_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_platform text := lower(trim(coalesce(p_platform, '')));
  v_token text := trim(coalesce(p_token, ''));
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_token = '' or char_length(v_token) > 512 then
    raise exception 'invalid token';
  end if;
  if v_platform not in ('ios', 'android') then
    raise exception 'invalid platform';
  end if;

  insert into public.device_push_tokens (user_id, token, platform, updated_at)
  values (v_uid, v_token, v_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();
end;
$$;

comment on function public.register_device_push_token(text, text) is
  'Upsert the caller’s device push token (ios|android).';

create or replace function public.unregister_device_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_token text := trim(coalesce(p_token, ''));
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_token = '' then
    return;
  end if;
  delete from public.device_push_tokens
  where user_id = v_uid
    and token = v_token;
end;
$$;

create or replace function public.clear_my_device_push_tokens()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  delete from public.device_push_tokens where user_id = v_uid;
end;
$$;

-- Sum of unseen_others across the user’s active circles (same rules as get_my_circle_unseen_counts).
create or replace function public.get_user_circle_unseen_total(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_total integer;
begin
  if p_user_id is null then
    return 0;
  end if;
  -- service_role (uid null) or the user themselves
  if v_caller is not null and v_caller is distinct from p_user_id then
    raise exception 'not allowed';
  end if;

  select coalesce(sum(x.unseen_others), 0)::int
  into v_total
  from (
    select coalesce((
      select count(*)::int
      from public.rating_circle_shares sh
      where sh.circle_id = cm.circle_id
        and sh.user_id is distinct from p_user_id
        and sh.created_at > coalesce(ls.last_seen_at, now())
    ), 0) as unseen_others
    from public.circle_members cm
    inner join public.circles c
      on c.id = cm.circle_id
     and c.status = 'active'
    left join public.circle_member_last_seen ls
      on ls.user_id = p_user_id
     and ls.circle_id = cm.circle_id
    where cm.user_id = p_user_id
  ) x;

  return coalesce(v_total, 0);
end;
$$;

comment on function public.get_user_circle_unseen_total(uuid) is
  'Total unseen circle shares for a user (sum of get_my_circle_unseen_counts). Service role or self.';

revoke all on function public.register_device_push_token(text, text) from public;
revoke all on function public.unregister_device_push_token(text) from public;
revoke all on function public.clear_my_device_push_tokens() from public;
revoke all on function public.get_user_circle_unseen_total(uuid) from public;

grant execute on function public.register_device_push_token(text, text) to authenticated;
grant execute on function public.unregister_device_push_token(text) to authenticated;
grant execute on function public.clear_my_device_push_tokens() to authenticated;
grant execute on function public.get_user_circle_unseen_total(uuid) to authenticated;
grant execute on function public.get_user_circle_unseen_total(uuid) to service_role;
