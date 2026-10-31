-- #818 (spec #800, ADR 0050) — What changing or clearing the S0 would do, before it is saved.
--
-- Read-only. Given the Odoo line ids of the S0 being switched to (null or empty when the S0 is being
-- cleared), it counts what the save would do: the SOR's current products that came from Odoo and are
-- not on the new S0 (they become "Removed from S0", as sor_replace_items does), and the Requested
-- Items and Tender Lines that sit on those products (they stay on them). Changes nothing.

create or replace function public.sales_reference_change_preview(
  p_opportunity_id uuid,
  p_new_odoo_line_ids text[] default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if public.get_employee_id() is null or public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'You do not have access to this SOR.' using errcode = '42501';
  end if;

  select coalesce(array_agg(i.id), '{}') into v_ids
    from public.sales_opportunity_items i
    where i.opportunity_id = p_opportunity_id
      and coalesce(i.removed_from_s0, false) = false
      and i.odoo_line_id is not null
      and i.odoo_line_id::text <> all (coalesce(p_new_odoo_line_ids, '{}'::text[]));

  return jsonb_build_object(
    'removed_products', coalesce(array_length(v_ids, 1), 0),
    'requested_items', (
      select count(*)::int
      from public.purchase_request_items pri
      join public.purchase_requests pr on pr.id = pri.request_id
      where pr.opportunity_id = p_opportunity_id
        and pri.sor_item_id = any (v_ids)
    ),
    'tender_lines', (
      select count(*)::int
      from public.costing_tender_lines tl
      join public.costing_matrices m on m.id = tl.matrix_id
      where m.opportunity_id = p_opportunity_id
        and tl.sor_item_id = any (v_ids)
    )
  );
end;
$$;

comment on function public.sales_reference_change_preview(uuid, text[]) is
  '#818: read-only. How many of the SOR''s Odoo products would be marked Removed from S0 if its S0 became the one with these Odoo line ids (empty or null = cleared), and how many Requested Items and Tender Lines sit on them. Returns { removed_products, requested_items, tender_lines }.';

revoke all on function public.sales_reference_change_preview(uuid, text[]) from public, anon;
grant execute on function public.sales_reference_change_preview(uuid, text[]) to authenticated, service_role;
