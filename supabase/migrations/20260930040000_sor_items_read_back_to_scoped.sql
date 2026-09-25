-- Puts sor_items_read back to the scoped rule from
-- 20260926000000_sor_visit_scoped_reads.sql, undoing
-- 20260929050000_sor_items_read_matches_edit.sql on this line of history.
--
-- 20260929050000 was a prod hotfix (2026-09-23), written while prod's sor_read
-- is open to everyone. It lets whoever passes sor_can_edit_opportunity read the
-- Product List, and that check still has a blanket "any head" clause. On the
-- scoped model (ADR 0021: heads lose automatic access) that let a head outside
-- the Deal Team read the Product List of SORs they cannot open. On staging on
-- 2026-09-25, one such head would have gone from 0 to 90 SORs' Product Lists.
--
-- The file itself is kept, not skipped, so staging's and prod's ledgers record
-- the same migrations. This one lands on prod with the next release.
--
-- The "before" snapshot for the change log doesn't depend on this read: it
-- comes back from sor_replace_items (20260929040000), which reads it under
-- security definer.

drop policy if exists "sor_items_read" on public.sales_opportunity_items;
create policy "sor_items_read" on public.sales_opportunity_items
  as permissive
  for select
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.sales_opportunities o
      where o.id = sales_opportunity_items.opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    )
    or public.is_hr()
  );
