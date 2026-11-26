-- OPEX Report (#1244, spec #1241, ADR 0056): one report per S0, read from Odoo.
-- Only Finance access and Super Admins read or write these tables.
--   opex_reports           the S0, plus the Contract price and retention Finance typed (blank for now)
--   opex_report_snapshots  the last Odoo read, so the list never calls Odoo per row

create table if not exists public.opex_reports (
  id uuid primary key default gen_random_uuid(),
  s0_number text not null,
  contract_price numeric,
  retention numeric,
  created_by uuid default public.get_employee_id(),
  created_at timestamptz not null default now(),
  constraint opex_reports_s0_format check (s0_number ~ '^S[0-9]+$')
);

create unique index if not exists opex_reports_s0_number_key on public.opex_reports (s0_number);

create table if not exists public.opex_report_snapshots (
  report_id uuid primary key references public.opex_reports(id) on delete cascade,
  read_at timestamptz not null default now(),
  project_name text,
  contract_price numeric,
  product_cost numeric,
  operation_admin numeric,
  marketing numeric,
  actual_opex numeric,
  revenue numeric,
  revenue_percent numeric
);

alter table public.opex_reports enable row level security;
alter table public.opex_report_snapshots enable row level security;

grant select, insert, update, delete on public.opex_reports to authenticated;
grant select, insert, update, delete on public.opex_report_snapshots to authenticated;

drop policy if exists opex_reports_finance on public.opex_reports;
create policy opex_reports_finance on public.opex_reports
  for all to authenticated
  using (public.has_finance_access() or coalesce(public.is_super_admin(), false))
  with check (public.has_finance_access() or coalesce(public.is_super_admin(), false));

drop policy if exists opex_report_snapshots_finance on public.opex_report_snapshots;
create policy opex_report_snapshots_finance on public.opex_report_snapshots
  for all to authenticated
  using (public.has_finance_access() or coalesce(public.is_super_admin(), false))
  with check (public.has_finance_access() or coalesce(public.is_super_admin(), false));

comment on table public.opex_reports is
  'OPEX Report (#1244): one per S0. contract_price and retention are what Finance typed; blank means use Odoo''s price and the usual rate.';
comment on table public.opex_report_snapshots is
  'The last Odoo read of an OPEX Report (#1244): the figures the OPEX list shows without calling Odoo.';
