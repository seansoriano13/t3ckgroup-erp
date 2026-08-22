-- ============================================================================
-- Migration 0033: Strategic 4-Role Split Model & Department Reserve Seeds
-- Architectural Rulings per CCPR-2026-001 Reconciliation (ADR 0002)
-- ============================================================================

-- 1. Add closing_sales_id to sales_opportunities
alter table public.sales_opportunities
  add column if not exists closing_sales_id uuid references public.employees(id) on delete set null;

create index if not exists sales_opportunities_closing_sales_idx
  on public.sales_opportunities (closing_sales_id);

-- 2. Expand commission_splits share_role constraint to include 'closing_salesperson'
alter table public.commission_splits
  drop constraint if exists commission_splits_share_role_chk;

alter table public.commission_splits
  add constraint commission_splits_share_role_chk
    check (share_role in ('deal_owner', 'supporting_salesperson', 'closing_salesperson', 'sales_director'));

-- 3. Upsert Strategic split seeds: 40% Deal Owner, 20% Closing Salesperson, 20% Supporting Sales Team, 20% Sales Director
insert into public.commission_splits (project_type, share_role, percent) values
  ('STRATEGIC', 'deal_owner', 40),
  ('STRATEGIC', 'closing_salesperson', 20),
  ('STRATEGIC', 'supporting_salesperson', 20),
  ('STRATEGIC', 'sales_director', 20)
on conflict (project_type, share_role) do update
  set percent = excluded.percent;

-- 4. Seed Department Reserve Fund (5%) for Administration, Human Resources, and Finance & Accounting
insert into public.commission_positions (department_id, name, allocation_percent)
select id, 'Department Reserve Fund', 5.0
from public.commission_departments
where key in ('administration', 'human_resources', 'finance_accounting')
   or lower(name) in ('administration', 'human resources', 'finance & accounting', 'finance and accounting')
on conflict (department_id, name) do update
  set allocation_percent = excluded.allocation_percent;
