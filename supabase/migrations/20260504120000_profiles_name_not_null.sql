-- Every profile must have a non-empty display name (product invariant).
-- Backfill from auth.users email local-part, then enforce NOT NULL.

-- 1) Prefer existing non-blank name; else email prefix before @; else literal fallback.
--    Cap length defensively (long email locals); trim whitespace.
update public.profiles p
set name = left(
  btrim(
    coalesce(
      nullif(btrim(p.name::text), ''),
      nullif(split_part(u.email::text, '@', 1), ''),
      'User'
    )
  ),
  120
)
from auth.users u
where u.id = p.id
  and (p.name is null or btrim(p.name::text) = '');

-- 2) Orphans or any row still empty after step 1
update public.profiles
set name = 'User'
where name is null or btrim(name::text) = '';

alter table public.profiles
  alter column name set not null;

comment on column public.profiles.name is 'Display name; required (NOT NULL). App must set on signup / profile edit.';
