-- Issue #206 / ADR 0004 D12: the ITB gate at For Bidding is retired. Sales
-- Flows replaced it, and the legacy pipeline no longer needs to enforce it
-- either. The Sales Reference rule stays untouched — only the ITB branches
-- are dropped from the trigger. `itb_number`/`itb_exempt` columns and their
-- data are kept; existing values just become read-only in the app.
--
-- `is_itb_gate` is also cleared on every crm_pipeline_stages row so the flag
-- can't silently re-arm a gate this trigger no longer enforces. Check the
-- live row after applying this, not the migration name — 0038 previously
-- re-enabled a gate that 0037 had disabled.
CREATE OR REPLACE FUNCTION public.sales_opportunities_require_sales_ref()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  _is_lead boolean;
  _is_lost boolean;
  _old_is_lead boolean;
begin
  -- Normalise before checking
  new.sales_reference := upper(nullif(btrim(new.sales_reference), ''));
  new.itb_number := nullif(btrim(new.itb_number), '');

  select is_default, is_lost into _is_lead, _is_lost
  from public.crm_pipeline_stages
  where code = new.status;

  if tg_op = 'INSERT' then
    if not _is_lead and not _is_lost and new.sales_reference is null then
      raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required to register an opportunity beyond Lead.';
    end if;
    return new;
  end if;

  select is_default into _old_is_lead
  from public.crm_pipeline_stages
  where code = old.status;

  if new.status is distinct from old.status then
    if _old_is_lead and not _is_lead and not _is_lost and new.sales_reference is null then
      raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required before this opportunity can leave Lead.';
    end if;
  end if;

  return new;
end $function$
;

UPDATE public.crm_pipeline_stages SET is_itb_gate = false WHERE is_itb_gate;
