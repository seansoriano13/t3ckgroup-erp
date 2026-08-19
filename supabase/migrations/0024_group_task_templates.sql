-- ==============================================================================
-- 0024_group_task_templates.sql
--
-- Group task templates: an org-wide, reusable seed for the "New Group Task"
-- modal. A template is one row of task-level defaults (name, title,
-- description, a due-date offset in days) plus N member "slots" — each slot
-- optionally carries a bound employee and/or task-level fields (description,
-- checklist, role). A pure "employee roster" template is just a template
-- whose slots have employees but blank task fields; a pure "task structure"
-- template is the reverse. There is no second, competing template concept.
--
-- Applying a template SNAPSHOTS its data into the create-modal's draft state.
-- Nothing here is referenced live by a created group task afterwards, except
-- the optional template_id column below, kept purely for "used N times"
-- lineage — deleting a template never touches a real group task.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Two new tables — nothing existing selects them.
--   * committee_tasks.template_id is a new nullable FK column, catalog-only.
--   * No existing row/table/policy is modified.
--   * Idempotent — safe to re-run.
--
-- Run this BEFORE deploying the templates frontend — groupTaskTemplateService
-- selects these tables/column, and PostgREST rejects the whole query (not a
-- partial one) when a relation or column is missing.
-- ==============================================================================

create table if not exists public.group_task_templates (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,               -- the template's own identity; never a group task field
  title                 text,                         -- nullable: blank = creator fills in manually
  description           text,
  due_date_offset_days  integer,                      -- nullable: creator picks a due date manually if null
  created_by            uuid not null references public.employees(id),
  archived_at           timestamptz,                  -- soft delete; null = active/visible in the picker
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.group_task_template_members (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid not null references public.group_task_templates(id) on delete cascade,
  -- Nullable and ON DELETE SET NULL: a slot with no bound employee is a valid,
  -- common shape (a "task structure" template), and a deactivated employee
  -- must not take the slot down with them.
  employee_id       uuid references public.employees(id) on delete set null,
  task_description  text,
  checklist         jsonb,
  role              text,
  custom_role       text,
  sort_order        integer not null default 0,       -- Postgres does not guarantee row order without this
  created_at        timestamptz not null default now()
);

alter table public.committee_tasks
  add column if not exists template_id uuid references public.group_task_templates(id) on delete set null;

create index if not exists group_task_template_members_template_idx
  on public.group_task_template_members (template_id);

create index if not exists committee_tasks_template_idx
  on public.committee_tasks (template_id);

-- Active-only lookups (the create-modal picker) are the hot path.
create index if not exists group_task_templates_active_idx
  on public.group_task_templates (created_at desc)
  where archived_at is null;

create or replace function public.group_task_templates_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_group_task_templates_touch on public.group_task_templates;
create trigger trg_group_task_templates_touch
  before update on public.group_task_templates
  for each row execute function public.group_task_templates_touch();

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Templates and member slots are org-wide readable by any authenticated user,
-- allowing employees and heads to discover and apply templates to group tasks.
-- Creation, updates, and deletion are permitted for the template creator as well
-- as any head or super admin.

alter table public.group_task_templates enable row level security;
alter table public.group_task_template_members enable row level security;

-- Helper to check if current employee can edit template contents
create or replace function public.group_task_template_can_edit(p_template_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_task_templates t
    where t.id = p_template_id
      and (
        t.created_by = public.get_employee_id()
        or exists (
          select 1 from public.employees e
          where e.id = public.get_employee_id()
            and (e.is_head or e.is_super_admin)
        )
      )
  )
$$;

-- ── group_task_templates policies ──────────────────────────────────────────
drop policy if exists group_task_templates_read on public.group_task_templates;
create policy group_task_templates_read on public.group_task_templates
  for select to authenticated using (true);

drop policy if exists group_task_templates_insert on public.group_task_templates;
create policy group_task_templates_insert on public.group_task_templates
  for insert to authenticated
  with check (
    created_by = public.get_employee_id()
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.is_head or e.is_super_admin)
    )
  );

drop policy if exists group_task_templates_update on public.group_task_templates;
create policy group_task_templates_update on public.group_task_templates
  for update to authenticated
  using (
    created_by = public.get_employee_id()
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.is_head or e.is_super_admin)
    )
  )
  with check (
    created_by = public.get_employee_id()
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.is_head or e.is_super_admin)
    )
  );

drop policy if exists group_task_templates_delete on public.group_task_templates;
create policy group_task_templates_delete on public.group_task_templates
  for delete to authenticated
  using (
    created_by = public.get_employee_id()
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.is_head or e.is_super_admin)
    )
  );

-- ── group_task_template_members policies ────────────────────────────────────
drop policy if exists group_task_template_members_read on public.group_task_template_members;
create policy group_task_template_members_read on public.group_task_template_members
  for select to authenticated using (true);

drop policy if exists group_task_template_members_insert on public.group_task_template_members;
create policy group_task_template_members_insert on public.group_task_template_members
  for insert to authenticated
  with check (
    public.group_task_template_can_edit(template_id)
  );

drop policy if exists group_task_template_members_update on public.group_task_template_members;
create policy group_task_template_members_update on public.group_task_template_members
  for update to authenticated
  using (
    public.group_task_template_can_edit(template_id)
  )
  with check (
    public.group_task_template_can_edit(template_id)
  );

drop policy if exists group_task_template_members_delete on public.group_task_template_members;
create policy group_task_template_members_delete on public.group_task_template_members
  for delete to authenticated
  using (
    public.group_task_template_can_edit(template_id)
  );

-- ==============================================================================
