-- Part of the Commission Pool feature (#10), this ticket #12.
--
-- One row per (Project Type, Sales role) pair, holding that role's percentage
-- of the Sales department's share. SSP has no rows here: it stays 100% to the
-- deal owner (src/utils/commission.js:splitSalesShareForSsp), computed
-- without needing this table at all.
--
-- 'supporting_salesperson' represents the combined share for BOTH support
-- slots on a deal, split evenly between however many are actually filled (1
-- or 2) — the two slots are an interchangeable, unordered pair, not distinct
-- roles, so there is one percentage for "the support cast" rather than one
-- per slot.

create table if not exists public.commission_splits (
  id uuid primary key default gen_random_uuid(),
  project_type text not null,
  share_role text not null,
  percent numeric(6,3) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commission_splits_project_type_chk check (project_type in ('CP', 'STRATEGIC')),
  constraint commission_splits_share_role_chk check (
    share_role in ('deal_owner', 'supporting_salesperson', 'sales_director')
  ),
  constraint commission_splits_unique_role unique (project_type, share_role)
);

create index if not exists commission_splits_project_type_idx on public.commission_splits (project_type);

alter table public.commission_splits enable row level security;

drop policy if exists commission_splits_read on public.commission_splits;
create policy commission_splits_read on public.commission_splits
  for select to authenticated using (true);

-- Write access is broader than commission_rates/commission_departments: a
-- Sales Director edits these (ticket #16), not only a Super Admin. There's no
-- "is_sales_director" boolean on employees today, so "Sales Director" is
-- defined here as "set as sales_director_id on at least one opportunity" —
-- the same definition the application layer uses in
-- commissionService.js:isSalesDirector — rather than the much broader
-- has_sales_flow (which just means "has sales-module access at all").
drop policy if exists commission_splits_write on public.commission_splits;
create policy commission_splits_write on public.commission_splits
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
    or exists (
      select 1 from public.sales_opportunities so
      where so.sales_director_id = public.get_employee_id()
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
    or exists (
      select 1 from public.sales_opportunities so
      where so.sales_director_id = public.get_employee_id()
    )
  );

-- Starting split values, editable thereafter via the Commission Formula
-- screen (#16).
insert into public.commission_splits (project_type, share_role, percent) values
  ('CP', 'deal_owner', 40),
  ('CP', 'supporting_salesperson', 30),
  ('CP', 'sales_director', 30),
  ('STRATEGIC', 'deal_owner', 30),
  ('STRATEGIC', 'supporting_salesperson', 30),
  ('STRATEGIC', 'sales_director', 40)
on conflict (project_type, share_role) do nothing;
