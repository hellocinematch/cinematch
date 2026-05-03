-- Keep public.profiles.name aligned with auth signup metadata when email confirmation
-- leaves the client without a JWT (post-signup profiles.update cannot pass RLS).

-- 1) Backfill: meta has a display name but profiles.name is empty / whitespace-only
update public.profiles p
set name = left(
  case
    when char_length(btrim(coalesce(nullif(u.raw_user_meta_data->>'name', ''), ''))) >= 2 then
      btrim(u.raw_user_meta_data->>'name')
    when char_length(btrim(coalesce(nullif(split_part(u.email::text, '@', 1), ''), ''))) >= 2 then
      btrim(split_part(u.email::text, '@', 1))
    else 'User'
  end,
  120
)
from auth.users u
where u.id = p.id
  and btrim(coalesce(p.name::text, '')) = ''
  and (
    nullif(btrim(coalesce(u.raw_user_meta_data->>'name', '')), '') is not null
    or nullif(split_part(u.email::text, '@', 1), '') is not null
  );

-- 2) Trigger: new signups and metadata edits
create or replace function public.sync_profile_display_name_from_auth_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta text;
  v_final text;
begin
  v_meta := nullif(btrim(coalesce(new.raw_user_meta_data->>'name', '')), '');
  if v_meta is not null and char_length(v_meta) >= 2 then
    v_final := left(v_meta, 120);
  elsif char_length(btrim(coalesce(nullif(split_part(new.email::text, '@', 1), ''), ''))) >= 2 then
    v_final := left(btrim(split_part(new.email::text, '@', 1)), 120);
  else
    v_final := 'User';
  end if;

  insert into public.profiles (id, name)
  values (new.id, v_final)
  on conflict (id) do update
  set name = excluded.name
  where btrim(coalesce(public.profiles.name, '')) = ''
     or (v_meta is not null and char_length(v_meta) >= 2);

  return new;
end;
$$;

comment on function public.sync_profile_display_name_from_auth_users() is
  'AFTER INSERT OR UPDATE OF raw_user_meta_data ON auth.users: upsert profiles.name from user_metadata.name (email local-part / User fallback). Covers confirm-email signup without client session.';

drop trigger if exists on_auth_user_sync_profile_display_name on auth.users;
create trigger on_auth_user_sync_profile_display_name
  after insert or update of raw_user_meta_data on auth.users
  for each row
  execute function public.sync_profile_display_name_from_auth_users();
