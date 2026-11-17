-- #1064 (spec #1062): Settings > Activities. The rules #1063 fixed in code are now settings HR and Super Admins change.
--
-- * activity_type_settings    one row per Activity type: name, colour, on/off, who files it, whether it waits for
--                             HR, whether it can run over several days. At least one type stays on; no fifth type.
-- * activity_general_settings one row: the Meeting types that are on, the earliest start and latest end, the time
--                             step, the default start and end, the reminder lead, the longest range, Guests.
-- Everyone signed in can read them; only HR and Super Admins change them (the database refuses anyone else).
-- The database reads them live when filing, editing, checking the days and sending reminders. A change applies to
-- new filings and edits only: an Activity already filed keeps its type, meeting type, days and guests, and an edit
-- may keep what the Activity already has. Starting values are the rules #1063 and #1056 had in code.
-- Written as a file only. Apply it through the normal staging/prod path.

-- ---- Tables --------------------------------------------------------------------------------
create table if not exists public.activity_type_settings (
  activity_type text primary key check (activity_type in ('MEETING', 'ADMIN_TASK', 'OPERATIONS_TASK', 'EVENT')),
  name text not null check (btrim(name) <> '' and char_length(name) <= 40),
  color text not null check (color in ('teal', 'indigo', 'orange', 'plum', 'blue', 'green', 'pink', 'amber', 'violet')),
  active boolean not null default true,
  who_files text not null default 'HEADS' check (who_files in ('EVERYONE', 'HEADS')),
  needs_hr boolean not null default false,
  multi_day boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.activity_type_settings is
  '#1064: one row per Activity type. who_files EVERYONE or HEADS; needs_hr = waits for HR (a Meeting only when it holds a Venue; never when the filer is HR or a Super Admin); multi_day = can run over several days. HR and Super Admins edit.';

create table if not exists public.activity_general_settings (
  id boolean primary key default true check (id),
  meeting_onsite boolean not null default true,
  meeting_online boolean not null default true,
  meeting_hybrid boolean not null default true,
  earliest_start time not null default '06:00',
  latest_end time not null default '21:45',
  time_step_minutes smallint not null default 15 check (time_step_minutes in (15, 30, 60)),
  default_start time not null default '09:00',
  default_end time not null default '10:00',
  reminder_minutes integer not null default 15 check (reminder_minutes between 5 and 1440),
  max_days integer not null default 31 check (max_days between 1 and 366),
  guests_allowed boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint activity_general_window_chk check (earliest_start < latest_end),
  constraint activity_general_default_chk check (
    default_start < default_end and default_start >= earliest_start and default_end <= latest_end
  ),
  constraint activity_general_step_chk check (
    mod((extract(epoch from earliest_start) / 60)::int, time_step_minutes) = 0
    and mod((extract(epoch from latest_end) / 60)::int, time_step_minutes) = 0
    and mod((extract(epoch from default_start) / 60)::int, time_step_minutes) = 0
    and mod((extract(epoch from default_end) / 60)::int, time_step_minutes) = 0
  ),
  constraint activity_general_one_meeting_type_chk check (meeting_onsite or meeting_online or meeting_hybrid)
);

comment on table public.activity_general_settings is
  '#1064: Activity settings that are not per type, one row. HR and Super Admins edit.';

insert into public.activity_type_settings (activity_type, name, color, active, who_files, needs_hr, multi_day) values
  ('MEETING', 'Meeting', 'teal', true, 'EVERYONE', true, false),
  ('ADMIN_TASK', 'Admin Task', 'indigo', true, 'HEADS', false, true),
  ('OPERATIONS_TASK', 'Operations Task', 'orange', true, 'HEADS', false, true),
  ('EVENT', 'Event', 'plum', true, 'HEADS', false, true)
on conflict (activity_type) do nothing;
insert into public.activity_general_settings (id) values (true) on conflict (id) do nothing;

-- Only HR and Super Admins change either table.
create or replace function public.can_manage_activity_settings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false)
       from public.employees e where e.id = public.get_employee_id()),
    false
  );
$function$;
revoke all on function public.can_manage_activity_settings() from public, anon;
grant execute on function public.can_manage_activity_settings() to authenticated;

alter table public.activity_type_settings enable row level security;
alter table public.activity_general_settings enable row level security;

drop policy if exists activity_type_settings_read on public.activity_type_settings;
create policy activity_type_settings_read on public.activity_type_settings for select to authenticated using (true);
drop policy if exists activity_type_settings_update on public.activity_type_settings;
create policy activity_type_settings_update on public.activity_type_settings
  for update to authenticated using (public.can_manage_activity_settings()) with check (public.can_manage_activity_settings());
drop policy if exists activity_general_settings_read on public.activity_general_settings;
create policy activity_general_settings_read on public.activity_general_settings for select to authenticated using (true);
drop policy if exists activity_general_settings_update on public.activity_general_settings;
create policy activity_general_settings_update on public.activity_general_settings
  for update to authenticated using (public.can_manage_activity_settings()) with check (public.can_manage_activity_settings());

revoke all on public.activity_type_settings from anon, authenticated;
revoke all on public.activity_general_settings from anon, authenticated;
grant select, update on public.activity_type_settings to authenticated;
grant select, update on public.activity_general_settings to authenticated;

-- At least one type stays on.
create or replace function public.activity_type_settings_guard()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  if new.active = false and old.active
     and not exists (select 1 from public.activity_type_settings t where t.active and t.activity_type <> new.activity_type) then
    raise exception 'At least one Activity type must stay on.' using errcode = '22023';
  end if;
  return new;
end;
$function$;
drop trigger if exists activity_type_settings_guard on public.activity_type_settings;
create trigger activity_type_settings_guard before update on public.activity_type_settings
  for each row execute function public.activity_type_settings_guard();

create or replace function public.activity_general_settings_touch()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
drop trigger if exists activity_general_settings_touch on public.activity_general_settings;
create trigger activity_general_settings_touch before update on public.activity_general_settings
  for each row execute function public.activity_general_settings_touch();

-- ---- The rules, read live ----------------------------------------------------------------------
create or replace function public.activity_can_file(p_employee_id uuid, p_activity_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_employee_id is null then false
    else coalesce((
      select case t.who_files
               when 'EVERYONE' then true
               else coalesce((select coalesce(e.is_head, false) from public.employees e where e.id = p_employee_id), false)
             end
        from public.activity_type_settings t
       where t.activity_type = p_activity_type
    ), false)
  end;
$function$;

create or replace function public.activity_type_phrase(p_activity_type text)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((select t.name from public.activity_type_settings t where t.activity_type = p_activity_type), 'this Activity type');
$function$;

drop function if exists public.activity_needs_hr(text, uuid, uuid);
create or replace function public.activity_needs_hr(p_activity_type text, p_venue_id uuid, p_filer_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
           select t.needs_hr and (p_activity_type <> 'MEETING' or p_venue_id is not null)
             from public.activity_type_settings t where t.activity_type = p_activity_type
         ), false)
     and not public.activity_is_approver(p_filer_id);
$function$;

-- Refuses what the settings turn away. An edit may keep what the Activity already has (its type, its
-- meeting type, its guests): a change applies to new filings and edits only. The p_old_* values are the
-- saved Activity's, or null when filing.
create or replace function public.activity_settings_check(
  p_activity_type text,
  p_meeting_type text,
  p_guests text[],
  p_old_activity_type text default null,
  p_old_meeting_type text default null,
  p_old_guests text[] default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  g public.activity_general_settings%rowtype;
  v_on boolean;
  v_name text;
begin
  select * into g from public.activity_general_settings limit 1;
  select t.active, t.name into v_on, v_name from public.activity_type_settings t where t.activity_type = p_activity_type;
  if not coalesce(v_on, false) and p_activity_type is distinct from p_old_activity_type then
    raise exception '% is switched off, so it cannot be filed.', coalesce(v_name, 'That Activity type') using errcode = '22023';
  end if;
  if p_activity_type = 'MEETING' and p_meeting_type is distinct from p_old_meeting_type
     and not case p_meeting_type when 'ONSITE' then g.meeting_onsite when 'ONLINE' then g.meeting_online when 'HYBRID' then g.meeting_hybrid else true end then
    raise exception '% meetings are switched off.', initcap(lower(p_meeting_type)) using errcode = '22023';
  end if;
  if not g.guests_allowed and coalesce(array_length(p_guests, 1), 0) > 0
     and p_guests is distinct from coalesce(p_old_guests, '{}') then
    raise exception 'Guests are not allowed on an Activity.' using errcode = '22023';
  end if;
end;
$function$;

-- The day list check, now held to the settings: hours, time step, several days, longest range.
create or replace function public.activity_days_normalize(
  p_days jsonb,
  p_activity_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_raw jsonb;
  v_out jsonb;
  v_n int;
  v_listed boolean := coalesce(case when jsonb_typeof(p_days) = 'array' then jsonb_array_length(p_days) > 0 end, false);
  g public.activity_general_settings%rowtype;
  v_multi boolean;
  v_name text;
  v_span int;
  r record;
begin
  select * into g from public.activity_general_settings limit 1;
  select t.multi_day, t.name into v_multi, v_name from public.activity_type_settings t where t.activity_type = p_activity_type;

  v_raw := case
    when p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) = 0
      then jsonb_build_array(jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at))
    else p_days
  end;

  select coalesce(jsonb_agg(jsonb_build_object('starts_at', x.starts_at, 'ends_at', x.ends_at) order by x.starts_at), '[]'::jsonb)
    into v_out
    from jsonb_to_recordset(v_raw) as x(starts_at timestamptz, ends_at timestamptz);
  v_n := jsonb_array_length(v_out);

  if v_n = 0 then
    raise exception 'Choose at least one day.' using errcode = '22023';
  end if;
  if v_n > 1 and not coalesce(v_multi, false) then
    raise exception 'A % is one day.', coalesce(v_name, 'Meeting') using errcode = '22023';
  end if;

  for r in select x.starts_at, x.ends_at from jsonb_to_recordset(v_out) as x(starts_at timestamptz, ends_at timestamptz) loop
    if r.starts_at is null or r.ends_at is null then
      raise exception 'Every day needs a start and an end.' using errcode = '22023';
    end if;
    if r.ends_at <= r.starts_at then
      raise exception 'Each day must end after it starts.' using errcode = '22023';
    end if;
    if (r.starts_at at time zone 'Asia/Manila')::date <> (r.ends_at at time zone 'Asia/Manila')::date then
      raise exception 'Each day must start and end on the same day.' using errcode = '22023';
    end if;
    if mod(extract(epoch from r.starts_at)::bigint, g.time_step_minutes * 60) <> 0
       or mod(extract(epoch from r.ends_at)::bigint, g.time_step_minutes * 60) <> 0 then
      raise exception 'Times must be on %-minute marks.', g.time_step_minutes using errcode = '22023';
    end if;
    if v_listed and ((r.starts_at at time zone 'Asia/Manila')::time < g.earliest_start
       or (r.ends_at at time zone 'Asia/Manila')::time > g.latest_end) then
      raise exception 'Times must be between % and %.', to_char(g.earliest_start, 'HH24:MI'), to_char(g.latest_end, 'HH24:MI') using errcode = '22023';
    end if;
  end loop;

  if (
    select count(distinct (x.starts_at at time zone 'Asia/Manila')::date)
    from jsonb_to_recordset(v_out) as x(starts_at timestamptz, ends_at timestamptz)
  ) <> v_n then
    raise exception 'Each day can be listed only once.' using errcode = '22023';
  end if;

  select ((max((x.starts_at at time zone 'Asia/Manila')::date) - min((x.starts_at at time zone 'Asia/Manila')::date)) + 1)
    into v_span from jsonb_to_recordset(v_out) as x(starts_at timestamptz, ends_at timestamptz);
  if v_span > g.max_days then
    raise exception 'An Activity can cover at most % days.', g.max_days using errcode = '22023';
  end if;

  return v_out;
end;
$function$;

revoke all on function public.activity_days_normalize(jsonb, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.activity_can_file(uuid, text) from public, anon, authenticated;
revoke all on function public.activity_type_phrase(text) from public, anon, authenticated;
revoke all on function public.activity_needs_hr(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.activity_settings_check(text, text, text[], text, text, text[]) from public, anon, authenticated;

-- A Meeting may now run over several days when its setting says so. The day-count trigger refuses a second
-- day on a Meeting only while its type is one day, and only on an insert; the parent's one-day check is
-- dropped (each day row is still one Manila day, and file/edit hold the day list to the settings).
-- An Activity already filed keeps its days whatever the setting becomes.
create or replace function public.meeting_request_days_meeting_check()
returns trigger
language plpgsql
as $function$
declare
  v_id uuid;
  v_type text;
  v_multi boolean;
begin
  if tg_table_name = 'meeting_requests' then
    v_id := new.id;
  else
    v_id := coalesce(new.request_id, old.request_id);
  end if;
  select activity_type into v_type from public.meeting_requests where id = v_id;
  select multi_day into v_multi from public.activity_type_settings where activity_type = v_type;
  if v_type = 'MEETING' and not coalesce(v_multi, false)
     and (select count(*) from public.meeting_request_days where request_id = v_id) <> 1
     and (tg_op = 'INSERT' or tg_table_name = 'meeting_requests') then
    raise exception 'A Meeting is one day.' using errcode = '23514';
  end if;
  return null;
end;
$function$;

alter table public.meeting_requests drop constraint if exists meeting_requests_same_manila_day;

-- ---- Reminder: the lead time is a setting ----------------------------------------------------------------
create or replace function public.send_meeting_reminders()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
  v_lead integer;
begin
  select reminder_minutes into v_lead from public.activity_general_settings limit 1;
  v_lead := coalesce(v_lead, 15);

  with due as (
    update public.meeting_request_days dy
       set reminder_sent_at = now()
      from public.meeting_requests r
     where r.id = dy.request_id
       and r.status = 'APPROVED'
       and dy.reminder_sent_at is null
       and dy.starts_at > now()
       and dy.starts_at <= now() + make_interval(mins => v_lead)
    returning r.id, r.applicant_id, r.facilitator_id, r.venue_id, r.meeting_type, dy.starts_at, r.purpose
  ),
  people as (
    select d.id as request_id, d.starts_at, d.applicant_id as person_id from due d
    union
    select d.id, d.starts_at, d.facilitator_id from due d
    union
    select d.id, d.starts_at, p.employee_id
      from due d
      join public.meeting_request_participants p on p.request_id = d.id
  ),
  ins as (
    insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
    select pe.person_id,
           null,
           'MEETING_REMINDER',
           'Activity starts soon',
           concat_ws(', ',
                     case
                       when v.name is not null then v.name
                       when d.meeting_type = 'ONLINE' then 'Online'
                     end,
                     to_char(d.starts_at at time zone 'Asia/Manila', 'Mon FMDD, FMHH12:MI AM')
           ) || ': ' || d.purpose,
           d.id
      from people pe
      join due d on d.id = pe.request_id and d.starts_at = pe.starts_at
      left join public.calendar_venues v on v.id = d.venue_id
    returning 1
  )
  select count(*) into v_count from ins;

  return coalesce(v_count, 0);
end;
$function$;
revoke all on function public.send_meeting_reminders() from public, anon, authenticated;

-- ---- File and edit (the #1063 functions, now held to the settings) -----------------------------------------------------------------------
drop function if exists public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb);
drop function if exists public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb);

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
  p_days jsonb default null
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
begin
  if v_applicant is null then
    raise exception 'Sign in to file an Activity.' using errcode = '42501';
  end if;

  if v_atype = 'MEETING' and v_type is null then
    v_type := 'ONSITE';
  end if;
  perform public.activity_fields_check(v_atype, v_type, p_venue_id, v_link);
  v_days := public.activity_days_normalize(p_days, v_atype, p_starts_at, p_ends_at);

  if not public.activity_can_file(v_applicant, v_atype) then
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

  if coalesce(btrim(p_purpose), '') = '' then
    raise exception 'Write the purpose of the Activity.' using errcode = '22023';
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
    meeting_type, meeting_link, activity_type
  ) values (
    v_applicant, p_venue_id, v_first_start, v_first_end, p_facilitator_id, btrim(p_purpose), v_guests, v_emails, v_status, v_head,
    v_type, v_link, v_atype
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
    jsonb_build_object('activity_type', v_atype, 'meeting_type', v_type, 'venue_id', p_venue_id, 'starts_at', v_first_start, 'ends_at', v_last_end,
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

  -- Editable while at least one day has not started.
  if not exists (select 1 from public.meeting_request_days where request_id = p_request_id and starts_at > now()) then
    raise exception 'This Activity has already started, so it can no longer be edited.' using errcode = '22023';
  end if;

  v_atype := upper(coalesce(p_activity_type, v_req.activity_type));
  if v_atype = 'MEETING' and v_type is null then
    v_type := 'ONSITE';
  end if;
  perform public.activity_fields_check(v_atype, v_type, p_venue_id, v_link);
  v_days := public.activity_days_normalize(p_days, v_atype, p_starts_at, p_ends_at);

  -- Days that have started stay exactly as they are.
  if exists (
    select 1 from public.meeting_request_days d
    where d.request_id = p_request_id and d.starts_at <= now()
      and not exists (
        select 1 from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
        where x.starts_at = d.starts_at and x.ends_at = d.ends_at
      )
  ) then
    raise exception 'A day that has already started cannot be changed or removed.' using errcode = '22023';
  end if;
  -- Any day that is not already saved must be in the future.
  if exists (
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

  -- An edit may keep the Activity's own type, even one its filer could not file today (an Admin Task a
  -- non-head filed before #1063). It may not switch to a type the filer cannot file.
  if v_atype <> v_req.activity_type and not public.activity_can_file(v_actor, v_atype) then
    raise exception 'Only a department head can file the % type.', public.activity_type_phrase(v_atype) using errcode = '42501';
  end if;

  v_head := null;

  -- The same rule as filing, run again on every edit: an approver's own Activity stays approved.
  v_to := case
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
  if v_req.head_id is distinct from v_head then
    v_changed := v_changed || jsonb_build_object('head_id', jsonb_build_object('from', v_req.head_id, 'to', v_head));
  end if;

  -- Days: drop the ones not started that are no longer listed, add the ones not saved yet.
  delete from public.meeting_request_days d
  where d.request_id = p_request_id and d.starts_at > now()
    and not exists (
      select 1 from jsonb_to_recordset(v_days) as x(starts_at timestamptz, ends_at timestamptz)
      where x.starts_at = d.starts_at and x.ends_at = d.ends_at
    );
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

revoke all on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) from public, anon;
grant execute on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) to authenticated;
revoke all on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) from public, anon;
grant execute on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) to authenticated;

