-- #587 (spec #584): a flagged Account # clears IPAS section 2 only.

-- #587: clears the Approved role of the given stored sections only. A new name,
-- so _ipas_clear_approvals (1 and 3, shared with the Odoo refresh) is untouched.
create or replace function public._ipas_clear_section_approvals(
  p_ipas_id uuid,
  p_actor uuid,
  p_reason text,
  p_sections integer[],
  out sections integer[],
  out preparer_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  with cleared as (
    update public.ipas_signoffs s
       set cleared_at = now(), cleared_by = p_actor, cleared_reason = p_reason
     where s.ipas_id = p_ipas_id
       and s.section = any (p_sections)
       and s.role = 'approved'
       and s.cleared_at is null
    returning s.section
  )
  select coalesce(array_agg(distinct section::integer), '{}'::integer[]) into sections from cleared;

  preparer_ids := '{}'::uuid[];
  if cardinality(sections) > 0 then
    select coalesce(array_agg(distinct s.signed_by), '{}'::uuid[])
      into preparer_ids
      from public.ipas_signoffs s
     where s.ipas_id = p_ipas_id
       and s.section = any (sections)
       and s.role = 'prepared'
       and s.cleared_at is null;

    perform public._ipas_write_event(p_ipas_id, p_actor, 'approvals_cleared', jsonb_build_object(
      'reason', p_reason,
      'sections', to_jsonb(sections)
    ));
  end if;
end;
$$;

revoke all on function public._ipas_clear_section_approvals(uuid, uuid, text, integer[]) from public, anon, authenticated;

create or replace function public.ipas_set_bank_details(
  p_ipas_id uuid,
  p_bank_name text,
  p_account_name text,
  p_account_number text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_ipas public.ipas;
  v_before public.ipas_bank_details;
  v_row public.ipas_bank_details;
  v_bank text := nullif(btrim(p_bank_name), '');
  v_name text := nullif(btrim(p_account_name), '');
  v_number text := nullif(btrim(p_account_number), '');
  v_new boolean;
  v_key text;
  v_partner text;
  v_prev_id uuid;
  v_prev_number text;
  v_prev_key text;
  v_flagged boolean := false;
  v_account_changed boolean;
  v_fields text[] := '{}';
  v_sections integer[] := '{}';
  v_preparers uuid[] := '{}';
begin
  if v_actor is null then
    raise exception 'ipas_set_bank_details: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_set_bank_details: only Purchasing types bank details' using errcode = '42501';
  end if;

  v_ipas := public._ipas_lock_open('ipas_set_bank_details', p_ipas_id);

  select * into v_before from public.ipas_bank_details where ipas_id = v_ipas.id for update;
  v_new := v_before.ipas_id is null;

  if length(coalesce(v_bank, '')) > 200 or length(coalesce(v_name, '')) > 200 then
    raise exception 'ipas_set_bank_details: Bank Name and Account Name are 200 characters at most' using errcode = '22023';
  end if;
  if length(coalesce(v_number, '')) > 100 then
    raise exception 'ipas_set_bank_details: Account # is 100 characters at most' using errcode = '22023';
  end if;

  v_key := public._ipas_account_key(v_number);

  -- Against the same supplier's most recent other IPAS that has an Account #.
  -- Security definer: the caller reads no other IPAS's bank details, only the
  -- answer. No Odoo partner id means nothing to match on.
  v_partner := nullif(v_ipas.odoo_copy->'supplier'->>'id', '');
  if v_key <> '' and v_partner is not null then
    select b.ipas_id, i.number, b.account_number
      into v_prev_id, v_prev_number, v_prev_key
      from public.ipas_bank_details b
      join public.ipas i on i.id = b.ipas_id
     where i.id <> v_ipas.id
       and i.state <> 'cancelled'
       and i.odoo_copy->'supplier'->>'id' = v_partner
       and public._ipas_account_key(b.account_number) <> ''
     order by i.created_at desc, i.id desc
     limit 1;
    if v_prev_id is not null then
      v_flagged := public._ipas_account_key(v_prev_key) <> v_key;
    end if;
  end if;

  v_account_changed := public._ipas_account_key(v_before.account_number) <> v_key;

  if not v_new then
    if v_bank is distinct from v_before.bank_name then v_fields := array_append(v_fields, 'bank_name'); end if;
    if v_name is distinct from v_before.account_name then v_fields := array_append(v_fields, 'account_name'); end if;
    if v_number is distinct from v_before.account_number then v_fields := array_append(v_fields, 'account_number'); end if;
    -- Nothing typed differently and the flag stands: nothing to record.
    if cardinality(v_fields) = 0 and v_flagged = v_before.account_flagged then
      return jsonb_build_object(
        'bank_details', to_jsonb(v_before),
        'flagged', v_before.account_flagged,
        'account_changed', false,
        'approvals_cleared', '[]'::jsonb,
        'preparer_ids', '[]'::jsonb
      );
    end if;
  else
    if v_bank is not null then v_fields := array_append(v_fields, 'bank_name'); end if;
    if v_name is not null then v_fields := array_append(v_fields, 'account_name'); end if;
    if v_number is not null then v_fields := array_append(v_fields, 'account_number'); end if;
  end if;

  insert into public.ipas_bank_details (ipas_id, bank_name, account_name, account_number, account_flagged, updated_by)
  values (v_ipas.id, v_bank, v_name, v_number, v_flagged, v_actor)
  on conflict (ipas_id) do update
     set bank_name = excluded.bank_name,
         account_name = excluded.account_name,
         account_number = excluded.account_number,
         account_flagged = excluded.account_flagged,
         updated_by = excluded.updated_by
  returning * into v_row;

  -- What changed, never the values: ipas_events is readable by people who may
  -- not read bank details.
  perform public._ipas_write_event(
    v_ipas.id, v_actor,
    case when v_new then 'bank_details_set' else 'bank_details_changed' end,
    jsonb_build_object(
      'fields', to_jsonb(v_fields),
      'account_changed', v_account_changed,
      'flagged', v_flagged,
      'was_flagged', case when v_new then false else v_before.account_flagged end
    )
  );

  if v_flagged and v_account_changed then
    perform public._ipas_write_event(v_ipas.id, v_actor, 'account_flagged', jsonb_build_object(
      'previous_ipas_id', v_prev_id,
      'previous_number', v_prev_number
    ));

    -- The bank details belong to screen section 2 (stored 3): only its live
    -- approval no longer approves this account. Section 1 is left alone.
    select c.sections, c.preparer_ids
      into v_sections, v_preparers
      from public._ipas_clear_section_approvals(v_ipas.id, v_actor, 'Account # flagged', array[3]) c;
  end if;

  return jsonb_build_object(
    'bank_details', to_jsonb(v_row),
    'flagged', v_flagged,
    'account_changed', v_account_changed,
    'approvals_cleared', to_jsonb(v_sections),
    'preparer_ids', to_jsonb(v_preparers)
  );
end;
$$;

comment on function public.ipas_set_bank_details(uuid, text, text, text) is
  '#245, #587: Purchasing access types or changes the supplier''s Bank Name, Account Name and Account # on an open IPAS. The Account # (spaces and dashes stripped) is compared with the same Odoo supplier''s most recent other IPAS that is not cancelled and has one: a difference sets account_flagged, writes an "account_flagged" event, clears the live section 2 (stored 3) approval only ("Account # flagged") and returns the section 2 preparers to notify; a supplier''s first IPAS is never flagged. Events record which fields changed, never the values. Returns { bank_details, flagged, account_changed, approvals_cleared[], preparer_ids[] }.';

revoke all on function public.ipas_set_bank_details(uuid, text, text, text) from public, anon;
grant execute on function public.ipas_set_bank_details(uuid, text, text, text) to authenticated;
