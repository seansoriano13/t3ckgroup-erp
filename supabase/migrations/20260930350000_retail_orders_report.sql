-- ==============================================================================
-- 20260930350000_retail_orders_report.sql
--
-- Retail becomes a report, not a review queue.
--
-- Retail orders (Shopee, Lazada) are already entered in Odoo, and a retail order
-- has no stages, so it never belonged in the SOR engine. The Retail screen
-- becomes a read-only dashboard over one table of its own: `retail_orders`,
-- written only by the `odoo-sor-sync` edge function (service role, bypasses RLS)
-- and read by anyone with the Retail access right.
--
-- WHAT THIS DOES NOT TOUCH
-- `odoo_retail_queue`, `approve_retail_queue_item()`, and the `is_retail` SORs
-- stay exactly as they are — the queue screen is only hidden, so approvals can
-- come back if Sales asks for them. Nothing here reads them after the backfill.
--
-- BACKFILL (one-time, deduped by Odoo SO number)
--   1. Queue rows that are pending or approved — an order nobody dismissed.
--   2. `is_retail` SORs with no queue row (created before the queue existed, or
--      reclassified by 20260909090000).
--   3. Dismissed queue rows, copied with `is_excluded = true`. Without them the
--      new sync would re-insert every order somebody once dismissed.
-- `odoo_state` stays null for backfilled rows until the sync refreshes them;
-- the report treats null as "counted".
--
-- SAFE TO RUN AT ANY TIME: a new table nothing else reads, idempotent, and the
-- backfill is `on conflict do nothing`.
-- ==============================================================================

create table if not exists public.retail_orders (
  id                    uuid        primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  odoo_so_number        text        not null unique,
  odoo_so_id            integer,
  storefront            text        not null,
  partner_name          text        not null,
  buyer_name            text,
  odoo_salesperson_name text,
  amount                numeric     not null default 0,
  ordered_at            timestamptz,
  odoo_state            text,

  is_excluded           boolean     not null default false,
  excluded_reason       text,
  source                text        not null default 'sync'
                        check (source in ('sync', 'queue', 'sor'))
);

comment on table public.retail_orders is
  'Marketplace orders (Shopee, Lazada) synced from Odoo for the Retail report. Written only by odoo-sor-sync; read by the Retail access right.';
comment on column public.retail_orders.ordered_at is
  'Odoo date_order, falling back to create_date. The date the report groups by.';
comment on column public.retail_orders.odoo_state is
  'Odoo sale.order state (draft, sent, sale, done, cancel). Null until the sync has refreshed a backfilled row. The report counts only sale and done.';
comment on column public.retail_orders.is_excluded is
  'True for an order somebody dismissed in the old queue. The sync never clears it; the report leaves it out.';

create index if not exists retail_orders_ordered_at_idx
  on public.retail_orders (ordered_at desc);

create or replace function public.set_retail_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_retail_orders_updated_at on public.retail_orders;
create trigger trg_retail_orders_updated_at
  before update on public.retail_orders
  for each row execute function public.set_retail_orders_updated_at();

-- Read-only to the app. No insert/update/delete policy exists on purpose: the
-- edge function uses the service role, which bypasses RLS.
alter table public.retail_orders enable row level security;

drop policy if exists "Retail handlers can view retail orders" on public.retail_orders;
create policy "Retail handlers can view retail orders"
  on public.retail_orders for select
  to authenticated
  using (public.can_handle_retail_queue());

-- ── Backfill ────────────────────────────────────────────────────────────────

-- 1 + 3. Every queue row. A dismissed one is carried over as excluded.
insert into public.retail_orders (
  odoo_so_number, odoo_so_id, storefront, partner_name, buyer_name,
  odoo_salesperson_name, amount, ordered_at, is_excluded, excluded_reason, source
)
select
  q.odoo_so_number,
  q.odoo_so_id,
  case
    when q.odoo_partner_name ilike '%shopee%' then 'Shopee'
    when q.odoo_partner_name ilike '%lazada%' then 'Lazada'
    else q.odoo_partner_name
  end,
  q.odoo_partner_name,
  q.odoo_person_name,
  q.odoo_salesperson_name,
  coalesce(q.odoo_amount, 0),
  coalesce(q.odoo_date_order, q.odoo_create_date, q.created_at),
  q.status = 'dismissed',
  case when q.status = 'dismissed' then 'dismissed in the retail queue' end,
  'queue'
from public.odoo_retail_queue q
on conflict (odoo_so_number) do nothing;

-- 2. Retail SORs the queue never saw.
insert into public.retail_orders (
  odoo_so_number, storefront, partner_name, buyer_name, amount, ordered_at, source
)
select
  o.sales_reference,
  case
    when o.client_name ilike '%shopee%' then 'Shopee'
    when o.client_name ilike '%lazada%' then 'Lazada'
    else coalesce(o.client_name, 'Other')
  end,
  coalesce(o.client_name, 'Other'),
  o.contact_person,
  coalesce(o.expected_value, 0),
  coalesce(o.registration_date::timestamptz, o.created_at),
  'sor'
from public.sales_opportunities o
where o.is_retail = true
  and o.is_deleted is not true
  and o.sales_reference is not null
on conflict (odoo_so_number) do nothing;

comment on column public.employees.has_retail_access is
  'Retail access right: shows the Retail screen (the marketplace-orders report). On by default for SALES employees. Enforced by can_handle_retail_queue() and the retail_orders read policy.';
