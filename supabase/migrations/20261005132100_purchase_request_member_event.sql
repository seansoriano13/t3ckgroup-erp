-- ==============================================================================
-- 20261005132100_purchase_request_member_event.sql
--
-- #209 follow-up: the request chat names who was added or removed
-- ("Added Paolo Purchaser." / "Removed Paolo Purchaser."), not just
-- "Member added." / "Member removed.".
--
-- This first went into 20261005130200 after staging had already recorded that
-- version as applied, so `db push` would have skipped it there. It lives in its
-- own migration, after everything else on the branch, so staging gets it too.
-- 20261005130200 is back to what staging applied.
-- ==============================================================================

-- Posts "Added <name>." / "Removed <name>." in the request's chat.
create or replace function public._purchase_request_member_event(
  p_request_id uuid,
  p_actor uuid,
  p_employee_id uuid,
  p_event text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (
    p_request_id,
    p_actor,
    format(
      '%s %s.',
      case p_event when 'member_added' then 'Added' else 'Removed' end,
      coalesce((select name from public.employees where id = p_employee_id), 'a member')
    ),
    jsonb_build_object('event', p_event, 'employee_id', p_employee_id)
  );
$$;

revoke all on function public._purchase_request_member_event(uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.purchase_request_add_member(p_request_id uuid, p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
begin
  if v_actor is null or not public.purchase_request_can_manage_members(p_request_id) then
    raise exception 'purchase_request_add_member: not allowed' using errcode = '42501';
  end if;

  if public._purchase_request_add_member(p_request_id, p_employee_id, v_actor) then
    perform public._purchase_request_member_event(p_request_id, v_actor, p_employee_id, 'member_added');
  end if;
end;
$$;

create or replace function public.purchase_request_remove_member(p_request_id uuid, p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.purchase_requests;
  v_removed uuid;
begin
  if v_actor is null or not public.purchase_request_can_manage_members(p_request_id) then
    raise exception 'purchase_request_remove_member: not allowed' using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id;
  if v_req.buyer_id = p_employee_id then
    raise exception 'purchase_request_remove_member: the Buyer cannot be removed' using errcode = '42501';
  end if;

  delete from public.purchase_request_members
  where request_id = p_request_id and employee_id = p_employee_id
  returning id into v_removed;

  if v_removed is null then
    return;
  end if;

  update public.sor_stage_participants
  set closed_at = now(), closed_reason = 'removed', removed_by = v_actor
  where source = 'purchase_request' and source_id = p_request_id
    and employee_id = p_employee_id and closed_at is null;

  perform public._purchase_request_member_event(p_request_id, v_actor, p_employee_id, 'member_removed');
end;
$$;

grant execute on function public.purchase_request_add_member(uuid, uuid) to authenticated;
grant execute on function public.purchase_request_remove_member(uuid, uuid) to authenticated;

revoke all on function public.purchase_request_add_member(uuid, uuid) from public, anon;
revoke all on function public.purchase_request_remove_member(uuid, uuid) from public, anon;
