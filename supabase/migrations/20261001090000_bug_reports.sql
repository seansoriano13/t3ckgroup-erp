-- ==============================================================================
-- 20261001090000_bug_reports.sql
--
-- Bug Reports: any employee sends one from any page (a plain-text description
-- plus up to 5 attachments); Super Admins and holders of the new Bug Reports
-- System Access Right read them, tick them Resolved, and are notified of each
-- new one.
--
-- ACCESS RIGHT
-- `employees.has_bug_report_access`, toggled in the employee form under System
-- Access Rights, the same shape as `has_retail_access` (a stored boolean, not a
-- read-time match on the free-text team). On by default for the IT Team:
-- every current employee whose sub_department is IT gets it here.
--
-- WRITES GO THROUGH FUNCTIONS
-- The table has a select policy for readers and nothing else. Sending is
-- `submit_bug_report` (files the report under get_employee_id() and notifies
-- the readers in the same transaction), Resolved is `set_bug_report_resolved`,
-- and the one-year file purge is `mark_bug_report_files_purged`. The sender
-- cannot read their own report back: that is on purpose, they get a "Sent"
-- toast and nothing more.
--
-- ATTACHMENTS
-- Private bucket `bug-reports`, 50MB a file, any type. Path is
-- `<employeeId>/<uuid>.<ext>`; the original filename rides in the report's
-- attachment descriptor ({ path, name, type, bytes }). A reader may delete a
-- file once it is a year old: the Bug Reports page does that when it opens and
-- then calls mark_bug_report_files_purged. Deletion has to go through the
-- Storage API (deleting storage.objects rows in SQL would orphan the files),
-- which is why the purge runs from the page and not from pg_cron.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: new column
-- with a false default, new table, new functions, new bucket. Idempotent.
-- ==============================================================================

alter table public.employees
  add column if not exists has_bug_report_access boolean not null default false;

comment on column public.employees.has_bug_report_access is
  'Bug Reports access right: shows the Bug Reports page, lets the holder read every Bug Report and tick it Resolved, and notifies them of new ones. On by default for the IT Team. Enforced by can_read_bug_reports().';

update public.employees
   set has_bug_report_access = true
 where upper(btrim(sub_department)) = 'IT'
   and has_bug_report_access = false;

create or replace function public.can_read_bug_reports()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and (e.is_super_admin or e.has_bug_report_access)
  );
$$;

grant execute on function public.can_read_bug_reports() to authenticated;

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.employees(id),
  description text not null check (length(btrim(description)) > 0),
  attachments jsonb not null default '[]'::jsonb,
  page_url text,
  user_agent text,
  app_version text,
  environment text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.employees(id),
  attachments_purged_at timestamptz
);

create index if not exists bug_reports_created_at_idx on public.bug_reports (created_at desc);

alter table public.bug_reports enable row level security;

drop policy if exists "Bug report readers can view" on public.bug_reports;
create policy "Bug report readers can view"
on public.bug_reports for select
to authenticated
using (can_read_bug_reports());

create or replace function public.submit_bug_report(
  p_description text,
  p_attachments jsonb default '[]'::jsonb,
  p_page_url text default null,
  p_user_agent text default null,
  p_app_version text default null,
  p_environment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reporter uuid;
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_id uuid;
begin
  v_reporter := get_employee_id();
  if v_reporter is null then
    raise exception 'Not signed in as a recognized employee.';
  end if;

  if length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'Describe the bug before sending.';
  end if;

  if jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'Attachments must be a list.';
  end if;
  if jsonb_array_length(v_attachments) > 5 then
    raise exception 'At most 5 attachments.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_attachments) a
    where coalesce(a->>'path', '') not like v_reporter::text || '/%'
  ) then
    raise exception 'Attachment is not one of your uploads.';
  end if;

  insert into bug_reports (reporter_id, description, attachments, page_url, user_agent, app_version, environment)
  values (v_reporter, btrim(p_description), v_attachments, p_page_url, p_user_agent, p_app_version, p_environment)
  returning id into v_id;

  insert into notifications (recipient_id, sender_id, type, title, message, reference_id)
  select e.id, v_reporter, 'BUG_REPORT_SUBMITTED', 'New bug report',
         left(split_part(btrim(p_description), E'\n', 1), 140), v_id::text
  from employees e
  where (e.is_super_admin or e.has_bug_report_access)
    and not coalesce(e.is_deleted, false)
    and e.id <> v_reporter;

  return v_id;
end;
$$;

grant execute on function public.submit_bug_report(text, jsonb, text, text, text, text) to authenticated;

create or replace function public.set_bug_report_resolved(p_id uuid, p_resolved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not can_read_bug_reports() then
    raise exception 'You do not have Bug Reports access.';
  end if;

  update bug_reports set
    resolved_at = case when p_resolved then coalesce(resolved_at, now()) end,
    resolved_by = case when p_resolved then coalesce(resolved_by, get_employee_id()) end
  where id = p_id;

  if not found then
    raise exception 'Bug report not found.';
  end if;
end;
$$;

grant execute on function public.set_bug_report_resolved(uuid, boolean) to authenticated;

create or replace function public.mark_bug_report_files_purged(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not can_read_bug_reports() then
    raise exception 'You do not have Bug Reports access.';
  end if;

  update bug_reports set
    attachments = '[]'::jsonb,
    attachments_purged_at = now()
  where id = p_id
    and created_at < now() - interval '1 year';

  if not found then
    raise exception 'Bug report not found, or not a year old yet.';
  end if;
end;
$$;

grant execute on function public.mark_bug_report_files_purged(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-reports', 'bug-reports', false, 52428800, null)
on conflict (id) do nothing;

drop policy if exists "bug_reports_insert_own" on storage.objects;
create policy "bug_reports_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'bug-reports'
  and (storage.foldername(name))[1] = get_employee_id()::text
);

drop policy if exists "bug_reports_select_readers" on storage.objects;
create policy "bug_reports_select_readers"
on storage.objects for select
to authenticated
using (
  bucket_id = 'bug-reports'
  and can_read_bug_reports()
);

drop policy if exists "bug_reports_delete_year_old" on storage.objects;
create policy "bug_reports_delete_year_old"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'bug-reports'
  and can_read_bug_reports()
  and created_at < now() - interval '1 year'
);
