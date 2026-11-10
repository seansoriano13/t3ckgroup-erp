-- ==============================================================================
-- #730 (spec #718): attaching a P0 to a project line raises its IPAS.
--
-- After odoo-po-verify attaches a verified P0, it reads the PO from Odoo itself
-- (the same read as odoo-po-ipas) and calls `purchase_request_item_auto_ipas`
-- (service role only) for the signed-in buyer with its own verdict and copy:
--   * no live IPAS for the P0   -> raised: Source from the PO's currency (PHP is
--     Local, anything else Import), Purpose Project, Priority Medium, SORs = [this SOR];
--   * a live IPAS, not filed    -> this SOR is added to it (new event 'sor_added');
--   * a filed IPAS              -> nothing is added; the answer says so;
--   * Odoo did not answer       -> the P0 stays attached and the line is flagged
--     `ipas_pending` ("IPAS to create"); calling again retries.
-- Only a project line (a request on an SOR) does this. Inventory, Supplies and
-- Events IPAS are still raised by hand.
--
-- This relaxes "the SOR list is fixed after raising" for additions only. Nobody
-- can still remove an SOR or edit the list by hand (ipas_set_purpose_and_sors is
-- unchanged).
--
-- SAFE TO RUN AT ANY TIME. Idempotent.
-- ==============================================================================

alter table public.purchase_request_items
  add column if not exists ipas_pending boolean not null default false,
  add column if not exists ipas_number text;

comment on column public.purchase_request_items.ipas_pending is
  '#730: true when a project line''s P0 is attached but its IPAS could not be raised (Odoo did not answer). The line shows "IPAS to create" with a retry.';
comment on column public.purchase_request_items.ipas_number is
  '#730: the number of the IPAS raised, or joined, when this line''s P0 was attached.';

create or replace function public.purchase_request_item_auto_ipas(
  p_actor_email text,
  p_item_id uuid,
  p_verdict text,
  p_odoo_copy jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_item public.purchase_request_items;
  v_sor uuid;
  v_ipas public.ipas;
  v_source text;
  v_result text;
  v_message text;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'purchase_request_item_auto_ipas: not signed in' using errcode = '42501';
  end if;
  select e.id into v_actor from public.employees e where lower(e.email) = lower(btrim(p_actor_email)) limit 1;
  if v_actor is null or not public._employee_has_purchasing_access(v_actor) then
    raise exception 'purchase_request_item_auto_ipas: only Purchasing raises an IPAS' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_item_auto_ipas: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if v_item.po_number is null or v_item.po_verification is distinct from 'VERIFIED' then
    raise exception 'purchase_request_item_auto_ipas: attach a verified P0 first' using errcode = '22023';
  end if;

  select r.opportunity_id into v_sor from public.purchase_requests r where r.id = v_item.request_id;
  if v_sor is null then
    -- A Direct request has no SOR: its IPAS is raised by hand.
    return jsonb_build_object('result', 'not_project', 'message', 'This line is not on a project, so its IPAS is raised by hand.');
  end if;
  if v_item.purpose is distinct from 'client' then
    return jsonb_build_object('result', 'not_project', 'message', 'Job materials are not part of the project, so their IPAS is raised by hand.');
  end if;

  -- Several lines attached to the same P0 at once must take turns.
  perform pg_advisory_xact_lock(hashtext('ipas_auto:' || v_item.po_number));

  select * into v_ipas from public.ipas i where i.po_number = v_item.po_number and i.state <> 'cancelled';

  if v_ipas.id is not null then
    if v_ipas.state = 'filed' then
      v_result := 'filed';
      v_message := format('%s is already filed, so nothing was added to it.', v_ipas.number);
    elsif v_ipas.purpose <> 'project' then
      v_result := 'not_project';
      v_message := format('%s is not a Project IPAS, so this SOR was not added.', v_ipas.number);
    elsif exists (select 1 from public.ipas_sors s where s.ipas_id = v_ipas.id and s.opportunity_id = v_sor) then
      v_result := 'already_named';
      v_message := format('%s already names this SOR.', v_ipas.number);
    else
      insert into public.ipas_sors (ipas_id, opportunity_id) values (v_ipas.id, v_sor);
      perform public._ipas_write_event(v_ipas.id, v_actor, 'sor_added', jsonb_build_object(
        'number', v_ipas.number,
        'po_number', v_ipas.po_number,
        'opportunity_id', v_sor,
        'item_id', v_item.id
      ));
      v_result := 'sor_added';
      v_message := format('This SOR was added to %s.', v_ipas.number);
    end if;
  else
    if p_verdict = 'found' then
      v_source := case when upper(btrim(coalesce(p_odoo_copy->'po'->>'currency', ''))) = 'PHP' then 'local' else 'import' end;
      v_ipas := public.ipas_raise_from_odoo(
        v_actor, v_item.po_number, 'medium', v_source, 'project', array[v_sor], null, 'found', p_odoo_copy
      );
      v_result := 'created';
      v_message := format('%s was raised for %s.', v_ipas.number, v_item.po_number);
    elsif p_verdict = 'not_found' then
      v_result := 'not_found';
      v_message := format('Odoo has no purchase order named %s, so its IPAS was not raised.', v_item.po_number);
    else
      v_result := 'unavailable';
      v_message := 'Odoo did not answer, so the IPAS was not raised. The P0 stays attached; try again.';
    end if;
  end if;

  update public.purchase_request_items
     set ipas_pending = v_result in ('unavailable', 'not_found'),
         ipas_number = case when v_result in ('created', 'sor_added', 'already_named') then v_ipas.number else ipas_number end
   where id = v_item.id;

  return jsonb_build_object(
    'result', v_result,
    'message', v_message,
    'ipas_id', v_ipas.id,
    'ipas_number', v_ipas.number
  );
end;
$$;

comment on function public.purchase_request_item_auto_ipas(text, uuid, text, jsonb) is
  '#730: server-only (service role). After a P0 is attached to a project line, raises its IPAS (Source from the PO currency, Purpose Project, Priority Medium, SORs = this line''s SOR), or adds the SOR to the live IPAS, or adds nothing when it is filed. Result: created | sor_added | already_named | filed | not_project | not_found | unavailable (the line is flagged ipas_pending for a retry).';

revoke all on function public.purchase_request_item_auto_ipas(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.purchase_request_item_auto_ipas(text, uuid, text, jsonb) to service_role;
