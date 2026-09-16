-- Registration form customization, per Sales Flow.
--
-- The Flow Canvas gains a form builder for the SOR registration form
-- (OpportunityFormModal). Choosing a Sale Type at registration loads that
-- flow's form: the built-in default fields, as customized here, plus any
-- custom fields the flow adds.
--
-- WHY A ROW MEANS "CHANGED", NOT "PRESENT"
-- The default fields are not seeded into this table. A row with
-- source='default' exists only where a default has actually been customized —
-- relabelled, reordered, or hidden. No row means "the built-in default,
-- untouched". Three consequences, all of them the point:
--   * Restore-to-default is deleting this flow's rows. Nothing to reconcile.
--   * A default nobody has touched can never drift from the form's own code.
--   * Adding a new default field later needs no backfill — every existing
--     flow picks it up automatically.
--
-- WHAT CANNOT BE CUSTOMIZED
-- The Ownership fields (deal owner, closing salesperson, sales director,
-- support sales 1/2) are out of scope entirely and have no representation
-- here. Company, Contact Person, Project and Lead Source may be relabelled
-- and reordered but never hidden: they are `required` on the form and back
-- NOT NULL columns, so hiding one produces a form that passes the builder and
-- fails on submit. Both rules are enforced in formFieldService, not by a
-- constraint — the allowed key list lives in JS beside the form it describes.

-- ─── flow_form_fields ────────────────────────────────────────────────────────

create table if not exists public.flow_form_fields (
  id           uuid primary key default gen_random_uuid(),
  flow_id      uuid not null references public.sales_flows (id) on delete cascade,
  source       text not null,
  -- For source='default': which built-in field this row customizes, e.g.
  -- 'expected_award_date'. Null for a custom field.
  default_key  text,
  -- Null on a 'default' row means "keep the form's own label".
  label        text,
  help         text,
  field_type   text,
  options      jsonb not null default '[]'::jsonb,
  is_required  boolean,
  is_hidden    boolean not null default false,
  sort_order   integer not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint flow_form_fields_source_chk check (source in ('default', 'custom')),
  constraint flow_form_fields_default_key_chk check (
    (source = 'default' and default_key is not null)
    or (source = 'custom' and default_key is null)
  ),
  -- A custom field is a real input and needs both a label and a type; a
  -- default row may carry neither, since it only overrides what it sets.
  constraint flow_form_fields_custom_shape_chk check (
    source <> 'custom'
    or (label is not null and btrim(label) <> '' and field_type is not null)
  ),
  constraint flow_form_fields_type_chk check (
    field_type is null or field_type in ('text', 'number', 'date', 'choice')
  ),
  -- One customization row per default field per flow. Custom fields are not
  -- constrained this way: two custom fields may share a label.
  constraint flow_form_fields_default_unique unique (flow_id, default_key)
);

create index if not exists flow_form_fields_flow_id_idx on public.flow_form_fields (flow_id);

alter table public.flow_form_fields enable row level security;

drop policy if exists flow_form_fields_read on public.flow_form_fields;
create policy flow_form_fields_read on public.flow_form_fields
  for select to authenticated
  using (true);

-- Access control opened, matching flow_stage_fields_write and
-- stage_conditions_write: anyone can edit the Flow Canvas.
drop policy if exists flow_form_fields_write on public.flow_form_fields;
create policy flow_form_fields_write on public.flow_form_fields
  for all to authenticated
  using (true)
  with check (true);

-- ─── sor_form_values ─────────────────────────────────────────────────────────
--
-- A custom registration field's answer, given once when the SOR is
-- registered. Deliberately NOT sor_stage_field_values: that table is keyed by
-- Stage Visit because a Stage can ask the same question again on a later
-- visit. A registration answer has no visit — it is given before the SOR has
-- entered anything — so it is keyed by the SOR itself.
--
-- A 'default'-source field never writes here: it writes the SOR's own column,
-- exactly as it does today. Storing it here as well would be a second,
-- driftable copy — the same reasoning sor_stage_field_values applies to its
-- own 'sor'-source fields.

create table if not exists public.sor_form_values (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.sales_opportunities (id) on delete cascade,
  field_id        uuid not null references public.flow_form_fields (id) on delete cascade,
  value           jsonb,
  updated_by      uuid references public.employees (id),
  updated_at      timestamptz not null default now(),

  constraint sor_form_values_unique unique (opportunity_id, field_id)
);

create index if not exists sor_form_values_opportunity_id_idx
  on public.sor_form_values (opportunity_id);

alter table public.sor_form_values enable row level security;

drop policy if exists sor_form_values_read on public.sor_form_values;
create policy sor_form_values_read on public.sor_form_values
  for select to authenticated
  using (true);

drop policy if exists sor_form_values_write on public.sor_form_values;
create policy sor_form_values_write on public.sor_form_values
  for all to authenticated
  using (true)
  with check (true);
