-- #789: the run sheet (step 8.2) has the Warehouse person on the Logistics signer list pick the
-- Item Location before signing Logistics. The RPC only let Purchasing in, so the picker stayed
-- disabled for them. Now Purchasing OR a member of 'logistics_signed' may set it, on an open IPAS.
-- Body is the one from 20261013100600 with only the actor check changed.
create or replace function public.ipas_set_item_location(p_ipas_id uuid, p_option_id uuid)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_from_label text;
  v_to_label text;
begin
  if v_actor is null then
    raise exception 'ipas_set_item_location: not signed in' using errcode = '42501';
  end if;
  if not (public.has_purchasing_access() or public._ipas_on_list('logistics_signed', v_actor)) then
    raise exception 'ipas_set_item_location: only Purchasing or the Logistics signer list sets the Item Location'
      using errcode = '42501';
  end if;

  v_row := public._ipas_lock_open('ipas_set_item_location', p_ipas_id);

  if p_option_id is not null then
    v_to_label := public._ipas_check_option(
      'ipas_set_item_location', p_option_id, 'item_location', v_row.item_location_id, 'item location'
    );
  end if;
  if p_option_id is not distinct from v_row.item_location_id then
    return v_row;
  end if;
  select o.label into v_from_label from public.ipas_options o where o.id = v_row.item_location_id;

  update public.ipas set item_location_id = p_option_id where id = v_row.id returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'item_location_changed', jsonb_build_object(
    'from', v_from_label,
    'to', v_to_label
  ));

  return v_row;
end;
$$;

comment on function public.ipas_set_item_location(uuid, uuid) is
  '#246/#789: Purchasing, or a member of the Logistics signer list, sets the Item Location of an open IPAS from the item_location list (an active option, or null to clear). Writes "item_location_changed" with the labels.';

revoke all on function public.ipas_set_item_location(uuid, uuid) from public, anon;
grant execute on function public.ipas_set_item_location(uuid, uuid) to authenticated;
