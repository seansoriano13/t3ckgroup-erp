-- #713 (spec #699): IPAS Logistics sign-off. A stored section 8 ("logistics", shown as 6) with
-- one sign-off, role 'approved', given by the 'logistics_signed' list (seeded with Ma'am Grace,
-- call sign 102, so someone else can be added to cover for her). Filing (stored 7) opens only
-- once sections 1, 2, 3 and Logistics are signed.
--
-- Nothing already given is cleared: an IPAS in Filing keeps its Received / Noted / Checked, only
-- what is still to be given waits. Idempotent.

create or replace function public._ipas_section_no(p_section integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_section when 3 then 2 when 6 then 3 when 7 then 4 when 8 then 6 else p_section end;
$$;

revoke all on function public._ipas_section_no(integer) from public, anon, authenticated;

create or replace function public._ipas_signoff_pair_ok(p_section integer, p_role text)
returns boolean
language sql
immutable
as $$
  select (p_section in (1, 3, 6) and p_role in ('prepared', 'approved'))
      or (p_section = 7 and p_role in ('received', 'noted', 'checked', 'approved'))
      or (p_section = 8 and p_role = 'approved');
$$;

revoke all on function public._ipas_signoff_pair_ok(integer, text) from public, anon, authenticated;

alter table public.ipas_signoffs drop constraint if exists ipas_signoffs_section_chk;
alter table public.ipas_signoffs add constraint ipas_signoffs_section_chk check (section in (1, 3, 6, 7, 8));
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
    when p_section = 8 and p_role = 'approved' then 'logistics_signed'
    else null
  end;
$$;

revoke all on function public._ipas_signoff_list_key(integer, text) from public, anon, authenticated;

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
    when p_section = 8 then public._ipas_on_list('logistics_signed', p_employee_id)
    else false
  end;
$$;

revoke all on function public._ipas_can_sign_section(integer, uuid) from public, anon, authenticated;

alter table public.ipas_signer_lists drop constraint if exists ipas_signer_lists_key_chk;
alter table public.ipas_signer_lists add constraint ipas_signer_lists_key_chk check (list_key in (
  's1_approved', 's3_approved', 's6_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
  'logistics_signed',
  'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
));

alter table public.ipas_signer_list_log drop constraint if exists ipas_signer_list_log_key_chk;
alter table public.ipas_signer_list_log add constraint ipas_signer_list_log_key_chk check (list_key in (
  's1_approved', 's3_approved', 's6_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
  'logistics_signed',
  'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
));

-- Seed: Ma'am Grace (call sign 102). Re-runnable. No change-log row: the log needs an actor.
insert into public.ipas_signer_lists (list_key, employee_id)
select 'logistics_signed', e.id
  from public.employees e
 where e.call_sign = '102'
   and not coalesce(e.is_deleted, false)
on conflict do nothing;

-- The Filing gate: sections 1, 2, 3 (stored 1, 3, 6) and Logistics (stored 8) are signed.
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
       and s.section in (1, 3, 6, 8)
       and s.role = 'approved'
       and s.cleared_at is null
  ) = 4;
$$;

revoke all on function public._ipas_filing_open(uuid) from public, anon, authenticated;

-- ipas_set_signer_list (latest: 20261025110000_586); logistics_signed added to the keys.
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
    's1_approved', 's3_approved', 's6_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved', 'logistics_signed',
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

-- ipas_sign (latest: 20261025130000_590). Changes: Logistics (8) is an Approved with no
-- Prepared before it; its signing counts toward Filing opening and tells the Received list.
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
      raise exception 'ipas_sign: section % opens once sections %, %, % and % are signed', public._ipas_section_no(7), public._ipas_section_no(1), public._ipas_section_no(3), public._ipas_section_no(6), public._ipas_section_no(8) using errcode = '22023';
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

