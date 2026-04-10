-- V1.3.0: Optional single “secondary market” for the home [Region] Now strip (Hollywood remains primary US flow).

alter table public.profiles
  add column if not exists secondary_region_key text;

comment on column public.profiles.secondary_region_key is 'V1.3.0: At most one of indian|asian|latam|european; null = hide secondary strip. Hollywood is always primary home market.';
