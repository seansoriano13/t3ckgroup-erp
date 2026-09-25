-- allow-out-of-order: prod hotfix (2026-09-23) already recorded under this name in prod's ledger; renaming would orphan it there (#325).
-- ==============================================================================
-- 20260929040000_sor_replace_items_returns_previous.sql
--
-- Fallout from 20260929030000: opening an SOR now correctly stops doubling
-- expected_value, but the timeline logs "Added product(s): <the whole list>"
-- on every single open for some employees, forever -- never "Modified" or
-- "no change" even when nothing actually changed. Reproduced live: a Super
-- Admin never sees it; an ordinary employee always does.
--
-- Cause: opportunityService.updateOpportunity builds its "before" snapshot of
-- the Product List with a plain `select * from sales_opportunity_items`,
-- which is gated by RLS policy sor_items_read -- is_super_admin() OR
-- (sor_is_deal_team() OR sor_always_sees()) OR is_hr(). sor_can_edit_opportunity,
-- the check sor_replace_items itself uses to authorize the *write*, is a
-- different, broader set: the deal-team columns OR is_head OR is_super_admin.
-- An employee who can edit only via is_head (a department head who isn't
-- personally on this deal's team, and isn't covered by any flow's
-- always_sees rule) satisfies the write check but not the read policy, so
-- their "before" select silently returns zero rows -- not an error, RLS just
-- filters everything out. Every product then looks newly "added", every
-- time, because the diff is comparing the fresh Odoo pull against nothing.
--
-- Fix: sor_replace_items now returns the rows it is about to delete, read
-- from inside the same SECURITY DEFINER call that already bypasses RLS to
-- perform the write -- so the caller's "before" snapshot for the diff no
-- longer depends on whether they can read the table directly, and is
-- captured atomically in the same locked transaction as the write itself
-- rather than a separate, timing-dependent round trip.
-- ==============================================================================

drop function if exists public.sor_replace_items(uuid, jsonb);

create function public.sor_replace_items(
  p_opportunity_id uuid,
  p_items jsonb
)
returns setof sales_opportunity_items
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_employee_id() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- Serializes concurrent replaces of the same opportunity's Product List
  -- (see 20260929030000). Locked before the authorization check so a caller
  -- who fails it still releases the lock immediately (the transaction ends).
  perform 1 from public.sales_opportunities where id = p_opportunity_id for update;

  if not public.sor_can_edit_opportunity(p_opportunity_id) then
    raise exception 'You cannot edit this opportunity''s Product List.' using errcode = '42501';
  end if;

  -- The "before" snapshot, handed back to the caller for its own change log
  -- -- captured here, bypassing RLS, rather than left to a separate
  -- SELECT the caller might not have visibility to run.
  return query
    select * from public.sales_opportunity_items where opportunity_id = p_opportunity_id;

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

  return;
end;
$$;

grant execute on function public.sor_replace_items(uuid, jsonb) to authenticated;
