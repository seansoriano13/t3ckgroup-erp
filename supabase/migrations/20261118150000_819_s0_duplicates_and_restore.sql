-- #819 (spec #800, ADR 0050) — Existing duplicate S0s show on the card, and a deleted SOR cannot be
-- restored onto an S0 another SOR now uses.
--
-- 1. sales_reference_card now lists `duplicates`: the other SORs (not deleted, Lost included) with
--    the same S0, as {id, name}. The name is built the way set_sales_reference's duplicate refusal
--    names a SOR: project title, then the client in brackets.
-- 2. restore_opportunity(p_opportunity_id) replaces the browser's own restore: same permission as
--    before (Super Admin or the SOR's Deal Owner), plus the duplicate check, then the same restore
--    and the same OPPORTUNITY_RESTORED history.
--
-- No existing data is changed: duplicates already in the table are left alone and only shown.

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
    'duplicates', case
      when nullif(btrim(coalesce(v_opp.sales_reference, '')), '') is null then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', o.id,
                 'name', coalesce(o.project_title, '') || ' (' || coalesce(o.client_name, '') || ')'
               ) order by o.created_at)
        from public.sales_opportunities o
        where o.sales_reference = v_opp.sales_reference
          and o.id <> v_opp.id
          and coalesce(o.is_deleted, false) = false
      ), '[]'::jsonb)
    end
  );
end;
$$;

comment on function public.sales_reference_card(uuid) is
  '#815/#819: what the S0 card shows: the S0, its lock (open / fill_once / locked), the first Stage''s name, whether the caller may change it now, the Odoo state, last read, the count of products that came from Odoo, and duplicates: the other SORs (not deleted) on the same S0 as {id, name}.';

revoke all on function public.sales_reference_card(uuid) from public, anon;
grant execute on function public.sales_reference_card(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------------------
-- Restore a deleted SOR
-- ------------------------------------------------------------------------------

create or replace function public.restore_opportunity(p_opportunity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_opp public.sales_opportunities;
  v_other record;
  v_content text;
  v_meta jsonb;
begin
  if v_actor is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;

  select * into v_opp from public.sales_opportunities where id = p_opportunity_id for update;
  if v_opp.id is null then
    raise exception 'That SOR could not be found.' using errcode = 'P0002', hint = 'not_found_sor';
  end if;

  if not (public.is_super_admin() or v_opp.deal_owner_id = v_actor) then
    raise exception 'Only a Super Admin or this SOR''s Deal Owner can restore it.'
      using errcode = '42501', hint = 'forbidden';
  end if;

  -- One S0 per SOR: refuse when another SOR that is not deleted has taken this S0.
  if nullif(btrim(coalesce(v_opp.sales_reference, '')), '') is not null then
    select o.id, o.project_title, o.client_name into v_other
      from public.sales_opportunities o
      where o.sales_reference = v_opp.sales_reference
        and o.id <> v_opp.id
        and coalesce(o.is_deleted, false) = false
      order by o.created_at
      limit 1;
    if v_other.id is not null then
      raise exception '% is now on SOR "%" (%). One S0 per SOR; change one before restoring.',
        v_opp.sales_reference, v_other.project_title, v_other.client_name
        using errcode = '23505', hint = 'duplicate';
    end if;
  end if;

  update public.sales_opportunities
     set is_deleted = false, deleted_at = null, deleted_by = null
   where id = v_opp.id
   returning * into v_opp;

  v_content := 'SOR restored from Deleted.';
  v_meta := jsonb_build_object('event', 'OPPORTUNITY_RESTORED', 'employeeId', v_actor);

  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (v_opp.id, v_actor, 'SYSTEM', v_content, v_meta);
  insert into public.system_audit_logs (author_id, entity_type, entity_id, content, type, metadata)
  values (
    v_actor, 'OPPORTUNITY', v_opp.id::text,
    case when nullif(btrim(coalesce(v_opp.sales_reference, '')), '') is not null
      then 'Sales opportunity ' || v_opp.sales_reference
      else 'Sales opportunity for ' || v_opp.client_name end || ' restored.',
    'SYSTEM', v_meta
  );

  return to_jsonb(v_opp);
end;
$$;

comment on function public.restore_opportunity(uuid) is
  '#819 (ADR 0050): restores a deleted SOR. A Super Admin or the SOR''s Deal Owner only. Refused (hint duplicate, naming the other SOR) when another SOR that is not deleted now uses its S0. Writes the OPPORTUNITY_RESTORED note and audit entry.';

revoke all on function public.restore_opportunity(uuid) from public, anon;
grant execute on function public.restore_opportunity(uuid) to authenticated, service_role;
