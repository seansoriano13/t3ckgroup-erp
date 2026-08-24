-- ==============================================================================
-- 0035_opportunity_itb.sql
--
-- Adds the Invitation to Bid (itb_number) field and enforces it for deals
-- moving into the For Bidding stage or later.
-- ==============================================================================

alter table public.sales_opportunities
  add column if not exists itb_number text;

-- ── Rewrite the progression gate trigger ────────────────────────────────────
-- Enforces both the Sales Reference (required to leave Lead) and the ITB Number
-- (required to enter For Bidding, i.e., sort_order >= 35).
create or replace function public.sales_opportunities_require_sales_ref()
returns trigger language plpgsql as $$
declare
  _is_lead boolean;
  _is_lost boolean;
  _sort_order int;
  _old_is_lead boolean;
  _old_sort_order int;
begin
  -- Normalise before checking
  new.sales_reference := upper(nullif(btrim(new.sales_reference), ''));
  new.itb_number := nullif(btrim(new.itb_number), '');

  select is_default, is_lost, sort_order into _is_lead, _is_lost, _sort_order
  from public.crm_pipeline_stages
  where code = new.status;

  if tg_op = 'INSERT' then
    if not _is_lead and not _is_lost and new.sales_reference is null then
      raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required to register an opportunity beyond Lead.';
    end if;
    if _sort_order >= 35 and not _is_lost and new.itb_number is null then
      raise exception 'An ITB Number (Invitation to Bid) is required to register an opportunity at For Bidding or beyond.';
    end if;
    return new;
  end if;

  select is_default, sort_order into _old_is_lead, _old_sort_order
  from public.crm_pipeline_stages
  where code = old.status;

  if new.status is distinct from old.status then
    if _old_is_lead and not _is_lead and not _is_lost and new.sales_reference is null then
      raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required before this opportunity can leave Lead.';
    end if;

    if _old_sort_order < 35 and _sort_order >= 35 and not _is_lost and new.itb_number is null then
      raise exception 'An ITB Number (Invitation to Bid) is required before this opportunity can move to For Bidding or beyond.';
    end if;
  end if;

  return new;
end $$;
