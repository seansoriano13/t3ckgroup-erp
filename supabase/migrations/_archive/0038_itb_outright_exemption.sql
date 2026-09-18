-- ==============================================================================
-- 0038_itb_outright_exemption.sql
--
-- Turns the ITB gate back on — 0037 switched it off wholesale — and gives it
-- the thing it was missing, which is the reason it had to be switched off at
-- all: a way for a deal to say the Invitation to Bid does not apply to it.
--
-- 0035 built the gate on the assumption that everything reaching For Bidding
-- or beyond had gone out to bid. Outright awards (government direct contracts
-- among them) are won with no ITB ever issued, so they have no number to
-- give, and a gate with no exemption could only either block them or be off
-- for everybody. 0037 chose "off for everybody" to unblock prod; this is the
-- fix it names in its own header.
--
-- `itb_exempt` is that exemption, recorded per opportunity: this deal was
-- outright, no bidding required. The gate is satisfied by an ITB Number OR
-- the exemption, so the prompt stays in front of everyone crossing it — the
-- salesperson still has to answer for the missing number, they just now have
-- a truthful answer available besides inventing one.
--
-- Deliberately a plain boolean with no "who set it" columns, matching how
-- sales_reference carries no provenance of its own: who declared it outright
-- and when is written to the opportunity's timeline and the system audit log
-- by opportunityService.updateStatus, which is where the rest of the stage
-- history already lives and where anyone auditing a deal is already looking.
--
-- Nothing backfills. Every existing row starts false, including the deals
-- that moved while 0037 had the gate off — they are not retroactively
-- declared outright, because nobody declared them anything. They simply sit
-- past the gate already, and the gate only fires on crossing it.
-- ==============================================================================

alter table public.sales_opportunities
  add column if not exists itb_exempt boolean not null default false;

comment on column public.sales_opportunities.itb_exempt is
  'Outright award — no bidding required, so no ITB Number exists. Satisfies the ITB gate in place of itb_number. Who declared it is on the opportunity timeline.';

-- Undo 0037: For Bidding is the gate stage again.
update public.crm_pipeline_stages
  set is_itb_gate = true
  where code = 'FOR_BIDDING';

-- ── Rewrite the trigger to accept the exemption ────────────────────────────
-- Unchanged from 0036 apart from the two ITB conditions, which now read "no
-- number AND not exempt" instead of "no number".
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
       and not _is_lost and new.itb_number is null and not new.itb_exempt then
      raise exception 'An ITB Number (Invitation to Bid) is required to register an opportunity at For Bidding or beyond, unless it is marked outright (no bidding required).';
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
       and not _is_lost and new.itb_number is null and not new.itb_exempt then
      raise exception 'An ITB Number (Invitation to Bid) is required before this opportunity can move to For Bidding or beyond, unless it is marked outright (no bidding required).';
    end if;
  end if;

  return new;
end $$;
