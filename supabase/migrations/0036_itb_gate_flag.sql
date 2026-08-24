-- ==============================================================================
-- 0036_itb_gate_flag.sql
--
-- 0035 gated the ITB Number (Invitation to Bid) on a literal sort_order
-- comparison (`>= 35`) baked into the trigger, and constants/sor.js carried
-- the identical literal on the app side. That is exactly what the flag design
-- in 0033 exists to prevent: every other piece of stage behaviour — Contract
-- Date, the Realized split, the Sales Reference gate — is resolved by asking
-- a flag, never by matching a stage's position or name directly, because a
-- literal silently detaches the moment that stage is renamed or reordered.
-- For Bidding sitting in the open region (0033/0034's Ticket 6) makes this a
-- live risk, not a hypothetical one: a super admin reordering the pre-award
-- stages could move For Bidding to a different sort_order and the `35` in the
-- trigger would keep gating the old position.
--
-- This adds is_itb_gate, mirrors is_anchor's shape exactly (a single flagged
-- row, resolved and compared by position, never a literal), and rewrites the
-- trigger to read it. The behaviour for today's pipeline is unchanged — For
-- Bidding is still the one stage that gates the ITB Number — only how the
-- threshold is found changes.
-- ==============================================================================

alter table public.crm_pipeline_stages
  add column if not exists is_itb_gate boolean not null default false;

-- At most one row may carry the flag, same shape as the other singleton flags
-- in 0033. Zero is a valid state (see the trigger's coalesce below) — it is
-- "at most one", not "exactly one", the same as is_anchor/is_won/is_lost.
create unique index if not exists crm_pipeline_stages_one_itb_gate
  on public.crm_pipeline_stages ((true)) where is_itb_gate;

update public.crm_pipeline_stages
  set is_itb_gate = true
  where code = 'FOR_BIDDING';

-- ── Rewrite the trigger to read the flag instead of a literal ──────────────
create or replace function public.sales_opportunities_require_sales_ref()
returns trigger language plpgsql as $$
declare
  _is_lead boolean;
  _is_lost boolean;
  _sort_order int;
  _old_is_lead boolean;
  _old_sort_order int;
  _gate_sort_order int;
begin
  -- Normalise before checking
  new.sales_reference := upper(nullif(btrim(new.sales_reference), ''));
  new.itb_number := nullif(btrim(new.itb_number), '');

  select is_default, is_lost, sort_order into _is_lead, _is_lost, _sort_order
  from public.crm_pipeline_stages
  where code = new.status;

  -- The ITB gate's own position, not a literal. No flagged row means nothing
  -- is gated — the same fail-safe direction the app-side derivation takes.
  select sort_order into _gate_sort_order
  from public.crm_pipeline_stages
  where is_itb_gate
  limit 1;

  if tg_op = 'INSERT' then
    if not _is_lead and not _is_lost and new.sales_reference is null then
      raise exception 'A Sales Reference (Odoo quotation no., e.g. S01237) is required to register an opportunity beyond Lead.';
    end if;
    if _gate_sort_order is not null and _sort_order >= _gate_sort_order
       and not _is_lost and new.itb_number is null then
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

    if _gate_sort_order is not null
       and _old_sort_order < _gate_sort_order
       and _sort_order >= _gate_sort_order
       and not _is_lost and new.itb_number is null then
      raise exception 'An ITB Number (Invitation to Bid) is required before this opportunity can move to For Bidding or beyond.';
    end if;
  end if;

  return new;
end $$;
