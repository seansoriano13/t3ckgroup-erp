-- Retail: Income Note facts on retail_orders (#450). Null = not given, never 0.
-- Staging only: prod has no retail_orders.
alter table public.retail_orders add column if not exists marketplace_order_id text;
alter table public.retail_orders add column if not exists marketplace_fee numeric;
alter table public.retail_orders add column if not exists order_income numeric;

comment on column public.retail_orders.order_income is
  'Order Income as typed in the Income Note. Never Order Amount - Fee (ADR 0031).';
