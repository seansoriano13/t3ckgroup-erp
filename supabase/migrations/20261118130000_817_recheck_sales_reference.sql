-- #817 (spec #800, ADR 0050) — Re-check an S0 when its SOR opens.
--
-- recheck_sales_reference is what the sor-sales-reference edge function calls (action 'recheck')
-- after asking Odoo about the SOR's current S0. It moves only the two Odoo-state columns:
--   found       -> state found, last read now
--   unreachable -> nothing changes
--   not_found   -> state gone, and ONE history entry (SALES_REFERENCE_GONE), only when the state was
--                  not already gone
-- No lines, no S0, nothing else on the deal changes. Anyone who can open the SOR may trigger it.
-- Service role only: the browser never sends Odoo facts.

create or replace function public.recheck_sales_reference(
  p_actor_email text,
  p_opportunity_id uuid,
  p_odoo text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_opp public.sales_opportunities;
  v_content text;
  v_meta jsonb;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'recheck_sales_reference: not signed in' using errcode = '42501';
  end if;
  if p_odoo is null or p_odoo not in ('found', 'not_found', 'unreachable') then
    raise exception 'recheck_sales_reference: p_odoo must be found, not_found or unreachable' using errcode = '22023';
  end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);
  v_actor := public.get_employee_id();
  if v_actor is null then
    raise exception 'recheck_sales_reference: not signed in' using errcode = '42501';
  end if;
  if public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'You do not have access to this SOR.' using errcode = '42501', hint = 'forbidden';
  end if;

  select * into v_opp from public.sales_opportunities
    where id = p_opportunity_id and coalesce(is_deleted, false) = false
    for update;
  if v_opp.id is null then
    raise exception 'That SOR could not be found.' using errcode = 'P0002', hint = 'not_found_sor';
  end if;

  -- Nothing to check without an S0, and an unanswered question changes nothing.
  if nullif(btrim(coalesce(v_opp.sales_reference, '')), '') is null or p_odoo = 'unreachable' then
    return jsonb_build_object(
      'sales_reference', v_opp.sales_reference,
      'odoo_state', v_opp.sales_reference_odoo_state,
      'checked_at', v_opp.sales_reference_checked_at
    );
  end if;

  -- Only the two state columns move; the flag keeps the S0 column guard (#822) quiet.
  perform set_config('app.sor_set_sales_reference', 'on', true);

  if p_odoo = 'found' then
    update public.sales_opportunities
       set sales_reference_odoo_state = 'found',
           sales_reference_checked_at = now()
     where id = v_opp.id
    returning * into v_opp;
  elsif v_opp.sales_reference_odoo_state is distinct from 'gone' then
    update public.sales_opportunities
       set sales_reference_odoo_state = 'gone'
     where id = v_opp.id
    returning * into v_opp;

    v_content := format('Odoo no longer has %s', v_opp.sales_reference);
    v_meta := jsonb_build_object(
      'event', 'SALES_REFERENCE_GONE',
      'old', v_opp.sales_reference,
      'new', v_opp.sales_reference,
      'reason', null,
      'employeeId', v_actor
    );
    insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
    values (v_opp.id, v_actor, 'SYSTEM', v_content, v_meta);
    insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
    values (v_actor, 'OPPORTUNITY', v_opp.id::text, v_content, 'SYSTEM', v_meta);
  end if;

  return jsonb_build_object(
    'sales_reference', v_opp.sales_reference,
    'odoo_state', v_opp.sales_reference_odoo_state,
    'checked_at', v_opp.sales_reference_checked_at
  );
end;
$$;

comment on function public.recheck_sales_reference(text, uuid, text) is
  '#817 (ADR 0050): re-checks the SOR''s S0 against Odoo''s answer (p_odoo found / not_found / unreachable). Found sets state found and the read time; unreachable changes nothing; not_found sets state gone and writes ONE SALES_REFERENCE_GONE history entry the first time. Touches only the two state columns. Anyone who can open the SOR may trigger it. Service role only.';

revoke all on function public.recheck_sales_reference(text, uuid, text) from public, anon, authenticated;
grant execute on function public.recheck_sales_reference(text, uuid, text) to service_role;
