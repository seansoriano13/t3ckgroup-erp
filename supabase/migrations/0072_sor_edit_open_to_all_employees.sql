-- ============================================================================
-- Hotfix: saving an SOR failed for anyone not listed on the deal.
--
-- `sor_update` only matched the registrant, a listed participant, or a
-- head/super admin. An UPDATE from anyone else matched ZERO rows — not an
-- error, just nothing — and the app's `.single()` on the returning row turned
-- that into PGRST116 ("cannot coerce the result to a single JSON object"),
-- which reads as a broken save rather than a refused one. Prod logs show Sales
-- Ops and Sales Associates hitting it repeatedly on colleagues' deals.
--
-- The register is a shared working document — the whole sales team is expected
-- to keep it current, not only whoever happens to be named on a row — so edit
-- rights are widened to every signed-in employee. The audit trail is what
-- attributes a change to a person now: every edit still writes a timeline note
-- and a system audit event naming the actor (opportunityService.updateOpportunity).
--
-- registered_by and registration_date remain immutable via
-- trg_sales_opportunities_guard, so deal ownership can still not be rewritten.
-- ============================================================================

drop policy if exists sor_update on public.sales_opportunities;
create policy sor_update on public.sales_opportunities
  for update to authenticated using (true) with check (true);

-- The product list follows the parent: this function is what gates item
-- insert/update/delete, and leaving it narrow would keep the Product List
-- silently unsaveable for the same people.
create or replace function public.sor_can_edit_opportunity(p_opportunity_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sales_opportunities o where o.id = p_opportunity_id)
$$;
