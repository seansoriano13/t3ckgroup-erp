-- ============================================================================
-- Retires opportunity_no.
--
-- Run this once in the Supabase SQL editor.
--
-- WHY: opportunity_no was minted as 'S' || lpad(nextval(...), 5, '0') from a
-- sequence starting at 7190 — deliberately continuing the Google Sheet's
-- numbering, whose last value was S07189. But S07189 is ALSO a real Odoo
-- quotation number. So our registration numbers and Odoo's sales references
-- share one format drawn from one numeric range, permanently interleaved.
--
-- In practice that meant an opportunity displayed as S07233 sat next to a
-- Sales Reference of S07189, and S07233 in Odoo was an unrelated order for a
-- different customer. Reading the wrong number off the screen and looking it
-- up in Odoo pulls up the wrong quotation — a live mis-pricing risk on tender
-- work.
--
-- sales_reference (the Odoo number) is now the only S0#### identifier in the
-- product. Internal identity is the row id and serial_no.
--
-- STAGED ON PURPOSE: this migration stops opportunity_no being generated and
-- releases it from the immutability guard, but KEEPS the existing column and
-- its data. Historical audit entries quote those values and cannot be
-- rewritten, so the column stays readable until you are confident nothing
-- needs it. The final DROP is at the bottom, commented out.
-- ============================================================================

-- ── Stop minting new numbers ────────────────────────────────────────────────
-- Rows inserted from here on leave opportunity_no null. The column is already
-- nullable (`opportunity_no text unique` in 0001), so nothing else changes.
drop trigger if exists trg_sales_opportunities_set_no on public.sales_opportunities;
drop function if exists public.sales_opportunities_set_no();

-- ── Release it from the immutability guard ──────────────────────────────────
-- registration_date and registered_by stay guarded: Annex C.4 resolves
-- ownership disputes on those two, and that is unchanged. Only the
-- opportunity_no arm is dropped, so the column can be backfilled or removed
-- later without fighting the trigger.
create or replace function public.sales_opportunities_guard()
returns trigger language plpgsql as $$
begin
  if new.registration_date is distinct from old.registration_date then
    raise exception 'registration_date is immutable — it determines deal ownership';
  end if;
  if new.registered_by is distinct from old.registered_by then
    raise exception 'registered_by is immutable';
  end if;
  return new;
end $$;

-- ── Retire the sequence ─────────────────────────────────────────────────────
-- Nothing draws from it once the trigger is gone. Dropped separately so a
-- rollback only has to recreate the trigger, not re-derive the counter.
drop sequence if exists sales_opportunity_no_seq;

-- ============================================================================
-- STEP 2 — run only after confirming nothing reads opportunity_no.
-- Irreversible: the historical S0#### values are gone for good.
--
--   alter table public.sales_opportunities drop column opportunity_no;
-- ============================================================================
