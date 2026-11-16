-- #964 fix: the project expenses total the way the screen counts it.
--
-- The screen (applyPercentRows) works a row typed as a percent of the ABC as that percent of the ABC total
-- and drops its Final cost, so the amount counted is the one worked. The database added up
-- coalesce(final_acquire_unit, acquire_unit) * quantity on every row, which left a percent row at whatever
-- was stored (or blank). Now a percent row counts at abc_pct % of the ABC total (blank while the ABC is
-- unknown, never zero); every other row is its Final cost, else its Acquire, times the quantity.

create or replace function public.costing_project_expenses_total(p_matrix_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when count(*) > 0 and bool_and(x.amount is not null) then sum(x.amount) end
  from (
    select case
             when r.abc_pct is not null then round(r.abc_pct * (select b.abc_total from public.costing_bid_totals(p_matrix_id) b) / 100, 2)
             else round(coalesce(r.final_acquire_unit, r.acquire_unit) * r.quantity, 2)
           end as amount
    from public.costing_cost_rows r
    where r.matrix_id = p_matrix_id
      and (r.abc_pct is not null or r.acquire_unit is not null or r.final_acquire_unit is not null)
  ) x
$$;
revoke all on function public.costing_project_expenses_total(uuid) from public, anon, authenticated;
