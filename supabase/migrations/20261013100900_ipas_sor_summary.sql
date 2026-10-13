-- ==============================================================================
-- #249: the SOR reads its IPAS summary
--
-- `ipas_summaries_for_sor(p_opportunity_id)` gives whoever can read an SOR a
-- summary of each Project IPAS naming it: number, PO, supplier, Purpose, state,
-- the buyer track, computation status and sign-off progress. It never carries
-- payments, charges, bank details or Landed Cost, so a Deal Team member with no
-- Purchasing or Finance access gets a summary without being able to read any
-- of the IPAS's money (`ipas`, `ipas_payments`, `ipas_charges` and
-- `ipas_bank_details` stay behind `ipas_can_read()`).
--
-- SECURITY DEFINER because the reader is, by design, someone `ipas_can_read()`
-- refuses. The gate is the SOR read rule in force: `sor_access_level(...) =
-- 'full'`, the same one the SOR itself uses, so the summary narrows by itself
-- when stage-scoped visibility (#208) lands. No access -> zero rows.
--
-- Only a Project IPAS names an SOR (the deferred SOR rule on `ipas_sors`), and
-- the function asks for `purpose = 'project'` as well, so an Inventory, Supplies
-- or Events IPAS never appears on any SOR whatever the rows say. An IPAS naming
-- two SORs appears on both: the match is one `ipas_sors` row per SOR.
--
-- The buyer track is derived here from the same inputs the page derives it
-- from (the stored Odoo copy, the typed dates, the Actual Checking stamp and
-- whether any payment carries proof). It is returned as ticks only: key,
-- ticked, partial. The proof test reads `ipas_payments.proof_url` but returns
-- a boolean, never the link or an amount.
--
-- The sign-off progress is `{ "1": {prepared, approved}, "3": {prepared,
-- approved}, "7": {received, noted, checked, approved} }`, each true while a
-- live (uncleared) sign-off exists. Names, signatures and dates stay on the
-- full IPAS.
--
-- SAFE TO RUN AT ANY TIME: one new function; nothing existing is redefined.
-- ==============================================================================

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
        jsonb_build_object('key', 'delivered', 'ticked', i.delivered_on is not null, 'partial', false),
        jsonb_build_object('key', 'received_in_odoo', 'ticked', rs.received_state = 'received', 'partial', rs.received_state = 'partial'),
        jsonb_build_object('key', 'create_bill', 'ticked', o.bill_count > 0, 'partial', false),
        jsonb_build_object('key', 'actual_checking', 'ticked', i.actual_checking_by is not null, 'partial', false)
      )
      else jsonb_build_array(
        jsonb_build_object('key', 'purchase_order', 'ticked', coalesce(o.po_state in ('purchase', 'done'), false), 'partial', false),
        jsonb_build_object('key', 'with_pop', 'ticked', pop.has_proof, 'partial', false),
        jsonb_build_object('key', 'delivered', 'ticked', i.delivered_on is not null, 'partial', false),
        jsonb_build_object('key', 'received_in_odoo', 'ticked', rs.received_state = 'received', 'partial', rs.received_state = 'partial'),
        jsonb_build_object('key', 'create_bill', 'ticked', o.bill_count > 0, 'partial', false),
        jsonb_build_object('key', 'actual_checking', 'ticked', i.actual_checking_by is not null, 'partial', false)
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
  '#249: the Project IPAS naming an SOR, as a summary (number, PO, supplier, Purpose, state, buyer track ticks, computation status, sign-off progress) for anyone who can read the SOR (sor_access_level = full). Never payments, charges, bank details or Landed Cost. No SOR access -> no rows.';

revoke all on function public.ipas_summaries_for_sor(uuid) from public, anon;
grant execute on function public.ipas_summaries_for_sor(uuid) to authenticated;
