-- #747: the SOR modal's Product List shows each bought line's P0, linked to Odoo (ADR 0044).
-- The overview's items now carry po_number, po_state and the Odoo order id (from the IPAS
-- for that P0, when one exists). No cost or price.
create or replace function public.sor_purchase_request_overview(p_opportunity_id uuid)
returns table (
  request_id uuid,
  buyer_id uuid,
  buyer_name text,
  buyer_avatar_path text,
  opened_visit_id uuid,
  created_at timestamptz,
  items jsonb
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    r.id,
    r.buyer_id,
    b.name,
    b.avatar_path,
    r.opened_visit_id,
    r.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', it.id,
        'name', it.name,
        'odoo_product_id', it.odoo_product_id,
        'sor_item_id', it.sor_item_id,
        'quantity', it.quantity,
        'unit', it.unit,
        'status', it.status,
        'source', it.source,
        'created_at', it.created_at,
        'po_number', it.po_number,
        'po_state', it.po_state,
        'odoo_po_id', (
          select i.odoo_po_id from public.ipas i
          where i.po_number = it.po_number and i.odoo_po_id is not null
          order by i.created_at desc limit 1
        )
      ) order by it.created_at, it.id)
      from public.purchase_request_items it
      where it.request_id = r.id
    ), '[]'::jsonb)
  from public.purchase_requests r
  left join public.employees b on b.id = r.buyer_id
  where r.opportunity_id = p_opportunity_id
    and public.can_read_purchase_request(r.id);
$function$;
