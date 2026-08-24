-- ==============================================================================
-- 0033_crm_pipeline_stages.sql
--
-- Moves the SOR pipeline out of hard-coded constants and into a table, the way
-- 0013 did for lead sources. The twelve Annex C.3 stages are seeded here as
-- system rows, plus two the business runs but Annex C never named: For Bidding
-- and Payment Verification. Beyond those two additions this migration does not
-- amend Policy CCPR-2026-001 — it stops a rename or a colour change from
-- needing a deploy.
--
-- WHY FLAGS AND NOT NAMES
-- Four stages carry behaviour that used to be matched by literal name in both
-- the app and the 0011 trigger. That is what made the pipeline unsafe to edit:
-- renaming a stage would have silently detached its meaning. The flags below
-- carry it instead, so a label is only ever a label.
--
--   is_default  status defaults to this stage on insert, and leaving it is what
--               requires a Sales Reference (0011).
--   is_anchor   stamps contract_date, which permanently fixes which Commission
--               Rate prices that opportunity. Exactly one row, forever.
--   is_won      terminal success.  is_lost  terminal failure.
--   is_system   seeded by policy; the app refuses to deactivate or reorder it.
--
-- WHAT IS DELIBERATELY ABSENT
-- There is no `counts_as_realized` column. Realized-vs-Projected is derived
-- from sort_order relative to the anchor (see constants/sor.js), so that no
-- settings screen anywhere can move an opportunity between the Realized and
-- Projected Commission Pool. Storing it as a per-stage toggle would put a
-- checkbox in front of money. See docs/adr/0003.
--
-- sort_order is gapped by ten so inserting a stage never renumbers its
-- neighbours, which would otherwise rewrite every row on an ordering change.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new table — nothing existing selects it.
--   * No existing ROW is modified, and no opportunity changes stage.
--   * The status CHECK on sales_opportunities is widened, never narrowed, so
--     every stored status stays valid and the statement cannot fail on
--     existing data. Replacing that CHECK with a foreign key onto this table
--     is a separate migration.
--   * Idempotent — safe to re-run.
--
-- Run this BEFORE deploying the pipeline stage frontend — pipelineStageService
-- selects this table, and PostgREST rejects the whole query (not a partial one)
-- when a relation is missing. The service does carry the same stages as a
-- fallback, so a missing table degrades to the default pipeline rather than an
-- empty board, but the ordering above avoids relying on that.
-- ==============================================================================

create table if not exists public.crm_pipeline_stages (
  -- Immutable once created. `sales_opportunities.status` stores this value, so
  -- a rename must never touch it — that is the entire reason label is separate.
  code        text primary key,
  label       text        not null,
  sort_order  integer     not null,
  -- Name of an entry in the badge palette (constants/statusTheme.js). The
  -- name-to-classes mapping stays in code so badge lookup stays synchronous.
  theme       text        not null default 'mauve',
  is_active   boolean     not null default true,
  is_system   boolean     not null default false,
  is_default  boolean     not null default false,
  is_anchor   boolean     not null default false,
  is_won      boolean     not null default false,
  is_lost     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Ordering is what the derivation reads, so two stages may not share a slot.
create unique index if not exists crm_pipeline_stages_sort_order_key
  on public.crm_pipeline_stages (sort_order);

-- At most one row may carry each of these. A unique index on a constant
-- expression, restricted to rows where the flag is set, is how Postgres
-- expresses "exactly one" without a trigger.
create unique index if not exists crm_pipeline_stages_one_default
  on public.crm_pipeline_stages ((true)) where is_default;
create unique index if not exists crm_pipeline_stages_one_anchor
  on public.crm_pipeline_stages ((true)) where is_anchor;
create unique index if not exists crm_pipeline_stages_one_won
  on public.crm_pipeline_stages ((true)) where is_won;
create unique index if not exists crm_pipeline_stages_one_lost
  on public.crm_pipeline_stages ((true)) where is_lost;

-- ── Seed: the default pipeline, in order ────────────────────────────────────
-- Values match PIPELINE_STAGE_SEED in src/constants/sor.js. The twelve Annex
-- C.3 themes are the ones those badges already rendered with, so nothing
-- changes colour.
--
-- For Bidding (35) and Payment Verification (65) are additions on top of Annex
-- C.3, slotted into the existing gaps so no seeded stage had to be renumbered.
-- Payment Verification is past the anchor, so opportunities there count toward
-- the Realized Commission Pool — correct, because the deal is awarded and its
-- Contract Date is already stamped, and precisely why a stage on that side is
-- added by migration rather than from a settings screen.
insert into public.crm_pipeline_stages
  (code, label, sort_order, theme, is_system, is_default, is_anchor, is_won, is_lost)
values
  ('LEAD',               'Lead',              10,  'mauve',  true, true,  false, false, false),
  ('QUALIFIED',          'Qualified',         20,  'amber',  true, false, false, false, false),
  ('PROPOSAL_SUBMITTED', 'Proposal Submitted',30,  'blue',   true, false, false, false, false),
  ('FOR_BIDDING',        'For Bidding',       35,  'amber',  true, false, false, false, false),
  ('BID_SUBMITTED',      'Bid Submitted',     40,  'blue',   true, false, false, false, false),
  ('NEGOTIATION',        'Negotiation',       50,  'violet', true, false, false, false, false),
  ('AWARDED',            'Awarded',           60,  'green',  true, false, true,  false, false),
  ('PAYMENT_VERIFICATION','Payment Verification',65,'amber',  true, false, false, false, false),
  ('PO_RECEIVED',        'PO Received',       70,  'green',  true, false, false, false, false),
  ('PROJECT_DELIVERY',   'Project Delivery',  80,  'orange', true, false, false, false, false),
  ('COLLECTION',         'Collection',        90,  'orange', true, false, false, false, false),
  ('CLOSED_WON',         'Closed Won',        100, 'green',  true, false, false, true,  false),
  ('RETENTION',          'Retention',         110, 'violet', true, false, false, false, false),
  ('CLOSED_LOST',        'Closed Lost',       120, 'red',    true, false, false, false, true)
on conflict (code) do nothing;

-- ── Let sales_opportunities.status accept the new stages ────────────────────
-- 0001 froze the twelve valid statuses into a CHECK. Two stages have been
-- added, so the constraint has to learn them or a deal could be moved to a
-- stage the picker offers and the database then rejects.
--
-- This deliberately stops at widening the list. Replacing the CHECK with a
-- foreign key onto this table — which removes the duplicated enumeration for
-- good — is its own migration, because it also requires rewriting the 0011
-- trigger and teaching the test factories to seed a pipeline.
alter table public.sales_opportunities
  drop constraint if exists sales_opportunities_status_chk;
alter table public.sales_opportunities
  add constraint sales_opportunities_status_chk check (status in (
    'LEAD','QUALIFIED','PROPOSAL_SUBMITTED','FOR_BIDDING','BID_SUBMITTED',
    'NEGOTIATION','AWARDED','PAYMENT_VERIFICATION','PO_RECEIVED',
    'PROJECT_DELIVERY','COLLECTION','CLOSED_WON','RETENTION','CLOSED_LOST'
  ));

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Everyone reads the pipeline, because everyone renders it. Only a super admin
-- writes it — same shape as the commission configuration tables in 0028.
alter table public.crm_pipeline_stages enable row level security;

drop policy if exists crm_pipeline_stages_read on public.crm_pipeline_stages;
create policy crm_pipeline_stages_read on public.crm_pipeline_stages
  for select to authenticated using (true);

drop policy if exists crm_pipeline_stages_write on public.crm_pipeline_stages;
create policy crm_pipeline_stages_write on public.crm_pipeline_stages
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  );
