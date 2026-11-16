-- #1056 (spec #1054): Activities over a date range, one row per day.
-- An Admin Task, Operations Task or Event can run over several days; a Meeting stays one day.
--
-- * New child table meeting_request_days: one row per Manila day (start, end, "reminder sent" mark).
--   Each row keeps the old rules: end after start, one Manila day, 15-minute marks, not in the past when
--   filed. The 06:00 to 21:45 window is checked in the file/edit functions for a listed set of days, not as a table constraint:
--   older rows were never held to it, so a constraint could refuse a harmless update of one of them.
-- * The parent row's starts_at is the first day's start and ends_at the last day's end. Its same-day
--   check now applies to a Meeting only. The no-double-booking constraint stays on the parent (a Meeting
--   is one day, ADR 0038).
-- * A Meeting has exactly one day: a deferred constraint trigger refuses a second one.
-- * Every existing Activity gets one day row whose id is the request id, so a link like
--   ?entry=meeting:<id> still opens its first day. A parent insert with no days gets one automatically.
-- * Changing: a day that has started is frozen. Days not started can be changed or removed.
-- * Cancelling after the first day started deletes the days not started and keeps the held days.
--   cancelled_at tells the Calendar which cancelled Activities still have held days to show: it shows
--   them when cancelled_at is after the first start. A cancel before the start keeps every day row
--   (nothing is deleted) and the Calendar hides it as before.
-- * The 15-minute reminder reads the day rows; the "sent" mark moves to the day. The old column stays.
-- Written as a file only. Apply it through the normal staging/prod path.

-- ---- Table -----------------------------------------------------------------
create table if not exists public.meeting_request_days (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.meeting_requests(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint meeting_request_days_end_after_start check (ends_at > starts_at),
  constraint meeting_request_days_same_manila_day check (
    (starts_at at time zone 'Asia/Manila')::date = (ends_at at time zone 'Asia/Manila')::date
  ),
  constraint meeting_request_days_quarter_hours check (
    mod(extract(epoch from starts_at)::bigint, 900) = 0
    and mod(extract(epoch from ends_at)::bigint, 900) = 0
  )
);
create index if not exists meeting_request_days_request_idx on public.meeting_request_days (request_id, starts_at);
create index if not exists meeting_request_days_starts_at_idx on public.meeting_request_days (starts_at);

alter table public.meeting_request_days enable row level security;
drop policy if exists meeting_request_days_read on public.meeting_request_days;
create policy meeting_request_days_read on public.meeting_request_days
  for select to authenticated using (true);
revoke all on public.meeting_request_days from anon, authenticated;
grant select on public.meeting_request_days to authenticated;

-- Backfill: one day per existing Activity (before the insert guard exists, so past rows copy over).
insert into public.meeting_request_days (id, request_id, starts_at, ends_at, reminder_sent_at)
select m.id, m.id, m.starts_at, m.ends_at, m.reminder_sent_at
from public.meeting_requests m
where not exists (select 1 from public.meeting_request_days d where d.request_id = m.id);

-- ---- Parent changes ----------------------------------------------------------
alter table public.meeting_requests add column if not exists cancelled_at timestamptz;

alter table public.meeting_requests drop constraint if exists meeting_requests_same_manila_day;
alter table public.meeting_requests
  add constraint meeting_requests_same_manila_day check (
    activity_type <> 'MEETING'
    or (starts_at at time zone 'Asia/Manila')::date = (ends_at at time zone 'Asia/Manila')::date
  );

-- ---- Triggers on the day table ----------------------------------------------
create or replace function public.meeting_request_days_guard_insert()
returns trigger
language plpgsql
as $function$
begin
  if new.starts_at < now() then
    raise exception 'A meeting cannot start in the past.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists meeting_request_days_guard_insert on public.meeting_request_days;
create trigger meeting_request_days_guard_insert
  before insert on public.meeting_request_days
  for each row execute function public.meeting_request_days_guard_insert();

-- A parent inserted without days (older callers, tests) gets its one day from its own times.
create or replace function public.meeting_requests_default_day()
returns trigger
language plpgsql
as $function$
begin
  insert into public.meeting_request_days (id, request_id, starts_at, ends_at, reminder_sent_at)
  values (new.id, new.id, new.starts_at, new.ends_at, new.reminder_sent_at);
  return null;
end;
$function$;

drop trigger if exists meeting_requests_default_day on public.meeting_requests;
create trigger meeting_requests_default_day
  after insert on public.meeting_requests
  for each row execute function public.meeting_requests_default_day();

-- A Meeting has exactly one day. Deferred, so a function may swap its day inside one transaction.
create or replace function public.meeting_request_days_meeting_check()
returns trigger
language plpgsql
as $function$
declare
  v_id uuid;
  v_type text;
begin
  if tg_table_name = 'meeting_requests' then
    v_id := new.id;
  else
    v_id := coalesce(new.request_id, old.request_id);
  end if;
  select activity_type into v_type from public.meeting_requests where id = v_id;
  if v_type = 'MEETING' and (select count(*) from public.meeting_request_days where request_id = v_id) <> 1 then
    raise exception 'A Meeting is one day.' using errcode = '23514';
  end if;
  return null;
end;
$function$;

drop trigger if exists meeting_request_days_meeting_check on public.meeting_request_days;
create constraint trigger meeting_request_days_meeting_check
  after insert or update or delete on public.meeting_request_days
  deferrable initially deferred
  for each row execute function public.meeting_request_days_meeting_check();

drop trigger if exists meeting_requests_meeting_days_check on public.meeting_requests;
create constraint trigger meeting_requests_meeting_days_check
  after update of activity_type on public.meeting_requests
  deferrable initially deferred
  for each row execute function public.meeting_request_days_meeting_check();

-- Live Calendar: same pattern as the other Activity tables (#627).
create or replace function public.meeting_request_days_broadcast_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', coalesce(new.request_id, old.request_id)),
      tg_op,
      'meeting_request_days-changes',
      true
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$;

drop trigger if exists meeting_request_days_broadcast_change_trigger on public.meeting_request_days;
create trigger meeting_request_days_broadcast_change_trigger
  after insert or update or delete on public.meeting_request_days
  for each row execute function public.meeting_request_days_broadcast_change();

-- ---- Day list check ----------------------------------------------------------
-- Returns the days as a sorted jsonb array of {starts_at, ends_at}. With no list, the one day is
-- p_starts_at to p_ends_at (older callers, not held to the 06:00 to 21:45 window). Plain messages for the form; the table is the real guard.
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
  r record;
begin
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
  if p_activity_type = 'MEETING' and v_n > 1 then
    raise exception 'A Meeting is one day.' using errcode = '22023';
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
    if mod(extract(epoch from r.starts_at)::bigint, 900) <> 0 or mod(extract(epoch from r.ends_at)::bigint, 900) <> 0 then
      raise exception 'Times must be on 15-minute marks.' using errcode = '22023';
    end if;
    if v_listed and ((r.starts_at at time zone 'Asia/Manila')::time < time '06:00'
       or (r.ends_at at time zone 'Asia/Manila')::time > time '21:45') then
      raise exception 'Times must be between 06:00 and 21:45.' using errcode = '22023';
    end if;
  end loop;

  if (
    select count(distinct (x.starts_at at time zone 'Asia/Manila')::date)
    from jsonb_to_recordset(v_out) as x(starts_at timestamptz, ends_at timestamptz)
  ) <> v_n then
    raise exception 'Each day can be listed only once.' using errcode = '22023';
  end if;

  return v_out;
end;
$function$;

revoke all on function public.activity_days_normalize(jsonb, text, timestamptz, timestamptz) from public, anon;

drop function if exists public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text);
drop function if exists public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text);

-- ---- File ---------------------------------------------------------------------
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
  v_applicant_is_head boolean;
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

  if v_atype = 'EVENT' then
    select coalesce(is_head, false) into v_applicant_is_head from public.employees where id = v_applicant;
    if not coalesce(v_applicant_is_head, false) then
      raise exception 'Only a department head can file an Event.' using errcode = '42501';
    end if;
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

  v_status := case when public.activity_needs_hr(v_atype, p_venue_id) then 'PENDING_HR' else 'APPROVED' end;
  v_head := null;

  select coalesce(array_agg(btrim(g.name) order by g.i), '{}'),
         coalesce(array_agg(coalesce(btrim(p_guest_emails[g.i]), '') order by g.i), '{}')
    into v_guests, v_emails
    from unnest(coalesce(p_guests, '{}')) with ordinality as g(name, i)
    where btrim(g.name) <> '';
  perform public.guest_emails_check(v_emails);

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

-- ---- Edit -----------------------------------------------------------------------
-- p_days is the full list of days after the change. A day that has started must be in it exactly as it
-- is; days not started can be added, changed (a changed day gets a new row and a fresh reminder) or left out.
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
  v_applicant_is_head boolean;
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
    raise exception 'This meeting has already started, so it can no longer be edited.' using errcode = '22023';
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
    raise exception 'A meeting cannot start in the past.' using errcode = '22023';
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

  select coalesce(is_head, false) into v_applicant_is_head from public.employees where id = v_actor;
  if v_atype = 'EVENT' and v_req.activity_type <> 'EVENT' and not coalesce(v_applicant_is_head, false) then
    raise exception 'Only a department head can file an Event.' using errcode = '42501';
  end if;

  v_head := null;

  -- The same rule as filing, run again on every edit: any change to an Event goes back to HR.
  v_to := case
    when not public.activity_needs_hr(v_atype, p_venue_id) then 'APPROVED'
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

-- ---- Cancel ---------------------------------------------------------------------
-- Allowed while a day has not started. If the first day has started, the days not started are removed
-- and the days already held stay (the Calendar keeps showing them, see cancelled_at).
create or replace function public.cancel_meeting_request(
  p_request_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := public.get_employee_id();
  v_is_hr boolean := false;
  v_req public.meeting_requests%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_by_applicant boolean;
  v_action text;
  v_left_end timestamptz;
begin
  if v_actor is null then
    raise exception 'Sign in to cancel an Activity.' using errcode = '42501';
  end if;

  select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false)
    into v_is_hr from public.employees e where e.id = v_actor;
  v_is_hr := coalesce(v_is_hr, false);

  select * into v_req from public.meeting_requests where id = p_request_id for update;
  if not found then
    raise exception 'Activity not found.' using errcode = 'P0002';
  end if;

  v_by_applicant := v_req.applicant_id = v_actor;
  if not (v_by_applicant or v_is_hr) then
    raise exception 'Only the applicant, HR or a Super Admin can cancel this Activity.' using errcode = '42501';
  end if;

  if v_req.status not in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED') then
    raise exception 'A % Activity is final and cannot be cancelled.', lower(v_req.status) using errcode = '22023';
  end if;

  if not exists (select 1 from public.meeting_request_days where request_id = p_request_id and starts_at > now()) then
    raise exception 'This meeting has already started, so it can no longer be cancelled.' using errcode = '22023';
  end if;

  if not v_by_applicant and v_reason is null then
    raise exception 'Write the reason for cancelling this Activity.' using errcode = '22023';
  end if;

  v_action := case when v_by_applicant then 'CANCELLED' else 'HR_CANCELLED' end;

  -- Once a day has started, drop the days that have not; the held days stay.
  if exists (select 1 from public.meeting_request_days where request_id = p_request_id and starts_at <= now()) then
    delete from public.meeting_request_days where request_id = p_request_id and starts_at > now();
    select max(ends_at) into v_left_end from public.meeting_request_days where request_id = p_request_id;
  end if;

  update public.meeting_requests set
    status = 'CANCELLED',
    cancel_reason = v_reason,
    cancelled_by = v_actor,
    cancelled_at = now(),
    ends_at = coalesce(v_left_end, ends_at)
  where id = p_request_id;

  perform public.log_meeting_request_event(p_request_id, v_actor, v_action, v_req.status, 'CANCELLED', null, v_reason);

  return jsonb_build_object(
    'id', p_request_id,
    'action', v_action,
    'from_status', v_req.status,
    'to_status', 'CANCELLED',
    'head_id', v_req.head_id,
    'applicant_id', v_req.applicant_id,
    'facilitator_id', v_req.facilitator_id,
    'participant_ids', coalesce((
      select jsonb_agg(mp.employee_id) from public.meeting_request_participants mp where mp.request_id = p_request_id
    ), '[]'::jsonb)
  );
end;
$function$;

-- ---- Reminder: one per day, the mark lives on the day row ------------------------------
create or replace function public.send_meeting_reminders()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  with due as (
    update public.meeting_request_days dy
       set reminder_sent_at = now()
      from public.meeting_requests r
     where r.id = dy.request_id
       and r.status = 'APPROVED'
       and dy.reminder_sent_at is null
       and dy.starts_at > now()
       and dy.starts_at <= now() + interval '15 minutes'
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
revoke all on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) from public, anon;
grant execute on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) to authenticated;
revoke all on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) from public, anon;
grant execute on function public.edit_meeting_request(uuid, uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid, text, text, text[], text, jsonb) to authenticated;
revoke all on function public.cancel_meeting_request(uuid, text) from public, anon;
grant execute on function public.cancel_meeting_request(uuid, text) to authenticated;

-- ---- Calendar: one entry per Activity day (ADR 0037) ----------------------------
-- id is the DAY's id; group_id and details.request_id are the Activity's id. A day-1 row keeps the
-- request id as its id, so an old link still lands on it. Cancelled Activities show only held days.
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
  v_pending boolean;
begin
  if v_viewer is null then
    return;
  end if;

  select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false) or coalesce(e.can_manage_leaves, false)
    into v_hr
    from public.employees e
    where e.id = v_viewer;
  v_hr := coalesce(v_hr, false);
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
  ) q
  order by q.manila_date, q.starts_at, q.id;
end;
$function$;

revoke all on function public.calendar_entries(date, date, boolean) from public, anon;
grant execute on function public.calendar_entries(date, date, boolean) to authenticated;
