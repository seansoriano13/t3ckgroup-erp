-- ==============================================================================
-- 0034_pipeline_fk_and_trigger.sql
--
-- Ticket 7: Replace the hardcoded CHECK constraint on sales_opportunities.status
-- with a foreign key to crm_pipeline_stages. Rewrite the 0011 sales reference
-- trigger to read flags from the stage table rather than hard-coding 'LEAD'.
-- ==============================================================================

alter table public.sales_opportunities
  drop constraint if exists sales_opportunities_status_chk;

alter table public.sales_opportunities
  add constraint sales_opportunities_status_fkey
  foreign key (status) references public.crm_pipeline_stages (code);

-- ── Rewrite the 0011 trigger ────────────────────────────────────────────────
-- It used to match new.status not in ('LEAD', 'CLOSED_LOST') directly. Now it
-- reads the is_default (LEAD) and is_lost (CLOSED_LOST) flags from the new table.
create or replace function public.sales_opportunities_require_sales_ref()
returns trigger language plpgsql as $$
declare
  _is_lead boolean;
  _is_lost boolean;
  _old_is_lead boolean;
begin
  -- Normalise before the CHECK constraint runs, so 's01237' is accepted.
  new.sales_reference := upper(nullif(btrim(new.sales_reference), ''));

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

  if new.status is distinct from old.status
     and _old_is_lead
     and not _is_lead
     and not _is_lost
     and new.sales_reference is null then
    raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required before this opportunity can leave Lead.';
  end if;

  return new;
end $$;
