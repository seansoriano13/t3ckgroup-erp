-- Spec #1133 / #1136 (tracker A4): the Dashboard quote is held to 100 characters in the database too.
-- The box on My Profile stops at 100, but the API took 5,000 and the Dashboard shows the quote in its header bar.
-- Trims longer rows first, in this same migration, then adds the check. Idempotent.
-- Not applied by the agent. Prod goes through the manual workflow (ADR 0008); look for longer rows first:
--
--   select count(*) from employees where char_length(dashboard_quote) > 100;

UPDATE public.employees
SET dashboard_quote = left(dashboard_quote, 100)
WHERE char_length(dashboard_quote) > 100;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_dashboard_quote_length') THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_dashboard_quote_length CHECK (dashboard_quote IS NULL OR char_length(dashboard_quote) <= 100);
  END IF;
END $$;
