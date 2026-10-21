-- #590 (spec #584): IPAS Filing waits for section 3.
--
-- Filing (section 4, stored 7) opens only once sections 1, 2 and 3 are approved
-- (stored 1, 3 and 6). Section 4 sign-offs already given on open IPAS stay: this
-- migration clears nothing. Only what is still to be given waits, the final Approve
-- among it. The section 4 Received signer is told when section 3 is the last
-- approval in and section 4 opens.
--
-- Also adds the order-ageing step 'section_3_approval' ("section 3 waiting for
-- approval"), blank by default, owned by the section 3 approval list.
--
-- RELEASE ORDER: 20261025110000_586 (section 3 list seeding and the Checked by
-- conversion) must run before this one reaches users, or Filing stops: no IPAS
-- would have a section 3 approval to open it.
--
-- SAFE TO RUN AT ANY TIME ONCE 586 HAS RUN. Idempotent.

-- One place that knows "1, 2 and 3 are approved" (ipas_sign, ipas_send_back).
create or replace function public._ipas_filing_open(p_ipas_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    select count(distinct s.section)
      from public.ipas_signoffs s
     where s.ipas_id = p_ipas_id
       and s.section in (1, 3, 6)
       and s.role = 'approved'
       and s.cleared_at is null
  ) = 3;
$$;

revoke all on function public._ipas_filing_open(uuid) from public, anon, authenticated;

-- ipas_sign (latest: 20261025110000_586_ipas_section3_signoff.sql); the Filing gate
-- and the received_ready notification now use _ipas_filing_open.
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
    -- Section 7 (Filing, screen section 4) opens once sections 1, 2 and 3 are
    -- approved (stored 1, 3 and 6). Checked at every step: an approval undone by an
    -- Odoo change closes it again. The gate runs for every section 7 role, so
    -- Approved waits for section 3 too, and so does a Noted or Checked not yet given
    -- (#590); the ones already given stay.
    if not public._ipas_filing_open(v_ipas.id) then
      raise exception 'ipas_sign: section 4 opens once sections 1, 2 and 3 are approved' using errcode = '22023';
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
  elsif p_section in (1, 3, 6) then
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

-- ipas_send_back (latest: 20261023210000_refusal_codes.sql). #590 CHANGES ONLY the
-- section 7 "is it open" check, which now goes through _ipas_filing_open. Nothing
-- else here differs from that version.
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
    raise exception 'ipas_send_back: only sections 1, 2 and 4 can be returned' using errcode = '22023';
  end if;

  -- Refuses a filed or cancelled IPAS (55000): a filed one is reopened, not returned.
  v_ipas := public._ipas_lock_open('ipas_send_back', p_ipas_id);

  if p_section = 7 then
    -- Anyone on a section 7 list, whichever sign-off they give.
    if not public._ipas_can_sign_section(7, v_actor) then
      raise exception 'ipas_send_back: only a signer of section 4 returns it' using errcode = '42501';
    end if;

    -- Section 7 is open once sections 1, 2 and 3 are approved (#590: the Filing gate
    -- now includes section 3, stored 6).
    if not public._ipas_filing_open(v_ipas.id) then
      raise exception 'ipas_send_back: section 4 isn''t open yet; sections 1, 2 and 3 must be approved first' using errcode = '22023';
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
      raise exception 'ipas_send_back: only a signer of section % returns it', public._ipas_section_no(p_section) using errcode = '42501';
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
    raise exception 'ipas_send_back: section % has nothing to return', public._ipas_section_no(p_section) using errcode = '22023';
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

-- Order ageing: the new step.
alter table public.order_ageing_rules drop constraint if exists order_ageing_rules_step_chk;
alter table public.order_ageing_rules add constraint order_ageing_rules_step_chk check (step in (
  'purchase_order', 'with_pop', 'import_clearance', 'delivered', 'received_in_odoo',
  'create_bill', 'actual_checking',
  'no_transmittal', 'check_open', 'section_3_approval', 'ready_to_file'
));
insert into public.order_ageing_rules (step) values ('section_3_approval')
on conflict (step) do nothing;
