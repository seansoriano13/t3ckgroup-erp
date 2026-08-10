-- ============================================================================
-- SOR — Sales Reference (Odoo sales quotation number)
--
-- The "S" number Odoo issues when the sales quotation is created, e.g. S01237.
-- Its presence is the proof that a quotation actually exists, so it gates the
-- Lead → Qualified move (and every other move out of Lead).
--
-- NOTE: this is NOT the same thing as `opportunity_no`, which this system
-- issues itself from `sales_opportunity_no_seq`. Both happen to be S-prefixed.
-- ============================================================================

alter table public.sales_opportunities
  add column if not exists sales_reference text;

-- Deliberately permissive: "S" followed by digits. Odoo's numbering width has
-- changed before, so anything stricter would reject valid quotation numbers.
alter table public.sales_opportunities
  drop constraint if exists sales_opportunities_sales_reference_chk;
alter table public.sales_opportunities
  add constraint sales_opportunities_sales_reference_chk
  check (sales_reference is null or sales_reference ~ '^S[0-9]+$');

create index if not exists sales_opportunities_sales_reference_idx
  on public.sales_opportunities (sales_reference);

comment on column public.sales_opportunities.sales_reference is
  'Odoo sales quotation number (e.g. S01237). Required to leave the Lead stage.';

-- ── Stage gate ──────────────────────────────────────────────────────────────
-- Enforced on the transition out of LEAD rather than as a table-wide rule, so
-- rows already deeper in the pipeline from before this column existed keep
-- moving. CLOSED_LOST is exempt — a lead can die before anyone quotes it.
create or replace function public.sales_opportunities_require_sales_ref()
returns trigger language plpgsql as $$
begin
  -- Normalise before the CHECK constraint runs, so 's01237' is accepted.
  new.sales_reference := upper(nullif(btrim(new.sales_reference), ''));

  if tg_op = 'INSERT' then
    if new.status not in ('LEAD', 'CLOSED_LOST') and new.sales_reference is null then
      raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required to register an opportunity beyond Lead.';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     and old.status = 'LEAD'
     and new.status not in ('LEAD', 'CLOSED_LOST')
     and new.sales_reference is null then
    raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required before this opportunity can leave Lead.';
  end if;

  return new;
end $$;

drop trigger if exists trg_sales_opportunities_require_sales_ref on public.sales_opportunities;
create trigger trg_sales_opportunities_require_sales_ref
  before insert or update on public.sales_opportunities
  for each row execute function public.sales_opportunities_require_sales_ref();
