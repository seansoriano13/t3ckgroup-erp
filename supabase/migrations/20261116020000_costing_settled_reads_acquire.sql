-- Costing settled reads the Acquire cost, not only Final Acquire.
--
-- Final Acquire left the screen in #703, so nothing writes final_acquire_unit on a new matrix and
-- costing_settled_met could never pass. A row now counts as costed when it has a Final Acquire
-- (old deals, kept as signed) or else an Acquire. Everything else in the check is unchanged.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: create-or-replace.

-- costing_settled_met (latest: 20261018220000_costing_review_fixes.sql)
create or replace function public.costing_settled_met(p_matrix_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_totals  record;
  v_costed  integer;
  v_missing integer;
begin
  if p_matrix_id is null then
    return false;
  end if;

  select * into v_totals from public.costing_bid_totals(p_matrix_id);
  if coalesce(v_totals.line_count, 0) = 0 or coalesce(v_totals.missing_offer, 1) <> 0 then
    return false;
  end if;
  if coalesce(v_totals.final_offer_total > v_totals.abc_total, false) then
    return false;
  end if;

  select count(*), count(*) filter (where coalesce(cc.final_acquire_unit, cc.acquire_unit) is null)
    into v_costed, v_missing
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
   where l.matrix_id = p_matrix_id;
  v_costed := v_costed + (select count(*) from public.costing_cost_rows r where r.matrix_id = p_matrix_id);
  v_missing := v_missing + (select count(*) from public.costing_cost_rows r
                             where r.matrix_id = p_matrix_id
                               and coalesce(r.final_acquire_unit, r.acquire_unit) is null);
  if v_costed = 0 or v_missing <> 0 then
    return false;
  end if;

  return exists (
           select 1 from public.costing_signoffs s
            where s.matrix_id = p_matrix_id and s.role = 'evaluation_approved' and s.cleared_at is null)
     and coalesce((select d.verdict from public.costing_bid_decisions d
                    where d.matrix_id = p_matrix_id and d.cleared_at is null), '') = 'go';
end;
$$;
