-- ==============================================================================
-- #310: the SOR reads its Purchase Request
--
-- `sor_purchase_request_overview(p_opportunity_id)` gives the SOR modal what it
-- shows of the SOR's Purchase Request: the Buyer and each Requested Item
-- (name, product, quantity, unit, status, when raised). The Now card, the Items
-- tab statuses and the Journey all read it.
--
-- SECURITY DEFINER because a member who is not on the deal cannot read the
-- request's rows through the SOR, and because the SOR's own readers must not
-- see a request they were left out of: the gate is `can_read_purchase_request`
-- (member, Super Admin, or Purchasing access on an unassigned request), nothing
-- else. No readable request -> zero rows (the SOR then shows none of it).
--
-- SAFE TO RUN AT ANY TIME: one new function; nothing existing is redefined.
-- ==============================================================================

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
        'quantity', it.quantity,
        'unit', it.unit,
        'status', it.status,
        'source', it.source,
        'created_at', it.created_at
      ) order by it.created_at, it.id)
      from public.purchase_request_items it
      where it.request_id = r.id
    ), '[]'::jsonb)
  from public.purchase_requests r
  left join public.employees b on b.id = r.buyer_id
  where r.opportunity_id = p_opportunity_id
    and public.can_read_purchase_request(r.id);
$function$;

comment on function public.sor_purchase_request_overview(uuid) is
  '#310: the SOR''s Purchase Request as the SOR modal shows it (Buyer + Requested Items), for anyone who can read the request. No readable request -> no rows.';

revoke all on function public.sor_purchase_request_overview(uuid) from public, anon;
grant execute on function public.sor_purchase_request_overview(uuid) to authenticated;
