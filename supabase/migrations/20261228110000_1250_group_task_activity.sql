-- #1250 (spec #1246): a fifth Activity type, Group Task.
--
--   * GROUP_TASK joins the allowed types (meeting_requests, activity_type_settings, activity_fields_check).
--   * meeting_requests.group_task_id links an Activity to one Group Task; a partial unique index allows one
--     live (not declined, not cancelled) Activity per Group Task.
--   * A trigger on committee_tasks copies a renamed title onto the linked Activities (no notice, no re-approval).
--   * file_meeting_request gains p_group_task_id (re-created from 20261218190000_1087); edit_meeting_request is
--     re-created from 20261224120300_1194 and refuses a purpose change on a Group Task Activity.
--   * calendar_entries (from 20261224120500_1197) adds group_task_id to the MEETING branch details.
-- Safe to run twice.

alter table public.meeting_requests drop constraint if exists meeting_requests_activity_type_check;
alter table public.meeting_requests
  add constraint meeting_requests_activity_type_check
    check (activity_type in ('MEETING', 'ADMIN_TASK', 'OPERATIONS_TASK', 'EVENT', 'GROUP_TASK'));

alter table public.activity_type_settings drop constraint if exists activity_type_settings_activity_type_check;
alter table public.activity_type_settings
  add constraint activity_type_settings_activity_type_check
    check (activity_type in ('MEETING', 'ADMIN_TASK', 'OPERATIONS_TASK', 'EVENT', 'GROUP_TASK'));

alter table public.meeting_requests add column if not exists group_task_id uuid references public.committee_tasks(id) on delete set null;
alter table public.meeting_requests drop constraint if exists meeting_requests_group_task_link;
alter table public.meeting_requests
  add constraint meeting_requests_group_task_link
    check (activity_type = 'GROUP_TASK' or group_task_id is null);  -- the link is required at filing; on delete set null may clear it later
comment on column public.meeting_requests.group_task_id is
  '#1250: the Group Task a GROUP_TASK Activity belongs to. Null on every other type.';

create unique index if not exists meeting_requests_one_live_per_group_task
  on public.meeting_requests (group_task_id)
  where group_task_id is not null and status not in ('DECLINED', 'CANCELLED');

insert into public.activity_type_settings (activity_type, name, color, active, who_files, needs_hr, multi_day)
values ('GROUP_TASK', 'Group Task', 'blue', true, 'EVERYONE', false, true)
on conflict (activity_type) do nothing;

-- At least one ORDINARY type stays on: Group Task cannot be filed from the ordinary form.
create or replace function public.activity_type_settings_guard()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  if new.active = false and old.active
     and not exists (
       select 1 from public.activity_type_settings t
       where t.active and t.activity_type <> new.activity_type and t.activity_type <> 'GROUP_TASK'
     ) then
    raise exception 'At least one Activity type must stay on.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create or replace function public.activity_fields_check(p_activity_type text, p_type text, p_venue_id uuid, p_link text)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_activity_type not in ('MEETING', 'ADMIN_TASK', 'OPERATIONS_TASK', 'EVENT', 'GROUP_TASK') then
    raise exception 'Choose an Activity type.' using errcode = '22023';
  end if;
  if p_activity_type = 'MEETING' then
    perform public.meeting_type_check(p_type, p_venue_id, p_link);
  elsif p_type is not null or p_venue_id is not null or p_link is not null then
    raise exception 'Only a Meeting has a Venue, a meeting type or a meeting link.' using errcode = '22023';
  end if;
end;
$function$;

-- The committee_tasks_read rule (20261221110000), asked for a given person. Used by file_meeting_request, which
-- runs with raised rights.
create or replace function public.committee_task_readable(p_task_id uuid, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.committee_tasks t
    where t.id = p_task_id
      and p_employee_id is not null
      and (
        (select public.is_super_admin())
        or t.evaluator_id = p_employee_id
        or exists (select 1 from public.committee_task_members m where m.committee_task_id = t.id and m.employee_id = p_employee_id)
        or (
          t.created_by = p_employee_id
          and (
            t.opportunity_id is null
            or (t.stage_visit_id is not null
                and t.stage_visit_id in (select public.sor_visible_visit_ids(t.opportunity_id)))
            or (t.stage_visit_id is null
                and public.sor_access_level(t.opportunity_id) = any (array['full'::text, 'participant'::text]))
          )
        )
      )
  );
$function$;
revoke all on function public.committee_task_readable(uuid, uuid) from public, anon, authenticated;

-- A renamed Group Task shows its new title on every linked Activity. No notice, no new approval.
create or replace function public.committee_task_title_to_activities()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.meeting_requests
     set purpose = left(btrim(new.title), 500)
   where group_task_id = new.id and purpose is distinct from left(btrim(new.title), 500);
  return new;
end;
$function$;
drop trigger if exists committee_task_title_to_activities on public.committee_tasks;
create trigger committee_task_title_to_activities after update of title on public.committee_tasks
  for each row when (old.title is distinct from new.title)
  execute function public.committee_task_title_to_activities();

drop function if exists public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb);

create or replace function public.file_meeting_request(
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_facilitator_id uuid,
  p_purpose text,
  p_guests text[] default '{}',
  p_participant_ids uuid[] default '{}',
  p_head_id uuid default null,
  p_meeting_type text default null,
  p_meeting_link text default null,
  p_guest_emails text[] default '{}',
  p_activity_type text default 'MEETING',
  p_days jsonb default null,
  p_group_task_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_applicant uuid := public.get_employee_id();
  v_atype text := upper(coalesce(p_activity_type, 'MEETING'));
  v_status text;
  v_head uuid;
  v_id uuid;
  v_guests text[];
  v_emails text[];
  v_link text := nullif(btrim(coalesce(p_meeting_link, '')), '');
  v_type text := nullif(upper(btrim(coalesce(p_meeting_type, ''))), '');
  v_days jsonb;
  v_first_start timestamptz;
  v_first_end timestamptz;
  v_last_end timestamptz;
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_task public.committee_tasks%rowtype;
begin
  if v_applicant is null then
    raise exception 'Sign in to file an Activity.' using errcode = '42501';
  end if;

  -- #1250: the type is GROUP_TASK exactly when a Group Task is given.
  if v_atype = 'GROUP_TASK' and p_group_task_id is null then
    raise exception 'A Group Task Activity needs a Group Task.' using errcode = '22023';
  end if;
  if p_group_task_id is not null and v_atype <> 'GROUP_TASK' then
    raise exception 'Only a Group Task Activity can link to a Group Task.' using errcode = '22023';
  end if;
  if v_atype = 'MEETING' and v_type is null then
    v_type := 'ONSITE';
  end if;
  perform public.activity_fields_check(v_atype, v_type, p_venue_id, v_link);
  -- #1087: a meeting link is a web link.
  if v_link is not null and v_link !~* '^https?://\S+$' then
    raise exception 'The meeting link must start with http:// or https://' using errcode = '22023';
  end if;
  v_days := public.activity_days_normalize(p_days, v_atype, p_starts_at, p_ends_at);
  -- #1087: no day is more than one year ahead (Manila dates, the same as the form).
  if exists (
    select 1 from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
    where (x.starts_at at time zone 'Asia/Manila')::date > (now() at time zone 'Asia/Manila')::date + interval '1 year'
  ) then
    raise exception 'An Activity cannot be more than one year ahead.' using errcode = '22023';
  end if;

  if v_atype = 'GROUP_TASK' then
    -- Anyone who can open the Group Task may file it (the same rule as committee_tasks_read; this function
    -- runs with raised rights, so the rule is checked here). The title is the Group Task's, never the browser's.
    select * into v_task from public.committee_tasks t where t.id = p_group_task_id;
    if not found or not public.committee_task_readable(p_group_task_id, v_applicant) then
      raise exception 'You cannot open that Group Task, so you cannot put it on the Calendar.' using errcode = '42501';
    end if;
    if v_task.status = 'CANCELLED' then
      raise exception 'A cancelled Group Task cannot be put on the Calendar.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.meeting_requests m
      where m.group_task_id = p_group_task_id and m.status not in ('DECLINED', 'CANCELLED')
    ) then
      raise exception 'This Group Task is already on the Calendar.' using errcode = '22023';
    end if;
    v_purpose := left(btrim(v_task.title), 500);
  elsif not public.activity_can_file(v_applicant, v_atype) then
    raise exception 'Only a department head can file the % type.', public.activity_type_phrase(v_atype) using errcode = '42501';
  end if;

  if p_venue_id is not null and not exists (select 1 from public.calendar_venues where id = p_venue_id and active) then
    raise exception 'Choose a Venue that is open for booking.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.employees
    where id = p_facilitator_id and coalesce(is_deleted, false) = false
  ) then
    raise exception 'Choose a Lead.' using errcode = '22023';
  end if;

  if v_purpose = '' then
    raise exception 'Write the purpose of the Activity.' using errcode = '22023';
  end if;
  if char_length(v_purpose) > 500 then
    raise exception 'The purpose can be at most 500 characters.' using errcode = '22023';
  end if;

  v_status := case when public.activity_needs_hr(v_atype, p_venue_id, v_applicant) then 'PENDING_HR' else 'APPROVED' end;
  v_head := null;

  select coalesce(array_agg(btrim(g.name) order by g.i), '{}'),
         coalesce(array_agg(coalesce(btrim(p_guest_emails[g.i]), '') order by g.i), '{}')
    into v_guests, v_emails
    from unnest(coalesce(p_guests, '{}')) with ordinality as g(name, i)
    where btrim(g.name) <> '';
  perform public.guest_emails_check(v_emails);
  perform public.activity_settings_check(v_atype, v_type, v_guests);

  select (v_days->0->>'starts_at')::timestamptz, (v_days->0->>'ends_at')::timestamptz into v_first_start, v_first_end;
  select max(x.ends_at) into v_last_end from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz);

  -- The parent is inserted with the first day (its default-day trigger writes that day row);
  -- the other days follow, then the parent's end moves to the last day's end.
  insert into public.meeting_requests (
    applicant_id, venue_id, starts_at, ends_at, facilitator_id, purpose, guests, guest_emails, status, head_id,
    meeting_type, meeting_link, activity_type, group_task_id
  ) values (
    v_applicant, p_venue_id, v_first_start, v_first_end, p_facilitator_id, v_purpose, v_guests, v_emails, v_status, v_head,
    v_type, v_link, v_atype, p_group_task_id
  ) returning id into v_id;

  insert into public.meeting_request_days (request_id, starts_at, ends_at)
  select v_id, x.starts_at, x.ends_at
  from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
  where x.starts_at <> v_first_start;

  if v_last_end <> v_first_end then
    update public.meeting_requests set ends_at = v_last_end where id = v_id;
  end if;

  insert into public.meeting_request_participants (request_id, employee_id)
  select v_id, e.id from public.employees e
  where e.id = any(coalesce(p_participant_ids, '{}'))
  on conflict do nothing;

  perform public.log_meeting_request_event(
    v_id, v_applicant, 'FILED', null, v_status,
    jsonb_build_object('activity_type', v_atype, 'group_task_id', p_group_task_id, 'meeting_type', v_type, 'venue_id', p_venue_id, 'starts_at', v_first_start, 'ends_at', v_last_end,
                       'days', v_days, 'facilitator_id', p_facilitator_id, 'head_id', v_head),
    null
  );

  return v_id;
end;
$function$;

create or replace function public.edit_meeting_request(
  p_request_id uuid,
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_facilitator_id uuid,
  p_purpose text,
  p_guests text[] default '{}',
  p_participant_ids uuid[] default '{}',
  p_head_id uuid default null,
  p_meeting_type text default null,
  p_meeting_link text default null,
  p_guest_emails text[] default '{}',
  p_activity_type text default null,
  p_days jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := public.get_employee_id();
  v_req public.meeting_requests%rowtype;
  v_atype text;
  v_to text;
  v_head uuid;
  v_guests text[];
  v_emails text[];
  v_link text := nullif(btrim(coalesce(p_meeting_link, '')), '');
  v_type text := nullif(upper(btrim(coalesce(p_meeting_type, ''))), '');
  v_old_people uuid[];
  v_new_people uuid[];
  v_changed jsonb := '{}'::jsonb;
  v_restart boolean;
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_days jsonb;
  v_old_days jsonb;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_after boolean;
begin
  if v_actor is null then
    raise exception 'Sign in to edit an Activity.' using errcode = '42501';
  end if;

  select * into v_req from public.meeting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Activity not found.' using errcode = 'P0002';
  end if;

  if v_req.applicant_id <> v_actor then
    raise exception 'Only the person who filed this Activity can edit it.' using errcode = '42501';
  end if;

  if v_req.status not in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED') then
    raise exception 'A % Activity cannot be edited.', lower(v_req.status) using errcode = '22023';
  end if;

  -- #1194: once its first day has started the Activity is history. Its filer may still change all of it: the
  -- status stays, nobody is sent back to HR, and the change shows in the Activity's history.
  v_after := exists (select 1 from public.meeting_request_days where request_id = p_request_id and starts_at <= now());

  v_atype := upper(coalesce(p_activity_type, v_req.activity_type));
  -- #1250: a Group Task Activity keeps its type and its Group Task, and its title is the Group Task's.
  if (v_atype = 'GROUP_TASK') <> (v_req.activity_type = 'GROUP_TASK') then
    raise exception 'The type of a Group Task Activity cannot be changed.' using errcode = '22023';
  end if;
  if v_req.activity_type = 'GROUP_TASK' and btrim(coalesce(p_purpose, '')) <> v_req.purpose then
    raise exception 'The title of a Group Task Activity is the Group Task''s title and cannot be changed here.' using errcode = '22023';
  end if;
  if v_atype = 'MEETING' and v_type is null then
    v_type := 'ONSITE';
  end if;
  perform public.activity_fields_check(v_atype, v_type, p_venue_id, v_link);
  -- #1087: a meeting link is a web link.
  if v_link is not null and v_link !~* '^https?://\S+$' then
    raise exception 'The meeting link must start with http:// or https://' using errcode = '22023';
  end if;
  v_days := public.activity_days_normalize(p_days, v_atype, p_starts_at, p_ends_at);

  -- #1087: a day that is not already saved is at most one year ahead (Manila dates, the same as the form).
  if exists (
    select 1 from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
    where (x.starts_at at time zone 'Asia/Manila')::date > (now() at time zone 'Asia/Manila')::date + interval '1 year'
      and not exists (
        select 1 from public.meeting_request_days d
        where d.request_id = p_request_id and d.starts_at = x.starts_at and d.ends_at = x.ends_at
      )
  ) then
    raise exception 'An Activity cannot be more than one year ahead.' using errcode = '22023';
  end if;
  -- Before its first day starts, a day that is not already saved must still be in the future.
  if not v_after and exists (
    select 1 from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
    where x.starts_at < now()
      and not exists (
        select 1 from public.meeting_request_days d
        where d.request_id = p_request_id and d.starts_at = x.starts_at and d.ends_at = x.ends_at
      )
  ) then
    raise exception 'An Activity cannot start in the past.' using errcode = '22023';
  end if;

  if p_venue_id is not null and not exists (
    select 1 from public.calendar_venues
    where id = p_venue_id and (active or id = v_req.venue_id)
  ) then
    raise exception 'Choose a Venue that is open for booking.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.employees
    where id = p_facilitator_id and coalesce(is_deleted, false) = false
  ) then
    raise exception 'Choose a Lead.' using errcode = '22023';
  end if;

  if v_purpose = '' then
    raise exception 'Write the purpose of the Activity.' using errcode = '22023';
  end if;
  if char_length(v_purpose) > 500 then
    raise exception 'The purpose can be at most 500 characters.' using errcode = '22023';
  end if;

  -- An edit may keep the Activity's own type, even one its filer could not file today (an Admin Task a
  -- non-head filed before #1063). It may not switch to a type the filer cannot file.
  if v_atype <> v_req.activity_type and not public.activity_can_file(v_actor, v_atype) then
    raise exception 'Only a department head can file the % type.', public.activity_type_phrase(v_atype) using errcode = '42501';
  end if;

  v_head := null;

  -- The same rule as filing, run again on every edit: an approver's own Activity stays approved.
  v_to := case
    when v_after then v_req.status
    when not public.activity_needs_hr(v_atype, p_venue_id, v_req.applicant_id) then 'APPROVED'
    when v_req.status = 'RETURNED' then 'RETURNED'
    else 'PENDING_HR'
  end;
  v_restart := v_to <> v_req.status and v_to in ('PENDING_HEAD', 'PENDING_HR');

  select coalesce(array_agg(btrim(g.name) order by g.i), '{}'),
         coalesce(array_agg(coalesce(btrim(p_guest_emails[g.i]), '') order by g.i), '{}')
    into v_guests, v_emails
    from unnest(coalesce(p_guests, '{}')) with ordinality as g(name, i)
    where btrim(g.name) <> '';
  perform public.guest_emails_check(v_emails);
  perform public.activity_settings_check(v_atype, v_type, v_guests, v_req.activity_type, v_req.meeting_type, v_req.guests);

  select coalesce(array_agg(employee_id order by employee_id), '{}') into v_old_people
    from public.meeting_request_participants where request_id = p_request_id;
  select coalesce(array_agg(e.id order by e.id), '{}') into v_new_people
    from public.employees e where e.id = any(coalesce(p_participant_ids, '{}'));

  select coalesce(jsonb_agg(jsonb_build_object('starts_at', d.starts_at, 'ends_at', d.ends_at) order by d.starts_at), '[]'::jsonb)
    into v_old_days from public.meeting_request_days d where d.request_id = p_request_id;
  select min(x.starts_at), max(x.ends_at) into v_new_start, v_new_end
    from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz);

  if v_req.activity_type <> v_atype then
    v_changed := v_changed || jsonb_build_object('activity_type', jsonb_build_object('from', v_req.activity_type, 'to', v_atype));
  end if;
  if v_req.meeting_type is distinct from v_type then
    v_changed := v_changed || jsonb_build_object('meeting_type', jsonb_build_object('from', v_req.meeting_type, 'to', v_type));
  end if;
  if v_req.venue_id is distinct from p_venue_id then
    v_changed := v_changed || jsonb_build_object('venue_id', jsonb_build_object('from', v_req.venue_id, 'to', p_venue_id));
  end if;
  if v_req.meeting_link is distinct from v_link then
    v_changed := v_changed || jsonb_build_object('meeting_link', jsonb_build_object('from', v_req.meeting_link, 'to', v_link));
  end if;
  if v_req.starts_at <> v_new_start then
    v_changed := v_changed || jsonb_build_object('starts_at', jsonb_build_object('from', v_req.starts_at, 'to', v_new_start));
  end if;
  if v_req.ends_at <> v_new_end then
    v_changed := v_changed || jsonb_build_object('ends_at', jsonb_build_object('from', v_req.ends_at, 'to', v_new_end));
  end if;
  if jsonb_array_length(v_old_days) <> jsonb_array_length(v_days) or exists (
    select 1 from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
    where not exists (
      select 1 from public.meeting_request_days d
      where d.request_id = p_request_id and d.starts_at = x.starts_at and d.ends_at = x.ends_at
    )
  ) then
    v_changed := v_changed || jsonb_build_object('days', jsonb_build_object('from', v_old_days, 'to', v_days));
  end if;
  if v_req.facilitator_id <> p_facilitator_id then
    v_changed := v_changed || jsonb_build_object('facilitator_id', jsonb_build_object('from', v_req.facilitator_id, 'to', p_facilitator_id));
  end if;
  if v_req.purpose <> v_purpose then
    v_changed := v_changed || jsonb_build_object('purpose', jsonb_build_object('from', v_req.purpose, 'to', v_purpose));
  end if;
  if v_req.guests is distinct from v_guests or v_req.guest_emails is distinct from v_emails then
    v_changed := v_changed || jsonb_build_object('guests', jsonb_build_object('from', to_jsonb(v_req.guests), 'to', to_jsonb(v_guests)));
  end if;
  if v_old_people is distinct from v_new_people then
    v_changed := v_changed || jsonb_build_object('participant_ids', jsonb_build_object('from', to_jsonb(v_old_people), 'to', to_jsonb(v_new_people)));
  end if;

  -- #1084: an edit that changes no field is not an edit. The status stays (an approved Activity stays approved),
  -- no event row is written, and the caller is told so (the service then sends no notice and no audit line).
  -- Everything above ran first, so a bad value is still refused.
  if v_changed = '{}'::jsonb then
    return jsonb_build_object(
      'id', p_request_id,
      'action', 'NO_CHANGE',
      'no_change', true,
      'from_status', v_req.status,
      'to_status', v_req.status,
      'changed_fields', '{}'::jsonb,
      'head_id', v_req.head_id,
      'applicant_id', v_req.applicant_id,
      'facilitator_id', v_req.facilitator_id,
      'old_facilitator_id', v_req.facilitator_id,
      'participant_ids', to_jsonb(v_old_people),
      'old_participant_ids', to_jsonb(v_old_people)
    );
  end if;
  -- head_id is not part of the no-change test: an edit never keeps a head (v_head is always null here), so an
  -- Activity saved with a head_id would otherwise never match. It is still written to the log of a real edit.
  if v_req.head_id is distinct from v_head then
    v_changed := v_changed || jsonb_build_object('head_id', jsonb_build_object('from', v_req.head_id, 'to', v_head));
  end if;

  -- Days: drop the ones not started that are no longer listed, add the ones not saved yet.
  delete from public.meeting_request_days d
  where d.request_id = p_request_id
    and not exists (
      select 1 from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
      where x.starts_at = d.starts_at and x.ends_at = d.ends_at
    );
  -- A day in the past may be saved by this function only (the day guard refuses it otherwise).
  perform set_config('app.activity_edit_after_day', case when v_after then 'on' else 'off' end, true);
  insert into public.meeting_request_days (request_id, starts_at, ends_at)
  select p_request_id, x.starts_at, x.ends_at
  from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
  where not exists (
    select 1 from public.meeting_request_days d
    where d.request_id = p_request_id and d.starts_at = x.starts_at and d.ends_at = x.ends_at
  );

  update public.meeting_requests set
    activity_type = v_atype,
    meeting_type = v_type,
    venue_id = p_venue_id,
    meeting_link = v_link,
    starts_at = v_new_start,
    ends_at = v_new_end,
    facilitator_id = p_facilitator_id,
    purpose = v_purpose,
    guests = v_guests,
    guest_emails = v_emails,
    head_id = v_head,
    status = v_to,
    head_decided_at = case when v_restart then null else head_decided_at end,
    head_note = case when v_restart then null else head_note end,
    hr_override = case when v_restart then false else hr_override end,
    hr_decided_by = case when v_restart then null else hr_decided_by end,
    hr_decided_at = case when v_restart then null else hr_decided_at end,
    hr_note = case when v_restart then null else hr_note end
  where id = p_request_id;

  delete from public.meeting_request_participants where request_id = p_request_id;
  insert into public.meeting_request_participants (request_id, employee_id)
  select p_request_id, unnest(v_new_people);

  perform public.log_meeting_request_event(p_request_id, v_actor, 'EDITED', v_req.status, v_to, v_changed, null);

  return jsonb_build_object(
    'id', p_request_id,
    'action', 'EDITED',
    'after_day', v_after,
    'from_status', v_req.status,
    'to_status', v_to,
    'changed_fields', v_changed,
    'head_id', v_head,
    'applicant_id', v_req.applicant_id,
    'facilitator_id', p_facilitator_id,
    'old_facilitator_id', v_req.facilitator_id,
    'participant_ids', to_jsonb(v_new_people),
    'old_participant_ids', to_jsonb(v_old_people)
  );
end;
$function$;

create or replace function public.calendar_entries(
  p_from date,
  p_to date,
  p_include_pending boolean default false
)
returns table (
  kind text,
  id uuid,
  group_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  manila_date date,
  employee jsonb,
  status text,
  hours numeric,
  venue text,
  title text,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_viewer uuid := public.get_employee_id();
  v_hr boolean := false;
  v_super boolean := false;
  v_pending boolean;
begin
  if v_viewer is null then
    return;
  end if;

  select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false) or coalesce(e.can_manage_leaves, false),
         coalesce(e.is_super_admin, false)
    into v_hr, v_super
    from public.employees e
    where e.id = v_viewer;
  v_hr := coalesce(v_hr, false);
  v_super := coalesce(v_super, false);
  v_pending := v_hr and coalesce(p_include_pending, false);

  return query
  select q.* from (
    with src as (
      -- ---- SIL ------------------------------------------------------------
      select 'SIL'::text as kind, s.id, s.leave_group_id as group_id, s.employee_id,
             s.date, s.start_time, s.end_time,
             s.status as raw_status, s.hours, 'SIL'::text as title, s.reason
        from public.sil_leaves s
        where s.date between p_from and p_to
      union all
      -- ---- LWOP -----------------------------------------------------------
      select 'LWOP', l.id, l.leave_group_id, l.employee_id,
             l.date, l.start_time, l.end_time,
             l.status, l.hours, 'LWOP', l.reason
        from public.lwop_leaves l
        where l.date between p_from and p_to
      union all
      -- ---- OFFSET ---------------------------------------------------------
      select 'OFFSET', o.id, o.leave_group_id, o.employee_id,
             o.date, o.start_time, o.end_time,
             o.status, o.hours, 'Offset', o.reason
        from public.offset_leaves o
        where o.date between p_from and p_to
      union all
      -- ---- OVERTIME -------------------------------------------------------
      select 'OVERTIME', ot.id, ot.id, ot.employee_id,
             ot.date, ot.start_time, ot.end_time,
             ot.status, coalesce(ot.approved_hours, ot.hours), 'Overtime', ot.reason
        from public.overtime_requests ot
        where ot.date between p_from and p_to
      union all
      -- ---- UNDERTIME ------------------------------------------------------
      select 'UNDERTIME', u.id, u.id, u.employee_id,
             u.date,
             coalesce(u.actual_start_time, u.original_start_time),
             coalesce(u.actual_end_time, u.original_end_time),
             u.status, coalesce(u.approved_hours, u.hours), 'Undertime', u.reason
        from public.undertime_requests u
        where u.date between p_from and p_to
    )
    select
      s.kind,
      s.id,
      s.group_id,
      ((s.date + coalesce(s.start_time, time '00:00')) at time zone 'Asia/Manila') as starts_at,
      ((s.date + coalesce(s.end_time, time '23:59:59')) at time zone 'Asia/Manila') as ends_at,
      (s.start_time is null) as all_day,
      s.date as manila_date,
      jsonb_build_object('id', e.id, 'name', e.name, 'department', e.department, 'avatar', e.avatar_path) as employee,
      case when s.raw_status = 'PENDING' then 'PENDING' else 'APPROVED' end as status,
      s.hours,
      null::text as venue,
      s.title,
      case when v_hr or s.employee_id = v_viewer
           then jsonb_build_object('reason', s.reason)
           else '{}'::jsonb end as details
    from src s
    join public.employees e on e.id = s.employee_id
    where (s.raw_status in ('APPROVED', 'APPROVED_PAID', 'APPROVED_OFFSET')
           or (s.raw_status = 'PENDING' and v_pending))

    union all


    -- ---- MEETING (one entry per Activity day) -----------------------------
    select
      'MEETING'::text,
      d.id,
      m.id,
      d.starts_at,
      d.ends_at,
      false,
      (d.starts_at at time zone 'Asia/Manila')::date,
      jsonb_build_object('id', a.id, 'name', a.name, 'department', a.department, 'avatar', a.avatar_path),
      case when m.status in ('APPROVED', 'CANCELLED') then 'APPROVED' else 'PENDING' end,
      round((extract(epoch from (d.ends_at - d.starts_at)) / 3600.0)::numeric, 2),
      v.name,
      m.purpose,
      jsonb_build_object(
        'stage', m.status,
        'request_id', m.id,
        'day_index', d.day_index,
        'days_total', d.days_total,
        'range_start', (d.range_start at time zone 'Asia/Manila')::date,
        'range_end', (d.range_end at time zone 'Asia/Manila')::date,
        'last_day_starts_at', d.range_end,
        'purpose', m.purpose,
        'venue', v.name,
        'activity_type', m.activity_type,
        'group_task_id', m.group_task_id,
        'meeting_type', m.meeting_type,
        'meeting_link', m.meeting_link,
        'facilitator', jsonb_build_object('id', f.id, 'name', f.name),
        'participants', coalesce((
          select jsonb_agg(jsonb_build_object('id', pe.id, 'name', pe.name) order by pe.name)
          from public.meeting_request_participants mp
          join public.employees pe on pe.id = mp.employee_id
          where mp.request_id = m.id
        ), '[]'::jsonb),
        'guests', to_jsonb(m.guests),
        'guest_emails', to_jsonb(m.guest_emails)
      )
    from public.meeting_requests m
    join (
      select dd.id, dd.request_id, dd.starts_at, dd.ends_at,
             row_number() over (partition by dd.request_id order by dd.starts_at) as day_index,
             count(*) over (partition by dd.request_id) as days_total,
             min(dd.starts_at) over (partition by dd.request_id) as range_start,
             max(dd.starts_at) over (partition by dd.request_id) as range_end
        from public.meeting_request_days dd
    ) d on d.request_id = m.id
    left join public.calendar_venues v on v.id = m.venue_id
    join public.employees a on a.id = m.applicant_id
    join public.employees f on f.id = m.facilitator_id
    where (
        m.status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED')
        or (m.status = 'CANCELLED' and m.cancelled_at is not null and m.cancelled_at > m.starts_at)
      )
      and (d.starts_at at time zone 'Asia/Manila')::date between p_from and p_to

    union all

    -- ---- SOR_DATE: a date Stage Field marked "Show on Calendar" (#1197) -------
    -- The SOR's latest value for the field, all day on that date. Only a caller who can see the Stage Visit
    -- the value sits on (ADR 0021) gets a row; everyone else gets nothing, not a blank slot. Deleted,
    -- scratch and Lost SORs, archived fields, and a cleared or non-date value give none.
    select
      'SOR_DATE'::text,
      sv.id,
      sv.opportunity_id,
      (sv.d::timestamp at time zone 'Asia/Manila'),
      ((sv.d + 1)::timestamp at time zone 'Asia/Manila') - interval '1 second',
      true,
      sv.d,
      null::jsonb,
      'APPROVED'::text,
      null::numeric,
      null::text,
      coalesce(nullif(btrim(o.project_title), ''), o.client_name) || ' · ' || sv.label,
      jsonb_build_object(
        'opportunity_id', o.id,
        'field_id', sv.field_id,
        'field_label', sv.label,
        'sales_reference', o.sales_reference,
        'client_name', o.client_name
      )
    from (
      select distinct on (val.opportunity_id, val.field_id)
             val.id, val.opportunity_id, val.field_id, val.stage_visit_id, f.label,
             case when (val.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' then (val.value #>> '{}')::date end as d
        from public.sor_stage_field_values val
        join public.flow_stage_fields f on f.id = val.field_id and f.show_on_calendar and f.archived_at is null
        join public.sor_stage_visits vis on vis.id = val.stage_visit_id and vis.undone_at is null
       order by val.opportunity_id, val.field_id, val.updated_at desc, val.id
    ) sv
    join public.sales_opportunities o on o.id = sv.opportunity_id
    where sv.d between p_from and p_to
      and not coalesce(o.is_deleted, false)
      and not coalesce(o.is_scratch, false)
      and not exists (select 1 from public.crm_pipeline_stages ps where ps.code = o.status and ps.is_lost)
      and exists (
        select 1 from public._sor_visible_visit_ids_as(o.id, v_viewer, v_super) as vv(id)
        where vv.id = sv.stage_visit_id
      )
  ) q
  order by q.manila_date, q.starts_at, q.id;
end;
$function$;

revoke all on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb, uuid) from public, anon;
grant execute on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb, uuid) to authenticated;
revoke all on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) from public, anon;
grant execute on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) to authenticated;
revoke all on function public.calendar_entries(date, date, boolean) from public, anon;
grant execute on function public.calendar_entries(date, date, boolean) to authenticated;
