-- Align circles.name length with app validation (2–32 chars, letter-led names enforced in client).
-- Drops the legacy char_length 1–40 check from 20260422120000_circles_schema.sql.

do $$
declare
  rname text;
begin
  select c.conname into rname
  from pg_constraint c
  join pg_class t on c.conrelid = t.oid
  join pg_namespace n on t.relnamespace = n.oid
  where n.nspname = 'public'
    and t.relname = 'circles'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%char_length(name)%';
  if rname is not null then
    execute format('alter table public.circles drop constraint %I', rname);
  end if;
end $$;

alter table public.circles
  add constraint circles_name_len check (char_length(name) between 2 and 32);

comment on constraint circles_name_len on public.circles is
  'Product: 2–32 characters. Charset rules enforced in app (validateCircleName).';
