-- allow-out-of-order: must run on prod right after its post-repair tip 20260904173500 (#336)
--
-- Production never ran 20260904000000_baseline_schema.sql; the cutover only
-- marks it applied (runbook step 4), on the premise that prod already has
-- everything it creates. The #336 rehearsal disproved that: the baseline was
-- generated from staging, and prod lacks one object in it,
-- sales_opportunities.is_scratch (with the partial index built on it), which
-- 20260909060000_retail_sor_flag.sql needs. db push failed there.
--
-- Diffing the baseline-claimed schema against live prod (cutover-rehearsal
-- workflow, baseline-gap job) found nothing else missing. The other
-- differences are cosmetic (FK ON DELETE rules, CHECK spelling, identity/uuid
-- defaults) or objects prod has that the baseline doesn't; the release's own
-- migrations replace the ones that matter (sor_update, the tasks policies).
--
-- Idempotent. On staging, which ran the baseline, it changes nothing; the
-- marker above lets check-migration-order accept a file that sorts before
-- staging's tip, and migrate-staging's --include-all applies it.
--
-- No SOR on prod is scratch data, so the default (false) is correct for all.

alter table public.sales_opportunities
  add column if not exists is_scratch boolean not null default false;

create index if not exists sales_opportunities_live_idx
  on public.sales_opportunities (registration_date desc, created_at desc)
  where is_scratch = false and is_deleted = false;
