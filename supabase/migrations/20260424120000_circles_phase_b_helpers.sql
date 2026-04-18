-- Circles Phase B (v5.1.0): invite-by-email helpers.
--
-- Adds two SECURITY DEFINER functions that support the Phase B invite flow:
--
--   1. resolve_profile_id_by_email(email text) -> uuid
--        Resolves an account email to public.profiles.id (= auth.users.id under house convention).
--        Used server-side only (send-circle-invite Edge function runs as service_role).
--        NOT granted to the authenticated role — we don't want the client enumerating accounts.
--
--   2. get_my_pending_invites() -> table of enriched invite rows
--        Returns every pending invite for auth.uid(), pre-joined with the circle's public fields
--        (name, vibe, status, archived_at, member_count) and the sender's display name from
--        public.profiles. Pre-joining in a SECURITY DEFINER function avoids the chicken-and-egg
--        where client-side joins against profiles/circle_members would need SELECT RLS to clear
--        on tables the caller has no direct read access to, and keeps the endpoint to a single
--        round-trip for the bell-panel render.
--
-- Both helpers use SET search_path = public so schema-prefixed identifiers inside the function
-- body resolve correctly regardless of the caller's session search_path.
-- ================================================================================================

-- ------------------------------------------------------------------------------------------------
-- resolve_profile_id_by_email: server-only email resolver
-- ------------------------------------------------------------------------------------------------

create or replace function public.resolve_profile_id_by_email(email_in text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
  from auth.users
  where lower(email) = lower(btrim(email_in))
    and deleted_at is null
  limit 1;
$$;

comment on function public.resolve_profile_id_by_email(text) is
  'Resolves an email to profiles.id via auth.users. SECURITY DEFINER. Not granted to authenticated by design — send-circle-invite Edge calls it via service_role. Returns NULL when no active account matches.';

-- Revoke default PUBLIC execute to block client enumeration; grant execute to service_role only
-- (send-circle-invite Edge calls this RPC with the service role key).
revoke all on function public.resolve_profile_id_by_email(text) from public;
revoke all on function public.resolve_profile_id_by_email(text) from authenticated;
revoke all on function public.resolve_profile_id_by_email(text) from anon;
grant execute on function public.resolve_profile_id_by_email(text) to service_role;

-- ------------------------------------------------------------------------------------------------
-- get_my_pending_invites: enriched list for the bell panel
-- ------------------------------------------------------------------------------------------------

create or replace function public.get_my_pending_invites()
returns table (
  invite_id uuid,
  circle_id uuid,
  created_at timestamptz,
  circle_name text,
  circle_vibe text,
  circle_status text,
  circle_archived_at timestamptz,
  member_count integer,
  inviter_id uuid,
  inviter_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ci.id                                            as invite_id,
    ci.circle_id                                     as circle_id,
    ci.created_at                                    as created_at,
    c.name                                           as circle_name,
    c.vibe                                           as circle_vibe,
    c.status                                         as circle_status,
    c.archived_at                                    as circle_archived_at,
    coalesce(
      (select count(*)::int
         from public.circle_members cm
         where cm.circle_id = ci.circle_id),
      0
    )                                                as member_count,
    ci.invited_by                                    as inviter_id,
    coalesce(p.name, 'Someone')                      as inviter_name
  from public.circle_invites ci
  join public.circles c      on c.id = ci.circle_id
  left join public.profiles p on p.id = ci.invited_by
  where ci.invited_user_id = auth.uid()
    and ci.status = 'pending'
  order by ci.created_at desc;
$$;

comment on function public.get_my_pending_invites() is
  'Enriched pending-invite list for auth.uid() — circle name/vibe/status, member count, sender name. SECURITY DEFINER so we can pre-join through profiles + circle_members without relying on their SELECT RLS.';

grant execute on function public.get_my_pending_invites() to authenticated;
