-- Circle info modal: display names for all members of a circle.
--
-- Direct `select from profiles where id in (...)` only returns rows the caller may read under
-- RLS (typically just their own row). Co-members' names need a SECURITY DEFINER read gated on
-- `is_circle_member(p_circle_id)` — same pattern as `get_my_pending_invites()`.

create or replace function public.get_circle_member_names(p_circle_id uuid)
returns table (user_id uuid, member_name text)
language sql
security definer
set search_path = public
stable
as $$
  select
    cm.user_id,
    coalesce(p.name, '')::text as member_name
  from public.circle_members cm
  inner join public.profiles p on p.id = cm.user_id
  where cm.circle_id = p_circle_id
    and public.is_circle_member(p_circle_id)
  order by cm.user_id;
$$;

comment on function public.get_circle_member_names(uuid) is
  'For auth.uid() members of p_circle_id: returns each co-member''s profiles.name. Empty string when name is null. No rows when caller is not in the circle.';

revoke all on function public.get_circle_member_names(uuid) from public;
revoke all on function public.get_circle_member_names(uuid) from anon;
grant execute on function public.get_circle_member_names(uuid) to authenticated;
