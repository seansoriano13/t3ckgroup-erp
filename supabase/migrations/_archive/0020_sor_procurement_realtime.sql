-- Migration 0020: Enable Supabase Realtime for SOR Procurement Requests
--
-- Postgres Realtime requires the table to be added to the supabase_realtime
-- publication so that INSERT, UPDATE, and DELETE events broadcast to subscribed
-- web clients (Sales SOR panel & Purchasing task drawer).
--
-- REPLICA IDENTITY FULL ensures all column data is included on row updates.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Adds a table to a publication; no row, column, policy or index changes.
--   * A frontend that does not subscribe is unaffected by the broadcast.
--   * Idempotent — the do-block checks pg_publication_tables before adding.

alter table public.sor_procurement_requests replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sor_procurement_requests'
  ) then
    alter publication supabase_realtime add table public.sor_procurement_requests;
  end if;
end $$;
