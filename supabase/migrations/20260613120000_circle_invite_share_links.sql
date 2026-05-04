-- Shareable circle invite links (one token → one recipient). Email-targeted invites stay unchanged.
-- Adds nullable invited_user_id rows with invite_token + expires_at until the recipient claims.

-- 1. Link invites may exist before the recipient account is bound.
alter table public.circle_invites
  alter column invited_user_id drop not null;

-- 2. Extend status for host-cancelled link rows.
alter table public.circle_invites drop constraint if exists circle_invites_status_check;
alter table public.circle_invites
  add constraint circle_invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'auto_declined', 'revoked'));

-- 3. Token + optional recipient email (filled when claimed); expiry for link invites.
alter table public.circle_invites add column if not exists invite_token text;
alter table public.circle_invites add column if not exists invite_email text;
alter table public.circle_invites add column if not exists expires_at timestamptz;

create unique index if not exists circle_invites_invite_token_uidx
  on public.circle_invites (invite_token)
  where invite_token is not null;

comment on column public.circle_invites.invite_token is
  'Opaque token for /join/{token}; null for legacy email-targeted invites.';
comment on column public.circle_invites.invite_email is
  'Recipient login email when known (claim); null until claimed for link invites.';
comment on column public.circle_invites.expires_at is
  'Link expiry (UTC); null for legacy email invites (no expiry).';

-- 4. Moderators: pending list shows claimed targets only (invited_user_id set).
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
    and ci.invited_user_id is not null
    and public.is_active_circle_moderator(p_circle_id)
  order by ci.created_at asc;
$$;

comment on function public.get_circle_pending_invite_labels(uuid) is
  'For circle moderators: pending invites with display label (name or email). Link invites appear after claim.';

revoke all on function public.get_circle_pending_invite_labels(uuid) from public;
revoke all on function public.get_circle_pending_invite_labels(uuid) from anon;
grant execute on function public.get_circle_pending_invite_labels(uuid) to authenticated;

-- 5. Recipient may delete their own declined invite row (dismiss).
grant delete on public.circle_invites to authenticated;

drop policy if exists "recipient can delete own declined invite" on public.circle_invites;
create policy "recipient can delete own declined invite"
  on public.circle_invites
  for delete
  to authenticated
  using (
    invited_user_id = auth.uid()
    and status = 'declined'
  );
