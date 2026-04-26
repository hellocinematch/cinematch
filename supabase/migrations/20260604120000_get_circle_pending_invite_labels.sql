-- Circle info (hosts): list pending in-app invites for a circle — one row per invite with a display
-- label (profiles.name, else auth.users.email). Gated on is_active_circle_moderator.

create or replace function public.get_circle_pending_invite_labels(p_circle_id uuid)
returns table (
  invite_id uuid,
  invited_user_id uuid,
  display_label text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ci.id as invite_id,
    ci.invited_user_id,
    coalesce(
      nullif(btrim(p.name::text), ''),
      u.email::text,
      'Invite pending'
    ) as display_label
  from public.circle_invites ci
  inner join public.profiles p on p.id = ci.invited_user_id
  inner join auth.users u on u.id = ci.invited_user_id
  where ci.circle_id = p_circle_id
    and ci.status = 'pending'
    and public.is_active_circle_moderator(p_circle_id)
  order by ci.created_at asc;
$$;

comment on function public.get_circle_pending_invite_labels(uuid) is
  'For circle moderators: pending invites with display label (name or email).';

revoke all on function public.get_circle_pending_invite_labels(uuid) from public;
revoke all on function public.get_circle_pending_invite_labels(uuid) from anon;
grant execute on function public.get_circle_pending_invite_labels(uuid) to authenticated;
