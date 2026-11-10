-- #619 (spec #609, ADR 0038): Meeting Requests.
--
-- A Meeting Request reserves a Venue for a same-day Manila time window. The
-- database, not the browser, refuses a double-booked Venue: an exclusion
-- constraint over (venue, half-open time range) while the request is pending,
-- returned or approved. Writes go only through functions (security definer);
-- every signed-in employee may read.
--
-- Statuses: PENDING_HEAD, PENDING_HR, RETURNED, APPROVED, DECLINED, CANCELLED.
--
-- Written as a file only. Apply it through the normal staging/prod path.

create extension if not exists btree_gist;

-- ---- Venues ---------------------------------------------------------------
create table if not exists public.calendar_venues (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0
);

insert into public.calendar_venues (name, sort_order)
values ('Conference Room', 1), ('Admin Office', 2)
on conflict (name) do nothing;

-- ---- Meeting requests -----------------------------------------------------
create table if not exists public.meeting_requests (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.employees(id),
  venue_id uuid not null references public.calendar_venues(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  facilitator_id uuid not null references public.employees(id),
  purpose text not null,
  guests text[] not null default '{}',
  status text not null default 'PENDING_HEAD',
  head_id uuid references public.employees(id),
  head_decided_at timestamptz,
  head_note text,
  hr_override boolean not null default false,
  hr_decided_by uuid references public.employees(id),
  hr_decided_at timestamptz,
  hr_note text,
  return_note text,
  returned_by uuid references public.employees(id),
  cancel_reason text,
  cancelled_by uuid references public.employees(id),
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_requests_status_check check (
    status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED', 'DECLINED', 'CANCELLED')
  ),
  constraint meeting_requests_end_after_start check (ends_at > starts_at),
  constraint meeting_requests_same_manila_day check (
    (starts_at at time zone 'Asia/Manila')::date = (ends_at at time zone 'Asia/Manila')::date
  ),
  constraint meeting_requests_quarter_hours check (
    mod(extract(epoch from starts_at)::bigint, 900) = 0
    and mod(extract(epoch from ends_at)::bigint, 900) = 0
  )
);

alter table public.meeting_requests
  add constraint meeting_requests_no_double_booking
  exclude using gist (
    venue_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED'));

create index if not exists meeting_requests_starts_at_idx on public.meeting_requests (starts_at);
create index if not exists meeting_requests_applicant_idx on public.meeting_requests (applicant_id);
create index if not exists meeting_requests_head_idx on public.meeting_requests (head_id) where head_id is not null;

create table if not exists public.meeting_request_participants (
  request_id uuid not null references public.meeting_requests(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  primary key (request_id, employee_id)
);
create index if not exists meeting_request_participants_employee_idx on public.meeting_request_participants (employee_id);

create table if not exists public.meeting_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.meeting_requests(id) on delete cascade,
  actor_id uuid references public.employees(id),
  action text not null,
  from_status text,
  to_status text,
  changed_fields jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists meeting_request_events_request_idx on public.meeting_request_events (request_id, created_at);

-- A request may not be filed for a time that has already started. Checked on
-- insert only, so approving or cancelling a meeting later is never blocked by it.
create or replace function public.meeting_requests_guard_insert()
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

drop trigger if exists meeting_requests_guard_insert on public.meeting_requests;
create trigger meeting_requests_guard_insert
  before insert on public.meeting_requests
  for each row execute function public.meeting_requests_guard_insert();

create or replace function public.meeting_requests_touch()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists meeting_requests_touch on public.meeting_requests;
create trigger meeting_requests_touch
  before update on public.meeting_requests
  for each row execute function public.meeting_requests_touch();

-- ---- Row-level security: read for everyone signed in, no direct writes ----
alter table public.calendar_venues enable row level security;
alter table public.meeting_requests enable row level security;
alter table public.meeting_request_participants enable row level security;
alter table public.meeting_request_events enable row level security;

drop policy if exists calendar_venues_read on public.calendar_venues;
create policy calendar_venues_read on public.calendar_venues
  for select to authenticated using (true);
drop policy if exists meeting_requests_read on public.meeting_requests;
create policy meeting_requests_read on public.meeting_requests
  for select to authenticated using (true);
drop policy if exists meeting_request_participants_read on public.meeting_request_participants;
create policy meeting_request_participants_read on public.meeting_request_participants
  for select to authenticated using (true);
drop policy if exists meeting_request_events_read on public.meeting_request_events;
create policy meeting_request_events_read on public.meeting_request_events
  for select to authenticated using (true);

revoke all on public.calendar_venues, public.meeting_requests,
  public.meeting_request_participants, public.meeting_request_events from anon, authenticated;
grant select on public.calendar_venues, public.meeting_requests,
  public.meeting_request_participants, public.meeting_request_events to authenticated;

-- ---- Event log helper (internal; later tickets reuse it) -------------------
create or replace function public.log_meeting_request_event(
  p_request_id uuid,
  p_actor_id uuid,
  p_action text,
  p_from_status text,
  p_to_status text,
  p_changed_fields jsonb default null,
  p_note text default null
)
returns void
language sql
security definer
set search_path = public
as $function$
  insert into public.meeting_request_events (request_id, actor_id, action, from_status, to_status, changed_fields, note)
  values (p_request_id, p_actor_id, p_action, p_from_status, p_to_status, p_changed_fields, p_note);
$function$;

revoke all on function public.log_meeting_request_event(uuid, uuid, text, text, text, jsonb, text) from public, anon, authenticated;

-- ---- Who holds a slot (for the plain clash message) ------------------------
create or replace function public.meeting_request_holder(
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_id uuid default null
)
returns table (id uuid, purpose text, starts_at timestamptz, ends_at timestamptz, applicant_name text, venue_name text)
language sql
stable
security definer
set search_path = public
as $function$
  select m.id, m.purpose, m.starts_at, m.ends_at, e.name, v.name
    from public.meeting_requests m
    join public.employees e on e.id = m.applicant_id
    join public.calendar_venues v on v.id = m.venue_id
    where public.get_employee_id() is not null
      and m.venue_id = p_venue_id
      and m.status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED')
      and tstzrange(m.starts_at, m.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
      and (p_exclude_id is null or m.id <> p_exclude_id)
    order by m.starts_at
    limit 1;
$function$;

revoke all on function public.meeting_request_holder(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.meeting_request_holder(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---- Filing ----------------------------------------------------------------
create or replace function public.file_meeting_request(
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_facilitator_id uuid,
  p_purpose text,
  p_guests text[] default '{}',
  p_participant_ids uuid[] default '{}',
  p_head_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_applicant uuid := public.get_employee_id();
  v_applicant_is_head boolean;
  v_status text;
  v_head uuid;
  v_id uuid;
  v_guests text[];
begin
  if v_applicant is null then
    raise exception 'Sign in to file a Meeting Request.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.calendar_venues where id = p_venue_id and active) then
    raise exception 'Choose a Venue that is open for booking.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.employees
    where id = p_facilitator_id and coalesce(is_head, false) and coalesce(is_deleted, false) = false
  ) then
    raise exception 'The Facilitator must be a department head.' using errcode = '22023';
  end if;

  if coalesce(btrim(p_purpose), '') = '' then
    raise exception 'Write the purpose of the meeting.' using errcode = '22023';
  end if;

  select coalesce(is_head, false) into v_applicant_is_head from public.employees where id = v_applicant;

  if v_applicant_is_head then
    v_status := 'PENDING_HR';
    v_head := null;
  else
    v_status := 'PENDING_HEAD';
    if p_head_id is null or not exists (
      select 1 from public.employees
      where id = p_head_id and coalesce(is_head, false) and coalesce(is_deleted, false) = false
    ) then
      raise exception 'Choose the department head who approves this request.' using errcode = '22023';
    end if;
    v_head := p_head_id;
  end if;

  select coalesce(array_agg(btrim(g)) filter (where btrim(g) <> ''), '{}')
    into v_guests from unnest(coalesce(p_guests, '{}')) as g;

  insert into public.meeting_requests (
    applicant_id, venue_id, starts_at, ends_at, facilitator_id, purpose, guests, status, head_id
  ) values (
    v_applicant, p_venue_id, p_starts_at, p_ends_at, p_facilitator_id, btrim(p_purpose), v_guests, v_status, v_head
  ) returning id into v_id;

  insert into public.meeting_request_participants (request_id, employee_id)
  select v_id, e.id from public.employees e
  where e.id = any(coalesce(p_participant_ids, '{}'))
  on conflict do nothing;

  perform public.log_meeting_request_event(
    v_id, v_applicant, 'FILED', null, v_status,
    jsonb_build_object('venue_id', p_venue_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at,
                       'facilitator_id', p_facilitator_id, 'head_id', v_head),
    null
  );

  return v_id;
end;
$function$;

revoke all on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid) from public, anon;
grant execute on function public.file_meeting_request(uuid, timestamptz, timestamptz, uuid, text, text[], uuid[], uuid) to authenticated;

-- ---- Calendar: add the MEETING branch --------------------------------------
-- Meetings are visible to everyone while they hold a slot (pending, returned or
-- approved); the stage rides in details.stage. Pending and returned ones come
-- out as status PENDING so the Calendar draws them faded.
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

    -- ---- MEETING --------------------------------------------------------
    select
      'MEETING'::text,
      m.id,
      m.id,
      m.starts_at,
      m.ends_at,
      false,
      (m.starts_at at time zone 'Asia/Manila')::date,
      jsonb_build_object('id', a.id, 'name', a.name, 'department', a.department, 'avatar', a.avatar_path),
      case when m.status = 'APPROVED' then 'APPROVED' else 'PENDING' end,
      round((extract(epoch from (m.ends_at - m.starts_at)) / 3600.0)::numeric, 2),
      v.name,
      m.purpose,
      jsonb_build_object(
        'stage', m.status,
        'purpose', m.purpose,
        'venue', v.name,
        'facilitator', jsonb_build_object('id', f.id, 'name', f.name),
        'participants', coalesce((
          select jsonb_agg(jsonb_build_object('id', pe.id, 'name', pe.name) order by pe.name)
          from public.meeting_request_participants mp
          join public.employees pe on pe.id = mp.employee_id
          where mp.request_id = m.id
        ), '[]'::jsonb),
        'guests', to_jsonb(m.guests)
      )
    from public.meeting_requests m
    join public.calendar_venues v on v.id = m.venue_id
    join public.employees a on a.id = m.applicant_id
    join public.employees f on f.id = m.facilitator_id
    where m.status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED')
      and (m.starts_at at time zone 'Asia/Manila')::date between p_from and p_to
  ) q
  order by q.manila_date, q.starts_at, q.id;
end;
$function$;

revoke all on function public.calendar_entries(date, date, boolean) from public, anon;
grant execute on function public.calendar_entries(date, date, boolean) to authenticated;
