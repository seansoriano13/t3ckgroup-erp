-- ==============================================================================
-- 20261013100200_ipas_po_line_ids.sql
--
-- Issue #242 (IPAS, spec #241) — the #312 seam gets its body.
--
-- `_ipas_po_line_ids(p_po_number)` is what `purchase_request_item_po_lines` and
-- `purchase_request_pick_po_lines` ask for "the Odoo PO line ids on the IPAS
-- stored Odoo copy of this PO". It answered '{}' until an IPAS existed
-- (20261005130800_purchase_request_item_po.sql, "When IPAS lands, replace its
-- body — nothing else changes"). It now reads the live IPAS's `odoo_copy`:
--
--   * live = not cancelled (open or filed); a cancelled IPAS no longer stands
--     for the PO, and at most one live IPAS exists per PO;
--   * a PO with no IPAS still answers '{}', so nothing about picking changes
--     for it: every pick is refused and the picker stays hidden.
--
-- Signature, volatility and grants are unchanged. It is security definer so it
-- reads `ipas` whatever RLS says about the caller: the callers are themselves
-- security definer, and a Requested Item's member must be able to pick a PO line
-- without being able to read the IPAS.
--
-- SAFE TO RUN AT ANY TIME: one `create or replace` of an internal function.
-- Idempotent.
-- ==============================================================================

create or replace function public._ipas_po_line_ids(p_po_number text)
returns int[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select array_agg(distinct (l.line->>'line_id')::int order by (l.line->>'line_id')::int)
    from public.ipas i
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(i.odoo_copy->'lines') = 'array' then i.odoo_copy->'lines' else '[]'::jsonb end
    ) as l(line)
    where i.po_number = upper(btrim(p_po_number))
      and i.state <> 'cancelled'
      and (l.line->>'line_id') ~ '^[0-9]+$'
  ), '{}'::int[]);
$$;

comment on function public._ipas_po_line_ids(text) is
  '#312 seam, filled by #242: the Odoo purchase.order.line ids on the live (not cancelled) IPAS stored Odoo copy of PO `p_po_number`. Empty while the PO has no live IPAS, so no PO line can be picked yet.';

revoke all on function public._ipas_po_line_ids(text) from public, anon, authenticated;
