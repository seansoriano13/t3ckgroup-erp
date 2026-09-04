-- ==============================================================================
-- 0062_sor_purchase_order_links.sql
--
-- Actual cost (issue #48/#49) — local overrides to the live Odoo rollup of
-- purchase orders whose Source Document names the sale order.
--
-- ── Why this table holds overrides, not the rollup itself ──────────────────
-- The rollup total is read live from Odoo every time (a new edge function,
-- odoo-po-rollup) — storing a second copy of what Odoo already knows would
-- drift from it the moment anyone re-prices a PO. This table exists only for
-- the two things Odoo's search cannot express: a PO whose Source Document was
-- never filled in (attached manually, by number) and a PO Odoo's search
-- wrongly matched (detached, so it stops counting).
--
-- ── One row per (opportunity, PO number), meaning "this po_number is not
-- what a fresh Odoo search alone would say" ─────────────────────────────────
-- origin records where the override came from: 'ODOO_ORIGIN' means Odoo's own
-- search found it and this row exists only to detach it (is_detached is then
-- always true — a non-detached ODOO_ORIGIN row would carry no information a
-- fresh search doesn't already give). 'MANUAL' means a human typed the PO
-- number in because Odoo's search missed it; is_detached is false unless
-- someone later un-attaches it, at which point the row is simply deleted
-- (there is nothing left to override once neither the search nor a human
-- claims the number).
--
-- A PO nobody has ever touched has NO row here at all — it is whatever the
-- live search says, which is the point: a detach has to survive the next
-- refresh, and it does so by being the one thing recorded, not by every
-- ordinary match also needing a row.
--
-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read is org-wide, matching every other SOR-scoped table. Write mirrors
-- sor_can_edit_opportunity (0003) — reconciling actual cost against the
-- estimate is the same sales-side decision the Project Evaluation itself is.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Creates a new table. No deployed frontend selects it.
--   * No existing row, table or policy is modified.
--   * Idempotent — safe to re-run.
-- ==============================================================================

create table if not exists public.sor_purchase_order_links (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.sales_opportunities(id) on delete cascade,

  po_number       text not null,
  origin          text not null check (origin in ('ODOO_ORIGIN', 'MANUAL')),
  is_detached     boolean not null default false,

  created_by      uuid references public.employees(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint sor_purchase_order_links_unique unique (opportunity_id, po_number)
);

create index if not exists sor_purchase_order_links_opp_idx
  on public.sor_purchase_order_links (opportunity_id);

create or replace function public.sor_purchase_order_links_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sor_purchase_order_links_touch on public.sor_purchase_order_links;
create trigger trg_sor_purchase_order_links_touch
  before update on public.sor_purchase_order_links
  for each row execute function public.sor_purchase_order_links_touch();

alter table public.sor_purchase_order_links enable row level security;

drop policy if exists sor_purchase_order_links_read on public.sor_purchase_order_links;
create policy sor_purchase_order_links_read on public.sor_purchase_order_links
  for select to authenticated using (true);

drop policy if exists sor_purchase_order_links_write on public.sor_purchase_order_links;
create policy sor_purchase_order_links_write on public.sor_purchase_order_links
  for all to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id))
  with check (public.sor_can_edit_opportunity(opportunity_id));

comment on table public.sor_purchase_order_links is
  'Issue #49. Overrides to the live Odoo PO rollup: a manual attach for a PO Source Document missed, or a detach for one wrongly matched. A po_number with no row is neither — it is exactly what the live search says.';
