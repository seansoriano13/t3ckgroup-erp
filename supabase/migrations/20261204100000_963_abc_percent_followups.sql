-- #963 follow-ups (spec #955): a percent-of-ABC row stays in step with the ABC, and Sales may type the percent.
--
-- 1. The peso amount of a percent row (costing_cost_rows.acquire_unit) is worked by the database, never typed:
--    round(abc_pct x ABC total / 100, 2) divided by the quantity, the same figure as percentOfAbcAmount /
--    applyPercentRows on the screen. A blank ABC (or a blank/zero quantity) gives null, never zero.
--      - a BEFORE trigger on the row itself refreshes it whenever the percent row is written, so whoever may type the
--        percent (Sales or Purchasing) never has to, and may not, type the amount;
--      - AFTER triggers on the ABC's inputs (the evaluation's abc_mode / abc_total, a line's abc_unit / quantity)
--        refresh every percent row of that evaluation, whoever changed the ABC.
--    Both run SECURITY DEFINER and raise costing.bypass for the refresh only (the same switch the other trusted
--    writes use), so costing_enforce_bands still judges every normal write. The row trigger is named so it fires
--    after costing_bands: the band guard has already judged what the user typed before the amount is filled in.
-- 2. abc_pct is written by Sales and Purchasing (it was Purchasing only). acquire_unit stays Purchasing only.
--
-- SAFE TO RUN AT ANY TIME. Idempotent.

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_cost_rows', 'abc_pct', '{sales,purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

-- The worked amount per unit for one percent row; null while anything is blank.
create or replace function public.costing_percent_row_unit(p_matrix_id uuid, p_pct numeric, p_quantity numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p_pct is null or p_quantity is null or p_quantity <= 0 or b.abc_total is null then null
           else round(round(p_pct * b.abc_total / 100, 2) / p_quantity, 2)
         end
  from public.costing_bid_totals(p_matrix_id) b
$$;
revoke all on function public.costing_percent_row_unit(uuid, numeric, numeric) from public, anon, authenticated;

-- The row: a percent row always carries the worked amount.
create or replace function public.costing_cost_rows_percent_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.abc_pct is not null then
    new.acquire_unit := public.costing_percent_row_unit(new.matrix_id, new.abc_pct, new.quantity);
  end if;
  return new;
end;
$$;
revoke all on function public.costing_cost_rows_percent_unit() from public, anon, authenticated;

drop trigger if exists costing_cost_rows_percent_unit on public.costing_cost_rows;
create trigger costing_cost_rows_percent_unit before insert or update on public.costing_cost_rows
  for each row execute function public.costing_cost_rows_percent_unit();

-- The ABC moved: refresh every percent row of the evaluation.
create or replace function public.costing_refresh_percent_rows(p_matrix_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was text := coalesce(current_setting('costing.bypass', true), '');
begin
  if p_matrix_id is null then
    return;
  end if;
  perform set_config('costing.bypass', 'on', true);
  update public.costing_cost_rows r
     set acquire_unit = public.costing_percent_row_unit(r.matrix_id, r.abc_pct, r.quantity)
   where r.matrix_id = p_matrix_id
     and r.abc_pct is not null
     and r.acquire_unit is distinct from public.costing_percent_row_unit(r.matrix_id, r.abc_pct, r.quantity);
  perform set_config('costing.bypass', v_was, true);
end;
$$;
revoke all on function public.costing_refresh_percent_rows(uuid) from public, anon, authenticated;

create or replace function public.costing_abc_moved_matrix()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.costing_refresh_percent_rows(new.id);
  return null;
end;
$$;
revoke all on function public.costing_abc_moved_matrix() from public, anon, authenticated;

create or replace function public.costing_abc_moved_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.costing_refresh_percent_rows(case when tg_op = 'DELETE' then old.matrix_id else new.matrix_id end);
  return null;
end;
$$;
revoke all on function public.costing_abc_moved_line() from public, anon, authenticated;

create or replace function public.costing_abc_moved_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.costing_refresh_percent_rows(
    (select l.matrix_id from public.costing_tender_lines l
      where l.id = case when tg_op = 'DELETE' then old.tender_line_id else new.tender_line_id end));
  return null;
end;
$$;
revoke all on function public.costing_abc_moved_price() from public, anon, authenticated;

drop trigger if exists costing_abc_moved on public.costing_matrices;
create trigger costing_abc_moved after update of abc_mode, abc_total on public.costing_matrices
  for each row execute function public.costing_abc_moved_matrix();

drop trigger if exists costing_abc_moved on public.costing_tender_lines;
create trigger costing_abc_moved after insert or delete or update of quantity on public.costing_tender_lines
  for each row execute function public.costing_abc_moved_line();

drop trigger if exists costing_abc_moved on public.costing_tender_line_prices;
create trigger costing_abc_moved after insert or delete or update of abc_unit on public.costing_tender_line_prices
  for each row execute function public.costing_abc_moved_price();

-- Rows already saved: bring them in step now.
do $$
declare m uuid;
begin
  for m in select distinct matrix_id from public.costing_cost_rows where abc_pct is not null loop
    perform public.costing_refresh_percent_rows(m);
  end loop;
end $$;
