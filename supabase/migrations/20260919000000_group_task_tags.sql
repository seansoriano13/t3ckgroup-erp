-- Issue #205: Group Task Tags and a CRM filter on Tasks and Group Tasks.
--
-- task_tags is a single managed vocabulary (Super Admins/heads create, rename,
-- recolor, archive). committee_task_tags is the join table onto Group Tasks
-- only — individual tasks keep Category as their kind of work (Q58).

create table if not exists public.task_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null check (color = any (array['mauve', 'amber', 'blue', 'red', 'violet', 'orange', 'green'])),
  archived_at timestamptz,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique case-insensitively among active (non-archived) tags only, so a
-- retired name can be reused without resurrecting the old tag's history.
create unique index if not exists task_tags_active_name_key
  on public.task_tags (lower(name))
  where archived_at is null;

create table if not exists public.committee_task_tags (
  committee_task_id uuid not null references public.committee_tasks(id) on delete cascade,
  tag_id uuid not null references public.task_tags(id),
  added_by uuid references public.employees(id),
  added_at timestamptz not null default now(),
  primary key (committee_task_id, tag_id)
);

alter table public.task_tags enable row level security;
alter table public.committee_task_tags enable row level security;

-- task_tags: every signed-in employee reads; only Super Admins/heads write.
create policy "task_tags_select_authenticated" on public.task_tags
  for select
  to authenticated
  using (true);

create policy "task_tags_insert_management" on public.task_tags
  for insert
  to authenticated
  with check (coalesce(public.is_super_admin(), false) or coalesce(public.is_head(), false));

create policy "task_tags_update_management" on public.task_tags
  for update
  to authenticated
  using (coalesce(public.is_super_admin(), false) or coalesce(public.is_head(), false))
  with check (coalesce(public.is_super_admin(), false) or coalesce(public.is_head(), false));

-- committee_task_tags: read follows whoever can already see the group task
-- (today that's every signed-in employee — see committee_tasks' own select
-- policy); write is restricted to the group task's creator or a Super Admin,
-- the same people who can edit the group task itself.
create policy "committee_task_tags_select_authenticated" on public.committee_task_tags
  for select
  to authenticated
  using (true);

create policy "committee_task_tags_insert_owner" on public.committee_task_tags
  for insert
  to authenticated
  with check (
    coalesce(public.is_super_admin(), false)
    or exists (
      select 1 from public.committee_tasks ct
      where ct.id = committee_task_id
        and ct.created_by = public.get_employee_id()
    )
  );

create policy "committee_task_tags_delete_owner" on public.committee_task_tags
  for delete
  to authenticated
  using (
    coalesce(public.is_super_admin(), false)
    or exists (
      select 1 from public.committee_tasks ct
      where ct.id = committee_task_id
        and ct.created_by = public.get_employee_id()
    )
  );
