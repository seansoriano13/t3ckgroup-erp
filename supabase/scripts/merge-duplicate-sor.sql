-- ============================================================================
-- Merge Sales Opportunity Records that share one Odoo quotation number
-- ============================================================================
--
-- RUN AGAINST PRODUCTION 2026-08-22. Kept for the record, and because it is
-- re-runnable: it finds whatever duplicates exist rather than naming ids, so
-- it still works if a set ever gets in ahead of the constraint.
--
-- After that run, migration 0034 added a unique index on sales_reference and
-- opportunityService.assertSalesReferenceUnused started rejecting duplicates
-- at the application layer, so this should have nothing left to do.
--
-- WHAT IT DOES
--
--   1. Picks the LATEST registration as the survivor. That was a deliberate
--      decision: it keeps the most current view of who owns the deal. Note it
--      overrides Annex C.4 of CCPR-2026-001, which lists Registration Date
--      first when settling ownership — on S08106 the two rows named different
--      deal owners, and keeping the later one moved PHP 310.50 of Sales share
--      from Alvin Ariño to Maria Daniella C. Duran.
--
--   2. Re-parents every log entry onto the survivor. sales_opportunity_logs
--      has no composite constraint and keeps author_id and created_at, so the
--      merged conversation stays attributable and in chronological order.
--      Nothing is lost whichever row survives — which is precisely why the
--      survivor should not be chosen on "which one has the better chat".
--
--   3. Soft-deletes the losers. Not a hard delete: it is reversible, the app
--      already filters on is_deleted everywhere, and 0034's partial unique
--      index excludes soft-deleted rows, so this is what frees the reference.
--
-- Deliberately NOT copied onto the survivor: registration_date and
-- registered_by. The guard trigger on sales_opportunities rejects changes to
-- them ("registration_date is immutable — it determines deal ownership").
-- The retired row keeps its own, so the earlier registration stays on record.
-- ============================================================================

do $$
declare
  r record;
  keeper uuid;
  moved int;
  retired int;
  total_moved int := 0;
  total_retired int := 0;
begin
  for r in
    select sales_reference
      from public.sales_opportunities
     where coalesce(is_deleted, false) = false and sales_reference is not null
     group by sales_reference having count(*) > 1
  loop
    select id into keeper
      from public.sales_opportunities
     where sales_reference = r.sales_reference and coalesce(is_deleted, false) = false
     order by created_at desc
     limit 1;

    update public.sales_opportunity_logs l
       set opportunity_id = keeper
      from public.sales_opportunities o
     where l.opportunity_id = o.id
       and o.sales_reference = r.sales_reference
       and coalesce(o.is_deleted, false) = false
       and o.id <> keeper;
    get diagnostics moved = row_count;

    update public.sales_opportunities
       set is_deleted = true
     where sales_reference = r.sales_reference
       and coalesce(is_deleted, false) = false
       and id <> keeper;
    get diagnostics retired = row_count;

    total_moved := total_moved + moved;
    total_retired := total_retired + retired;
    raise notice 'ref % -> keeper %, moved % logs, retired % rows',
      r.sales_reference, keeper, moved, retired;
  end loop;

  raise notice 'TOTAL: moved % log entries, retired % duplicate rows',
    total_moved, total_retired;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification — every row below should read as stated.
-- ─────────────────────────────────────────────────────────────────────────────
select 'duplicate references' as check,
       coalesce((select string_agg(sales_reference, ', ')
                   from (select sales_reference
                           from public.sales_opportunities
                          where coalesce(is_deleted, false) = false
                            and sales_reference is not null
                          group by sales_reference having count(*) > 1) d), 'NONE') as result
union all
select 'orphaned log entries', count(*)::text
  from public.sales_opportunity_logs l
 where not exists (select 1 from public.sales_opportunities o where o.id = l.opportunity_id);

-- Outcome of the 2026-08-22 run:
--   S08106 -> Vigan City Government   (owner Maria Daniella C. Duran)  7 comments, 14 entries
--   S07995 -> Santa Lucia Ilocos Sur  (owner Alvin Ariño)              2 comments,  9 entries
--   both retired rows left 0 logs behind; live opportunities 90 -> 88
