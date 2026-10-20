-- ==============================================================================
-- #550 (spec #544): the server fetches the Odoo copy itself when an IPAS is raised.
--
-- Until now `ipas_create` stored whatever Odoo copy the signed-in caller sent, so
-- a forged copy showed in the IPAS list until someone opened the IPAS.
--
-- Now:
--   * `ipas_raise_from_odoo` is the only way to raise. It is for the service role
--     alone: the odoo-po-ipas edge function resolves the caller from their JWT,
--     asks Odoo itself, and calls this with the caller as `p_actor`, its own
--     verdict ('found' | 'not_found' | 'unavailable') and the copy it read.
--   * `ipas_create` keeps its signature, so an older browser gets a clear
--     refusal instead of "function not found", and always refuses a signed-in
--     caller. It no longer stores anything.
--   * Refresh-on-open (`ipas_record_odoo_copy`) is untouched.
--
-- Verdicts: found -> raised with Odoo's copy; not_found -> refused naming the PO
-- (22023); unavailable -> refused, Odoo couldn't be asked (55000).
--
-- SAFE TO RUN AT ANY TIME. Idempotent.
-- ==============================================================================

create or replace function public.ipas_raise_from_odoo(
  p_actor uuid,
  p_po_number text,
  p_priority text,
  p_source text,
  p_purpose text,
  p_sor_ids uuid[],
  p_remarks text,
  p_verdict text,
  p_odoo_copy jsonb
) returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po text := upper(btrim(p_po_number));
  v_sors uuid[];
  v_existing text;
  v_row public.ipas;
begin
  if p_actor is null or not public._employee_has_purchasing_access(p_actor) then
    raise exception 'ipas_create: only Purchasing raises an IPAS' using errcode = '42501';
  end if;

  if v_po is null or v_po !~ '^P[0-9]+$' then
    raise exception 'ipas_create: % isn''t an Odoo PO number ("P" then digits, e.g. P01234)', coalesce(p_po_number, 'null')
      using errcode = '22023';
  end if;
  if p_priority is null or p_priority not in ('very_high', 'high', 'medium') then
    raise exception 'ipas_create: % isn''t a Priority', coalesce(p_priority, 'null') using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('import', 'local') then
    raise exception 'ipas_create: % isn''t a Source', coalesce(p_source, 'null') using errcode = '22023';
  end if;
  if p_purpose is null or p_purpose not in ('project', 'inventory', 'supplies', 'events') then
    raise exception 'ipas_create: % isn''t a Purpose', coalesce(p_purpose, 'null') using errcode = '22023';
  end if;

  -- What Odoo said, as the server heard it.
  if p_verdict is distinct from 'found' then
    if p_verdict = 'not_found' then
      raise exception 'ipas_create: Odoo has no purchase order named %', v_po using errcode = '22023', hint = 'odoo_not_found';
    elsif p_verdict = 'unavailable' then
      raise exception 'ipas_create: Odoo couldn''t be asked about %; try again shortly', v_po using errcode = '55000', hint = 'odoo_unavailable';
    end if;
    raise exception 'ipas_create: % isn''t an Odoo verdict', coalesce(p_verdict, 'null') using errcode = '22023';
  end if;

  if p_odoo_copy is null
     or jsonb_typeof(p_odoo_copy) <> 'object'
     or jsonb_typeof(p_odoo_copy->'po') is distinct from 'object'
     or jsonb_typeof(p_odoo_copy->'lines') is distinct from 'array' then
    raise exception 'ipas_create: the Odoo copy is missing' using errcode = '22023';
  end if;
  if upper(btrim(p_odoo_copy->'po'->>'name')) is distinct from v_po then
    raise exception 'ipas_create: the Odoo copy is for %, not %', coalesce(p_odoo_copy->'po'->>'name', 'no PO'), v_po
      using errcode = '22023';
  end if;

  v_sors := public._ipas_clean_sor_ids('ipas_create', p_purpose, p_sor_ids);

  select i.number into v_existing
    from public.ipas i
   where i.po_number = v_po and i.state <> 'cancelled';
  if v_existing is not null then
    raise exception 'ipas_create: % already has a live IPAS (%); cancel it to raise a new one', v_po, v_existing
      using errcode = '23505';
  end if;

  insert into public.ipas (
    po_number, odoo_po_id, priority, source, purpose, remarks, odoo_copy, created_by
  ) values (
    v_po,
    case when (p_odoo_copy->'po'->>'id') ~ '^[0-9]+$' then (p_odoo_copy->'po'->>'id')::integer end,
    p_priority,
    p_source,
    p_purpose,
    nullif(btrim(p_remarks), ''),
    p_odoo_copy,
    p_actor
  )
  returning * into v_row;

  insert into public.ipas_sors (ipas_id, opportunity_id)
  select v_row.id, s from unnest(v_sors) s;

  perform public._ipas_write_event(v_row.id, p_actor, 'created', jsonb_build_object(
    'number', v_row.number,
    'po_number', v_row.po_number,
    'priority', v_row.priority,
    'source', v_row.source,
    'purpose', v_row.purpose,
    'sor_ids', to_jsonb(v_sors)
  ));

  return v_row;
end;
$$;

comment on function public.ipas_raise_from_odoo(uuid, text, text, text, text, uuid[], text, text, jsonb) is
  '#550: server-only (service role). The odoo-po-ipas edge function raises an IPAS for p_actor (Purchasing) with the Odoo copy it read itself and its verdict (found / not_found / unavailable). Same rules as the old ipas_create; a PO Odoo doesn''t know is refused naming the PO (22023), no answer is refused (55000).';

revoke all on function public.ipas_raise_from_odoo(uuid, text, text, text, text, uuid[], text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ipas_raise_from_odoo(uuid, text, text, text, text, uuid[], text, text, jsonb)
  to service_role;

-- A signed-in caller can no longer hand the database a copy.
create or replace function public.ipas_create(
  p_po_number text,
  p_priority text,
  p_source text,
  p_purpose text,
  p_sor_ids uuid[],
  p_remarks text,
  p_odoo_copy jsonb
) returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_create: not signed in' using errcode = '42501';
  end if;
  raise exception 'ipas_create: an IPAS is raised through the server, which reads the PO from Odoo itself; reload the page and try again'
    using errcode = '42501';
end;
$$;

comment on function public.ipas_create(text, text, text, text, uuid[], text, jsonb) is
  '#550: always refuses a signed-in caller. Raise through the odoo-po-ipas edge function (ipas_raise_from_odoo). Kept so an older browser gets a clear refusal.';

revoke all on function public.ipas_create(text, text, text, text, uuid[], text, jsonb) from public, anon;
grant execute on function public.ipas_create(text, text, text, text, uuid[], text, jsonb) to authenticated;
