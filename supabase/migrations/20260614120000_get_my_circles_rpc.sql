-- My Circles list: direct `circles` SELECT plus nested `circle_members` hit conflicting RLS —
-- `creator can read own circle` exposes rows to former creators while embedded members use
-- member-only policies → empty `circle_members` + false `memberCount`. Fix: membership-only
-- list via SECURITY DEFINER + row_security off (caller still gated by inner join on caller's row).

create or replace function public.get_my_circles()
returns jsonb
language sql
security definer
set search_path = public
set row_security = off
stable
as $$
  select coalesce(
    jsonb_agg(row_json order by sort_created_at desc),
    '[]'::jsonb
  )
  from (
    select
      c.created_at as sort_created_at,
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'description', c.description,
        'vibe', c.vibe,
        'status', c.status,
        'archived_at', c.archived_at,
        'created_at', c.created_at,
        'creator_id', c.creator_id,
        'circle_members', coalesce(memb.members_json, '[]'::jsonb)
      ) as row_json
    from public.circles c
    inner join public.circle_members cm_self
      on cm_self.circle_id = c.id
      and cm_self.user_id = auth.uid()
    left join lateral (
      select
        jsonb_agg(
          jsonb_build_object(
            'user_id', cm2.user_id,
            'role', cm2.role,
            'joined_at', cm2.joined_at
          )
          order by cm2.joined_at asc nulls last
        ) as members_json
      from public.circle_members cm2
      where cm2.circle_id = c.id
    ) memb on true
    where c.status = 'active'
  ) sub;
$$;

comment on function public.get_my_circles() is
  'Authenticated caller''s active circles where they have a membership row; full member list for counts/roles. Avoids creator SELECT without membership showing empty nested members.';

revoke all on function public.get_my_circles() from public;
grant execute on function public.get_my_circles() to authenticated;
