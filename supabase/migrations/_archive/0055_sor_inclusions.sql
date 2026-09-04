-- ==============================================================================
-- 0055_sor_inclusions.sql
--
-- Inclusions (issue #43): the client's specification, broken out one row per
-- item they actually asked for.
--
-- ── Why this table has to exist at all ──────────────────────────────────────
-- Odoo bundles. An Ambulance Commuter or a Rescue Vehicle is ONE line on the
-- sale order, and the inclusions and accessories that make it up are written as
-- free text inside that line's description (confirmed on S06070). There is
-- therefore no way, in Odoo, to walk a tender's spec sheet item by item and
-- confirm each requirement is accounted for — which is exactly what an
-- apple-to-apple comparison against that tender demands. The team rebuilds that
-- breakdown in a spreadsheet on every deal. This is that breakdown.
--
-- ── Why these are NOT sales_opportunity_items ───────────────────────────────
-- Same reason 0017 gave for procurement requests, and it is worth restating
-- because the temptation is identical. opportunityService.replaceItems deletes
-- every item row and re-inserts with fresh UUIDs on each SOR save. Line items
-- therefore have no stable identity, and anything hanging off one — a Canvass,
-- a stamped cost, a completeness state somebody spent an afternoon deciding —
-- would be destroyed, silently, the next time anyone edited the SOR.
--
-- Inclusions carry their own identity precisely because Canvass (#46, #47) and
-- cost attach to them. That is also why this ticket does not need to touch
-- replaceItems at all: the two lists answer different questions. A line item is
-- what Odoo is selling. An Inclusion is what the client asked for.
--
-- ── The two states, and why sourcing is not a boolean ───────────────────────
-- completeness answers "is this spec fully answered" — the module's whole
-- purpose. It defaults to MISSING because a row entered from a spec sheet has
-- not been answered yet, and defaulting to COVERED would make a fresh
-- breakdown read as complete.
--
-- sourcing is deliberately three-valued. An earlier draft had `is_source_out`
-- as a boolean; that collapses the middle case, because a stockable item with
-- zero on hand still needs ordering and is explicitly NOT source-out. It is
-- nullable, and null means nobody has assessed it yet — which is a real state
-- and is not the same as claiming the item is on the shelf. Set by hand for
-- now; a live Odoo qty_available read is out of scope (#38).
--
-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Read is org-wide, matching the parent opportunity.
--
-- INSERT and DELETE are sor_can_edit_opportunity: what the client asked for is
-- a sales fact, and sales owns the list.
--
-- UPDATE additionally admits anyone holding purchasing access. This is not
-- generosity — it is the policy the next two tickets need and it belongs here
-- rather than in a follow-up migration that would have to rewrite it: #45 has a
-- purchaser's Procurement Request outcome writing completeness back onto the
-- Inclusion it came from, and #47 has the winning Canvass offer stamping the
-- cost. Both run as the purchaser. Without this clause both would fail at RLS
-- with a row count of zero rather than an error, which is the worst way for a
-- permission problem to present.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Creates a new table. No deployed frontend selects it, so nothing can be
--     broken by it existing early.
--   * No existing row, table or policy is modified.
--   * Idempotent — safe to re-run.
-- ==============================================================================

create table if not exists public.sor_inclusions (
  id                 uuid primary key default gen_random_uuid(),
  opportunity_id     uuid not null references public.sales_opportunities(id) on delete cascade,

  -- What the client asked for, in their words or the spec sheet's. Free text
  -- by construction: a tender line is a paragraph of requirements far more
  -- often than it is a catalog product name.
  description        text not null,
  quantity           numeric(12,2) not null default 1,
  unit               text,
  note               text,

  -- Is the client's specification answered? The primary question.
  completeness       text not null default 'MISSING' check (completeness in (
                       'COVERED',       -- accounted for as asked
                       'MISSING',       -- not yet answered
                       'SUBSTITUTED',   -- answered with something else; sales must re-price
                       'NOT_REQUIRED'   -- listed, but the client does not need it
                     )),

  -- How the item would be obtained. Null until somebody assesses it.
  sourcing           text check (sourcing in (
                       'STOCKABLE_AVAILABLE',       -- carried, on hand
                       'STOCKABLE_NEEDS_ORDERING',  -- carried, none on hand
                       'SOURCE_OUT'                 -- not carried; must be sourced
                     )),

  sort_order         integer not null default 0,

  created_by         uuid references public.employees(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists sor_inclusions_opp_idx
  on public.sor_inclusions (opportunity_id, sort_order);

create or replace function public.sor_inclusions_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sor_inclusions_touch on public.sor_inclusions;
create trigger trg_sor_inclusions_touch
  before update on public.sor_inclusions
  for each row execute function public.sor_inclusions_touch();

alter table public.sor_inclusions enable row level security;

drop policy if exists sor_inclusions_read on public.sor_inclusions;
create policy sor_inclusions_read on public.sor_inclusions
  for select to authenticated using (true);

drop policy if exists sor_inclusions_insert on public.sor_inclusions;
create policy sor_inclusions_insert on public.sor_inclusions
  for insert to authenticated
  with check (public.sor_can_edit_opportunity(opportunity_id));

-- See the RLS note above: the purchasing clause is what #45 and #47 write
-- through. WITH CHECK mirrors USING so a row cannot be moved onto a different
-- opportunity by an update.
drop policy if exists sor_inclusions_update on public.sor_inclusions;
create policy sor_inclusions_update on public.sor_inclusions
  for update to authenticated
  using (
    public.sor_can_edit_opportunity(opportunity_id)
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and e.has_purchasing_flow
    )
  )
  with check (
    public.sor_can_edit_opportunity(opportunity_id)
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and e.has_purchasing_flow
    )
  );

drop policy if exists sor_inclusions_delete on public.sor_inclusions;
create policy sor_inclusions_delete on public.sor_inclusions
  for delete to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id));

comment on table public.sor_inclusions is
  'Issue #43. The client''s specification, one row per item asked for. Exists because Odoo bundles a complex product into a single order line, making the spec check impossible there. Deliberately not sales_opportunity_items: replaceItems destroys line identity on every save.';
