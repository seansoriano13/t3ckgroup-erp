-- Issue #142 (#143-145): a company register for T3CK Group's five entities,
-- a nullable company on each employee, and a company copied onto each
-- request record at submission so a printed form always names the entity it
-- was filed against — even after the employee transfers.
--
-- Nullable throughout, deliberately: filling in an existing employee's
-- company is HR's knowledge, not a migration's guess, and a wrong company
-- printed on a payroll form is worse than a blank one. Tightening to
-- required is a later decision, once HR reports the data complete.

-- ---------------------------------------------------------------------
-- The register
-- ---------------------------------------------------------------------

create table if not exists public."companies" (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "is_active" boolean not null default true,
  "sort_order" integer not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

alter table public."companies" add constraint "companies_pkey" primary key (id);
create unique index if not exists companies_sort_order_key on public.companies using btree (sort_order);

insert into public.companies (name, sort_order) values
  ('T3CK Trading', 1),
  ('TG Enterprise', 2),
  ('TCA Concept Builders and Services', 3),
  ('TG Global Trade OPC', 4),
  ('Store CDO', 5)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Company on the employee, and on each request table, at submission
-- ---------------------------------------------------------------------

alter table public.employees add column if not exists company_id uuid references public.companies(id) on delete set null;
create index if not exists employees_company_id_idx on public.employees using btree (company_id);

-- Never updated after insert (see the services) — the record keeps the
-- answer even after the employee's own company changes later.
alter table public.sil_leaves add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.offset_leaves add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.overtime_requests add column if not exists company_id uuid references public.companies(id) on delete set null;

create index if not exists sil_leaves_company_id_idx on public.sil_leaves using btree (company_id);
create index if not exists offset_leaves_company_id_idx on public.offset_leaves using btree (company_id);
create index if not exists overtime_requests_company_id_idx on public.overtime_requests using btree (company_id);

-- ---------------------------------------------------------------------
-- RLS: readable by every authenticated employee (same shape as
-- hr_leave_categories, the register this table is modelled after);
-- writable only by HR / Super Admin.
-- ---------------------------------------------------------------------

alter table public."companies" enable row level security;

create policy "companies_read" on public."companies"
  as permissive
  for select
  to authenticated
  using (true);

create policy "companies_write" on public."companies"
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin)))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND (e.is_hr OR e.is_super_admin)))));
