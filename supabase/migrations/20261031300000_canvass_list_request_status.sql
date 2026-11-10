-- The Canvasses page and the Canvass panel say whether a Purchase Request was made from a Canvass,
-- and what became of it: "PR-12 · Cancelled". The list already returns the request's id and label;
-- this adds the status of the Requested Item the Canvass points at (request_item_status).
-- Same rows, same read rule (canvass_can_read) and order as before; one column added, right after
-- the request columns (after request_label), so the return type changes and the function is dropped
-- and made again.

drop function if exists public.canvass_list();

create function public.canvass_list()
returns table (
  id uuid,
  number text,
  kind text,
  product_name text,
  subject_name text,
  component_id uuid,
  component_number text,
  requested_item_id uuid,
  request_id uuid,
  request_label text,
  request_item_status text,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  canvasser_id uuid,
  canvasser_name text,
  offer_count integer,
  winner_offer_id uuid,
  winner_supplier text,
  winner_brand text,
  signed_off_at timestamptz,
  signer_name text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         c.number,
         case when c.component_id is not null then 'component'
              when c.requested_item_id is not null then 'requested_item'
              else 'none' end,
         c.product_name,
         coalesce(comp.name, item.name, c.product_name),
         c.component_id,
         case when comp.id is not null then
           (select count(*) from public.costing_tender_lines t2
             where t2.matrix_id = t.matrix_id and t2.position <= t.position)::text
           || '.' ||
           (select count(*) from public.costing_components c2
             where c2.tender_line_id = comp.tender_line_id and c2.position <= comp.position)::text
         end,
         c.requested_item_id,
         req.id,
         case when req.id is not null then public._purchase_request_label(req.id) end,
         item.status,
         opp.id,
         opp.sales_reference,
         opp.project_title,
         coalesce(c.canvasser_id, comp.purchasing_incharge_id, m.purchasing_incharge_id, req.buyer_id),
         canvasser.name,
         (select count(*)::integer from public.sor_canvass_offers o where o.canvass_id = c.id),
         w.id,
         w.supplier_name,
         w.brand,
         c.signed_off_at,
         signer.name,
         c.created_by,
         c.created_at,
         c.updated_at
    from public.sor_canvasses c
    left join public.costing_components comp on comp.id = c.component_id
    left join public.costing_tender_lines t on t.id = comp.tender_line_id
    left join public.costing_matrices m on m.id = t.matrix_id
    left join public.purchase_request_items item on item.id = c.requested_item_id
    left join public.purchase_requests req on req.id = item.request_id
    left join public.sales_opportunities opp on opp.id = coalesce(m.opportunity_id, req.opportunity_id)
    left join public.sor_canvass_offers w on w.canvass_id = c.id and w.is_winner
    left join public.employees canvasser
      on canvasser.id = coalesce(c.canvasser_id, comp.purchasing_incharge_id, m.purchasing_incharge_id, req.buyer_id)
    left join public.employees signer on signer.id = c.signed_off_by
   where public.canvass_can_read(c.id)
   order by c.created_at desc, c.id
$$;

revoke all on function public.canvass_list() from public, anon;
grant execute on function public.canvass_list() to authenticated;
