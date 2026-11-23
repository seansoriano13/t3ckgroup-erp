-- #1193 (spec #1187): ONE-OFF bulk archive of the old Legacy Pipeline SORs. NOT A MIGRATION.
-- Sean said yes on 2026-11-23. It runs on prod only after the #1193 migration is live there, as its own
-- step, and only after the BEFORE count below is checked (143 on 2026-11-23: 41 LEAD, 98
-- PROPOSAL_SUBMITTED, 4 QUALIFIED). Do not run it from CI. Staging may run it freely.
--
-- Picks live (not deleted, not scratch, not already archived) SORs whose Sale Type is the Legacy
-- Pipeline (system_key = 'legacy_pipeline') or that have no Sale Type, at LEAD, PROPOSAL_SUBMITTED or
-- QUALIFIED. Writes only archived_at (archived_by stays null: archived by the system). Deletes nothing.
-- Re-runnable: a second run finds none.
--
-- Run:  psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/one-off/1193_archive_legacy_sors.sql

begin;

create temp table _legacy_archive_targets on commit drop as
select o.id, o.status
  from public.sales_opportunities o
  left join public.sale_types st on st.id = o.sale_type_id
 where coalesce(o.is_deleted, false) = false
   and coalesce(o.is_scratch, false) = false
   and o.archived_at is null
   and o.status in ('LEAD', 'PROPOSAL_SUBMITTED', 'QUALIFIED')
   and (o.sale_type_id is null or st.system_key = 'legacy_pipeline');

\echo BEFORE: SORs about to be archived, by status
select status, count(*) as n from _legacy_archive_targets group by status order by status;
select count(*) as before_total from _legacy_archive_targets;

update public.sales_opportunities o
   set archived_at = now()
  from _legacy_archive_targets t
 where o.id = t.id;

\echo AFTER: SORs archived in total (the number above plus any archived earlier)
select count(*) as archived_total from public.sales_opportunities where archived_at is not null;

-- Check the BEFORE total against the expected count first. To dry-run, change COMMIT to ROLLBACK.
commit;
