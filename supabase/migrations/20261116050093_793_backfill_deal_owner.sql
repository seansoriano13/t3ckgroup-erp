-- #793: SORs registered before the registrar became the default Deal Owner have none.
-- Give them the person who registered them. Only fills an empty owner; never overwrites one.
UPDATE public.sales_opportunities
SET deal_owner_id = registered_by
WHERE deal_owner_id IS NULL
  AND registered_by IS NOT NULL;
