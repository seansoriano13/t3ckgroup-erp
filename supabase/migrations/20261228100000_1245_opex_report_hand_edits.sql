-- OPEX Report hand edits (#1245, spec #1241): what Finance adds or corrects by hand.
-- Same access as the report: Finance access and Super Admins only.
--   opex_report_p0s          P0 numbers Finance added to a report
--   opex_typed_costs         costs Odoo does not show, filed under a group
--   opex_line_prices         a typed unit price for a P0 line Odoo has at zero (by Odoo P0 line id)
--   opex_left_out_expenses   expenses left out of the count (by Odoo analytic line id)

create table if not exists public.opex_report_p0s (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.opex_reports(id) on delete cascade,
  p0_number text not null,
  created_at timestamptz not null default now(),
  constraint opex_report_p0s_format check (p0_number ~ '^[A-Z]+[0-9]+$')
);
create unique index if not exists opex_report_p0s_key on public.opex_report_p0s (report_id, p0_number);

create table if not exists public.opex_typed_costs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.opex_reports(id) on delete cascade,
  cost_date date,
  description text not null,
  amount numeric not null,
  note text,
  cost_group text not null default 'product' check (cost_group in ('product', 'operation_admin', 'marketing')),
  created_at timestamptz not null default now()
);
create index if not exists opex_typed_costs_report_idx on public.opex_typed_costs (report_id);

create table if not exists public.opex_line_prices (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.opex_reports(id) on delete cascade,
  odoo_line_id bigint not null,
  unit_price numeric not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);
create unique index if not exists opex_line_prices_key on public.opex_line_prices (report_id, odoo_line_id);

create table if not exists public.opex_left_out_expenses (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.opex_reports(id) on delete cascade,
  analytic_line_id bigint not null,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists opex_left_out_expenses_key on public.opex_left_out_expenses (report_id, analytic_line_id);

do $$
declare t text;
begin
  foreach t in array array['opex_report_p0s', 'opex_typed_costs', 'opex_line_prices', 'opex_left_out_expenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_finance', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.has_finance_access() or coalesce(public.is_super_admin(), false)) with check (public.has_finance_access() or coalesce(public.is_super_admin(), false))',
      t || '_finance', t);
  end loop;
end $$;
