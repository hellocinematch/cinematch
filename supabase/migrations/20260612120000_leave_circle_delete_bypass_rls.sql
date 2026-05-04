-- Last-member leave: `DELETE FROM circles` inside `leave_circle` was subject to RLS as the caller.
-- Policy `creator can delete own circle` uses `is_circle_moderator` (admin only). A sole member
-- with role `member` (sync gap / legacy) then got **0 rows deleted** with no error, so the circle
-- row survived. Fix: run the RPC body with row_security off (trusted checks remain) and assert
-- row counts.

create or replace function public.leave_circle(p_circle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
  v_deleted int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.circles c
    where c.id = p_circle_id
      and c.status = 'active'
  ) then
    raise exception 'circle not found or not active';
  end if;

  if not exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
  ) then
    raise exception 'not a member';
  end if;

  select count(*)::int
    into v_count
  from public.circle_members
  where circle_id = p_circle_id;

  if v_count <= 1 then
    delete from public.circles
    where id = p_circle_id;
    get diagnostics v_deleted = row_count;
    if v_deleted <> 1 then
      raise exception 'leave_circle: could not delete circle';
    end if;
    return jsonb_build_object('outcome', 'circle_deleted', 'deleted', true);
  end if;

  delete from public.circle_members
  where circle_id = p_circle_id
    and user_id = v_uid;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'leave_circle: could not remove membership';
  end if;

  return jsonb_build_object('outcome', 'left', 'deleted', false);
end;
$$;

comment on function public.leave_circle(uuid) is
  'Member leaves: if last member, delete circle (cascade); else remove membership (roles resync via trigger). RLS off inside function so sole `member`-role rows still delete the circle; row_count guards.';
