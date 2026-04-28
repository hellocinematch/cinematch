-- Circles list: show last share time for the circle (any member), while unseen_others stays others-only.
-- Client reads `latest_share_at`; `latest_others_share_at` kept for compatibility.

create or replace function public.get_my_circle_unseen_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('rows', '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_build_object(
      'rows',
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'circle_id', x.circle_id,
            'unseen_others', x.unseen_others,
            'latest_share_at', to_jsonb(x.latest_share_at),
            'latest_others_share_at', to_jsonb(x.latest_others_share_at)
          )
          order by x.circle_id
        ) filter (where x.circle_id is not null),
        '[]'::jsonb
      )
    )
    from (
      select
        cm.circle_id,
        coalesce((
          select count(*)::int
          from public.rating_circle_shares sh
          where sh.circle_id = cm.circle_id
            and sh.user_id is distinct from v_uid
            and sh.created_at > coalesce(ls.last_seen_at, now())
        ), 0) as unseen_others,
        (
          select max(sh.created_at)
          from public.rating_circle_shares sh
          where sh.circle_id = cm.circle_id
        ) as latest_share_at,
        (
          select max(sh.created_at)
          from public.rating_circle_shares sh
          where sh.circle_id = cm.circle_id
            and sh.user_id is distinct from v_uid
        ) as latest_others_share_at
      from public.circle_members cm
      inner join public.circles c
        on c.id = cm.circle_id
       and c.status = 'active'
      left join public.circle_member_last_seen ls
        on ls.user_id = v_uid
       and ls.circle_id = cm.circle_id
      where cm.user_id = v_uid
    ) x
  ), jsonb_build_object('rows', '[]'::jsonb));
end;
$$;

comment on function public.get_my_circle_unseen_counts() is
  'Per active circle: unseen_others = others’ shares after last_seen; latest_share_at = max share time (anyone); latest_others_share_at = max other members’ share time.';
