-- #839: IPAS messages: name Logistics in the section 4 refusal, not 6.
-- Stored section 8 is Logistics (shown as section 6 on screen). When Filing (section 7)
-- opens, sections 1, 2, 3 and Logistics must be signed.

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
    raise exception 'ipas_sign: section % can be submitted once the Computation status is LC Odoo Done', public._ipas_section_no(6)
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
    -- Section 7 (Filing, screen section 4) opens once sections 1, 2 and 3 are
    -- approved (stored 1, 3 and 6). Checked at every step: an approval undone by an
    -- Odoo change closes it again. The gate runs for every section 7 role, so
    -- Approved waits for section 3 too, and so does a Noted or Checked not yet given
    -- (#590); the ones already given stay.
    if not public._ipas_filing_open(v_ipas.id) then
      raise exception 'ipas_sign: section % opens once sections %, %, % and Logistics are signed', public._ipas_section_no(7), public._ipas_section_no(1), public._ipas_section_no(3), public._ipas_section_no(6) using errcode = '22023';
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
  elsif p_section in (1, 3, 6, 8) then
    -- This section is approved. When it was the last of sections 1, 2 and 3 and
    -- section 7 hasn't started, section 7 is ready for Received (#590).
    if public._ipas_filing_open(v_ipas.id)
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

revoke all on function public.ipas_sign(uuid, integer, text, boolean) from public, anon;
grant execute on function public.ipas_sign(uuid, integer, text, boolean) to authenticated;
