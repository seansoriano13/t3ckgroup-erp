-- Issue #150: the standard working day — 07:30 to 18:00, 18:30 on
-- Wednesdays — existed only as three string literals, written twice inside
-- ApplyLeaveModal. The two copies disagreed about how to read a date (one
-- local time, one UTC), so near midnight they could decide it was a
-- different day.
--
-- This table is that configuration, seeded with the values the literals
-- held, so behaviour is unchanged on day one. Weekday follows Postgres'
-- own convention (0 = Sunday .. 6 = Saturday), matching extract(dow from ...)
-- and the UTC interpretation the existing weekend rule already uses.

create table if not exists public.hr_day_shift_config (
  "weekday" smallint not null check (weekday between 0 and 6),
  "start_time" time,
  "end_time" time,
  "is_working_day" boolean not null default true,
  "updated_at" timestamp with time zone not null default now()
);

alter table public.hr_day_shift_config add constraint "hr_day_shift_config_pkey" primary key (weekday);

insert into public.hr_day_shift_config (weekday, start_time, end_time, is_working_day) values
  (0, null,     null,     false), -- Sunday
  (1, '07:30', '18:00',   true),  -- Monday
  (2, '07:30', '18:00',   true),  -- Tuesday
  (3, '07:30', '18:30',   true),  -- Wednesday
  (4, '07:30', '18:00',   true),  -- Thursday
  (5, '07:30', '18:00',   true),  -- Friday
  (6, null,     null,     false)  -- Saturday
on conflict (weekday) do nothing;

-- ---------------------------------------------------------------------
-- RLS: readable by every authenticated employee (it only ever pre-fills a
-- form); writable only by Super Admin, per the spec's decision that this
-- configuration is a Super Admin surface, not an HR one.
-- ---------------------------------------------------------------------

alter table public.hr_day_shift_config enable row level security;

create policy "hr_day_shift_config_read" on public.hr_day_shift_config
  as permissive
  for select
  to authenticated
  using (true);

create policy "hr_day_shift_config_write" on public.hr_day_shift_config
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))))
  with check ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = get_employee_id()) AND e.is_super_admin))));
