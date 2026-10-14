-- IPAS: Return and Undo approval, a one-step-per-gate Computation status, and the
-- section 4 cascade.
--
--  1. computation_status becomes Encoding -> Encoded -> LC GS Done -> LC Odoo Done
--     -> Checked by. costs_complete rows become lc_odoo_done (a filed IPAS
--     included: the freeze guard is switched off for that one update and back
--     on). Filing waits for LC Odoo Done or Checked by, as it waited for Costs
--     complete. Finance, or a Super Admin who is not Purchasing, may give and
--     take back Checked by; everything else stays Purchasing's.
--  2. ipas_send_back (the Return) on sections 1 and 3 also clears section 4's
--     live Received, Noted and Checked: a returned section no longer backs them.
--     The people who gave them are told.
--  3. ipas_undo_approval: takes back only the Approved of section 1 or 3, with a
--     reason, leaving Prepared. Same section 4 consequence.

-- ------------------------------------------------------------------------------
-- 1. Computation status
-- ------------------------------------------------------------------------------

alter table public.ipas disable trigger ipas_freeze;

alter table public.ipas drop constraint if exists ipas_computation_status_chk;

update public.ipas set computation_status = 'lc_odoo_done' where computation_status = 'costs_complete';

alter table public.ipas add constraint ipas_computation_status_chk
  check (computation_status in ('encoding', 'encoded', 'lc_gs_done', 'lc_odoo_done', 'checked'));

alter table public.ipas enable trigger ipas_freeze;

comment on column public.ipas.computation_status is
  'Where the cost work stands: encoding, encoded, lc_gs_done, lc_odoo_done, checked. Landed Cost is final from lc_odoo_done, which is what filing waits for. Purchasing sets it; Finance gives and takes back checked.';

-- ------------------------------------------------------------------------------
-- ipas_sign, with the new filing gate
-- ------------------------------------------------------------------------------

create or replace function public.ipas_sign(
  p_ipas_id uuid,
  p_section integer,
  p_role text,
  p_decline_signature boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_ipas public.ipas;
  v_prepared public.ipas_signoffs;
  v_row public.ipas_signoffs;
  v_list_key text;
  v_signature text;
  v_notify uuid[] := '{}';
  v_stage text;
  v_filed boolean := false;
  v_other integer;
begin
  if v_actor is null then
    raise exception 'ipas_sign: not signed in' using errcode = '42501';
  end if;
  if p_section is null or p_role is null or not public._ipas_signoff_pair_ok(p_section, p_role) then
    raise exception 'ipas_sign: section % has no % sign-off', coalesce(p_section::text, 'null'), coalesce(p_role, 'null')
      using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_sign', p_ipas_id);
  v_list_key := public._ipas_signoff_list_key(p_section, p_role);

  if p_role = 'prepared' then
    if not public.has_purchasing_access() then
      raise exception 'ipas_sign: only Purchasing prepares a section' using errcode = '42501';
    end if;
  elsif not public._ipas_on_list(v_list_key, v_actor) then
    -- Every other sign-off belongs to its list, and a Super Admin is no
    -- exception: they sign when they are on it.
    raise exception 'ipas_sign: you are not on the list that may give this sign-off' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.ipas_signoffs s
     where s.ipas_id = v_ipas.id and s.section = p_section and s.role = p_role and s.cleared_at is null
  ) then
    raise exception 'ipas_sign: section % is already % on %', p_section, p_role, v_ipas.number using errcode = '55000';
  end if;

  if p_role = 'approved' and p_section in (1, 3) then
    select * into v_prepared
      from public.ipas_signoffs s
     where s.ipas_id = v_ipas.id and s.section = p_section and s.role = 'prepared' and s.cleared_at is null;
    if v_prepared.id is null then
      raise exception 'ipas_sign: section % hasn''t been prepared yet', p_section using errcode = '55000';
    end if;
    if v_prepared.signed_by = v_actor then
      raise exception 'ipas_sign: you prepared section %, so someone else approves it', p_section using errcode = '42501';
    end if;
  end if;

  if p_section = 7 then
    -- Section 7 opens once sections 1 and 3 are approved (checked at every step:
    -- an approval undone by an Odoo change closes it again).
    if not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 1 and s.role = 'approved' and s.cleared_at is null
    ) or not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 3 and s.role = 'approved' and s.cleared_at is null
    ) then
      raise exception 'ipas_sign: section 7 opens once sections 1 and 3 are approved' using errcode = '55000';
    end if;

    -- Received first; Noted and Checked after it, in any order.
    if p_role in ('noted', 'checked') and not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 7 and s.role = 'received' and s.cleared_at is null
    ) then
      raise exception 'ipas_sign: Received comes first; % can only be given after it', initcap(p_role) using errcode = '55000';
    end if;

    if p_role = 'approved' then
      if (
        select count(*) from public.ipas_signoffs s
         where s.ipas_id = v_ipas.id and s.section = 7 and s.role in ('received', 'noted', 'checked') and s.cleared_at is null
      ) < 3 then
        raise exception 'ipas_sign: Approved needs Received, Noted and Checked first' using errcode = '55000';
      end if;
      if v_ipas.computation_status not in ('lc_odoo_done', 'checked') then
        raise exception 'ipas_sign: % can''t be filed until LC Odoo Done: Landed Cost is still provisional, and Filing freezes it as final', v_ipas.number
          using errcode = '55000';
      end if;
    end if;
  end if;

  if p_decline_signature then
    v_signature := null;
  else
    select e.signature_path into v_signature from public.employees e where e.id = v_actor;
  end if;

  insert into public.ipas_signoffs (ipas_id, section, role, signed_by, signature_declined, signature_version)
  values (v_ipas.id, p_section, p_role, v_actor, coalesce(p_decline_signature, false), v_signature)
  returning * into v_row;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'signed', jsonb_build_object(
    'section', p_section,
    'role', p_role,
    'signoff_id', v_row.id,
    'signature_declined', v_row.signature_declined
  ));

  if p_section = 7 and p_role = 'approved' then
    -- The one point that locks the IPAS. The freeze lets this update through:
    -- the row is still open until it is made.
    update public.ipas
       set state = 'filed', filed_at = now()
     where id = v_ipas.id
    returning * into v_ipas;
    v_filed := true;
    v_stage := 'filed';

    perform public._ipas_write_event(v_ipas.id, v_actor, 'filed', jsonb_build_object(
      'computation_status', v_ipas.computation_status,
      'signoff_id', v_row.id
    ));
  elsif p_role = 'prepared' then
    -- Prepared is ready for approval: tell that section's approval list (never
    -- the person who just prepared it).
    v_stage := 'section_prepared';
    v_notify := public._ipas_list_members(array[public._ipas_signoff_list_key(p_section, 'approved')], v_actor);
  elsif p_section in (1, 3) then
    -- This section is approved. When the other is too and section 7 hasn't
    -- started, section 7 is ready for Received.
    v_other := case p_section when 1 then 3 else 1 end;
    if exists (
         select 1 from public.ipas_signoffs s
          where s.ipas_id = v_ipas.id and s.section = v_other and s.role = 'approved' and s.cleared_at is null
       )
       and not exists (
         select 1 from public.ipas_signoffs s
          where s.ipas_id = v_ipas.id and s.section = 7 and s.cleared_at is null
       ) then
      v_stage := 'received_ready';
      v_notify := public._ipas_list_members(array['s7_received'], v_actor);
    end if;
  elsif p_role = 'received' then
    v_stage := 'noted_checked_ready';
    v_notify := public._ipas_list_members(array['s7_noted', 's7_checked'], v_actor);
  elsif p_role in ('noted', 'checked') then
    -- Noted and Checked both given: Approved is ready.
    if exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 7
         and s.role = case p_role when 'noted' then 'checked' else 'noted' end
         and s.cleared_at is null
    ) then
      v_stage := 'approve_ready';
      v_notify := public._ipas_list_members(array['s7_approved'], v_actor);
    end if;
  end if;

  return jsonb_build_object(
    'signoff', to_jsonb(v_row),
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'role', p_role,
    'stage', v_stage,
    'filed', v_filed,
    'notify_ids', to_jsonb(v_notify)
  );
end;
$$;

-- ------------------------------------------------------------------------------
-- ipas_set_header, with the new statuses and Finance's Checked by
-- ------------------------------------------------------------------------------

create or replace function public.ipas_set_header(p_ipas_id uuid, p_fields jsonb)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_key text;
  v_raw jsonb;
  v_text text;
  v_contact text;
  v_pi text;
  v_amount numeric;
  v_freight uuid;
  v_split text;
  v_status text;
  v_sheet boolean;
  v_gantt boolean;
  v_label text;
  v_is_purchasing boolean;
  v_changes jsonb := '{}'::jsonb;
begin
  if v_actor is null then
    raise exception 'ipas_set_header: not signed in' using errcode = '42501';
  end if;
  -- Purchasing changes an IPAS. Finance or a Super Admin may only give or take back
  -- "Checked by" (the last computation status), which is checked further down.
  v_is_purchasing := public.has_purchasing_access();
  if not v_is_purchasing
     and not (public.has_finance_access() or coalesce(public.is_super_admin(), false)) then
    raise exception 'ipas_set_header: only Purchasing changes an IPAS' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'ipas_set_header: the fields must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in (
      'supplier_contact', 'pi_number', 'pi_qt_amount', 'freight_service_id', 'landed_cost_split', 'computation_status',
      'google_sheet', 'gantt_chart'
    ) then
      raise exception 'ipas_set_header: % isn''t a header field you can type here', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_set_header: IPAS % not found', p_ipas_id using errcode = 'P0002';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_set_header: % is filed; a Super Admin reopens it first', v_row.number using errcode = '55000';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_set_header: % is cancelled', v_row.number using errcode = '55000';
  end if;

  v_contact := case when jsonb_exists(p_fields, 'supplier_contact') then nullif(btrim(p_fields->>'supplier_contact'), '') else v_row.supplier_contact end;
  v_pi := case when jsonb_exists(p_fields, 'pi_number') then nullif(btrim(p_fields->>'pi_number'), '') else v_row.pi_number end;

  -- P.I/QT Amount: a number, or blank to clear. Anything half-typed is refused
  -- with a sentence, never a cast error.
  v_amount := v_row.pi_qt_amount;
  if jsonb_exists(p_fields, 'pi_qt_amount') then
    v_raw := p_fields->'pi_qt_amount';
    if jsonb_typeof(v_raw) = 'null' then
      v_amount := null;
    elsif jsonb_typeof(v_raw) = 'number' then
      v_amount := round((p_fields->>'pi_qt_amount')::numeric, 2);
    elsif jsonb_typeof(v_raw) = 'string' then
      v_text := btrim(replace(p_fields->>'pi_qt_amount', ',', ''));
      if v_text = '' then
        v_amount := null;
      elsif v_text ~ '^[0-9]+(\.[0-9]+)?$' then
        v_amount := round(v_text::numeric, 2);
      else
        raise exception 'ipas_set_header: P.I/QT Amount must be a number' using errcode = '22023';
      end if;
    else
      raise exception 'ipas_set_header: P.I/QT Amount must be a number' using errcode = '22023';
    end if;
    if v_amount is not null and v_amount < 0 then
      raise exception 'ipas_set_header: P.I/QT Amount can''t be negative' using errcode = '22023';
    end if;
  end if;

  v_freight := v_row.freight_service_id;
  if jsonb_exists(p_fields, 'freight_service_id') then
    v_raw := p_fields->'freight_service_id';
    if jsonb_typeof(v_raw) = 'null' or nullif(btrim(p_fields->>'freight_service_id'), '') is null then
      v_freight := null;
    else
      begin
        v_freight := (p_fields->>'freight_service_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'ipas_set_header: pick a freight service' using errcode = '22023';
      end;
      perform public._ipas_check_option(
        'ipas_set_header', v_freight, 'freight_service', v_row.freight_service_id, 'freight service'
      );
    end if;
  end if;

  v_split := v_row.landed_cost_split;
  if jsonb_exists(p_fields, 'landed_cost_split') then
    v_split := p_fields->>'landed_cost_split';
    if v_split is null or v_split not in ('value', 'quantity', 'equal') then
      raise exception 'ipas_set_header: Landed Cost is spread by value, by quantity or equally' using errcode = '22023';
    end if;
  end if;

  v_status := v_row.computation_status;
  if jsonb_exists(p_fields, 'computation_status') then
    v_status := p_fields->>'computation_status';
    if v_status is null or v_status not in ('encoding', 'encoded', 'lc_gs_done', 'lc_odoo_done', 'checked') then
      raise exception 'ipas_set_header: the computation status is Encoding, Encoded, LC GS Done, LC Odoo Done or Checked by'
        using errcode = '22023';
    end if;
  end if;

  -- Finance and Super Admins (who aren't Purchasing) only move Checked by: from LC Odoo Done
  -- to Checked by, or back, and nothing else in the same call.
  if not v_is_purchasing then
    if (select count(*) from jsonb_object_keys(p_fields)) <> 1
       or not jsonb_exists(p_fields, 'computation_status')
       or not (
         (v_row.computation_status = 'lc_odoo_done' and v_status = 'checked')
         or (v_row.computation_status = 'checked' and v_status = 'lc_odoo_done')
       ) then
      raise exception 'ipas_set_header: only Purchasing changes an IPAS; Finance gives or takes back Checked by' using errcode = '42501';
    end if;
  end if;

  if v_contact is distinct from v_row.supplier_contact then
    v_changes := v_changes || jsonb_build_object('supplier_contact', jsonb_build_object('from', v_row.supplier_contact, 'to', v_contact));
  end if;
  if v_pi is distinct from v_row.pi_number then
    v_changes := v_changes || jsonb_build_object('pi_number', jsonb_build_object('from', v_row.pi_number, 'to', v_pi));
  end if;
  if v_amount is distinct from v_row.pi_qt_amount then
    v_changes := v_changes || jsonb_build_object('pi_qt_amount', jsonb_build_object('from', v_row.pi_qt_amount, 'to', v_amount));
  end if;
  if v_freight is distinct from v_row.freight_service_id then
    v_changes := v_changes || jsonb_build_object('freight_service_id', jsonb_build_object(
      'from', (select o.label from public.ipas_options o where o.id = v_row.freight_service_id),
      'to', (select o.label from public.ipas_options o where o.id = v_freight)));
  end if;
  if v_split is distinct from v_row.landed_cost_split then
    v_changes := v_changes || jsonb_build_object('landed_cost_split', jsonb_build_object('from', v_row.landed_cost_split, 'to', v_split));
  end if;
  if v_status is distinct from v_row.computation_status then
    v_changes := v_changes || jsonb_build_object('computation_status', jsonb_build_object('from', v_row.computation_status, 'to', v_status));
  end if;
  -- The section 2 ticks: plain yes or no. JSON null and any other type are refused.
  v_sheet := v_row.google_sheet;
  if jsonb_exists(p_fields, 'google_sheet') then
    if jsonb_typeof(p_fields->'google_sheet') <> 'boolean' then
      raise exception 'ipas_set_header: Googlesheet must be ticked or not ticked' using errcode = '22023';
    end if;
    v_sheet := (p_fields->>'google_sheet')::boolean;
  end if;

  v_gantt := v_row.gantt_chart;
  if jsonb_exists(p_fields, 'gantt_chart') then
    if jsonb_typeof(p_fields->'gantt_chart') <> 'boolean' then
      raise exception 'ipas_set_header: Gantt Chart must be ticked or not ticked' using errcode = '22023';
    end if;
    v_gantt := (p_fields->>'gantt_chart')::boolean;
  end if;

  if v_sheet is distinct from v_row.google_sheet then
    v_changes := v_changes || jsonb_build_object('google_sheet', jsonb_build_object('from', v_row.google_sheet, 'to', v_sheet));
  end if;
  if v_gantt is distinct from v_row.gantt_chart then
    v_changes := v_changes || jsonb_build_object('gantt_chart', jsonb_build_object('from', v_row.gantt_chart, 'to', v_gantt));
  end if;
  if v_changes = '{}'::jsonb then
    return v_row;
  end if;

  update public.ipas
     set supplier_contact = v_contact,
         pi_number = v_pi,
         pi_qt_amount = v_amount,
         freight_service_id = v_freight,
         landed_cost_split = v_split,
         computation_status = v_status,
         google_sheet = v_sheet,
         gantt_chart = v_gantt
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'header_changed', jsonb_build_object('fields', v_changes));

  return v_row;
end;
$$;

comment on function public.ipas_set_header(uuid, jsonb) is
  '#243/#244/#241: Purchasing types the supplier''s name, P.I # and P.I/QT Amount, picks the freight service, sets the Landed Cost spread (value, quantity, equal), the computation status and the section 2 ticks (Googlesheet, Gantt Chart) on an open IPAS. Finance, or a Super Admin who is not Purchasing, may only give or take back Checked by. Keys present are set, blank clears where allowed. Writes one "header_changed" event with what changed.';

-- ------------------------------------------------------------------------------
-- 2. Return (ipas_send_back) with the section 4 cascade
-- ------------------------------------------------------------------------------

create or replace function public.ipas_send_back(
  p_ipas_id uuid,
  p_section integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_ipas public.ipas;
  v_roles text[];
  v_preparers uuid[];
  v_notify uuid[];
  v_cascade text[] := '{}'::text[];
  v_cascade_ids uuid[] := '{}'::uuid[];
begin
  if v_actor is null then
    raise exception 'ipas_send_back: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_send_back: give a reason, so the people who signed know what to fix' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_send_back: the reason is 500 characters at most' using errcode = '22023';
  end if;
  if p_section is null or p_section not in (1, 3, 7) then
    raise exception 'ipas_send_back: only sections 1, 3 and 7 can be returned' using errcode = '22023';
  end if;

  -- Refuses a filed or cancelled IPAS (55000): a filed one is reopened, not returned.
  v_ipas := public._ipas_lock_open('ipas_send_back', p_ipas_id);

  if p_section = 7 then
    -- Anyone on a section 7 list, whichever sign-off they give.
    if not public._ipas_can_sign_section(7, v_actor) then
      raise exception 'ipas_send_back: only a signer of section 7 returns it' using errcode = '42501';
    end if;

    -- Section 7 is open once sections 1 and 3 are approved.
    if not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 1 and s.role = 'approved' and s.cleared_at is null
    ) or not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 3 and s.role = 'approved' and s.cleared_at is null
    ) then
      raise exception 'ipas_send_back: section 7 isn''t open yet; sections 1 and 3 must be approved first' using errcode = '55000';
    end if;

    with cleared as (
      update public.ipas_signoffs s
         set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Returned: ' || v_reason
       where s.ipas_id = v_ipas.id
         and s.section = 7
         and s.role in ('received', 'noted', 'checked')
         and s.cleared_at is null
      returning s.role, s.signed_by
    )
    select coalesce(array_agg(role order by role), '{}'::text[]),
           coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
      into v_roles, v_notify
      from cleared;

    v_preparers := '{}'::uuid[];
  else
    if not public._ipas_can_sign_section(p_section, v_actor) then
      raise exception 'ipas_send_back: only a signer of section % returns it', p_section using errcode = '42501';
    end if;

    with cleared as (
      update public.ipas_signoffs s
         set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Returned: ' || v_reason
       where s.ipas_id = v_ipas.id
         and s.section = p_section
         and s.role in ('prepared', 'approved')
         and s.cleared_at is null
      returning s.role, s.signed_by
    )
    select coalesce(array_agg(role order by role), '{}'::text[]),
           coalesce(array_agg(distinct signed_by) filter (where role = 'prepared'), '{}'::uuid[])
      into v_roles, v_preparers
      from cleared;

    v_notify := v_preparers;

    -- Section 4 no longer has two approved sections behind it: its open sign-offs go too.
    if cardinality(v_roles) > 0 then
      with cleared as (
        update public.ipas_signoffs s
           set cleared_at = now(), cleared_by = v_actor,
               cleared_reason = 'Section ' || p_section || ' returned: ' || v_reason
         where s.ipas_id = v_ipas.id
           and s.section = 7
           and s.role in ('received', 'noted', 'checked')
           and s.cleared_at is null
        returning s.role, s.signed_by
      )
      select coalesce(array_agg(role order by role), '{}'::text[]),
             coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
        into v_cascade, v_cascade_ids
        from cleared;
      v_notify := (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(v_notify || v_cascade_ids) as x);
    end if;
  end if;

  if cardinality(v_roles) = 0 then
    raise exception 'ipas_send_back: section % has nothing to return', p_section using errcode = '55000';
  end if;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'sent_back', jsonb_build_object(
    'section', p_section,
    'reason', v_reason,
    'cleared', to_jsonb(v_roles),
    'cleared_section_7', to_jsonb(v_cascade)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'actor_id', v_actor,
    'cleared_roles', to_jsonb(v_roles),
    'cleared_section_7', to_jsonb(v_cascade),
    'preparer_ids', to_jsonb(v_preparers),
    'notify_ids', to_jsonb(v_notify)
  );
end;
$$;

comment on function public.ipas_send_back(uuid, integer, text) is
  'Return: a signer returns a section with a reason. Sections 1 and 3: the section''s approval list clears the live Prepared and Approved, and section 4''s live Received, Noted and Checked with them. Section 7: anyone on a section 7 list, while section 7 is open and the IPAS is not filed, clears the live Received, Noted and Checked. Cleared sign-offs stay as history (Returned: <reason>). Refused when nothing is signed (55000), on a filed or cancelled IPAS, and to anyone not on the section''s list. Returns { ipas, section, actor_id, cleared_roles[], cleared_section_7[], preparer_ids[], notify_ids[] }.';

revoke all on function public.ipas_send_back(uuid, integer, text) from public, anon;
grant execute on function public.ipas_send_back(uuid, integer, text) to authenticated;

-- ------------------------------------------------------------------------------
-- 3. Undo approval
-- ------------------------------------------------------------------------------

create or replace function public.ipas_undo_approval(
  p_ipas_id uuid,
  p_section integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_ipas public.ipas;
  v_approver uuid;
  v_cascade text[] := '{}'::text[];
  v_cascade_ids uuid[] := '{}'::uuid[];
  v_notify uuid[] := '{}'::uuid[];
begin
  if v_actor is null then
    raise exception 'ipas_undo_approval: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_undo_approval: give a reason, so the approver knows why' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_undo_approval: the reason is 500 characters at most' using errcode = '22023';
  end if;
  if p_section is null or p_section not in (1, 3) then
    raise exception 'ipas_undo_approval: only sections 1 and 3 have an approval to undo' using errcode = '22023';
  end if;

  v_ipas := public._ipas_lock_open('ipas_undo_approval', p_ipas_id);

  if not public._ipas_can_sign_section(p_section, v_actor) then
    raise exception 'ipas_undo_approval: only a signer of section % undoes its approval', p_section using errcode = '42501';
  end if;

  update public.ipas_signoffs s
     set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Approval undone: ' || v_reason
   where s.ipas_id = v_ipas.id and s.section = p_section and s.role = 'approved' and s.cleared_at is null
  returning s.signed_by into v_approver;

  if not found then
    raise exception 'ipas_undo_approval: section % has no approval to undo', p_section using errcode = '55000';
  end if;

  -- Section 4 stood on both approvals: its open sign-offs go too.
  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = v_actor,
           cleared_reason = 'Section ' || p_section || ' approval undone: ' || v_reason
     where s.ipas_id = v_ipas.id
       and s.section = 7
       and s.role in ('received', 'noted', 'checked')
       and s.cleared_at is null
    returning s.role, s.signed_by
  )
  select coalesce(array_agg(role order by role), '{}'::text[]),
         coalesce(array_agg(distinct signed_by) filter (where signed_by is distinct from v_actor), '{}'::uuid[])
    into v_cascade, v_cascade_ids
    from cleared;

  v_notify := v_cascade_ids;
  if v_approver is not null and v_approver is distinct from v_actor then
    v_notify := v_notify || v_approver;
  end if;
  v_notify := (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(v_notify) as x);

  perform public._ipas_write_event(v_ipas.id, v_actor, 'approval_undone', jsonb_build_object(
    'section', p_section,
    'reason', v_reason,
    'approver_id', v_approver,
    'cleared_section_7', to_jsonb(v_cascade)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_ipas),
    'section', p_section,
    'actor_id', v_actor,
    'approver_id', v_approver,
    'cleared_section_7', to_jsonb(v_cascade),
    'notify_ids', to_jsonb(v_notify)
  );
end;
$$;

comment on function public.ipas_undo_approval(uuid, integer, text) is
  'Undo approval: a signer on section 1 or 3''s approval list takes back its Approved with a reason. Prepared stays, so the section waits for an approver again. Section 4''s live Received, Noted and Checked are cleared with it. Refused when the section has no live approval (55000), on a filed or cancelled IPAS, and to anyone not on the list. Returns { ipas, section, actor_id, approver_id, cleared_section_7[], notify_ids[] }.';

revoke all on function public.ipas_undo_approval(uuid, integer, text) from public, anon;
grant execute on function public.ipas_undo_approval(uuid, integer, text) to authenticated;
