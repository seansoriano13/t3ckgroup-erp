-- ==============================================================================
-- 0023_sor_procurement_column_guard.sql
--
-- Stops the requester writing purchasing's half of a procurement request.
--
-- 0017's sor_procurement_update policy admits three parties: the assigned
-- purchaser, the requester, and heads/super admins. Its comment describes the
-- requester's share as "amend or withdraw their own ask" — but a Postgres RLS
-- policy cannot scope itself to columns, so in practice the salesperson who
-- raised the request could also write `outcome`, `po_number` and, worst of the
-- three, `verification`. A salesperson could mark their own PO 'VERIFIED',
-- which is precisely the fact odoo-po-verify exists to establish independently.
--
-- Column-level GRANTs are the other way to do this, but they apply to the whole
-- `authenticated` role and would take the columns away from purchasing too. A
-- BEFORE UPDATE trigger is the only mechanism here that can tell the two
-- parties apart, so the policy stays as the row gate and this narrows it.
--
-- Must run AFTER 0022 — it references odoo_vendor, which 0022 adds.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Adds a trigger that only ever rejects a write the comment on 0017
--     already said was not allowed. No existing row is modified.
--   * No policy, column or index is changed.
--   * Idempotent — safe to re-run.
-- ==============================================================================

create or replace function public.sor_procurement_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor      uuid := public.get_employee_id();
  is_manager boolean;
begin
  -- Nothing purchasing owns was touched: this is the requester amending their
  -- own ask, which is exactly what 0017 intends to allow.
  if new.outcome          is not distinct from old.outcome
 and new.outcome_note     is not distinct from old.outcome_note
 and new.po_number        is not distinct from old.po_number
 and new.odoo_product_ref is not distinct from old.odoo_product_ref
 and new.odoo_vendor      is not distinct from old.odoo_vendor
 and new.eta              is not distinct from old.eta
 and new.verification     is not distinct from old.verification
 and new.resolved_by      is not distinct from old.resolved_by
 and new.resolved_at      is not distinct from old.resolved_at
  then
    return new;
  end if;

  select (e.is_head or e.is_super_admin)
    into is_manager
    from public.employees e
   where e.id = actor;

  if old.assigned_to is not distinct from actor
     or coalesce(is_manager, false)
  then
    return new;
  end if;

  raise exception
    'Only the assigned purchaser can record the outcome, PO number or Odoo verification for a procurement request.'
    using errcode = 'check_violation';
end $$;

-- Fires before sor_procurement_requests_touch(): triggers on the same event run
-- in name order, and "guard" sorts before "touch".
drop trigger if exists trg_sor_procurement_requests_guard on public.sor_procurement_requests;
create trigger trg_sor_procurement_requests_guard
  before update on public.sor_procurement_requests
  for each row execute function public.sor_procurement_requests_guard();
