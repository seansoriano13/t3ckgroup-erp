-- ============================================================================
-- Fix: sales_opportunities / sales_opportunity_logs have RLS enabled with no
-- policies, so every write is denied outright ("new row violates row-level
-- security policy"). This was discovered live: RLS got turned on (likely via
-- the Table Editor's RLS toggle) without the policy block from
-- 0001_sales_opportunities.sql being applied — that block referenced a
-- function named current_employee_id(), which does not exist in this
-- database. What DOES exist and already works is get_employee_id() — it
-- correctly resolved the signed-in session to its employees row when tested
-- via RPC. These policies are written against that existing function rather
-- than introducing a second, redundant one.
--
-- Run this once in the Supabase SQL editor.
-- ============================================================================

alter table public.sales_opportunities enable row level security;
alter table public.sales_opportunity_logs enable row level security;

-- Org-wide read visibility is the point of the register — it's what lets two
-- salespeople see they're both working the same lead.
drop policy if exists sor_read on public.sales_opportunities;
create policy sor_read on public.sales_opportunities
  for select to authenticated using (true);

drop policy if exists sor_insert on public.sales_opportunities;
create policy sor_insert on public.sales_opportunities
  for insert to authenticated
  with check (registered_by = public.get_employee_id());

drop policy if exists sor_update on public.sales_opportunities;
create policy sor_update on public.sales_opportunities
  for update to authenticated using (
    registered_by = public.get_employee_id()
    or deal_owner_id = public.get_employee_id()
    or support_sales_1_id = public.get_employee_id()
    or support_sales_2_id = public.get_employee_id()
    or sales_director_id = public.get_employee_id()
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.is_head or e.is_super_admin)
    )
  );

drop policy if exists sor_log_read on public.sales_opportunity_logs;
create policy sor_log_read on public.sales_opportunity_logs
  for select to authenticated using (true);

-- author_id is null for SYSTEM entries (registration, stage moves) — those
-- are written by the app on the user's own session, not attributable to a
-- person, so the check allows null in addition to the author's own id.
drop policy if exists sor_log_insert on public.sales_opportunity_logs;
create policy sor_log_insert on public.sales_opportunity_logs
  for insert to authenticated
  with check (
    author_id = public.get_employee_id() or author_id is null
  );
