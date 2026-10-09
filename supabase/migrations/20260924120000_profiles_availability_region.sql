-- Where the user watches (catalog country) and which Indian languages lead that catalog.
-- Empty show_language_first means all Indian languages together, none forced first.
-- Catalog queries stay US until the client reads these columns.

alter table public.profiles
  add column if not exists availability_region text not null default 'US';

alter table public.profiles
  drop constraint if exists profiles_availability_region_check;

alter table public.profiles
  add constraint profiles_availability_region_check
  check (availability_region in ('US', 'CA', 'IN'));

comment on column public.profiles.availability_region is
  'Catalog country: US, CA, or IN. Does not follow travel. Default US.';

alter table public.profiles
  add column if not exists show_language_first text[] not null default '{}';

alter table public.profiles
  drop constraint if exists profiles_show_language_first_check;

alter table public.profiles
  add constraint profiles_show_language_first_check
  check (
    show_language_first <@ array['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr']::text[]
  );

comment on column public.profiles.show_language_first is
  'Indian language codes to show first when availability_region is IN. Empty = all of hi|ta|te|ml|kn|bn|mr together.';
