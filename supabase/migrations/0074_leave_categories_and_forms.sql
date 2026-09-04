-- ==============================================================================
-- 0074_leave_categories_and_forms.sql
--
-- Adds dynamic leave categories and printed form settings (Ticket #64).
-- Allows HR to manage leave categories (instead of being hard-coded) and
-- configure the supervisor/approver names and titles for printed forms.
-- ==============================================================================

create table if not exists public.hr_leave_categories (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  is_active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ordering is what the UI reads
create unique index if not exists hr_leave_categories_sort_order_key
  on public.hr_leave_categories (sort_order);

create table if not exists public.hr_form_settings (
  id integer primary key check (id = 1),
  supervisor_name text not null default '',
  supervisor_title text not null default '',
  approver_name text not null default '',
  approver_title text not null default '201',
  updated_at timestamptz not null default now()
);

-- Insert the single row for form settings
insert into public.hr_form_settings (id, approver_title)
values (1, '201')
on conflict (id) do nothing;

-- Add category_id to the leave tables
alter table public.overtime_requests
  add column if not exists category_id uuid references public.hr_leave_categories(id) on delete set null;

alter table public.offset_leaves
  add column if not exists category_id uuid references public.hr_leave_categories(id) on delete set null;

alter table public.sil_leaves
  add column if not exists category_id uuid references public.hr_leave_categories(id) on delete set null;

-- RLS for Leave Categories
alter table public.hr_leave_categories enable row level security;

drop policy if exists hr_leave_categories_read on public.hr_leave_categories;
create policy hr_leave_categories_read on public.hr_leave_categories
  for select to authenticated using (true);

drop policy if exists hr_leave_categories_write on public.hr_leave_categories;
create policy hr_leave_categories_write on public.hr_leave_categories
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and (e.is_hr or e.is_super_admin)
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and (e.is_hr or e.is_super_admin)
    )
  );

-- RLS for Form Settings
alter table public.hr_form_settings enable row level security;

drop policy if exists hr_form_settings_read on public.hr_form_settings;
create policy hr_form_settings_read on public.hr_form_settings
  for select to authenticated using (true);

drop policy if exists hr_form_settings_write on public.hr_form_settings;
create policy hr_form_settings_write on public.hr_form_settings
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and (e.is_hr or e.is_super_admin)
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and (e.is_hr or e.is_super_admin)
    )
  );
