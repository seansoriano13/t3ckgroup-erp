-- #1095 (spec #1093, tracker A2): Settings tables written by a Super Admin, not by every employee.
--
-- crm_lead_sources and system_updates had row level security OFF on staging, so any
-- signed-in employee could add, rename and delete Lead Sources and post a System Announcement.
-- (Production had RLS on for both; system_updates carried a "for all using (true)" policy.)
-- After this: reads stay open to everyone signed in (the Sales forms and the announcement
-- pop-up read them); insert, update and delete are Super Admin only.
--
-- meal_break_settings (Settings > HR & Schedule, "Super Admin or HR") was the one other Settings
-- table found open: RLS off. Reads stay open (the meal rule loads for everyone); writes are HR or Super Admin.
--
-- Idempotent. Any policy already on these tables is dropped first so a leftover cannot keep a table open.

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('crm_lead_sources', 'system_updates', 'meal_break_settings')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter table public.crm_lead_sources enable row level security;
alter table public.system_updates enable row level security;
alter table public.meal_break_settings enable row level security;

-- Lead Sources
create policy crm_lead_sources_read on public.crm_lead_sources
  for select to authenticated using (true);
create policy crm_lead_sources_insert on public.crm_lead_sources
  for insert to authenticated with check (coalesce(public.is_super_admin(), false));
create policy crm_lead_sources_update on public.crm_lead_sources
  for update to authenticated
  using (coalesce(public.is_super_admin(), false))
  with check (coalesce(public.is_super_admin(), false));
create policy crm_lead_sources_delete on public.crm_lead_sources
  for delete to authenticated using (coalesce(public.is_super_admin(), false));

-- System Announcements
create policy system_updates_read on public.system_updates
  for select to authenticated using (true);
create policy system_updates_insert on public.system_updates
  for insert to authenticated with check (coalesce(public.is_super_admin(), false));
create policy system_updates_update on public.system_updates
  for update to authenticated
  using (coalesce(public.is_super_admin(), false))
  with check (coalesce(public.is_super_admin(), false));
create policy system_updates_delete on public.system_updates
  for delete to authenticated using (coalesce(public.is_super_admin(), false));

-- Meal Break windows: HR or Super Admin write (the screen's rule); everyone reads.
create policy meal_break_settings_read on public.meal_break_settings
  for select to authenticated using (true);
create policy meal_break_settings_insert on public.meal_break_settings
  for insert to authenticated
  with check (coalesce(public.is_hr(), false) or coalesce(public.is_super_admin(), false));
create policy meal_break_settings_update on public.meal_break_settings
  for update to authenticated
  using (coalesce(public.is_hr(), false) or coalesce(public.is_super_admin(), false))
  with check (coalesce(public.is_hr(), false) or coalesce(public.is_super_admin(), false));

grant select, insert, update, delete on public.crm_lead_sources to authenticated;
grant select, insert, update, delete on public.system_updates to authenticated;
grant select, insert, update on public.meal_break_settings to authenticated;
