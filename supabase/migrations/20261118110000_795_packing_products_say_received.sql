-- #795 (A24): a Packing List box can only hold what has arrived. The picker needs to know,
-- per SOR line, whether a purchase request item for it is Received. The Warehouse cannot read
-- purchase_request_items directly, so this security-definer read says it. Nothing is written.

drop function if exists public.packing_list_sor_products(uuid);

create function public.packing_list_sor_products(p_opportunity_id uuid)
returns table (id uuid, product_name text, quantity numeric, unit text, received boolean)
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
    select i.id, i.product_name, i.quantity, i.unit,
           exists (
             select 1 from public.purchase_request_items r
              where r.sor_item_id = i.id and r.status = 'received'
           ) as received
      from public.sales_opportunity_items i
     where i.opportunity_id = p_opportunity_id
     order by i.sort_order, i.created_at;
end;
$$;

comment on function public.packing_list_sor_products(uuid) is
  '#255/#795: an SOR''s Product List lines (name, quantity, unit, received; no prices) for a Packing List''s box contents. Purchasing or the Warehouse list.';

revoke all on function public.packing_list_sor_products(uuid) from public, anon;
grant execute on function public.packing_list_sor_products(uuid) to authenticated;
