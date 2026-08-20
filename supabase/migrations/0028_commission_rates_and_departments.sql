-- Commission Pool feature (see docs/adr or CONTEXT.md once written; tracked as
-- GitHub issue #11, part of the Commission Pool epic #10).
--
-- Two standalone, commission-scoped tables. Deliberately NOT foreign-keyed to
-- employees.department / employees.sub_department / employees.role: those are
-- freeform text relied on by dozens of existing screens, and normalizing them
-- is a separate, later effort. commission_departments / commission_positions
-- (positions land in a later migration) exist purely to drive the commission
-- split calculation.

create table if not exists public.commission_rates (
  id uuid primary key default gen_random_uuid(),
  rate_type text not null,
  percent numeric(6,3) not null,
  effective_from date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commission_rates_rate_type_chk check (rate_type in ('VAT', 'WITHHOLDING', 'POOL')),
  constraint commission_rates_unique_type_date unique (rate_type, effective_from)
);

create index if not exists commission_rates_rate_type_idx on public.commission_rates (rate_type);

create table if not exists public.commission_departments (
  id uuid primary key default gen_random_uuid(),
  -- Stable identity, separate from the editable display `name` — commission
  -- math (e.g. "which department is Sales") is keyed off this, never off the
  -- freely-renamable name, so renaming a department in the admin screen can
  -- never silently break the Sales role split.
  key text not null unique,
  name text not null unique,
  allocation_percent numeric(6,3) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.commission_rates enable row level security;
alter table public.commission_departments enable row level security;

drop policy if exists commission_rates_read on public.commission_rates;
create policy commission_rates_read on public.commission_rates
  for select to authenticated using (true);

drop policy if exists commission_rates_write on public.commission_rates;
create policy commission_rates_write on public.commission_rates
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  );

drop policy if exists commission_departments_read on public.commission_departments;
create policy commission_departments_read on public.commission_departments
  for select to authenticated using (true);

drop policy if exists commission_departments_write on public.commission_departments;
create policy commission_departments_write on public.commission_departments
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  );

-- Starting policy values, editable thereafter via the admin screens (issues
-- #14 / #15). VAT 12% and Withholding (ITR) 8% are the standard Philippine
-- rates; Pool is 1% of Commissionable Revenue.
insert into public.commission_rates (rate_type, percent, effective_from) values
  ('VAT', 12, '2026-01-01'),
  ('WITHHOLDING', 8, '2026-01-01'),
  ('POOL', 1, '2026-01-01')
on conflict (rate_type, effective_from) do nothing;

insert into public.commission_departments (key, name, allocation_percent) values
  ('sales', 'Sales', 50),
  ('operations', 'Operations', 25),
  ('administration', 'Administration', 15),
  ('human_resources', 'Human Resources', 5),
  ('finance_accounting', 'Finance & Accounting', 5)
on conflict (key) do nothing;
