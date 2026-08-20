-- Part of the Commission Pool feature (#10), this ticket #15.
--
-- Commission Positions within a Commission Department, each with its own
-- allocation percentage of that department's share. Standalone, same as
-- commission_departments — not linked to employees.role.

create table if not exists public.commission_positions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.commission_departments(id) on delete cascade,
  name text not null,
  allocation_percent numeric(6,3) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commission_positions_unique_name_per_department unique (department_id, name)
);

create index if not exists commission_positions_department_id_idx on public.commission_positions (department_id);

alter table public.commission_positions enable row level security;

drop policy if exists commission_positions_read on public.commission_positions;
create policy commission_positions_read on public.commission_positions
  for select to authenticated using (true);

drop policy if exists commission_positions_write on public.commission_positions;
create policy commission_positions_write on public.commission_positions
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
