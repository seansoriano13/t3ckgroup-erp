-- ==============================================================================
-- 0047_sale_types_and_sales_flows.sql
--
-- Sale Types and the Sales Flows they own (issue #36 — Flow Canvas; ADR 0006).
-- The container ADR 0004 established survives — a deal carries a type, the type
-- owns a flow — but the axis is renamed and its values stop being fixed in code.
--
-- NOTHING IS SEEDED, AND THAT IS THE POINT
-- Bidding/Outright were the values ADR 0004 fixed, and every later meeting
-- contradicted them. The Operations Manager creates Sale Types from an empty
-- list so the system cannot steer her toward categories that do not match how
-- the business actually sells. A seed here would be the system proposing
-- values, which is the failure this table exists to end.
--
-- WHY TWO TABLES FOR A ONE-TO-ONE RELATIONSHIP
-- They are one-to-one and they are not the same thing. `sale_types` is the
-- axis value an SOR carries — the thing a Deal Owner picks at registration and
-- the thing a report groups by. `sales_flows` is the process object that gets
-- drafted, locked, unlocked, snapshotted and promoted, and it carries the lock
-- state and the Won Stage. Folding them together would put a lock timestamp on
-- the value stored against every deal.
--
-- WON STAGE AS A COLUMN, NOT A FLAG
-- `won_stage_id` lives here rather than as an `is_won` boolean on the Stage,
-- so "exactly one Won Stage per flow" is structural rather than a rule
-- somebody has to remember to enforce. Two Won Stages cannot be represented.
-- It is null while drafting and required to lock — that check belongs at the
-- lock, not in a NOT NULL that would make an empty draft unrepresentable.
-- The FK is added in 0048, once flow_stages exists.
--
-- THE LOCK STATE
-- `draft` -> `locked`. Locked is read-only, enforced in the service layer
-- (the same place every other cross-row rule in this schema lives) rather than
-- by a trigger, because unlocking is a legitimate action with an audit trail
-- and a trigger cannot tell an unlock from a tamper.
--
-- ACCESS
-- Super-Admin only, per issue #36: the canvas is scaffolding scheduled to be
-- hidden, and building a role for it is the scope creep the project exists to
-- prevent. Read is left open to authenticated users because an SOR will carry
-- a sale_type_id and every register row needs to resolve its name.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Two new tables — nothing existing selects them.
--   * No existing row is modified and no column is dropped.
--   * Idempotent.
-- ==============================================================================

create table if not exists public.sale_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references public.employees (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,

  constraint sale_types_name_not_blank check (btrim(name) <> '')
);

-- Names are unique among the live ones only. An archived Sale Type keeps its
-- name (the deals that carry it still read it), and must not stop the
-- Operations Manager reusing that name for a flow she is redrawing.
create unique index if not exists sale_types_live_name_key
  on public.sale_types (lower(btrim(name)))
  where archived_at is null;

create table if not exists public.sales_flows (
  id            uuid primary key default gen_random_uuid(),
  sale_type_id  uuid not null unique references public.sale_types (id) on delete cascade,
  state         text not null default 'draft',
  won_stage_id  uuid,
  locked_at     timestamptz,
  locked_by     uuid references public.employees (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint sales_flows_state_chk check (state in ('draft', 'locked'))
);

-- ── RLS — configuration: everyone reads, Super Admin writes ─────────────────
-- The same split 0033 and 0041 already draw. Read is open because an SOR
-- carries a sale_type_id and every register row resolves its name.

alter table public.sale_types enable row level security;

drop policy if exists sale_types_read on public.sale_types;
create policy sale_types_read on public.sale_types
  for select to authenticated using (true);

drop policy if exists sale_types_write on public.sale_types;
create policy sale_types_write on public.sale_types
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

alter table public.sales_flows enable row level security;

drop policy if exists sales_flows_read on public.sales_flows;
create policy sales_flows_read on public.sales_flows
  for select to authenticated using (true);

drop policy if exists sales_flows_write on public.sales_flows;
create policy sales_flows_write on public.sales_flows
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
