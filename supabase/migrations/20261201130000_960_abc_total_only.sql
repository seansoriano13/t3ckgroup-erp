-- #960 (spec #955): type the ABC as one total.
--
--   costing_matrices.abc_mode    'by_line' (today, the default) or 'total_only'
--   costing_matrices.abc_total   the typed ABC total, used in 'total_only'. Blank is never zero.
--
-- Read by the tiers that read costing_tender_line_prices.abc_unit (price, cost, closed_book) and
-- written by the Sales band. Per-line abc_unit values are never touched by a switch: they stay and
-- come back in 'by_line'. Nothing is spread over the lines.
--
-- costing_bid_totals (read by the over-ABC check in costing_condition_inputs, the Bid Decision, the
-- cost guide and the print) uses the typed total in 'total_only', to the centavo.
--
-- SAFE TO RUN AT ANY TIME. Idempotent.

alter table public.costing_matrices add column if not exists abc_mode text not null default 'by_line';
alter table public.costing_matrices add column if not exists abc_total numeric(18,2);

alter table public.costing_matrices drop constraint if exists costing_matrices_abc_mode_chk;
alter table public.costing_matrices add constraint costing_matrices_abc_mode_chk check (abc_mode in ('by_line', 'total_only'));
alter table public.costing_matrices drop constraint if exists costing_matrices_abc_total_chk;
alter table public.costing_matrices add constraint costing_matrices_abc_total_chk check (abc_total is null or abc_total >= 0);

comment on column public.costing_matrices.abc_mode is
  '#960: how the ABC is typed: by_line (per Tender Line, default) or total_only (one typed total).';
comment on column public.costing_matrices.abc_total is
  '#960: the typed ABC total, used when abc_mode is total_only. Null is blank, never zero.';

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_matrices', 'abc_mode', '{price,cost,closed_book}'),
  ('costing_matrices', 'abc_total', '{price,cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_matrices', 'abc_mode', '{sales}'),
  ('costing_matrices', 'abc_total', '{sales}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

create or replace function public.costing_bid_totals(p_matrix_id uuid)
returns table (final_offer_total numeric, abc_total numeric, line_count integer, missing_offer integer, missing_abc integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when count(l.id) > 0 and count(l.id) filter (where p.final_offer_unit is null) = 0
         then sum(round(p.final_offer_unit * l.quantity, 2)) end,
    case when m.abc_mode = 'total_only' then (case when count(l.id) > 0 then m.abc_total end)
         when count(l.id) > 0 and count(l.id) filter (where p.abc_unit is null) = 0
         then sum(round(p.abc_unit * l.quantity, 2)) end,
    count(l.id)::integer,
    (count(l.id) filter (where p.final_offer_unit is null))::integer,
    case when m.abc_mode = 'total_only' then (case when count(l.id) > 0 and m.abc_total is null then 1 else 0 end)
         else (count(l.id) filter (where p.abc_unit is null))::integer end
  from public.costing_matrices m
  left join public.costing_tender_lines l on l.matrix_id = m.id
  left join public.costing_tender_line_prices p on p.tender_line_id = l.id
  where m.id = p_matrix_id
  group by m.abc_mode, m.abc_total
$$;
