-- Transmittal reads for every slip reader, and the SOR's IPAS summary reading
-- the slips (spec #251, walkthrough fixes).
--
-- A slip's PO lines point at an IPAS and an SOR. Warehouse and Technical read
-- the slip but not the IPAS, and Purchasing reads the IPAS but not every SOR,
-- so the embedded reads came back empty: the PO column said "Typed" and the
-- Project (S.O) column was blank. This function hands back only the reference
-- text a slip prints (IPAS number, PO number, SOR reference and project
-- title) to anyone who may read the slip. No prices, supplier or SOR details.

create or replace function public.transmittal_line_refs(p_transmittal_id uuid)
returns table (
  line_id       uuid,
  ipas_number   text,
  po_number     text,
  sor_id        uuid,
  sor_reference text,
  sor_project   text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'transmittal_line_refs: not signed in' using errcode = '42501';
  end if;
  if not public.transmittal_can_read(p_transmittal_id) then
    return;
  end if;

  return query
    select l.id, i.number, i.po_number, o.id, o.sales_reference, o.project_title
      from public.transmittal_lines l
      left join public.ipas i on i.id = l.ipas_id
      left join public.sales_opportunities o on o.id = l.opportunity_id
     where l.transmittal_id = p_transmittal_id
     order by l.position;
end;
$$;

comment on function public.transmittal_line_refs(uuid) is
  '#251: each line''s IPAS number, PO number and SOR reference, for anyone who may read the slip.';

revoke all on function public.transmittal_line_refs(uuid) from public, anon;
grant execute on function public.transmittal_line_refs(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- The SOR's IPAS summary (#249) ticks Delivered and Actual Checking from the
-- TG03 slips too, as the IPAS page does (#256). Same signature; the body adds
-- the `tg` lateral. Still ticks only: no slip numbers, ratings or names.
-- ------------------------------------------------------------------------------

create or replace function public.ipas_summaries_for_sor(p_opportunity_id uuid)
returns table (
  ipas_id uuid,
  number text,
  po_number text,
  supplier text,
  purpose text,
  state text,
  buyer_track jsonb,
  computation_status text,
  signoffs jsonb
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
      '7', jsonb_build_object(
        'received', '7:received' = any (lv.live),
        'noted', '7:noted' = any (lv.live),
        'checked', '7:checked' = any (lv.live),
        'approved', '7:approved' = any (lv.live)
      )
    )
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
    -- #256: the submitted, uncancelled TG03 slips carrying this IPAS's lines.
    -- Delivered once any slip's first stage is signed; Actual Checking once
    -- every slip's checking stage is.
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
  '#249, #256: the Project IPAS naming an SOR, as a summary (number, PO, supplier, Purpose, state, buyer track ticks with Delivered and Actual Checking also from TG03 slips, computation status, sign-off progress) for anyone who can read the SOR. Never payments, charges, bank details or Landed Cost. No SOR access -> no rows.';

revoke all on function public.ipas_summaries_for_sor(uuid) from public, anon;
grant execute on function public.ipas_summaries_for_sor(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- A Packing List's SOR reference for anyone who may read the list (#255). The
-- list is readable to the Warehouse and Purchasing even when the SOR isn't, so
-- the embedded SOR read came back empty and the header named no SOR.
-- ------------------------------------------------------------------------------

create or replace function public.packing_list_sor_refs(p_packing_list_ids uuid[])
returns table (
  packing_list_id uuid,
  sor_id          uuid,
  sor_reference   text,
  sor_project     text,
  client_name     text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'packing_list_sor_refs: not signed in' using errcode = '42501';
  end if;

  return query
    select p.id, o.id, o.sales_reference, o.project_title, o.client_name
      from public.packing_lists p
      join public.sales_opportunities o on o.id = p.opportunity_id
     where p.id = any (coalesce(p_packing_list_ids, '{}'::uuid[]))
       and public.packing_list_can_read(p.id);
end;
$$;

comment on function public.packing_list_sor_refs(uuid[]) is
  '#255: each readable Packing List''s SOR reference, project title and customer, for anyone who may read the list.';

revoke all on function public.packing_list_sor_refs(uuid[]) from public, anon;
grant execute on function public.packing_list_sor_refs(uuid[]) to authenticated;
