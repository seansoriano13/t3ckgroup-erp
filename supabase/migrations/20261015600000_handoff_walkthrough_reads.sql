-- Walkthrough fixes for spec #251 (Packing Lists and the SOR summary).
--
-- 1. The Warehouse list starts Packing Lists (#255) but its SOR picker called
--    ipas_find_sors, which only Purchasing may call, so a Warehouse member
--    found no SOR at all. The function returns reference, project title and
--    stage only, so the Warehouse list may call it too.
-- 2. A packer picks box contents from the SOR's Product List, but
--    sales_opportunity_items is read by the deal team only. A narrow reader
--    hands Purchasing and the Warehouse list each line's name, quantity and
--    unit; never prices.
-- 3. handoffs_for_sor listed draft Transmittals to the SOR's readers. A draft
--    isn't a slip yet; only submitted ones are listed.

CREATE OR REPLACE FUNCTION public.ipas_find_sors(p_refs text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text)
 RETURNS TABLE(opportunity_id uuid, sales_reference text, project_title text, current_stage_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_refs text[];
  v_term text := lower(nullif(btrim(p_search), ''));
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_find_sors: not signed in' using errcode = '42501';
  end if;
  if not (coalesce(public.has_purchasing_access(), false) or public.transmittal_on_list('transmittal_warehouse')) then
    raise exception 'ipas_find_sors: only Purchasing or the Warehouse list looks up SORs' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct upper(btrim(r))), '{}'::text[]) into v_refs
    from unnest(coalesce(p_refs, '{}'::text[])) r;

  return query
    select o.id, o.sales_reference, o.project_title, fs.name
      from public.sales_opportunities o
      left join public.flow_stages fs on fs.id = o.flow_stage_id
     where not coalesce(o.is_deleted, false)
       and not coalesce(o.is_scratch, false)
       and o.sales_reference is not null
       and (
         o.sales_reference = any (v_refs)
         or (
           v_term is not null
           and (
             position(v_term in lower(o.sales_reference)) > 0
             or position(v_term in lower(o.project_title)) > 0
           )
         )
       )
     order by o.sales_reference desc
     limit 25;
end;
$function$
;

create or replace function public.packing_list_sor_products(p_opportunity_id uuid)
returns table (id uuid, product_name text, quantity numeric, unit text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.get_employee_id() is null then
    raise exception 'packing_list_sor_products: not signed in' using errcode = '42501';
  end if;
  if not (coalesce(public.has_purchasing_access(), false) or public.transmittal_on_list('transmittal_warehouse')) then
    raise exception 'packing_list_sor_products: only Purchasing or the Warehouse list packs an SOR' using errcode = '42501';
  end if;
  return query
    select i.id, i.product_name, i.quantity, i.unit
      from public.sales_opportunity_items i
     where i.opportunity_id = p_opportunity_id
     order by i.sort_order, i.created_at;
end;
$$;

comment on function public.packing_list_sor_products(uuid) is
  '#255: an SOR''s Product List lines (name, quantity, unit; no prices) for a Packing List''s box contents. Purchasing or the Warehouse list.';

revoke all on function public.packing_list_sor_products(uuid) from public, anon;
grant execute on function public.packing_list_sor_products(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.handoffs_for_sor(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_sor public.sales_opportunities;
  v_transmittals jsonb := '[]'::jsonb;
  v_packing_lists jsonb := '[]'::jsonb;
begin
  select * into v_sor from public.sales_opportunities o where o.id = p_opportunity_id;
  -- coalesce: an SOR with an empty deal-team column makes sor_is_deal_team NULL,
  -- and `not NULL` would skip this refusal and leak the handoffs to a non-reader.
  if not found or not coalesce(
    public.is_super_admin()
    or public.sor_is_deal_team(v_sor, v_actor)
    or public.sor_always_sees(v_sor, v_actor),
    false
  ) then
    return jsonb_build_object('transmittals', v_transmittals, 'packing_lists', v_packing_lists);
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.prepared_on desc, t.number desc), '[]'::jsonb)
    into v_transmittals
    from (
      select tr.id,
             tr.number,
             tr.prepared_on,
             tr.priority,
             tr.state,
             (select count(*)::int
                from public.transmittal_lines l
               where l.transmittal_id = tr.id
                 and (l.wh_rating = 'na' or l.tech_rating = 'na')) as na_count,
             public.transmittal_can_read(tr.id) as can_open
        from public.transmittals tr
       where tr.state <> 'draft'
         and exists (
         select 1 from public.transmittal_lines l
          where l.transmittal_id = tr.id and l.opportunity_id = p_opportunity_id
       )
    ) t;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.number desc), '[]'::jsonb)
    into v_packing_lists
    from (
      select pl.id,
             pl.number,
             pl.state,
             (select count(*)::int from public.packing_list_boxes b where b.packing_list_id = pl.id) as box_count,
             pl.odoo_delivery_ref,
             public.packing_list_can_read(pl.id) as can_open
        from public.packing_lists pl
       where pl.opportunity_id = p_opportunity_id
    ) p;

  return jsonb_build_object('transmittals', v_transmittals, 'packing_lists', v_packing_lists);
end;
$function$
;
