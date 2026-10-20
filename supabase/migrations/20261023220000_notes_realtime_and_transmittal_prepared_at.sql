-- #558 (spec #544): two small fixes found in the purchasing run.
--
-- 1. The Notes panel never saw the "Final Offer changed after the bid was
--    submitted" entry until a refresh. The panel listens with `postgres_changes`
--    on sales_opportunity_logs, but that table was only added to the
--    supabase_realtime publication by archived migration 0021, which the
--    consolidated baseline did not carry forward. A database built from the
--    migrations therefore never announced a log row at all. Re-asserted here,
--    idempotently (docs/realtime-policy.md: postgres_changes needs the table in
--    the publication; the read policy still decides who receives each row).
--
-- 2. A Transmittal's "prepared" value was a date, so it could not say 5 PM and
--    was read back as the wrong hour. It becomes a full timestamp, shown in
--    Asia/Manila. The column keeps its name. Existing slips keep their day: each
--    becomes midnight Manila time of that same day, so the day shown is unchanged
--    (the screens show only the date when the time is exactly midnight Manila).
--
-- Re-runnable: the publication add and the type change are both guarded.

alter table public.sales_opportunity_logs replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'sales_opportunity_logs'
  ) then
    alter publication supabase_realtime add table public.sales_opportunity_logs;
  end if;
end $$;

do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'transmittals' and column_name = 'prepared_on') = 'date' then
    alter table public.transmittals alter column prepared_on drop default;
    alter table public.transmittals
      alter column prepared_on type timestamptz
      using (prepared_on::timestamp at time zone 'Asia/Manila');
    alter table public.transmittals alter column prepared_on set default now();
  end if;
end $$;

-- The name says "on" but the value is a timestamp now (kept so no query or screen breaks).
comment on column public.transmittals.prepared_on is
  'When the slip was prepared: a timestamp (timestamptz), shown in Asia/Manila. Named prepared_on from when it was a date; the name is kept.';
