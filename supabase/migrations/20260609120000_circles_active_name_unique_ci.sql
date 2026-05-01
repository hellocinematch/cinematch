-- Active circle names globally unique after trim + case-fold.
-- Matches client validation (`validateCircleName` trim); excludes `archived`
-- rows so legacy archived circles do not collide with this index.

do $$
begin
  if exists (
    select 1
    from (
      select lower(trim(name)) as n
      from public.circles
      where status = 'active'
      group by lower(trim(name))
      having count(*) > 1
    ) dup
  ) then
    raise exception
      'Migration blocked: duplicate active circle names remain after trim(lower). Resolve before applying.';
  end if;
end $$;

create unique index if not exists circles_active_name_lower_trim_unique
  on public.circles (lower(trim(name)))
  where status = 'active';

comment on index public.circles_active_name_lower_trim_unique is
  'Globally unique display name among active circles: lower(trim(name)). Archived omitted.';
