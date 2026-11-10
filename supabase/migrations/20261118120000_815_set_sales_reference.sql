-- #815 (spec #800, ADR 0050) — One home for the S0: the S0 card and one save step.
--
-- set_sales_reference is the only way the S0 (sales_opportunities.sales_reference) changes after
-- registration. It checks format, permission, the lock (free in the deal's first Stage, fill-once
-- after it, then locked; a Super Admin may override with a reason), duplicates (Lost counts,
-- deleted does not, no bypass), and the Odoo fact the edge function passes in. Every set, change,
-- clear and override is written to the deal's history. Service role only: the browser never sends
-- Odoo facts; the sor-sales-reference edge function calls it.
--
-- Existing writers are NOT removed here (#822 adds the guard). Existing duplicates are left alone.

alter table public.sales_opportunities
  add column if not exists sales_reference_odoo_state text,
  add column if not exists sales_reference_checked_at timestamptz;

alter table public.sales_opportunities
  drop constraint if exists sales_opportunities_sales_reference_odoo_state_chk;
alter table public.sales_opportunities
  add constraint sales_opportunities_sales_reference_odoo_state_chk
  check (sales_reference_odoo_state is null or sales_reference_odoo_state in ('found', 'not_checked', 'gone'));

comment on column public.sales_opportunities.sales_reference_odoo_state is
  'Whether Odoo has the S0: found, not_checked (Odoo did not answer when it was saved) or gone (a re-check no longer found it). Null while there is no S0 or it predates #815. Set by set_sales_reference.';
comment on column public.sales_opportunities.sales_reference_checked_at is
  'When Odoo last confirmed the S0 (state found). Set by set_sales_reference.';

-- ------------------------------------------------------------------------------
-- First Stage helpers
-- ------------------------------------------------------------------------------

-- The deal's first Stage on a Flow Canvas flow: the lowest-order Stage in its Flow Snapshot (name
-- breaks a tie). Returns no row for an old-pipeline deal.
create or replace function public._sor_first_stage(p_opportunity_id uuid)
returns table (stage_id uuid, stage_name text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name
  from (
    select (st->>'id')::uuid as id,
           st->>'name' as name,
           coalesce((st->>'sort_order')::numeric, 999999999) as ord
    from public.sales_opportunities o
    join public.flow_snapshots fs on fs.id = o.flow_snapshot_id
    cross join lateral jsonb_array_elements(coalesce(fs.snapshot_data->'stages', '[]'::jsonb)) st
    where o.id = p_opportunity_id and o.sale_type_id is not null
  ) s
  order by s.ord, s.name
  limit 1
$$;

create or replace function public.sor_at_first_stage(p_opportunity_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_opp public.sales_opportunities;
  v_first uuid;
begin
  select * into v_opp from public.sales_opportunities where id = p_opportunity_id;
  if v_opp.id is null then
    return false;
  end if;
  if v_opp.sale_type_id is not null and v_opp.flow_snapshot_id is not null then
    select stage_id into v_first from public._sor_first_stage(p_opportunity_id);
    return v_first is not null and v_opp.flow_stage_id = v_first;
  end if;
  return exists (
    select 1 from public.crm_pipeline_stages c
    where c.code = v_opp.status and coalesce(c.is_default, false)
  );
end;
$$;

comment on function public.sor_at_first_stage(uuid) is
  '#815: true while the deal is in its first Stage: the Flow Canvas flow''s lowest-order Stage, or Lead (the default Stage) on the old pipeline.';

create or replace function public.sor_sales_reference_lock(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.sor_at_first_stage(p_opportunity_id) then 'open'
    when exists (
      select 1 from public.sales_opportunities
      where id = p_opportunity_id and nullif(btrim(coalesce(sales_reference, '')), '') is null
    ) then 'fill_once'
    else 'locked'
  end
$$;

comment on function public.sor_sales_reference_lock(uuid) is
  '#815: open (first Stage: change or clear freely), fill_once (past the first Stage with no S0: it may be filled once) or locked (only a Super Admin may change it, with a reason).';

revoke all on function public._sor_first_stage(uuid) from public, anon, authenticated;
revoke all on function public.sor_at_first_stage(uuid) from public, anon;
revoke all on function public.sor_sales_reference_lock(uuid) from public, anon;
grant execute on function public.sor_at_first_stage(uuid), public.sor_sales_reference_lock(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------------------
-- The one save step
-- ------------------------------------------------------------------------------

create or replace function public.set_sales_reference(
  p_actor_email text,
  p_opportunity_id uuid,
  p_sales_reference text,
  p_reason text default null,
  p_odoo text default 'unreachable',
  p_items jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text := upper(nullif(btrim(coalesce(p_sales_reference, '')), ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor uuid;
  v_opp public.sales_opportunities;
  v_lock text;
  v_super boolean;
  v_other record;
  v_state text;
  v_checked timestamptz;
  v_event text;
  v_content text;
  v_meta jsonb;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'set_sales_reference: not signed in' using errcode = '42501';
  end if;
  if p_odoo is null or p_odoo not in ('found', 'not_found', 'unreachable') then
    raise exception 'set_sales_reference: p_odoo must be found, not_found or unreachable' using errcode = '22023';
  end if;

  -- 1. Format ("S" then digits; SO123 is read as S123, as the app does).
  if v_new is not null then
    if v_new ~ '^SO[0-9]+$' then
      v_new := 'S' || substr(v_new, 3);
    end if;
    if v_new !~ '^S[0-9]+$' then
      raise exception 'Sales Reference must be the Odoo quotation number — "S" followed by digits, e.g. S01237.'
        using errcode = '22023', hint = 'format';
    end if;
  end if;

  -- Act as the caller the edge function authenticated.
  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);
  v_actor := public.get_employee_id();
  if v_actor is null then
    raise exception 'set_sales_reference: not signed in' using errcode = '42501';
  end if;

  select * into v_opp from public.sales_opportunities
    where id = p_opportunity_id and coalesce(is_deleted, false) = false
    for update;
  if v_opp.id is null then
    raise exception 'That SOR could not be found.' using errcode = 'P0002', hint = 'not_found_sor';
  end if;

  -- Same value as now: nothing to do.
  if v_new is not distinct from v_opp.sales_reference then
    return jsonb_build_object(
      'sales_reference', v_opp.sales_reference,
      'odoo_state', v_opp.sales_reference_odoo_state,
      'checked_at', v_opp.sales_reference_checked_at
    );
  end if;

  -- 2 + 3. Permission and lock.
  v_super := public.is_super_admin();
  v_lock := public.sor_sales_reference_lock(v_opp.id);
  if not public.sor_can_edit_opportunity(v_opp.id) then
    raise exception 'You do not have permission to change this SOR''s S0.' using errcode = '42501', hint = 'forbidden';
  end if;
  if v_lock = 'locked' then
    if not v_super then
      raise exception 'This S0 is locked. Only a Super Admin can change it.' using errcode = '42501', hint = 'locked';
    end if;
    if v_reason is null then
      raise exception 'Say why the locked S0 is being changed.' using errcode = '22023', hint = 'reason_required';
    end if;
  end if;

  -- 4. Duplicates: any other SOR that is not deleted (Lost included). No bypass.
  if v_new is not null then
    select o.id, o.project_title, o.client_name into v_other
      from public.sales_opportunities o
      where o.sales_reference = v_new
        and o.id <> v_opp.id
        and coalesce(o.is_deleted, false) = false
      order by o.created_at
      limit 1;
    if v_other.id is not null then
      raise exception '% is already on SOR "%" (%). One S0 per SOR.',
        v_new, v_other.project_title, v_other.client_name
        using errcode = '23505', hint = 'duplicate';
    end if;
  end if;

  -- 5. Odoo. Clearing needs no answer.
  if v_new is null then
    v_state := null;
    v_checked := null;
  elsif p_odoo = 'not_found' then
    raise exception 'Odoo has no %. Check the number.', v_new using errcode = '22023', hint = 'not_found';
  elsif p_odoo = 'found' then
    v_state := 'found';
    v_checked := now();
  else
    v_state := 'not_checked';
    v_checked := null;
  end if;

  v_event := case
    when v_lock = 'locked' then 'SALES_REFERENCE_OVERRIDDEN'
    when v_new is null then 'SALES_REFERENCE_CLEARED'
    when v_opp.sales_reference is null then 'SALES_REFERENCE_SET'
    else 'SALES_REFERENCE_CHANGED'
  end;

  perform set_config('app.sor_set_sales_reference', 'on', true);
  update public.sales_opportunities
     set sales_reference = v_new,
         sales_reference_odoo_state = v_state,
         sales_reference_checked_at = v_checked
   where id = v_opp.id;

  -- The Odoo lines, through the line-matching save (ADR 0041), when the edge function sent them.
  if p_items is not null then
    perform public.sor_replace_items(v_opp.id, p_items);
  end if;

  v_content := case v_event
    when 'SALES_REFERENCE_SET' then format('S0 set to %s', v_new)
    when 'SALES_REFERENCE_CLEARED' then format('S0 %s cleared', v_opp.sales_reference)
    when 'SALES_REFERENCE_OVERRIDDEN' then format('Locked S0 changed from %s to %s', v_opp.sales_reference, coalesce(v_new, '(none)'))
    else format('S0 changed from %s to %s', v_opp.sales_reference, v_new)
  end || coalesce(' — ' || v_reason, '');
  v_meta := jsonb_build_object(
    'event', v_event,
    'old', v_opp.sales_reference,
    'new', v_new,
    'reason', v_reason,
    'employeeId', v_actor
  );

  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (v_opp.id, v_actor, 'SYSTEM', v_content, v_meta);
  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (v_actor, 'OPPORTUNITY', v_opp.id::text, v_content, 'SYSTEM', v_meta);

  return jsonb_build_object('sales_reference', v_new, 'odoo_state', v_state, 'checked_at', v_checked);
end;
$$;

comment on function public.set_sales_reference(text, uuid, text, text, text, jsonb) is
  '#815 (ADR 0050): the only way the S0 changes after registration. Checks format, permission (editors; a locked S0 needs a Super Admin and a reason), the lock, duplicates (Lost counts, deleted does not, no bypass) and the Odoo fact (p_odoo found / not_found / unreachable) the edge function passes in; writes history. p_items, when sent, go through sor_replace_items. Service role only.';

revoke all on function public.set_sales_reference(text, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_sales_reference(text, uuid, text, text, text, jsonb) to service_role;

-- ------------------------------------------------------------------------------
-- What the S0 card shows
-- ------------------------------------------------------------------------------

create or replace function public.sales_reference_card(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_opp public.sales_opportunities;
  v_lock text;
  v_first text;
  v_can boolean;
begin
  if public.get_employee_id() is null or public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'You do not have access to this SOR.' using errcode = '42501';
  end if;
  select * into v_opp from public.sales_opportunities where id = p_opportunity_id;
  v_lock := public.sor_sales_reference_lock(p_opportunity_id);
  select stage_name into v_first from public._sor_first_stage(p_opportunity_id);
  if v_first is null then
    select c.label into v_first from public.crm_pipeline_stages c
      where coalesce(c.is_default, false) order by c.sort_order limit 1;
  end if;
  v_can := coalesce(v_opp.is_deleted, false) = false
    and public.sor_can_edit_opportunity(p_opportunity_id)
    and (v_lock <> 'locked' or public.is_super_admin());

  return jsonb_build_object(
    'sales_reference', v_opp.sales_reference,
    'lock', v_lock,
    'first_stage_name', v_first,
    'can_edit', v_can,
    'odoo_state', v_opp.sales_reference_odoo_state,
    'checked_at', v_opp.sales_reference_checked_at,
    'product_count', (
      select count(*)::int from public.sales_opportunity_items i
      where i.opportunity_id = p_opportunity_id
        and coalesce(i.removed_from_s0, false) = false
        and i.odoo_line_id is not null
    ),
    'duplicates', '[]'::jsonb
  );
end;
$$;

comment on function public.sales_reference_card(uuid) is
  '#815: what the S0 card shows: the S0, its lock (open / fill_once / locked), the first Stage''s name, whether the caller may change it now, the Odoo state, last read, and the count of products that came from Odoo. #819 adds duplicates.';

revoke all on function public.sales_reference_card(uuid) from public, anon;
grant execute on function public.sales_reference_card(uuid) to authenticated, service_role;
