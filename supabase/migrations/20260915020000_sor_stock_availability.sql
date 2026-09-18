-- Issue #202 — Odoo free stock on SOR line items.
--
-- `odoo_product_id` lets a line be looked up in Odoo without re-reading the
-- quotation; it is written by opportunityService.replaceItems whenever a
-- line carries one (Odoo-fetched lines do, hand-typed lines don't).
--
-- `sor_stock_snapshots` holds one row per opportunity, replaced on every
-- successful stock fetch — never presented as live, always read with the
-- `fetched_at` beside it. Its policies mirror sales_opportunity_items:
-- world-readable, write gated by sor_can_edit_opportunity.

alter table public."sales_opportunity_items"
  add column if not exists "odoo_product_id" integer null;

create table if not exists public."sor_stock_snapshots" (
  "opportunity_id" uuid not null,
  "fetched_at" timestamp with time zone not null default now(),
  "fetched_by" uuid null,
  "data" jsonb not null default '{}'::jsonb
);

alter table public."sor_stock_snapshots"
  add constraint "sor_stock_snapshots_pkey" primary key (opportunity_id);

alter table public."sor_stock_snapshots"
  add constraint "sor_stock_snapshots_opportunity_id_fkey"
  foreign key (opportunity_id) references public.sales_opportunities(id) on delete cascade;

alter table public."sor_stock_snapshots"
  add constraint "sor_stock_snapshots_fetched_by_fkey"
  foreign key (fetched_by) references public.employees(id) on delete set null;

alter table public."sor_stock_snapshots" enable row level security;

create policy "sor_stock_snapshots_read" on public."sor_stock_snapshots"
  as permissive
  for select
  to authenticated
  using (true);

create policy "sor_stock_snapshots_insert" on public."sor_stock_snapshots"
  as permissive
  for insert
  to authenticated
  with check (sor_can_edit_opportunity(opportunity_id));

create policy "sor_stock_snapshots_update" on public."sor_stock_snapshots"
  as permissive
  for update
  to authenticated
  using (sor_can_edit_opportunity(opportunity_id))
  with check (sor_can_edit_opportunity(opportunity_id));
