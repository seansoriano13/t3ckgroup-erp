-- #626 (spec #609): HR and Super Admins manage the Venues.
--
-- Venues were read-only after #619. HR (is_hr) and Super Admins may now add, rename, reorder
-- and switch Venues off or on. Everyone else stays read-only. A Venue with any Meeting Request
-- cannot be deleted: meeting_requests.venue_id is on delete restrict (#619), so it can only be
-- switched off and past meetings keep their Venue.
--
-- Written as a file only. Apply it through the normal staging/prod path.

create or replace function public.can_manage_venues()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(
    (select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false)
       from public.employees e
      where e.id = public.get_employee_id()),
    false
  );
$function$;

revoke all on function public.can_manage_venues() from public, anon;
grant execute on function public.can_manage_venues() to authenticated;

drop policy if exists calendar_venues_insert on public.calendar_venues;
create policy calendar_venues_insert on public.calendar_venues
  for insert to authenticated with check (public.can_manage_venues());

drop policy if exists calendar_venues_update on public.calendar_venues;
create policy calendar_venues_update on public.calendar_venues
  for update to authenticated
  using (public.can_manage_venues())
  with check (public.can_manage_venues());

drop policy if exists calendar_venues_delete on public.calendar_venues;
create policy calendar_venues_delete on public.calendar_venues
  for delete to authenticated using (public.can_manage_venues());

grant insert, update, delete on public.calendar_venues to authenticated;
