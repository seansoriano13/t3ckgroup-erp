-- Spec #1104 / #1109: refuse commission percentages below 0 or above 100 at the database.
-- Checks existing rows first and stops with a clear message if any are out of range, so the
-- constraint never fails halfway. Idempotent: skips constraints that already exist.
-- Not applied by the agent. Prod goes through the manual workflow (ADR 0008); run the
-- SELECT below on staging and prod first and put the result in the PR.
--
--   select 'departments', count(*) from commission_departments where allocation_percent < 0 or allocation_percent > 100
--   union all select 'positions', count(*) from commission_positions where allocation_percent < 0 or allocation_percent > 100
--   union all select 'splits', count(*) from commission_splits where percent < 0 or percent > 100;

DO $$
DECLARE
  bad integer;
BEGIN
  SELECT
    (SELECT count(*) FROM public.commission_departments WHERE allocation_percent < 0 OR allocation_percent > 100)
  + (SELECT count(*) FROM public.commission_positions WHERE allocation_percent < 0 OR allocation_percent > 100)
  + (SELECT count(*) FROM public.commission_splits WHERE percent < 0 OR percent > 100)
  INTO bad;

  IF bad > 0 THEN
    RAISE EXCEPTION 'Spec #1109: % commission row(s) have a percent outside 0-100. Fix them before adding the constraints.', bad;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_departments_allocation_percent_range') THEN
    ALTER TABLE public.commission_departments
      ADD CONSTRAINT commission_departments_allocation_percent_range CHECK (allocation_percent >= 0 AND allocation_percent <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_positions_allocation_percent_range') THEN
    ALTER TABLE public.commission_positions
      ADD CONSTRAINT commission_positions_allocation_percent_range CHECK (allocation_percent >= 0 AND allocation_percent <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_splits_percent_range') THEN
    ALTER TABLE public.commission_splits
      ADD CONSTRAINT commission_splits_percent_range CHECK (percent >= 0 AND percent <= 100);
  END IF;
END $$;
