-- ==============================================================================
-- 20260929030000_atomic_sor_items_replace.sql
--
-- SOR S07229's Product List doubled in place on 2026-09-23 with no data
-- change in Odoo behind it. Cause: opening an SOR with a Sales Reference
-- auto-syncs its lines from Odoo every time (SorModal.jsx, issue #53), and
-- opportunityService.replaceItems did the replace as two separate,
-- unsynchronized round trips -- DELETE all items, then INSERT the freshly
-- pulled lines -- with nothing locking the row in between. Two overlapping
-- opens (two tabs, or two people both checking a large active deal) could
-- interleave as delete_A, delete_B (no-op, already empty), insert_A,
-- insert_B: both inserts land, so the item rows -- and therefore
-- sor_recalc_expected_value's SUM(quantity*unit_price) -- exactly double.
-- A later single reopen does one clean delete+insert and self-heals it,
-- which is why the record "went back to normal" the moment it was checked.
--
-- Fix, same shape as 20260909080000_retail_queue_atomic_approve.sql: move
-- the whole replace into one SECURITY DEFINER function and take `FOR UPDATE`
-- on the parent sales_opportunities row first, so a second concurrent call
-- blocks until the first one's delete+insert has committed, then correctly
-- deletes what the first call just inserted before adding its own rows --
-- serialized, not interleaved.
-- ==============================================================================

create or replace function public.sor_replace_items(
  p_opportunity_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_employee_id() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- Serializes concurrent replaces of the same opportunity's Product List --
  -- see header. Locked before the authorization check so a caller who fails
  -- it still releases the lock immediately (the transaction ends).
  perform 1 from public.sales_opportunities where id = p_opportunity_id for update;

  if not public.sor_can_edit_opportunity(p_opportunity_id) then
    raise exception 'You cannot edit this opportunity''s Product List.' using errcode = '42501';
  end if;

  delete from public.sales_opportunity_items where opportunity_id = p_opportunity_id;

  insert into public.sales_opportunity_items (
    opportunity_id, product_name, unit, quantity, unit_price, sort_order, odoo_product_id
  )
  select
    p_opportunity_id,
    trim(item ->> 'product_name'),
    nullif(trim(item ->> 'unit'), ''),
    coalesce((item ->> 'quantity')::numeric, 0),
    coalesce((item ->> 'unit_price')::numeric, 0),
    (ordinality - 1)::int,
    nullif(item ->> 'odoo_product_id', '')::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(item, ordinality)
  where nullif(trim(item ->> 'product_name'), '') is not null;
end;
$$;

grant execute on function public.sor_replace_items(uuid, jsonb) to authenticated;
