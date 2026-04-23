-- Creator leave: if other members exist, transfer circles.creator_id to the next member
-- (earliest joined_at) and remove the leaver. If only the creator remains, keep existing behavior
-- (archive + delete membership).

create or replace function public.creator_leave_circle(p_circle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
  v_new uuid;
  v_crow uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select c.creator_id
    into v_crow
  from public.circles c
  where c.id = p_circle_id
    and c.status = 'active';

  if v_crow is null then
    raise exception 'circle not found or not active';
  end if;

  if v_crow <> v_uid then
    raise exception 'only the current creator can use this';
  end if;

  if not exists (
    select 1
    from public.circle_members cm
    where cm.circle_id = p_circle_id
      and cm.user_id = v_uid
      and cm.role = 'creator'
  ) then
    raise exception 'not circle creator (membership)';
  end if;

  select count(*)::int
    into v_count
  from public.circle_members
  where circle_id = p_circle_id;

  if v_count <= 1 then
    update public.circles
    set status = 'archived', archived_at = now()
    where id = p_circle_id;

    delete from public.circle_members
    where circle_id = p_circle_id
      and user_id = v_uid;

    return jsonb_build_object('outcome', 'archived', 'archived', true);
  end if;

  select cm.user_id
    into v_new
  from public.circle_members cm
  where cm.circle_id = p_circle_id
    and cm.user_id <> v_uid
  order by cm.joined_at asc nulls last, cm.user_id asc
  limit 1;

  if v_new is null then
    raise exception 'no successor';
  end if;

  update public.circles
  set creator_id = v_new
  where id = p_circle_id;

  update public.circle_members
  set role = 'creator'
  where circle_id = p_circle_id
    and user_id = v_new;

  delete from public.circle_members
  where circle_id = p_circle_id
    and user_id = v_uid;

  return jsonb_build_object(
    'outcome', 'transferred',
    'archived', false,
    'new_creator_id', v_new
  );
end;
$$;

comment on function public.creator_leave_circle(uuid) is
  'Active circle creator: if alone, archive+leave; else set creator to earliest-joined other member, then delete caller membership.';

revoke all on function public.creator_leave_circle(uuid) from public;
grant execute on function public.creator_leave_circle(uuid) to authenticated;
