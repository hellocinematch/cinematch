-- Reviews (7.0.185).
--
-- One note per person per title, or per season. The score stays on ratings
-- (whole title) or season_ratings (one season). season_number 0 is the whole
-- title. 1+ is that season. TMDB specials (their season 0) are not a target.
--
-- A review cannot be stored without that score. Deleting the score deletes
-- the review. Changing the number leaves the words. The body is 1 to 500
-- characters after trimming. show_on_cinemastro is stored true: saving is the
-- agreement that the words may appear later on the Cinemastro page, with no
-- name. There is no switch in this build.
--
-- Other people read a review only through the circle RPCs, and only when the
-- author published that title to the circle. A review does not send an alert.
-- Word filter, report, and block are later.

-- ---------------------------------------------------------------------------
-- rating_reviews
-- ---------------------------------------------------------------------------

create table if not exists public.rating_reviews (
  user_id uuid not null references auth.users (id) on delete cascade,
  tmdb_id integer not null,
  media_type text not null,
  season_number integer not null default 0,
  body text not null,
  show_on_cinemastro boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rating_reviews_pkey primary key (user_id, tmdb_id, media_type, season_number),
  constraint rating_reviews_media_type_chk check (media_type in ('movie', 'tv')),
  constraint rating_reviews_season_chk check (
    (media_type = 'movie' and season_number = 0)
    or (media_type = 'tv' and (season_number = 0 or season_number >= 1))
  ),
  constraint rating_reviews_body_chk check (char_length(body) between 1 and 500)
);

comment on table public.rating_reviews is
  'One review per person per title (season_number 0) or per TV season (1+). Cannot exist without the matching score. show_on_cinemastro is the agreement that the words may appear on the Cinemastro page with no name.';

comment on column public.rating_reviews.season_number is
  '0 = the whole title. 1+ = that TV season. Not TMDB specials.';

comment on column public.rating_reviews.show_on_cinemastro is
  'True when the words may appear on the Cinemastro page. This build always stores true. No name is shown there.';

create index if not exists rating_reviews_title_idx
  on public.rating_reviews (tmdb_id, media_type);

alter table public.rating_reviews enable row level security;

drop policy if exists "rating_reviews select own" on public.rating_reviews;
create policy "rating_reviews select own"
  on public.rating_reviews for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "rating_reviews insert own" on public.rating_reviews;
create policy "rating_reviews insert own"
  on public.rating_reviews for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "rating_reviews update own" on public.rating_reviews;
create policy "rating_reviews update own"
  on public.rating_reviews for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "rating_reviews delete own" on public.rating_reviews;
create policy "rating_reviews delete own"
  on public.rating_reviews for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.rating_reviews to authenticated;
grant select, insert, update, delete on public.rating_reviews to service_role;

-- ---------------------------------------------------------------------------
-- Words require a score. Saving always records the Cinemastro-page agreement.
-- ---------------------------------------------------------------------------

create or replace function public.rating_reviews_require_score()
returns trigger
language plpgsql
as $$
begin
  new.body := btrim(new.body);
  if new.body is null or char_length(new.body) < 1 or char_length(new.body) > 500 then
    raise exception 'review must be 1 to 500 characters';
  end if;

  new.show_on_cinemastro := true;

  if new.season_number = 0 then
    if not exists (
      select 1
      from public.ratings r
      where r.user_id = new.user_id
        and r.tmdb_id = new.tmdb_id
        and r.media_type::text = new.media_type
        and not r.score_from_seasons
    ) then
      raise exception 'review requires a score';
    end if;
  else
    if new.media_type <> 'tv' then
      raise exception 'season review requires a tv show';
    end if;
    if not exists (
      select 1
      from public.season_ratings s
      where s.user_id = new.user_id
        and s.tmdb_id = new.tmdb_id
        and s.season_number = new.season_number
    ) then
      raise exception 'review requires a season score';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_rating_reviews_require_score on public.rating_reviews;
create trigger trg_rating_reviews_require_score
  before insert or update on public.rating_reviews
  for each row
  execute function public.rating_reviews_require_score();

-- ---------------------------------------------------------------------------
-- Deleting the score deletes the review. Updating the number does not.
-- ---------------------------------------------------------------------------

create or replace function public.rating_reviews_delete_for_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'ratings' then
    delete from public.rating_reviews
    where user_id = old.user_id
      and tmdb_id = old.tmdb_id
      and media_type = old.media_type::text
      and season_number = 0;
  elsif tg_table_name = 'season_ratings' then
    delete from public.rating_reviews
    where user_id = old.user_id
      and tmdb_id = old.tmdb_id
      and media_type = 'tv'
      and season_number = old.season_number;
  end if;
  return old;
end;
$$;

comment on function public.rating_reviews_delete_for_score() is
  'After a ratings or season_ratings row is deleted, remove the review that belonged to that score.';

revoke all on function public.rating_reviews_delete_for_score() from public;
revoke all on function public.rating_reviews_delete_for_score() from anon;

drop trigger if exists trg_ratings_delete_title_review on public.ratings;
create trigger trg_ratings_delete_title_review
  after delete on public.ratings
  for each row
  execute function public.rating_reviews_delete_for_score();

drop trigger if exists trg_season_ratings_delete_season_review on public.season_ratings;
create trigger trg_season_ratings_delete_season_review
  after delete on public.season_ratings
  for each row
  execute function public.rating_reviews_delete_for_score();

-- ---------------------------------------------------------------------------
-- Circle reads. Names stay inside the circle. Unpublished scores stay private.
-- ---------------------------------------------------------------------------

create or replace function public.get_circle_title_reviews(
  p_circle_id uuid,
  p_tmdb_id integer,
  p_media_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_archived_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_media_type is null or p_media_type not in ('movie', 'tv') then
    return '[]'::jsonb;
  end if;

  if not exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
  ) then
    raise exception 'not a member of this circle';
  end if;

  select c.archived_at into v_archived_at
  from public.circles c
  where c.id = p_circle_id;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'user_id', y.user_id,
        'member_name', y.member_name,
        'season_number', y.season_number,
        'body', y.body
      )
      order by y.member_name, y.user_id, y.season_sort
    )
    from (
      select
        rr.user_id,
        coalesce(p.name, '')::text as member_name,
        null::int as season_number,
        0 as season_sort,
        rr.body
      from public.rating_reviews rr
      inner join public.ratings r
        on r.user_id = rr.user_id
       and r.tmdb_id = rr.tmdb_id
       and r.media_type::text = rr.media_type
       and not r.score_from_seasons
      inner join public.circle_members cm
        on cm.user_id = rr.user_id
       and cm.circle_id = p_circle_id
      inner join public.rating_circle_shares sh
        on sh.user_id = rr.user_id
       and sh.tmdb_id = rr.tmdb_id
       and sh.media_type::text = rr.media_type
       and sh.circle_id = p_circle_id
      inner join public.profiles p
        on p.id = rr.user_id
      where rr.tmdb_id = p_tmdb_id
        and rr.media_type = p_media_type
        and rr.season_number = 0
        and (
          v_archived_at is null
          or (r.rated_at is not null and r.rated_at < v_archived_at)
        )

      union all

      select
        rr.user_id,
        coalesce(p.name, '')::text as member_name,
        rr.season_number,
        rr.season_number as season_sort,
        rr.body
      from public.rating_reviews rr
      inner join public.season_ratings s
        on s.user_id = rr.user_id
       and s.tmdb_id = rr.tmdb_id
       and s.season_number = rr.season_number
      inner join public.circle_members cm
        on cm.user_id = rr.user_id
       and cm.circle_id = p_circle_id
      inner join public.rating_circle_shares sh
        on sh.user_id = rr.user_id
       and sh.tmdb_id = rr.tmdb_id
       and sh.media_type = 'tv'
       and sh.circle_id = p_circle_id
      inner join public.profiles p
        on p.id = rr.user_id
      where p_media_type = 'tv'
        and rr.tmdb_id = p_tmdb_id
        and rr.media_type = 'tv'
        and rr.season_number >= 1
        and (
          v_archived_at is null
          or s.rated_at < v_archived_at
        )
    ) y
  ), '[]'::jsonb);
end;
$$;

comment on function public.get_circle_title_reviews(uuid, integer, text) is
  'For a circle member: reviews on this title by people who published it here. season_number null is the whole title. Names are for the circle only.';

revoke all on function public.get_circle_title_reviews(uuid, integer, text) from public;
revoke all on function public.get_circle_title_reviews(uuid, integer, text) from anon;
grant execute on function public.get_circle_title_reviews(uuid, integer, text) to authenticated;

create or replace function public.get_circle_review_counts(p_circle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_archived_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
  ) then
    raise exception 'not a member of this circle';
  end if;

  select c.archived_at into v_archived_at
  from public.circles c
  where c.id = p_circle_id;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'tmdb_id', y.tmdb_id,
        'media_type', y.media_type,
        'season_number', y.season_number,
        'review_count', y.review_count
      )
    )
    from (
      select
        rr.tmdb_id,
        rr.media_type,
        null::int as season_number,
        count(*)::int as review_count
      from public.rating_reviews rr
      inner join public.ratings r
        on r.user_id = rr.user_id
       and r.tmdb_id = rr.tmdb_id
       and r.media_type::text = rr.media_type
       and not r.score_from_seasons
      inner join public.circle_members cm
        on cm.user_id = rr.user_id
       and cm.circle_id = p_circle_id
      inner join public.rating_circle_shares sh
        on sh.user_id = rr.user_id
       and sh.tmdb_id = rr.tmdb_id
       and sh.media_type::text = rr.media_type
       and sh.circle_id = p_circle_id
      where rr.season_number = 0
        and (
          v_archived_at is null
          or (r.rated_at is not null and r.rated_at < v_archived_at)
        )
      group by rr.tmdb_id, rr.media_type

      union all

      select
        rr.tmdb_id,
        'tv'::text as media_type,
        rr.season_number,
        count(*)::int as review_count
      from public.rating_reviews rr
      inner join public.season_ratings s
        on s.user_id = rr.user_id
       and s.tmdb_id = rr.tmdb_id
       and s.season_number = rr.season_number
      inner join public.circle_members cm
        on cm.user_id = rr.user_id
       and cm.circle_id = p_circle_id
      inner join public.rating_circle_shares sh
        on sh.user_id = rr.user_id
       and sh.tmdb_id = rr.tmdb_id
       and sh.media_type = 'tv'
       and sh.circle_id = p_circle_id
      where rr.media_type = 'tv'
        and rr.season_number >= 1
        and (
          v_archived_at is null
          or s.rated_at < v_archived_at
        )
      group by rr.tmdb_id, rr.season_number
    ) y
  ), '[]'::jsonb);
end;
$$;

comment on function public.get_circle_review_counts(uuid) is
  'For a circle member: how many published reviews each title or season has. season_number null is the whole title.';

revoke all on function public.get_circle_review_counts(uuid) from public;
revoke all on function public.get_circle_review_counts(uuid) from anon;
grant execute on function public.get_circle_review_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion wipes reviews with the rest of the account.
-- ---------------------------------------------------------------------------

create or replace function public.prepare_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_circle_id uuid;
  v_count int;
  v_next uuid;
  v_deleted int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  for v_circle_id in
    select cm.circle_id
    from public.circle_members cm
    where cm.user_id = v_uid
  loop
    select count(*)::int
      into v_count
    from public.circle_members
    where circle_id = v_circle_id;

    if v_count <= 1 then
      delete from public.circles where id = v_circle_id;
    else
      select cm.user_id
        into v_next
      from public.circle_members cm
      where cm.circle_id = v_circle_id
        and cm.user_id is distinct from v_uid
      order by cm.joined_at asc nulls last, cm.user_id asc
      limit 1;

      if v_next is null then
        raise exception 'prepare_account_deletion: missing successor for circle %', v_circle_id;
      end if;

      update public.circles
      set creator_id = v_next, updated_at = now()
      where id = v_circle_id
        and creator_id = v_uid;

      update public.circle_invites
      set invited_by = v_next
      where circle_id = v_circle_id
        and invited_by = v_uid;

      delete from public.circle_members
      where circle_id = v_circle_id
        and user_id = v_uid;
      get diagnostics v_deleted = row_count;
      if v_deleted <> 1 then
        raise exception 'prepare_account_deletion: could not leave circle %', v_circle_id;
      end if;
    end if;
  end loop;

  for v_circle_id in
    select c.id
    from public.circles c
    where c.creator_id = v_uid
  loop
    select cm.user_id
      into v_next
    from public.circle_members cm
    where cm.circle_id = v_circle_id
      and cm.user_id is distinct from v_uid
    order by cm.joined_at asc nulls last, cm.user_id asc
    limit 1;

    if v_next is null then
      delete from public.circles where id = v_circle_id;
    else
      update public.circles
      set creator_id = v_next, updated_at = now()
      where id = v_circle_id;

      update public.circle_invites
      set invited_by = v_next
      where circle_id = v_circle_id
        and invited_by = v_uid;
    end if;
  end loop;

  update public.circle_invites ci
  set invited_by = c.creator_id
  from public.circles c
  where ci.circle_id = c.id
    and ci.invited_by = v_uid
    and c.creator_id is distinct from v_uid;

  delete from public.circle_invites
  where invited_by = v_uid
     or invited_user_id = v_uid;

  if to_regclass('public.watch_chain_events') is not null then
    execute 'update public.watch_chain_events set influencer_user_id = null where influencer_user_id = $1'
      using v_uid;
    execute 'delete from public.watch_chain_events where user_id = $1'
      using v_uid;
  end if;

  if to_regclass('public.analytics_events') is not null then
    execute 'delete from public.analytics_events where user_id = $1'
      using v_uid;
  end if;

  if to_regclass('public.rating_circle_shares') is not null then
    delete from public.rating_circle_shares where user_id = v_uid;
  end if;

  if to_regclass('public.user_title_predictions') is not null then
    delete from public.user_title_predictions where user_id = v_uid;
  end if;

  if to_regclass('public.user_neighbors') is not null then
    delete from public.user_neighbors
    where user_id = v_uid or neighbor_id = v_uid;
  end if;

  if to_regclass('public.user_neighbors_staging') is not null then
    delete from public.user_neighbors_staging
    where user_id = v_uid or neighbor_id = v_uid;
  end if;

  if to_regclass('public.device_push_tokens') is not null then
    delete from public.device_push_tokens where user_id = v_uid;
  end if;

  if to_regclass('public.watchlist') is not null then
    delete from public.watchlist where user_id = v_uid;
  end if;

  delete from public.rating_reviews where user_id = v_uid;

  delete from public.ratings where user_id = v_uid;

  delete from public.profiles where id = v_uid;

  return jsonb_build_object('ok', true, 'user_id', v_uid);
end;
$$;

comment on function public.prepare_account_deletion() is
  'Caller-only: leave/transfer circles (next host = earliest remaining joined_at), wipe public user rows including reviews. Edge then deletes auth.users.';
