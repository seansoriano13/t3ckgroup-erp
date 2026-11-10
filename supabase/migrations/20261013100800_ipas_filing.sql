-- ==============================================================================
-- 20261013100800_ipas_filing.sql
--
-- Issue #248 (IPAS, spec #241) — section 7 and Filing.
--
-- Section 7's sign-offs file the IPAS, and Filing is the single point that locks
-- it.
--
--   ipas_sign       re-created from its #247 body with section 7's rules:
--                     - it opens once sections 1 and 3 are approved
--                     - Received comes first; Noted and Checked follow, in any
--                       order
--                     - Approved needs Received, Noted and Checked AND
--                       computation_status at costs_complete or checked, then
--                       sets state = 'filed' and filed_at (one deliberate act)
--                   and names who to notify next (sections 1 and 3 approved ->
--                   the Received list; Received -> Noted and Checked; both given
--                   -> section 7's Approved list), never the person signing.
--   ipas_reopen     a Super Admin returns a filed IPAS to open with a reason:
--                   clears section 7's live sign-offs only (history is kept),
--                   leaves sections 1 and 3 approved.
--   The freeze      triggers refuse every insert, update and delete on a filed
--                   IPAS's SORs, payments, charges, documents and bank details,
--                   and every update of the ipas row itself, EXCEPT ipas_reopen
--                   (it says so with a transaction-local setting only it sets)
--                   and the odoo_changed_since_filing flag, which can move both
--                   ways. They are triggers, so the service role is held to
--                   them too. Nothing here touches a CHECK constraint, and a
--                   sign-off (ipas_signoffs) is not frozen: reopening has to
--                   clear them, and the signing functions guard themselves.
--
-- ipas_send_back stays sections 1 and 3 only. Section 7 has no Prepared sign-off
-- to clear and no approval to return to a preparer: a signer who finds the IPAS
-- unready simply doesn't sign, and a Super Admin can reopen a filed one.
--
-- Cancelling a filed IPAS was refused already (#242, ipas_cancel). Recording an
-- Odoo copy on a filed IPAS stores nothing and only moves the flag (#243).
--
-- Reopening also drops the flag: an open IPAS refreshes its copy again, so
-- "Odoo has changed since filing" no longer means anything until it is refiled.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: new triggers
-- and functions, `create or replace` of ipas_sign. Nothing is filed yet when
-- this lands, so no existing row is frozen by it. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- The freeze
-- ------------------------------------------------------------------------------

-- The ipas row itself. Once filed it changes only through ipas_reopen (which
-- sets `ipas.reopening` for its own transaction) or by the Odoo flag; never
-- deleted.
create or replace function public.ipas_freeze_guard()
returns trigger
language plpgsql
as $$
begin
  if old.state is distinct from 'filed' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'ipas: % is filed and frozen; it can''t be deleted', old.number using errcode = '55000';
  end if;

  if coalesce(current_setting('ipas.reopening', true), '') = 'on' then
    return new;
  end if;

  -- "Odoo has changed since filing" moves both ways; updated_at moves with it.
  if (to_jsonb(new) - 'odoo_changed_since_filing' - 'updated_at')
     = (to_jsonb(old) - 'odoo_changed_since_filing' - 'updated_at') then
    return new;
  end if;

  raise exception 'ipas: % is filed and frozen; a Super Admin reopens it first', old.number using errcode = '55000';
end;
$$;

drop trigger if exists ipas_freeze on public.ipas;
create trigger ipas_freeze
  before update or delete on public.ipas
  for each row execute function public.ipas_freeze_guard();

-- The tables that hang off an IPAS. Security definer: the answer must not depend
-- on what the writing role is allowed to read.
create or replace function public.ipas_children_freeze_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_number text;
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.ipas_id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.ipas_id];
  else
    v_ids := array[old.ipas_id, new.ipas_id];
  end if;

  select i.number into v_number
    from public.ipas i
   where i.id = any (v_ids) and i.state = 'filed'
   limit 1
     for share;

  if v_number is not null then
    raise exception '%: % is filed and frozen; a Super Admin reopens it first', tg_table_name, v_number
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $freeze$
declare
  v_table text;
begin
  foreach v_table in array array['ipas_sors', 'ipas_payments', 'ipas_charges', 'ipas_documents', 'ipas_bank_details']
  loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_freeze', v_table);
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.ipas_children_freeze_guard()',
      v_table || '_freeze', v_table
    );
  end loop;
end;
$freeze$;

-- ------------------------------------------------------------------------------
-- Who is on which lists
-- ------------------------------------------------------------------------------

-- Everyone on any of the lists, once, never the person acting and never a
-- soft-deleted employee: the people a step notifies.
create or replace function public._ipas_list_members(p_list_keys text[], p_exclude uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(x.employee_id order by x.first_added), '{}'::uuid[])
    from (
      select l.employee_id, min(l.created_at) as first_added
        from public.ipas_signer_lists l
        join public.employees e on e.id = l.employee_id
       where l.list_key = any (p_list_keys)
         and not coalesce(e.is_deleted, false)
         and l.employee_id is distinct from p_exclude
       group by l.employee_id
    ) x;
$$;

revoke all on function public._ipas_list_members(text[], uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Signing, with section 7
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
      if v_ipas.computation_status not in ('costs_complete', 'checked') then
        raise exception 'ipas_sign: % can''t be filed until Costs complete: Landed Cost is still provisional, and Filing freezes it as final', v_ipas.number
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

comment on function public.ipas_sign(uuid, integer, text, boolean) is
  '#247, #248: gives a sign-off on an open IPAS. Prepared needs Purchasing access; every other role needs its list (a Super Admin only when on it). Approved in sections 1 and 3 needs a live Prepared by someone else. Section 7 opens once sections 1 and 3 are approved: Received first, then Noted and Checked in any order, then Approved, which needs all three and computation_status at costs_complete or checked, and files the IPAS (state filed, filed_at). Snapshots the signer''s stored signature unless they decline it. Returns { signoff, ipas, section, role, stage, filed, notify_ids[] }; stage names what became ready (section_prepared, received_ready, noted_checked_ready, approve_ready, filed) and notify_ids are exactly that step''s list, never the signer.';

revoke all on function public.ipas_sign(uuid, integer, text, boolean) from public, anon;
grant execute on function public.ipas_sign(uuid, integer, text, boolean) to authenticated;

-- ------------------------------------------------------------------------------
-- Reopening
-- ------------------------------------------------------------------------------

create or replace function public.ipas_reopen(p_ipas_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_row public.ipas;
  v_roles text[];
begin
  if v_actor is null then
    raise exception 'ipas_reopen: not signed in' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'ipas_reopen: only a Super Admin reopens a filed IPAS' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_reopen: give the reason this IPAS is being reopened' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'ipas_reopen: the reason is 500 characters at most' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_reopen: IPAS % not found', p_ipas_id using errcode = 'P0002';
  end if;
  if v_row.state <> 'filed' then
    raise exception 'ipas_reopen: % isn''t filed', v_row.number using errcode = '55000';
  end if;

  -- The freeze lets this one update through; the setting lasts for this
  -- transaction and is switched off again straight after.
  perform set_config('ipas.reopening', 'on', true);
  update public.ipas
     set state = 'open', filed_at = null, odoo_changed_since_filing = false
   where id = v_row.id
  returning * into v_row;
  perform set_config('ipas.reopening', 'off', true);

  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = v_actor, cleared_reason = 'Reopened: ' || v_reason
     where s.ipas_id = v_row.id
       and s.section = 7
       and s.cleared_at is null
    returning s.role
  )
  select coalesce(array_agg(role order by role), '{}'::text[]) into v_roles from cleared;

  perform public._ipas_write_event(v_row.id, v_actor, 'reopened', jsonb_build_object(
    'reason', v_reason,
    'cleared', to_jsonb(v_roles)
  ));

  return jsonb_build_object(
    'ipas', to_jsonb(v_row),
    'actor_id', v_actor,
    'cleared_roles', to_jsonb(v_roles)
  );
end;
$$;

comment on function public.ipas_reopen(uuid, text) is
  '#248: a Super Admin returns a filed IPAS to open, with a reason. Clears section 7''s live sign-offs only (kept as history, "Reopened: <reason>"), leaves sections 1 and 3 approved, drops the "Odoo has changed since filing" flag and writes a "reopened" event. Refused to anyone else, without a reason, and on an IPAS that isn''t filed. Returns { ipas, actor_id, cleared_roles[] }.';

revoke all on function public.ipas_reopen(uuid, text) from public, anon;
grant execute on function public.ipas_reopen(uuid, text) to authenticated;
