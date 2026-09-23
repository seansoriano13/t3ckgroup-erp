-- ==============================================================================
-- 20260929050000_sor_items_read_matches_edit.sql
--
-- Second piece of fallout from 20260929030000/20260929040000: even with the
-- "before" snapshot fixed to bypass RLS (via sor_replace_items' return
-- value), the Product List itself still doesn't render for some employees —
-- confirmed live: a Super Admin opening an SOR sees its items fine, an
-- ordinary employee opens the exact same SOR and sees an empty list, even
-- though the rows are actually there (the write succeeded; the read just
-- comes back empty for them).
--
-- Cause is the same shape as before, just hitting the *display* path this
-- time instead of the diff log: ItemsTab (and everything else that renders
-- the Product List) reads sales_opportunity_items with a plain select,
-- gated by RLS policy sor_items_read -- is_super_admin() OR (sor_is_deal_team()
-- OR sor_always_sees()) OR is_hr(). sor_can_edit_opportunity -- what
-- sor_replace_items itself checks to authorize the *write* -- is a
-- different, broader set: deal team, or is_head, or super admin. An
-- employee who can edit only via is_head (a department head not personally
-- on this deal's team) passes the write check but the read policy silently
-- filters every row for them -- not an error, just zero rows -- so the list
-- renders empty no matter how many products are actually stored.
--
-- Fix: widen sor_items_read to also grant read access to anyone
-- sor_can_edit_opportunity already allows to write -- the two were never
-- supposed to diverge; whoever can edit the Product List obviously needs to
-- be able to see it. sor_is_deal_team and sor_always_sees stay in the OR too
-- (sor_is_deal_team covers closing_sales_id, which sor_can_edit_opportunity
-- does not), so nothing that could already read loses access.
-- ==============================================================================

drop policy if exists "sor_items_read" on public.sales_opportunity_items;
create policy "sor_items_read"
  on public.sales_opportunity_items for select
  to authenticated
  using (
    is_super_admin()
    or is_hr()
    or public.sor_can_edit_opportunity(opportunity_id)
    or exists (
      select 1 from public.sales_opportunities o
      where o.id = sales_opportunity_items.opportunity_id
        and (
          public.sor_is_deal_team(o.*, public.get_employee_id())
          or public.sor_always_sees(o.*, public.get_employee_id())
        )
    )
  );
