-- Issue #201 — Employee Groups: named sets of people any Sales Flow setting
-- can point at.
--
-- A group's members are hand-picked employees plus zero or more whole Teams.
-- A Team is everyone whose Sub-department matches, read from the field HR
-- already maintains — no Team list is built here (Q55 deferred it). A group
-- always means its current members: `employee_group_member_ids` resolves it
-- at read time, so moving someone into Purchasing moves them into every group
-- that includes Purchasing, and a soft-deleted employee never counts.
--
-- Only Super Admins write. Groups feed Restricted Stage exclusions and Always
-- sees lists (ADR 0021), so editing a group is an access-control change.
-- Every signed-in employee reads, so a rule's "who" is legible to the people
-- it is about.

create table if not exists public.employee_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  archived_at timestamp with time zone,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.employee_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.employee_groups(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  added_by uuid references public.employees(id) on delete set null,
  added_at timestamp with time zone not null default now(),
  constraint employee_group_members_group_employee_key unique (group_id, employee_id)
);

create table if not exists public.employee_group_teams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.employee_groups(id) on delete cascade,
  team text not null,
  constraint employee_group_teams_group_team_key unique (group_id, team)
);

-- Unique among active groups, case-insensitively: an archived "Purchasing"
-- does not stop a new one being made.
create unique index if not exists employee_groups_active_name_key
  on public.employee_groups (lower(trim(name)))
  where archived_at is null;

create index if not exists employee_group_members_employee_idx
  on public.employee_group_members (employee_id);

alter table public.employee_groups enable row level security;
alter table public.employee_group_members enable row level security;
alter table public.employee_group_teams enable row level security;

drop policy if exists "Employees can read employee groups" on public.employee_groups;
create policy "Employees can read employee groups"
  on public.employee_groups for select to authenticated using (true);

drop policy if exists "Super Admins can insert employee groups" on public.employee_groups;
create policy "Super Admins can insert employee groups"
  on public.employee_groups for insert to authenticated
  with check (coalesce(public.is_super_admin(), false));

drop policy if exists "Super Admins can update employee groups" on public.employee_groups;
create policy "Super Admins can update employee groups"
  on public.employee_groups for update to authenticated
  using (coalesce(public.is_super_admin(), false))
  with check (coalesce(public.is_super_admin(), false));

drop policy if exists "Super Admins can delete employee groups" on public.employee_groups;
create policy "Super Admins can delete employee groups"
  on public.employee_groups for delete to authenticated
  using (coalesce(public.is_super_admin(), false));

drop policy if exists "Employees can read employee group members" on public.employee_group_members;
create policy "Employees can read employee group members"
  on public.employee_group_members for select to authenticated using (true);

drop policy if exists "Super Admins can insert employee group members" on public.employee_group_members;
create policy "Super Admins can insert employee group members"
  on public.employee_group_members for insert to authenticated
  with check (coalesce(public.is_super_admin(), false));

drop policy if exists "Super Admins can update employee group members" on public.employee_group_members;
create policy "Super Admins can update employee group members"
  on public.employee_group_members for update to authenticated
  using (coalesce(public.is_super_admin(), false))
  with check (coalesce(public.is_super_admin(), false));

drop policy if exists "Super Admins can delete employee group members" on public.employee_group_members;
create policy "Super Admins can delete employee group members"
  on public.employee_group_members for delete to authenticated
  using (coalesce(public.is_super_admin(), false));

drop policy if exists "Employees can read employee group teams" on public.employee_group_teams;
create policy "Employees can read employee group teams"
  on public.employee_group_teams for select to authenticated using (true);

drop policy if exists "Super Admins can insert employee group teams" on public.employee_group_teams;
create policy "Super Admins can insert employee group teams"
  on public.employee_group_teams for insert to authenticated
  with check (coalesce(public.is_super_admin(), false));

drop policy if exists "Super Admins can update employee group teams" on public.employee_group_teams;
create policy "Super Admins can update employee group teams"
  on public.employee_group_teams for update to authenticated
  using (coalesce(public.is_super_admin(), false))
  with check (coalesce(public.is_super_admin(), false));

drop policy if exists "Super Admins can delete employee group teams" on public.employee_group_teams;
create policy "Super Admins can delete employee group teams"
  on public.employee_group_teams for delete to authenticated
  using (coalesce(public.is_super_admin(), false));

grant select, insert, update, delete on public.employee_groups to authenticated;
grant select, insert, update, delete on public.employee_group_members to authenticated;
grant select, insert, update, delete on public.employee_group_teams to authenticated;

-- The one definition of who a group means. Later specs' policies call it, and
-- `src/utils/resolvePeople.js` mirrors it for previews; the policy tier holds
-- the two to the same answers. SECURITY DEFINER so a policy calling it sees
-- every employee regardless of the caller's own read policy on `employees`.
-- Archived groups still resolve: archiving hides a group from pickers, it
-- does not empty the settings already using it.
create or replace function public.employee_group_member_ids(p_group_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.employees e
  where coalesce(e.is_deleted, false) = false
    and (
      exists (
        select 1 from public.employee_group_members m
        where m.group_id = p_group_id and m.employee_id = e.id
      )
      or exists (
        select 1 from public.employee_group_teams t
        where t.group_id = p_group_id
          and upper(trim(t.team)) = upper(trim(e.sub_department))
      )
    );
$$;

grant execute on function public.employee_group_member_ids(uuid) to authenticated;
