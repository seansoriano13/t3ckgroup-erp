-- ==============================================================================
-- 20261001130000_bug_report_notes.sql
--
-- Bug Report Notes: a short back-and-forth on a Bug Report between whoever
-- reads Bug Reports and the employee who sent it ("Fixed, can you check?" /
-- "Yes, works now"), so a report is ticked Resolved once the sender confirms.
-- Not real time: the thread loads when the report is opened, and each note
-- notifies the other side.
--
-- THE SENDER NOW SEES THEIR OWN REPORTS
-- 20261001090000 kept the sender out of their report on purpose. A thread needs
-- them in it, so the select policy (and the bucket's) now also lets the sender
-- read their own reports and files. Readers still see every report.
--
-- WHO IS NOTIFIED
-- A note from the sender notifies every reader (the same people a new report
-- notifies). A note from a reader notifies the sender. Type BUG_REPORT_NOTE,
-- reference_id the report.
--
-- RESOLVED / REOPENED LAND IN THE THREAD
-- set_bug_report_resolved now writes a 'resolved' or 'reopened' row into the
-- thread when the state actually changes, so the sender sees when it was ticked.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: new table,
-- new function, widened select policies, same set_bug_report_resolved signature.
-- Idempotent.
-- ==============================================================================

create table if not exists public.bug_report_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.bug_reports(id) on delete cascade,
  author_id uuid not null references public.employees(id),
  kind text not null default 'note' check (kind in ('note', 'resolved', 'reopened')),
  body text,
  created_at timestamptz not null default now()
);

create index if not exists bug_report_notes_report_idx on public.bug_report_notes (report_id, created_at);

alter table public.bug_report_notes enable row level security;

drop policy if exists "Bug report readers can view" on public.bug_reports;
drop policy if exists "Bug report readers and the sender can view" on public.bug_reports;
create policy "Bug report readers and the sender can view"
on public.bug_reports for select
to authenticated
using (can_read_bug_reports() or reporter_id = get_employee_id());

-- A note is visible exactly when its report is (the subquery runs under the
-- bug_reports policy above).
drop policy if exists "Bug report notes follow their report" on public.bug_report_notes;
create policy "Bug report notes follow their report"
on public.bug_report_notes for select
to authenticated
using (exists (select 1 from public.bug_reports r where r.id = report_id));

drop policy if exists "bug_reports_select_readers" on storage.objects;
create policy "bug_reports_select_readers"
on storage.objects for select
to authenticated
using (
  bucket_id = 'bug-reports'
  and (can_read_bug_reports() or (storage.foldername(name))[1] = get_employee_id()::text)
);

create or replace function public.add_bug_report_note(p_report_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := get_employee_id();
  v_reporter uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not signed in as a recognized employee.';
  end if;

  select reporter_id into v_reporter from bug_reports where id = p_report_id;
  if not found then
    raise exception 'Bug report not found.';
  end if;
  if v_reporter <> v_me and not can_read_bug_reports() then
    raise exception 'You cannot write on this bug report.';
  end if;

  if length(v_body) = 0 then
    raise exception 'Write something before sending.';
  end if;
  if length(v_body) > 4000 then
    raise exception 'Keep a note under 4000 characters.';
  end if;

  insert into bug_report_notes (report_id, author_id, kind, body)
  values (p_report_id, v_me, 'note', v_body)
  returning id into v_id;

  if v_me = v_reporter then
    insert into notifications (recipient_id, sender_id, type, title, message, reference_id)
    select e.id, v_me, 'BUG_REPORT_NOTE', 'Reply on a bug report',
           left(split_part(v_body, E'\n', 1), 140), p_report_id::text
    from employees e
    where (e.is_super_admin or e.has_bug_report_access)
      and not coalesce(e.is_deleted, false)
      and e.id <> v_me;
  else
    insert into notifications (recipient_id, sender_id, type, title, message, reference_id)
    select e.id, v_me, 'BUG_REPORT_NOTE', 'Note on your bug report',
           left(split_part(v_body, E'\n', 1), 140), p_report_id::text
    from employees e
    where e.id = v_reporter
      and not coalesce(e.is_deleted, false);
  end if;

  return v_id;
end;
$$;

grant execute on function public.add_bug_report_note(uuid, text) to authenticated;

create or replace function public.set_bug_report_resolved(p_id uuid, p_resolved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_resolved boolean;
begin
  if not can_read_bug_reports() then
    raise exception 'You do not have Bug Reports access.';
  end if;

  select resolved_at is not null into v_was_resolved from bug_reports where id = p_id for update;
  if not found then
    raise exception 'Bug report not found.';
  end if;

  update bug_reports set
    resolved_at = case when p_resolved then coalesce(resolved_at, now()) end,
    resolved_by = case when p_resolved then coalesce(resolved_by, get_employee_id()) end
  where id = p_id;

  if p_resolved <> v_was_resolved then
    insert into bug_report_notes (report_id, author_id, kind)
    values (p_id, get_employee_id(), case when p_resolved then 'resolved' else 'reopened' end);
  end if;
end;
$$;

grant execute on function public.set_bug_report_resolved(uuid, boolean) to authenticated;
