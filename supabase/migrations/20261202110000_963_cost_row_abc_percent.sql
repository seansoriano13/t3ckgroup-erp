-- #963 (spec #955): an Other costs row can be typed as a percent of the ABC.
--
--   costing_cost_rows.abc_pct   the typed percent (10 = 10% of the ABC). Null is not a percent row.
--
-- The percent is read and written by the same tiers and bands as the row's Acquire (the cost the
-- cost side types): read by cost and closed_book, written by the Purchasing band. The peso amount
-- is still stored in acquire_unit (the screen writes percent x ABC there), so every figure the
-- database already reads from a cost row keeps working. Typing a peso amount by hand clears the
-- percent (the screen sends both in one write).
--
-- SAFE TO RUN AT ANY TIME. Idempotent.

alter table public.costing_cost_rows add column if not exists abc_pct numeric(7,2);

alter table public.costing_cost_rows drop constraint if exists costing_cost_rows_abc_pct_chk;
alter table public.costing_cost_rows add constraint costing_cost_rows_abc_pct_chk check (abc_pct is null or (abc_pct >= 0 and abc_pct <= 1000));

comment on column public.costing_cost_rows.abc_pct is
  '#963: the row typed as a percent of the ABC (10 = 10%). Null means the amount was typed in pesos.';

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_cost_rows', 'abc_pct', '{cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_cost_rows', 'abc_pct', '{purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;
