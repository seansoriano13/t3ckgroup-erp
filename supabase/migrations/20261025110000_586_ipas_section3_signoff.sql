-- #586 (spec #584): IPAS section 3 (Computation status & Landed Cost) becomes a real
-- sign-off, Submitted (stored role "prepared") and Approved, replacing the "Checked by"
-- Computation status step. The status now ends at LC Odoo Done.
--
-- Stored section numbers are the paper-sheet numbers: 1 (Purchasing), 3 (Purchasing &
-- Finance), 7 (Filing). The new sign-off is stored section 6, the sheet's number for
-- "Computation status & Landed Cost", and reads as section 3 on screen
-- (_ipas_section_no / ipasSectionNo are the single mapping). Its approval list is
-- 's6_approved' ("Section 3 Approved" in Settings).
--
--  1. Mapping, pair rule, list key, signer rule for section 6.
--  2. Signer list key checks, ipas_set_signer_list, and the s6_approved seed (everyone with
--     Finance access at migration time).
--  3. ipas_sign: section 6 Submit is refused until LC Odoo Done; Approve follows the
--     rules of sections 1 and 3 (live Submitted, someone else, on the list).
--  4. ipas_set_header: only Purchasing, no Checked by, no Finance / Super Admin branch.
--  5. _ipas_convert_checked_by(): every non-cancelled IPAS at Checked by gets a section 3
--     Approved (latest Checked by event) and Submitted (latest LC Odoo Done event), then
--     every IPAS at Checked by moves to LC Odoo Done. Filed IPAS are done under the
--     ipas.reopening exception that ipas_reopen uses, so the freeze triggers stay intact
--     (ipas_signoffs and ipas_events have no freeze trigger, so inserting rows needs none).
--     Policy tests call the function again on seeded rows.
--  6. The SOR summary gains the '6' sign-off key.
-- Re-runnable: create or replace, drop ... if exists, no duplicate rows.

-- ------------------------------------------------------------------------------
-- 1. Mapping and rules
-- ------------------------------------------------------------------------------

-- A stored sign-off section (1, 3, 6, 7) as people read it in the IPAS (1, 2, 3, 4);
-- mirrors ipasSectionNo in src/constants/ipas.js. Used in refusal text.
create or replace function public._ipas_section_no(p_section integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_section when 3 then 2 when 6 then 3 when 7 then 4 else p_section end;
$$;

revoke all on function public._ipas_section_no(integer) from public, anon, authenticated;

-- The table's CHECK calls this, so it is redefined before the new section is used.
create or replace function public._ipas_signoff_pair_ok(p_section integer, p_role text)
returns boolean
language sql
immutable
as $$
  select (p_section in (1, 3, 6) and p_role in ('prepared', 'approved'))
      or (p_section = 7 and p_role in ('received', 'noted', 'checked', 'approved'));
$$;

revoke all on function public._ipas_signoff_pair_ok(integer, text) from public, anon, authenticated;

alter table public.ipas_signoffs drop constraint if exists ipas_signoffs_section_chk;
alter table public.ipas_signoffs add constraint ipas_signoffs_section_chk check (section in (1, 3, 6, 7));
alter table public.ipas_signoffs drop constraint if exists ipas_signoffs_pair_chk;
alter table public.ipas_signoffs add constraint ipas_signoffs_pair_chk check (public._ipas_signoff_pair_ok(section::integer, role));

create or replace function public._ipas_signoff_list_key(p_section integer, p_role text)
returns text
language sql
immutable
as $$
  select case
    when p_section = 1 and p_role = 'approved' then 's1_approved'
    when p_section = 3 and p_role = 'approved' then 's3_approved'
    when p_section = 6 and p_role = 'approved' then 's6_approved'
    when p_section = 7 and p_role = 'received' then 's7_received'
    when p_section = 7 and p_role = 'noted' then 's7_noted'
    when p_section = 7 and p_role = 'checked' then 's7_checked'
    when p_section = 7 and p_role = 'approved' then 's7_approved'
    else null
  end;
$$;

revoke all on function public._ipas_signoff_list_key(integer, text) from public, anon, authenticated;

-- Whether the employee is a signer of the section, who may send it back or undo it:
-- sections 1, 3 and 6 by their approval list, section 7 by any of its lists.
create or replace function public._ipas_can_sign_section(p_section integer, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_section = 1 then public._ipas_on_list('s1_approved', p_employee_id)
    when p_section = 3 then public._ipas_on_list('s3_approved', p_employee_id)
    when p_section = 6 then public._ipas_on_list('s6_approved', p_employee_id)
    when p_section = 7 then
      public._ipas_on_list('s7_received', p_employee_id)
      or public._ipas_on_list('s7_noted', p_employee_id)
      or public._ipas_on_list('s7_checked', p_employee_id)
      or public._ipas_on_list('s7_approved', p_employee_id)
    else false
  end;
$$;

revoke all on function public._ipas_can_sign_section(integer, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. The section 3 approval list
-- ------------------------------------------------------------------------------

alter table public.ipas_signer_lists drop constraint if exists ipas_signer_lists_key_chk;
alter table public.ipas_signer_lists add constraint ipas_signer_lists_key_chk check (list_key in (
  's1_approved', 's3_approved', 's6_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
  'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
));

alter table public.ipas_signer_list_log drop constraint if exists ipas_signer_list_log_key_chk;
alter table public.ipas_signer_list_log add constraint ipas_signer_list_log_key_chk check (list_key in (
  's1_approved', 's3_approved', 's6_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
  'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
));

-- Seed: everyone with Finance access today (the has_finance_access() test), so Finance
-- can approve section 3 on release day. A function so a policy test can run it on the
-- cast the test database loads (the migration itself runs on an empty database there).
-- Re-runnable: nobody is added twice. No change-log rows: the log needs an actor
-- (actor_id is NOT NULL) and a migration has none. Returns how many were added.
create or replace function public._ipas_seed_s6_approved()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added integer;
begin
  insert into public.ipas_signer_lists (list_key, employee_id)
  select 's6_approved', e.id
    from public.employees e
   where e.has_finance_flow
     and not coalesce(e.is_deleted, false)
     and not exists (
       select 1 from public.ipas_signer_lists l where l.list_key = 's6_approved' and l.employee_id = e.id
     );
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke all on function public._ipas_seed_s6_approved() from public, anon, authenticated;

select public._ipas_seed_s6_approved();

-- ------------------------------------------------------------------------------
-- 2b. ipas_set_signer_list knows the new list
-- ------------------------------------------------------------------------------

-- ipas_set_signer_list (latest: 20261023210000_refusal_codes.sql); s6_approved added
create or replace function public.ipas_set_signer_list(
  p_list_key text,
  p_employee_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_wanted uuid[];
  v_have uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_missing uuid;
begin
  if v_actor is null then
    raise exception 'ipas_set_signer_list: not signed in' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'ipas_set_signer_list: only a Super Admin changes who is on a sign-off list' using errcode = '42501';
  end if;
  if p_list_key is null or p_list_key not in (
    's1_approved', 's3_approved', 's6_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
    'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
  ) then
    raise exception 'ipas_set_signer_list: % isn''t a sign-off list', coalesce(p_list_key, 'null') using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_wanted
    from unnest(coalesce(p_employee_ids, '{}'::uuid[])) as x
   where x is not null;

  -- One change to a list at a time.
  perform pg_advisory_xact_lock(hashtext('ipas_signer_list:' || p_list_key));

  select coalesce(array_agg(l.employee_id), '{}'::uuid[])
    into v_have
    from public.ipas_signer_lists l
   where l.list_key = p_list_key;

  select x into v_missing
    from unnest(v_wanted) as x
   where x <> all (v_have)
     and not exists (
       select 1 from public.employees e where e.id = x and not coalesce(e.is_deleted, false)
     )
   limit 1;
  if v_missing is not null then
    raise exception 'ipas_set_signer_list: employee % isn''t an active employee', v_missing using errcode = '22023';
  end if;

  select coalesce(array_agg(x), '{}'::uuid[]) into v_added from unnest(v_wanted) as x where x <> all (v_have);
  select coalesce(array_agg(x), '{}'::uuid[]) into v_removed from unnest(v_have) as x where x <> all (v_wanted);

  if cardinality(v_removed) > 0 then
    delete from public.ipas_signer_lists
     where list_key = p_list_key and employee_id = any (v_removed);
  end if;
  if cardinality(v_added) > 0 then
    insert into public.ipas_signer_lists (list_key, employee_id)
    select p_list_key, x from unnest(v_added) as x;
  end if;

  insert into public.ipas_signer_list_log (list_key, employee_id, action, actor_id)
  select p_list_key, x, 'removed', v_actor from unnest(v_removed) as x
  union all
  select p_list_key, x, 'added', v_actor from unnest(v_added) as x;

  return jsonb_build_object(
    'list_key', p_list_key,
    'added', to_jsonb(v_added),
    'removed', to_jsonb(v_removed)
  );
end;
$$;

-- ------------------------------------------------------------------------------
-- 3. ipas_sign
-- ------------------------------------------------------------------------------

-- ipas_sign (latest: 20261023210000_refusal_codes.sql); section 3 (stored 6) added
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
    raise exception 'ipas_sign: section % has no % sign-off', coalesce(public._ipas_section_no(p_section)::text, 'null'), coalesce(p_role, 'null')
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

  -- Section 3 (stored 6) is the Landed Cost check: Purchasing submits it once the
  -- Computation status is LC Odoo Done, and not before.
  if p_section = 6 and p_role = 'prepared'
     and v_ipas.computation_status is distinct from 'lc_odoo_done' then
    raise exception 'ipas_sign: section 3 can be submitted once the Computation status is LC Odoo Done'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.ipas_signoffs s
     where s.ipas_id = v_ipas.id and s.section = p_section and s.role = p_role and s.cleared_at is null
  ) then
    raise exception 'ipas_sign: section % is already % on %', public._ipas_section_no(p_section), p_role, v_ipas.number using errcode = '22023';
  end if;

  if p_role = 'approved' and p_section in (1, 3, 6) then
    select * into v_prepared
      from public.ipas_signoffs s
     where s.ipas_id = v_ipas.id and s.section = p_section and s.role = 'prepared' and s.cleared_at is null;
    if v_prepared.id is null then
      raise exception 'ipas_sign: section % hasn''t been prepared yet', public._ipas_section_no(p_section) using errcode = '22023';
    end if;
    if v_prepared.signed_by = v_actor then
      raise exception 'ipas_sign: you prepared section %, so someone else approves it', public._ipas_section_no(p_section) using errcode = '42501';
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
      raise exception 'ipas_sign: section 4 opens once sections 1 and 2 are approved' using errcode = '22023';
    end if;

    -- Received first; Noted and Checked after it, in any order.
    if p_role in ('noted', 'checked') and not exists (
      select 1 from public.ipas_signoffs s
       where s.ipas_id = v_ipas.id and s.section = 7 and s.role = 'received' and s.cleared_at is null
    ) then
      raise exception 'ipas_sign: Received comes first; % can only be given after it', initcap(p_role) using errcode = '22023';
    end if;

    if p_role = 'approved' then
      if (
        select count(*) from public.ipas_signoffs s
         where s.ipas_id = v_ipas.id and s.section = 7 and s.role in ('received', 'noted', 'checked') and s.cleared_at is null
      ) < 3 then
        raise exception 'ipas_sign: Approved needs Received, Noted and Checked first' using errcode = '22023';
      end if;
      if v_ipas.computation_status not in ('lc_odoo_done', 'checked') then
        raise exception 'ipas_sign: % can''t be filed until LC Odoo Done: Landed Cost is still provisional, and Filing freezes it as final', v_ipas.number
          using errcode = '22023';
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
-- 4. ipas_set_header (Computation status ends at LC Odoo Done)
-- ------------------------------------------------------------------------------

-- ipas_set_header (latest: 20261023210000_refusal_codes.sql); Checked by removed
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
  v_remarks text;
  v_changes jsonb := '{}'::jsonb;
begin
  if v_actor is null then
    raise exception 'ipas_set_header: not signed in' using errcode = '42501';
  end if;
  -- Only Purchasing changes an IPAS (#586: Checked by is gone, so there is no Finance
  -- or Super Admin exception any more; section 3's sign-off is the check).
  if not public.has_purchasing_access() then
    raise exception 'ipas_set_header: only Purchasing changes an IPAS' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'ipas_set_header: the fields must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in (
      'supplier_contact', 'pi_number', 'pi_qt_amount', 'freight_service_id', 'landed_cost_split', 'computation_status',
      'google_sheet', 'gantt_chart', 'remarks'
    ) then
      raise exception 'ipas_set_header: % isn''t a header field you can type here', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_set_header: IPAS % not found', p_ipas_id using errcode = '22023';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_set_header: % is filed; a Super Admin reopens it first', v_row.number using errcode = '22023';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_set_header: % is cancelled', v_row.number using errcode = '22023';
  end if;

  -- Remarks: free text, blank clears. A non-text value is refused with a sentence.
  v_remarks := v_row.remarks;
  if jsonb_exists(p_fields, 'remarks') then
    if jsonb_typeof(p_fields->'remarks') not in ('string', 'null') then
      raise exception 'ipas_set_header: Remarks must be text' using errcode = '22023';
    end if;
    v_remarks := nullif(btrim(p_fields->>'remarks'), '');
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
    if v_status is null or v_status not in ('encoding', 'encoded', 'lc_gs_done', 'lc_odoo_done') then
      raise exception 'ipas_set_header: the computation status is Encoding, Encoded, LC GS Done or LC Odoo Done'
        using errcode = '22023';
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
  if v_remarks is distinct from v_row.remarks then
    v_changes := v_changes || jsonb_build_object('remarks', jsonb_build_object('from', v_row.remarks, 'to', v_remarks));
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
         gantt_chart = v_gantt,
         remarks = v_remarks
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'header_changed', jsonb_build_object('fields', v_changes));

  return v_row;
end;
$$;

-- ------------------------------------------------------------------------------
-- 5. Old "Checked by" becomes a section 3 approval
-- ------------------------------------------------------------------------------

-- Re-runnable and callable from tests. For every non-cancelled IPAS at Checked by:
--   Approved  = actor and time of the LATEST header_changed event that moved the status to checked
--   Submitted = actor and time of the LATEST header_changed event that moved it to lc_odoo_done
-- Both are written only when a Submitted event exists (an Approved with nobody having
-- submitted would break "someone else approves"); with no history the section stays
-- unsigned. A signature_version is the signer's stored signature today, or null (the
-- print then shows the name only). Each sign-off gets a `signed` history event dated at
-- the original time, flagged migrated. Then every IPAS at Checked by (any state) moves to
-- LC Odoo Done; a filed IPAS is updated under the same ipas.reopening exception that
-- ipas_reopen uses, which keeps ipas_freeze_guard intact for everyone else.
-- Returns how many IPAS moved.
create or replace function public._ipas_convert_checked_by()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_sub_by uuid;
  v_sub_at timestamptz;
  v_app_by uuid;
  v_app_at timestamptz;
  v_signoff public.ipas_signoffs;
  v_moved integer;
begin
  for r in
    select i.id from public.ipas i
     where i.computation_status = 'checked' and i.state <> 'cancelled'
  loop
    select ev.actor_id, ev.created_at into v_sub_by, v_sub_at
      from public.ipas_events ev
     where ev.ipas_id = r.id and ev.kind = 'header_changed'
       and ev.detail #>> '{fields,computation_status,to}' = 'lc_odoo_done'
     order by ev.created_at desc, ev.id desc
     limit 1;

    select ev.actor_id, ev.created_at into v_app_by, v_app_at
      from public.ipas_events ev
     where ev.ipas_id = r.id and ev.kind = 'header_changed'
       and ev.detail #>> '{fields,computation_status,to}' = 'checked'
     order by ev.created_at desc, ev.id desc
     limit 1;

    if v_sub_by is not null and v_app_by is not null
       and not exists (
         select 1 from public.ipas_signoffs s
          where s.ipas_id = r.id and s.section = 6 and s.cleared_at is null
       ) then
      insert into public.ipas_signoffs (ipas_id, section, role, signed_by, signed_at, signature_declined, signature_version)
      select r.id, 6, 'prepared', v_sub_by, v_sub_at, false, e.signature_path
        from public.employees e where e.id = v_sub_by
      returning * into v_signoff;
      insert into public.ipas_events (ipas_id, actor_id, kind, detail, created_at)
      values (r.id, v_sub_by, 'signed', jsonb_build_object(
        'section', 6, 'role', 'prepared', 'signoff_id', v_signoff.id,
        'signature_declined', false, 'migrated', true), v_sub_at);

      insert into public.ipas_signoffs (ipas_id, section, role, signed_by, signed_at, signature_declined, signature_version)
      select r.id, 6, 'approved', v_app_by, v_app_at, false, e.signature_path
        from public.employees e where e.id = v_app_by
      returning * into v_signoff;
      insert into public.ipas_events (ipas_id, actor_id, kind, detail, created_at)
      values (r.id, v_app_by, 'signed', jsonb_build_object(
        'section', 6, 'role', 'approved', 'signoff_id', v_signoff.id,
        'signature_declined', false, 'migrated', true), v_app_at);
    end if;
  end loop;

  perform set_config('ipas.reopening', 'on', true);
  update public.ipas set computation_status = 'lc_odoo_done' where computation_status = 'checked';
  get diagnostics v_moved = row_count;
  perform set_config('ipas.reopening', 'off', true);

  return v_moved;
end;
$$;

revoke all on function public._ipas_convert_checked_by() from public, anon, authenticated;

select public._ipas_convert_checked_by();

alter table public.ipas drop constraint if exists ipas_computation_status_chk;
alter table public.ipas add constraint ipas_computation_status_chk
  check (computation_status in ('encoding', 'encoded', 'lc_gs_done', 'lc_odoo_done'));

comment on column public.ipas.computation_status is
  'Where the cost work stands: encoding, encoded, lc_gs_done, lc_odoo_done. Landed Cost is final from lc_odoo_done. Purchasing sets it; section 3 (stored 6) is submitted once it reaches lc_odoo_done and approved by the s6_approved list.';

-- ------------------------------------------------------------------------------
-- 6. The SOR summary (latest: 20261023110000_landed_cost_cost_tier_only.sql) with the
--    section 3 sign-off key
-- ------------------------------------------------------------------------------

drop function if exists public.ipas_summaries_for_sor(uuid);

create function public.ipas_summaries_for_sor(p_opportunity_id uuid)
returns table (
  ipas_id uuid,
  number text,
  po_number text,
  supplier text,
  purpose text,
  state text,
  buyer_track jsonb,
  computation_status text,
  signoffs jsonb,
  landed_cost_total_php numeric,
  landed_cost_mark text
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    i.id,
    i.number,
    i.po_number,
    nullif(btrim(i.odoo_copy #>> '{supplier,name}'), ''),
    i.purpose,
    i.state,
    case when i.source = 'import'
      then jsonb_build_array(
        jsonb_build_object('key', 'purchase_order', 'ticked', coalesce(o.po_state in ('purchase', 'done'), false), 'partial', false),
        jsonb_build_object('key', 'with_pop', 'ticked', pop.has_proof, 'partial', false),
        jsonb_build_object('key', 'import_clearance', 'ticked', i.import_clearance_on is not null, 'partial', false),
        jsonb_build_object('key', 'delivered', 'ticked', i.delivered_on is not null or tg.delivered, 'partial', false),
        jsonb_build_object('key', 'received_in_odoo', 'ticked', rs.received_state = 'received', 'partial', rs.received_state = 'partial'),
        jsonb_build_object('key', 'create_bill', 'ticked', o.bill_count > 0, 'partial', false),
        jsonb_build_object('key', 'actual_checking', 'ticked', i.actual_checking_by is not null or tg.checked, 'partial', false)
      )
      else jsonb_build_array(
        jsonb_build_object('key', 'purchase_order', 'ticked', coalesce(o.po_state in ('purchase', 'done'), false), 'partial', false),
        jsonb_build_object('key', 'with_pop', 'ticked', pop.has_proof, 'partial', false),
        jsonb_build_object('key', 'delivered', 'ticked', i.delivered_on is not null or tg.delivered, 'partial', false),
        jsonb_build_object('key', 'received_in_odoo', 'ticked', rs.received_state = 'received', 'partial', rs.received_state = 'partial'),
        jsonb_build_object('key', 'create_bill', 'ticked', o.bill_count > 0, 'partial', false),
        jsonb_build_object('key', 'actual_checking', 'ticked', i.actual_checking_by is not null or tg.checked, 'partial', false)
      )
    end,
    i.computation_status,
    jsonb_build_object(
      '1', jsonb_build_object(
        'prepared', '1:prepared' = any (lv.live),
        'approved', '1:approved' = any (lv.live)
      ),
      '3', jsonb_build_object(
        'prepared', '3:prepared' = any (lv.live),
        'approved', '3:approved' = any (lv.live)
      ),
      '6', jsonb_build_object(
        'prepared', '6:prepared' = any (lv.live),
        'approved', '6:approved' = any (lv.live)
      ),
      '7', jsonb_build_object(
        'received', '7:received' = any (lv.live),
        'noted', '7:noted' = any (lv.live),
        'checked', '7:checked' = any (lv.live),
        'approved', '7:approved' = any (lv.live)
      )
    ),
    lcost.total,
    lcost.mark
  from public.ipas i
  cross join lateral (
    select
      i.odoo_copy #>> '{po,state}' as po_state,
      i.odoo_copy #>> '{receipts,status}' as receipts_status,
      case when (i.odoo_copy #>> '{receipts,total}') ~ '^[0-9]+(\.[0-9]+)?$'
        then (i.odoo_copy #>> '{receipts,total}')::numeric else 0 end as receipts_total,
      case when (i.odoo_copy #>> '{receipts,done}') ~ '^[0-9]+(\.[0-9]+)?$'
        then (i.odoo_copy #>> '{receipts,done}')::numeric else 0 end as receipts_done,
      case when (i.odoo_copy #>> '{bills,count}') ~ '^[0-9]+(\.[0-9]+)?$'
        then (i.odoo_copy #>> '{bills,count}')::numeric else 0 end as bill_count
  ) o
  cross join lateral (
    select case
      when o.receipts_status = 'partial' then 'partial'
      when o.receipts_status = 'full' or (o.receipts_total > 0 and o.receipts_done >= o.receipts_total) then 'received'
      when o.receipts_done > 0 then 'partial'
      else 'none'
    end as received_state
  ) rs
  cross join lateral (
    select exists (
      select 1 from public.ipas_payments p
      where p.ipas_id = i.id and coalesce(p.proof_url, '') <> ''
    ) as has_proof
  ) pop
  cross join lateral (
    select coalesce(array_agg(so.section::text || ':' || so.role), '{}'::text[]) as live
    from public.ipas_signoffs so
    where so.ipas_id = i.id and so.cleared_at is null
  ) lv
  cross join lateral (
    select
      coalesce(bool_or(first_done), false) as delivered,
      coalesce(count(*) > 0 and bool_and(check_done), false) as checked
    from (
      select
        exists (
          select 1 from public.transmittal_stages st
           where st.transmittal_id = t.id and st.completed_at is not null
             and st.stage = case when t.check_warehouse then 'warehouse_checking' else 'technical_inspection' end
        ) as first_done,
        exists (
          select 1 from public.transmittal_stages st
           where st.transmittal_id = t.id and st.completed_at is not null
             and st.stage = case when t.check_technical then 'technical_inspection' else 'warehouse_checking' end
        ) as check_done
      from public.transmittals t
      where t.state not in ('draft', 'cancelled')
        and exists (select 1 from public.transmittal_lines l where l.transmittal_id = t.id and l.ipas_id = i.id)
    ) slips
  ) tg
  -- #283: the IPAS's Landed Cost total and mark, for cost-tier readers only.
  cross join lateral (
    select
      case when bool_or(l.mark = 'unavailable') then null else sum(l.total_php) end as total,
      case when count(*) = 0 then null
           when bool_or(l.mark = 'unavailable') then 'unavailable'
           when bool_and(l.mark = 'final') then 'final'
           else 'provisional' end as mark
    from public.ipas_line_landed_costs(i.id) l
    where public.costing_can_read_cost(p_opportunity_id)
  ) lcost
  where (select public.sor_access_level(p_opportunity_id)) = 'full'
    and i.purpose = 'project'
    and exists (
      select 1 from public.ipas_sors s
      where s.ipas_id = i.id and s.opportunity_id = p_opportunity_id
    )
  order by
    case i.state when 'open' then 0 when 'filed' then 1 else 2 end,
    i.number;
$function$;

comment on function public.ipas_summaries_for_sor(uuid) is
  '#249, #256, #283: the Project IPAS naming an SOR, as a summary (number, PO, supplier, Purpose, state, buyer track ticks, computation status, sign-off progress) for anyone who can read the SOR. Landed Cost total and mark only for the matrix''s cost tiers (null otherwise). Never payments, charges or bank details. No SOR access -> no rows.';

revoke all on function public.ipas_summaries_for_sor(uuid) from public, anon;
grant execute on function public.ipas_summaries_for_sor(uuid) to authenticated;
