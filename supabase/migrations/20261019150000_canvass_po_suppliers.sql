-- ==============================================================================
-- #281 (spec #275): who a Component's PO is with
--
-- canvass_po_suppliers(p_opportunity_id) gives, for each Component on the SOR whose
-- P.O./RFQ No. names a live IPAS, the PO number and the supplier read from that IPAS's
-- stored Odoo copy (id and name). The Costing Matrix compares it with the winning Offer's
-- supplier and says so on the row when they differ. It carries no money, so any reader of
-- the matrix gets it.
--
-- SECURITY DEFINER because `ipas` is behind ipas_can_read(), which refuses the Deal Team.
-- The gate is costing_can_read(opp), the matrix's own read rule; no tier, no rows. A
-- cancelled IPAS is ignored. The Component's number is matched as the IPAS PO number
-- (upper-cased, trimmed), one live IPAS per PO.
--
-- SAFE TO RUN AT ANY TIME: one new function; nothing existing is redefined.
-- ==============================================================================

create or replace function public.canvass_po_suppliers(p_opportunity_id uuid)
returns table (
  component_id uuid,
  po_number text,
  supplier_id text,
  supplier_name text
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    c.id,
    i.po_number,
    nullif(btrim(i.odoo_copy #>> '{supplier,id}'), ''),
    nullif(btrim(i.odoo_copy #>> '{supplier,name}'), '')
  from public.costing_matrices m
  join public.costing_tender_lines l on l.matrix_id = m.id
  join public.costing_components c on c.tender_line_id = l.id
  join public.ipas i on i.po_number = upper(btrim(c.po_rfq_no)) and i.state <> 'cancelled'
  where m.opportunity_id = p_opportunity_id
    and public.costing_can_read(p_opportunity_id)
    and c.po_rfq_no is not null
$function$;

revoke all on function public.canvass_po_suppliers(uuid) from public, anon;
grant execute on function public.canvass_po_suppliers(uuid) to authenticated;
