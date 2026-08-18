-- ==============================================================================
-- 0017_sor_procurement_requests.sql
--
-- Procurement requests raised from a SOR: products a client has asked for that
-- the company does not carry, handed to purchasing as one task with a
-- checklist.
--
-- ── Why these are NOT SOR line items ────────────────────────────────────────
-- The SOR product list is pulled from the Odoo sales order (odoo-sor-lookup
-- reads sale.order.line), so every line in it exists in Odoo by construction.
-- A product that needs sourcing is precisely one that could never appear
-- there. A request is therefore free text — a name, whatever the client said
-- about it, and usually a screenshot of the message they said it in.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Creates a new table. No existing frontend selects it, so nothing can be
--     broken by it existing early.
--   * No existing row, table or policy is modified.
--   * Idempotent — safe to re-run.
--
-- Run this BEFORE deploying the procurement frontend. procurementService
-- selects this table, and PostgREST rejects the entire query when a relation
-- is missing, which returns an empty list rather than a partial one.
--
-- ── Why a separate table rather than columns on sales_opportunity_items ──────
-- opportunityService.replaceItems deletes every item row and re-inserts with
-- fresh UUIDs on each SOR save (src/services/opportunityService.js:393). Line
-- items therefore have no stable identity, and any procurement state stored on
-- them would be destroyed — silently — the next time anyone edited the SOR.
--
-- requested_name is a frozen snapshot of the free text sales typed, never
-- updated afterwards. A requisition records what was asked for at the time; it
-- must not mutate because someone corrected a typo three weeks later. Matching
-- a request back to a live SOR line is done by normalised name, for display
-- only, and a miss is tolerated.
-- ==============================================================================

create table if not exists public.sor_procurement_requests (
  id                 uuid primary key default gen_random_uuid(),
  opportunity_id     uuid not null references public.sales_opportunities(id) on delete cascade,

  -- The purchasing task this request was bundled into. Nullable and ON DELETE
  -- SET NULL: the request is the record of what was asked for and must outlive
  -- the task row that carried it.
  task_id            uuid references public.tasks(id) on delete set null,

  -- ── The ask, as sales wrote it ──────────────────────────────────────────
  -- No price: a product nobody carries has no unit price to quote yet. That is
  -- what purchasing is being asked to find out.
  requested_name        text not null,
  requested_unit        text,
  requested_quantity    numeric(12,2) not null default 1,

  -- The client's own words about what they need. Sales rarely retypes specs —
  -- they paste the screenshot of the message, so images are first-class here
  -- rather than an afterthought. Descriptor shape matches every other
  -- attachment column in this schema: [{ url, name, type, bytes }].
  requested_description text,
  requested_images      jsonb not null default '[]'::jsonb,

  -- ── Purchasing's answer ─────────────────────────────────────────────────
  -- NULL outcome means unresolved. The task closes when no row is left NULL.
  outcome            text check (outcome in (
                       'ON_ORDER',       -- PO raised, product now in Odoo, goods not yet on hand
                       'ALREADY_EXISTS', -- in Odoo under a different name; nothing bought
                       'SUBSTITUTED',    -- different product sourced; sales must re-price
                       'UNAVAILABLE'     -- cannot be sourced
                     )),
  outcome_note       text,
  po_number          text,
  odoo_product_ref   text,

  -- Lead time "depends on the product" per purchasing, so it is captured rather
  -- than inferred: a 3-day item and a 12-week item are otherwise identical here,
  -- and sales quotes a delivery date off it.
  eta                date,

  -- Result of checking po_number against Odoo's purchase.order. The check is
  -- soft-fail by design: an unreachable Odoo marks the row PENDING_VERIFICATION
  -- rather than blocking someone's task completion on an integration hiccup.
  verification       text not null default 'UNVERIFIED' check (verification in (
                       'UNVERIFIED',
                       'VERIFIED',
                       'PENDING_VERIFICATION',
                       'NOT_FOUND'
                     )),

  requested_by       uuid not null references public.employees(id),
  assigned_to        uuid references public.employees(id),
  resolved_by        uuid references public.employees(id),
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Idempotent top-up: this migration was revised after its first draft, so a
-- database that already ran the earlier version converges here rather than
-- needing a second file. `create table if not exists` above is a no-op once the
-- table exists and would silently skip these.
alter table public.sor_procurement_requests
  add column if not exists requested_description text;

alter table public.sor_procurement_requests
  add column if not exists requested_images jsonb not null default '[]'::jsonb;

alter table public.sor_procurement_requests
  drop column if exists requested_value;

create index if not exists sor_procurement_requests_opp_idx
  on public.sor_procurement_requests (opportunity_id);

create index if not exists sor_procurement_requests_task_idx
  on public.sor_procurement_requests (task_id);

-- Partial index: the hot read is "what is still on my plate", never the
-- resolved history.
create index if not exists sor_procurement_requests_open_idx
  on public.sor_procurement_requests (assigned_to)
  where outcome is null;

create or replace function public.sor_procurement_requests_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sor_procurement_requests_touch on public.sor_procurement_requests;
create trigger trg_sor_procurement_requests_touch
  before update on public.sor_procurement_requests
  for each row execute function public.sor_procurement_requests_touch();

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Read is org-wide, matching the parent opportunity's visibility.
--
-- Write is deliberately NOT sor_can_edit_opportunity(). That helper (see
-- 0003_sales_opportunity_items.sql) grants write to the registrant, the four
-- sales participants, heads and super admins — a purchasing employee is none of
-- those and would be blocked from recording the PO number that closes their own
-- task. It is still the right gate for INSERT, since raising a request is a
-- sales act on a deal they own.
--
-- UPDATE is scoped to the procurement row only. Nothing here grants a
-- purchasing employee any write access to the parent opportunity, which remains
-- governed by sor_update in 0002.
alter table public.sor_procurement_requests enable row level security;

drop policy if exists sor_procurement_read on public.sor_procurement_requests;
create policy sor_procurement_read on public.sor_procurement_requests
  for select to authenticated using (true);

drop policy if exists sor_procurement_insert on public.sor_procurement_requests;
create policy sor_procurement_insert on public.sor_procurement_requests
  for insert to authenticated
  with check (
    public.sor_can_edit_opportunity(opportunity_id)
    and requested_by = public.get_employee_id()
  );

-- The assigned purchaser resolves it; the requester can amend or withdraw their
-- own ask; heads and super admins can act on either side. WITH CHECK mirrors
-- USING so a row cannot be moved onto a different opportunity by an update.
drop policy if exists sor_procurement_update on public.sor_procurement_requests;
create policy sor_procurement_update on public.sor_procurement_requests
  for update to authenticated
  using (
    assigned_to = public.get_employee_id()
    or requested_by = public.get_employee_id()
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.is_head or e.is_super_admin)
    )
  )
  with check (
    assigned_to = public.get_employee_id()
    or requested_by = public.get_employee_id()
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.is_head or e.is_super_admin)
    )
  );

-- Withdrawing a request is the requester's call (or a head's). Purchasing
-- resolves rows, it does not delete them — the record of what was asked for is
-- the point.
drop policy if exists sor_procurement_delete on public.sor_procurement_requests;
create policy sor_procurement_delete on public.sor_procurement_requests
  for delete to authenticated
  using (
    requested_by = public.get_employee_id()
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.is_head or e.is_super_admin)
    )
  );
