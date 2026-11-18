-- #1062 review fix: a Venue is held per day, not for the whole span of an Activity.
-- The no-double-booking rule (20261028300000) was an exclusion constraint over the parent row's whole
-- start-to-end range. A room Meeting that runs over several days then blocked its Venue overnight and on
-- the days it skips. The rule now looks at the day rows (meeting_request_days): two Activities clash only
-- when a day of one overlaps a day of the other at the same Venue, while both are pending, returned or approved.
-- It still raises exclusion_violation (23P01), so the app's message for a clash is unchanged.
-- Checked at the end of the transaction, because file and edit replace the day rows inside one transaction.
-- Written as a file only. Apply it through the normal staging/prod path.

alter table public.meeting_requests drop constraint if exists meeting_requests_no_double_booking;

create or replace function public.meeting_request_venue_clash_check()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_id uuid;
  v_venue uuid;
begin
  -- Read the id with if/else: plpgsql resolves every field in a CASE, and
  -- meeting_requests rows have no request_id.
  if tg_table_name = 'meeting_requests' then
    v_id := new.id;
  else
    v_id := new.request_id;
  end if;
  select m.venue_id into v_venue from public.meeting_requests m
   where m.id = v_id and m.venue_id is not null and m.status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED');
  if v_venue is null then
    return null;
  end if;
  -- One at a time per Venue, so two filings made together cannot both pass.
  perform pg_advisory_xact_lock(hashtextextended(v_venue::text, 0));
  if exists (
    select 1
      from public.meeting_request_days d
      join public.meeting_requests o on o.venue_id = v_venue and o.id <> v_id
           and o.status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED')
      join public.meeting_request_days od on od.request_id = o.id
     where d.request_id = v_id
       and tstzrange(d.starts_at, d.ends_at, '[)') && tstzrange(od.starts_at, od.ends_at, '[)')
  ) then
    raise exception 'That Venue is already booked at that time.' using errcode = '23P01';
  end if;
  return null;
end;
$function$;

drop trigger if exists meeting_request_days_venue_clash on public.meeting_request_days;
create constraint trigger meeting_request_days_venue_clash
  after insert or update of starts_at, ends_at, request_id on public.meeting_request_days
  deferrable initially deferred
  for each row execute function public.meeting_request_venue_clash_check();

drop trigger if exists meeting_requests_venue_clash on public.meeting_requests;
create constraint trigger meeting_requests_venue_clash
  after update of venue_id, status on public.meeting_requests
  deferrable initially deferred
  for each row execute function public.meeting_request_venue_clash_check();

-- Who holds a slot, for the plain clash message: now by day. `p_days` is the list the filer sent
-- ([{starts_at, ends_at}]); with none, the one span p_starts_at to p_ends_at is checked.
drop function if exists public.meeting_request_holder(uuid, timestamptz, timestamptz, uuid);
create or replace function public.meeting_request_holder(
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_id uuid default null,
  p_days jsonb default null
)
returns table (id uuid, purpose text, starts_at timestamptz, ends_at timestamptz, applicant_name text, venue_name text)
language sql
stable
security definer
set search_path = public
as $function$
  with wanted as (
    select x.starts_at, x.ends_at
      from jsonb_to_recordset(
             case when jsonb_typeof(p_days) = 'array' and jsonb_array_length(p_days) > 0 then p_days
                  else jsonb_build_array(jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at)) end
           ) as x(starts_at timestamptz, ends_at timestamptz)
  )
  select m.id, m.purpose, d.starts_at, d.ends_at, e.name, v.name
    from public.meeting_requests m
    join public.meeting_request_days d on d.request_id = m.id
    join public.employees e on e.id = m.applicant_id
    join public.calendar_venues v on v.id = m.venue_id
    where public.get_employee_id() is not null
      and m.venue_id = p_venue_id
      and m.status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED')
      and exists (select 1 from wanted w where tstzrange(d.starts_at, d.ends_at, '[)') && tstzrange(w.starts_at, w.ends_at, '[)'))
      and (p_exclude_id is null or m.id <> p_exclude_id)
    order by d.starts_at
    limit 1;
$function$;

revoke all on function public.meeting_request_holder(uuid, timestamptz, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.meeting_request_holder(uuid, timestamptz, timestamptz, uuid, jsonb) to authenticated;
