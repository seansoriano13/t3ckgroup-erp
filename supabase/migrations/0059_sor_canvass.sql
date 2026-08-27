-- ==============================================================================
-- 0059_sor_canvass.sql
--
-- Canvass (issue #38 vocabulary; this ticket #46, Inclusion side in #47): the
-- three-or-more supplier comparison, recorded as structured Offers instead of
-- an ad-hoc sheet nobody can produce later as evidence.
--
-- ── One Canvass, one subject ────────────────────────────────────────────────
-- A Canvass belongs to exactly one of a Procurement Request or an Inclusion —
-- "shop this specific ask that already has a home" versus "price this line of
-- the client's spec directly." The CHECK below enforces exactly one of the two
-- foreign keys is set. This ticket ships the Procurement Request side, which
-- already exists; the Inclusion side (#47) needs nothing further here, the
-- column is just unused by this ticket's UI until then.
--
-- ── Offers, not a flat price column ─────────────────────────────────────────
-- Policy is price, delivery speed and quality — never price alone — so an
-- Offer carries brand, description, source link, brochure, remarks, unit
-- price, lead time and a quality note. lead_time is free text ("depends on the
-- product" per purchasing — a 3-day item and a 12-week item are not usefully
-- forced into one column shape).
--
-- ── The three-offer minimum is not a CHECK ──────────────────────────────────
-- Research happens over days; a Canvass must be saveable half-finished. The
-- minimum is a warning enforced in the UI at sign-off (constants/
-- projectEvaluation.js), never a database constraint.
--
-- ── At most one winner, enforced twice ──────────────────────────────────────
-- The partial unique index makes "two winners on one Canvass" impossible even
-- from a bad write path. projectEvaluationService additionally clears the old
-- winner before setting the new one (two sequential awaited writes), so the
-- index is never hit transiently — it's a backstop, not the primary mechanism,
-- which is the pure applyWinner() function tested at the unit tier.
--
-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read is org-wide, matching every other SOR-scoped table.
--
-- Write is has_purchasing_flow (or head / super admin) — canvassing is
-- purchasing's job regardless of which subject a Canvass hangs off. This is
-- deliberately NOT sor_can_edit_opportunity: a purchaser is routinely not one
-- of the SOR's sales participants, exactly as 0017 and 0055 already reasoned
-- for procurement requests and Inclusion sourcing.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Creates two new tables. No deployed frontend selects them.
--   * No existing row, table or policy is modified.
--   * Idempotent — safe to re-run.
-- ==============================================================================

create table if not exists public.sor_canvasses (
  id                      uuid primary key default gen_random_uuid(),

  procurement_request_id  uuid references public.sor_procurement_requests(id) on delete cascade,
  inclusion_id            uuid references public.sor_inclusions(id) on delete cascade,

  -- The original working sheet, evidence that canvassing happened however the
  -- purchaser actually did it. Same descriptor shape as every other attachment
  -- column in this schema: [{ url, name, type, bytes }].
  attachments             jsonb not null default '[]'::jsonb,

  signed_off_by           uuid references public.employees(id),
  signed_off_at           timestamptz,

  created_by              uuid references public.employees(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint sor_canvasses_one_subject_chk check (
    (procurement_request_id is not null)::int + (inclusion_id is not null)::int = 1
  )
);

create index if not exists sor_canvasses_procurement_request_idx
  on public.sor_canvasses (procurement_request_id)
  where procurement_request_id is not null;

create index if not exists sor_canvasses_inclusion_idx
  on public.sor_canvasses (inclusion_id)
  where inclusion_id is not null;

create table if not exists public.sor_canvass_offers (
  id             uuid primary key default gen_random_uuid(),
  canvass_id     uuid not null references public.sor_canvasses(id) on delete cascade,

  brand          text,
  description    text,
  source_link    text,
  brochure       jsonb not null default '[]'::jsonb,
  remarks        text,
  unit_price     numeric(14,2),
  lead_time      text,
  quality_note   text,

  is_winner      boolean not null default false,
  sort_order     integer not null default 0,

  created_by     uuid references public.employees(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists sor_canvass_offers_canvass_idx
  on public.sor_canvass_offers (canvass_id, sort_order);

-- At most one winner per Canvass. See the note above the table for why the
-- service still clears-then-sets rather than leaning on this alone.
create unique index if not exists sor_canvass_offers_one_winner_per_canvass
  on public.sor_canvass_offers (canvass_id)
  where is_winner;

create or replace function public.sor_canvasses_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sor_canvasses_touch on public.sor_canvasses;
create trigger trg_sor_canvasses_touch
  before update on public.sor_canvasses
  for each row execute function public.sor_canvasses_touch();

create or replace function public.sor_canvass_offers_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sor_canvass_offers_touch on public.sor_canvass_offers;
create trigger trg_sor_canvass_offers_touch
  before update on public.sor_canvass_offers
  for each row execute function public.sor_canvass_offers_touch();

alter table public.sor_canvasses enable row level security;
alter table public.sor_canvass_offers enable row level security;

drop policy if exists sor_canvasses_read on public.sor_canvasses;
create policy sor_canvasses_read on public.sor_canvasses
  for select to authenticated using (true);

drop policy if exists sor_canvasses_write on public.sor_canvasses;
create policy sor_canvasses_write on public.sor_canvasses
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.has_purchasing_flow or e.is_head or e.is_super_admin)
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.has_purchasing_flow or e.is_head or e.is_super_admin)
    )
  );

drop policy if exists sor_canvass_offers_read on public.sor_canvass_offers;
create policy sor_canvass_offers_read on public.sor_canvass_offers
  for select to authenticated using (true);

drop policy if exists sor_canvass_offers_write on public.sor_canvass_offers;
create policy sor_canvass_offers_write on public.sor_canvass_offers
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.has_purchasing_flow or e.is_head or e.is_super_admin)
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.has_purchasing_flow or e.is_head or e.is_super_admin)
    )
  );

comment on table public.sor_canvasses is
  'Issue #46/#47. The supplier comparison as evidence: belongs to exactly one Procurement Request or Inclusion, never both.';
comment on table public.sor_canvass_offers is
  'Issue #46/#47. One supplier offer within a Canvass. At most one per Canvass may carry is_winner — see sor_canvass_offers_one_winner_per_canvass.';
