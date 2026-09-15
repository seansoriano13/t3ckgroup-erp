-- Issue #203 — Stage Fields and Stage Visits.
--
-- Stage Fields replace the `field` condition kind: an input, not a rule, so
-- it gets its own table instead of living disguised inside stage_conditions'
-- config. `flow_stage_fields` mirrors stage_conditions' shape and policies
-- (open write, soft archive) — same table family, same access model.
--
-- `sor_stage_field_values` holds only *custom* field values, one per Stage
-- Visit: an `sor`-source field writes straight through to the SOR's own
-- column (issue #199's single-field write), so storing it again here would
-- just be a second, driftable copy.
--
-- Stage Visits are the foundation both tables' per-visit scoping depends on:
-- `sor_stage_visits` records every stay an SOR makes on a Stage. It is
-- written only by a trigger (security definer, no client insert/update
-- policy) so no caller can forget to record one (story 30) — see
-- `record_stage_visit()` below, fired from `sales_opportunities`.

-- ─── flow_stage_fields ───────────────────────────────────────────────────────

create table if not exists public.flow_stage_fields (
  id           uuid primary key default gen_random_uuid(),
  stage_id     uuid not null references public.flow_stages (id) on delete cascade,
  label        text not null,
  help         text,
  source       text not null,
  sor_field    text,
  field_type   text not null,
  options      jsonb not null default '[]'::jsonb,
  is_required  boolean not null default true,
  sort_order   integer not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint flow_stage_fields_source_chk check (source in ('sor', 'custom')),
  constraint flow_stage_fields_type_chk check (field_type in ('text', 'number', 'date', 'choice')),
  constraint flow_stage_fields_sor_field_chk check (
    (source = 'sor' and sor_field is not null) or (source = 'custom' and sor_field is null)
  ),
  constraint flow_stage_fields_label_not_blank check (btrim(label) <> '')
);

create index if not exists flow_stage_fields_stage_id_idx on public.flow_stage_fields (stage_id);

alter table public.flow_stage_fields enable row level security;

drop policy if exists flow_stage_fields_read on public.flow_stage_fields;
create policy flow_stage_fields_read on public.flow_stage_fields
  for select to authenticated
  using (true);

-- Access control opened, matching stage_conditions_write: anyone can edit
-- Flow Canvas (requireSuperAdmin in stageConditionService.js/a future
-- stageFieldService.js is a no-op today).
drop policy if exists flow_stage_fields_write on public.flow_stage_fields;
create policy flow_stage_fields_write on public.flow_stage_fields
  for all to authenticated
  using (true)
  with check (true);

-- ─── sor_stage_visits ────────────────────────────────────────────────────────

create table if not exists public.sor_stage_visits (
  id               uuid primary key default gen_random_uuid(),
  opportunity_id   uuid not null references public.sales_opportunities (id) on delete cascade,
  flow_stage_id    uuid not null references public.flow_stages (id) on delete cascade,
  flow_snapshot_id uuid references public.flow_snapshots (id),
  sequence         integer not null,
  entered_at       timestamptz not null default now(),
  entered_by       uuid references public.employees (id),
  left_at          timestamptz,
  left_by          uuid references public.employees (id),

  constraint sor_stage_visits_unique_sequence unique (opportunity_id, sequence)
);

create index if not exists sor_stage_visits_opportunity_id_idx on public.sor_stage_visits (opportunity_id);
create index if not exists sor_stage_visits_open_idx on public.sor_stage_visits (opportunity_id) where left_at is null;

alter table public.sor_stage_visits enable row level security;

-- Story 30 / Testing Decision (Policy tier): no signed-in employee can
-- insert or update sor_stage_visits directly — only the trigger, running as
-- its definer, writes here. Read is open, same as every other Stage-gate
-- table today (visit-scoped *visibility* is a later spec, issue #203's Out
-- of Scope).
drop policy if exists sor_stage_visits_read on public.sor_stage_visits;
create policy sor_stage_visits_read on public.sor_stage_visits
  for select to authenticated
  using (true);

-- ─── sor_stage_field_values ──────────────────────────────────────────────────

create table if not exists public.sor_stage_field_values (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.sales_opportunities (id) on delete cascade,
  stage_visit_id  uuid not null references public.sor_stage_visits (id) on delete cascade,
  field_id        uuid not null references public.flow_stage_fields (id) on delete cascade,
  value           jsonb,
  updated_by      uuid references public.employees (id),
  updated_at      timestamptz not null default now(),

  constraint sor_stage_field_values_unique unique (stage_visit_id, field_id)
);

create index if not exists sor_stage_field_values_opportunity_id_idx
  on public.sor_stage_field_values (opportunity_id);

alter table public.sor_stage_field_values enable row level security;

drop policy if exists sor_stage_field_values_write on public.sor_stage_field_values;
create policy sor_stage_field_values_write on public.sor_stage_field_values
  for all to authenticated
  using (true)
  with check (true);

-- ─── sor_condition_status: visit-scoped evidence ────────────────────────────
--
-- A tickbox certified on a visit that has since closed must ask again on the
-- next visit (story 28). The unique key moves from (opportunity, condition)
-- to (stage_visit, condition); existing rows attach to whichever visit was
-- open when they were written — the backfill migration below creates those
-- visits first, so this column is never left null for a live SOR.

alter table public.sor_condition_status
  add column if not exists stage_visit_id uuid references public.sor_stage_visits (id) on delete cascade;

create index if not exists sor_condition_status_stage_visit_id_idx
  on public.sor_condition_status (stage_visit_id);

-- The unique key moves from (opportunity, condition) to (visit, condition):
-- a certification is now scoped to the visit it was given on, so a second
-- visit can certify the same condition again without colliding with the
-- first visit's row.
alter table public.sor_condition_status drop constraint if exists sor_condition_status_unique;
alter table public.sor_condition_status
  add constraint sor_condition_status_visit_unique unique (stage_visit_id, condition_id);

-- ─── The trigger: opens/closes a visit on insert and on stage change ────────
--
-- Security definer, so a client with no insert/update grant on
-- sor_stage_visits still gets one recorded (story 30) purely by moving an
-- SOR through sales_opportunities, which it already has write access to.
-- Fires only for flow-built deals (flow_stage_id not null) — the legacy
-- pipeline's `status` column has no notion of a Stage Visit.
--
-- `sales_opportunities` carries no `updated_by` column, so `entered_by`
-- and `left_by` on a stage-change visit are left null — "who moved it" is
-- already recorded on the STAGE_CHANGED timeline entry the caller writes
-- separately; this trigger only owns "when".
create or replace function public.record_stage_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_sequence integer;
begin
  if TG_OP = 'INSERT' then
    if NEW.flow_stage_id is null then
      return NEW;
    end if;

    insert into public.sor_stage_visits (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by)
    values (NEW.id, NEW.flow_stage_id, NEW.flow_snapshot_id, 1, coalesce(NEW.created_at, now()), NEW.registered_by);

    return NEW;
  end if;

  -- UPDATE: only react to an actual stage change.
  if NEW.flow_stage_id is not distinct from OLD.flow_stage_id then
    return NEW;
  end if;

  update public.sor_stage_visits
    set left_at = now()
    where opportunity_id = NEW.id and left_at is null;

  if NEW.flow_stage_id is not null then
    select coalesce(max(sequence), 0) + 1 into v_next_sequence
      from public.sor_stage_visits where opportunity_id = NEW.id;

    insert into public.sor_stage_visits (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at)
    values (NEW.id, NEW.flow_stage_id, NEW.flow_snapshot_id, v_next_sequence, now());
  end if;

  return NEW;
end;
$$;

drop trigger if exists sor_stage_visits_on_insert on public.sales_opportunities;
create trigger sor_stage_visits_on_insert
  after insert on public.sales_opportunities
  for each row execute function public.record_stage_visit();

drop trigger if exists sor_stage_visits_on_stage_change on public.sales_opportunities;
create trigger sor_stage_visits_on_stage_change
  after update of flow_stage_id on public.sales_opportunities
  for each row execute function public.record_stage_visit();
