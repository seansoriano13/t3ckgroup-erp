-- ==============================================================================
-- 20261015100000_transmittals_tracer.sql
--
-- Issue #252 (Transmittals: raise and submit a TG03 slip, spec #251).
--
-- The tracer bullet: the TG03 header, its products and references, its lines,
-- the derived IPAS and SOR links, the stage rows created on submit, the number
-- sequence, the append-only handoff history, the staff lists and the read rule.
-- Submitted, cancelled and closed slips are refused by triggers; the stages'
-- ratings and signatures arrive in the next two tickets (no stub here).
--
-- NUMBERING
-- `transmittals.number` is `TG03-` and the unpadded value of
-- `transmittal_number_seq`, never handed back. `transmittal_set_first_number`
-- (Super Admin) restarts the series, refused once any Transmittal exists.
--
-- WHO READS
-- `transmittal_can_read(id)`: `ipas_can_read()`, any of the four Transmittal
-- staff lists, or the preparer. The four staff lists are rows in
-- `ipas_signer_lists`, so `ipas_can_read()` now ignores the `transmittal_*`
-- keys: a Warehouse or Logistics member reads Transmittals, not IPAS (no
-- prices). A Warehouse or Logistics preparer picks PO lines through
-- `transmittal_pickable_po_lines`, which returns no money columns.
--
-- WHO PREPARES
-- `transmittal_can_prepare()`: Purchasing access, or the Warehouse or
-- Logistics list.
--
-- HISTORY IS APPEND-ONLY
-- `pms_handoff_events` refuses update, delete and truncate for every role, the
-- service role included. Each RPC writes a row in the same transaction.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: new tables,
-- a new sequence and new functions. Two existing constraints are widened (the
-- option lists and the signer-list keys) and ipas_can_read / ipas_set_signer_list
-- are replaced with the same signature. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Option lists and staff lists
-- ------------------------------------------------------------------------------

alter table public.ipas_options drop constraint if exists ipas_options_list_chk;
alter table public.ipas_options add constraint ipas_options_list_chk check (list in (
  'payment_method', 'charge_kind', 'document_kind', 'freight_service', 'item_location',
  'transmittal_product', 'transmittal_reference'
));

insert into public.ipas_options (list, label, sort) values
  ('transmittal_product', 'Marwa', 10),
  ('transmittal_product', 'BM', 20),
  ('transmittal_product', 'Office', 30),
  ('transmittal_reference', 'Data Sheet / Brochure', 10),
  ('transmittal_reference', 'Packing List / Picking List', 20),
  ('transmittal_reference', 'Manual', 30),
  ('transmittal_reference', 'Video & Photo', 40)
on conflict do nothing;

alter table public.ipas_signer_lists drop constraint if exists ipas_signer_lists_key_chk;
alter table public.ipas_signer_lists add constraint ipas_signer_lists_key_chk check (list_key in (
  's1_approved', 's3_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
  'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
));

alter table public.ipas_signer_list_log drop constraint if exists ipas_signer_list_log_key_chk;
alter table public.ipas_signer_list_log add constraint ipas_signer_list_log_key_chk check (list_key in (
  's1_approved', 's3_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
  'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
));

-- Check by is seeded by call sign (Ma'am Raquel 1001, Ma'am Grace 102). The
-- other three staff lists start empty and are filled at switch-over.
insert into public.ipas_signer_lists (list_key, employee_id)
select 'transmittal_check_by', e.id
  from public.employees e
 where e.call_sign in ('1001', '102')
   and not coalesce(e.is_deleted, false)
on conflict do nothing;

-- The IPAS read rule ignores the Transmittal staff lists: membership of one
-- reads Transmittals only.
create or replace function public.ipas_can_read()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and not coalesce(e.is_deleted, false)
      and (
        coalesce(e.has_purchasing_flow, false)
        or coalesce(e.has_finance_flow, false)
        or coalesce(e.is_super_admin, false)
        or exists (
          select 1 from ipas_signer_lists l
           where l.employee_id = e.id
             and l.list_key not like 'transmittal\_%' escape '\'
        )
      )
  );
$$;

comment on function public.ipas_can_read() is
  '#242, widened in #252: whether the caller may read every IPAS — Purchasing access, Finance access, a Super Admin, or anyone on an IPAS sign-off list (never a Transmittal staff list alone; never a soft-deleted employee).';

-- Replaces one list with exactly the given employees. Now also knows the four
-- Transmittal staff lists (#252); otherwise as in #241.
create or replace function public.ipas_set_signer_list(
  p_list_key text,
  p_employee_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_wanted uuid[];
  v_have uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_missing uuid;
begin
  if v_actor is null then
    raise exception 'ipas_set_signer_list: not signed in' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'ipas_set_signer_list: only a Super Admin changes who is on a sign-off list' using errcode = '42501';
  end if;
  if p_list_key is null or p_list_key not in (
    's1_approved', 's3_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved',
    'transmittal_warehouse', 'transmittal_technical', 'transmittal_logistics', 'transmittal_check_by'
  ) then
    raise exception 'ipas_set_signer_list: % isn''t a sign-off list', coalesce(p_list_key, 'null') using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_wanted
    from unnest(coalesce(p_employee_ids, '{}'::uuid[])) as x
   where x is not null;

  -- One change to a list at a time.
  perform pg_advisory_xact_lock(hashtext('ipas_signer_list:' || p_list_key));

  select coalesce(array_agg(l.employee_id), '{}'::uuid[])
    into v_have
    from public.ipas_signer_lists l
   where l.list_key = p_list_key;

  select x into v_missing
    from unnest(v_wanted) as x
   where x <> all (v_have)
     and not exists (
       select 1 from public.employees e where e.id = x and not coalesce(e.is_deleted, false)
     )
   limit 1;
  if v_missing is not null then
    raise exception 'ipas_set_signer_list: employee % isn''t an active employee', v_missing using errcode = 'P0002';
  end if;

  select coalesce(array_agg(x), '{}'::uuid[]) into v_added from unnest(v_wanted) as x where x <> all (v_have);
  select coalesce(array_agg(x), '{}'::uuid[]) into v_removed from unnest(v_have) as x where x <> all (v_wanted);

  if cardinality(v_removed) > 0 then
    delete from public.ipas_signer_lists
     where list_key = p_list_key and employee_id = any (v_removed);
  end if;
  if cardinality(v_added) > 0 then
    insert into public.ipas_signer_lists (list_key, employee_id)
    select p_list_key, x from unnest(v_added) as x;
  end if;

  insert into public.ipas_signer_list_log (list_key, employee_id, action, actor_id)
  select p_list_key, x, 'removed', v_actor from unnest(v_removed) as x
  union all
  select p_list_key, x, 'added', v_actor from unnest(v_added) as x;

  return jsonb_build_object(
    'list_key', p_list_key,
    'added', to_jsonb(v_added),
    'removed', to_jsonb(v_removed)
  );
end;
$$;

revoke all on function public.ipas_set_signer_list(text, uuid[]) from public, anon;
grant execute on function public.ipas_set_signer_list(text, uuid[]) to authenticated;

-- ------------------------------------------------------------------------------
-- Numbering
-- ------------------------------------------------------------------------------

create sequence if not exists public.transmittal_number_seq start with 1 minvalue 1;

comment on sequence public.transmittal_number_seq is
  'TG03 Transmittal numbers (#252). Continues the paper series across all four entities; set once by transmittal_set_first_number before any Transmittal exists. Never handed back.';

-- ------------------------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------------------------

create table if not exists public.transmittals (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null default ('TG03-' || nextval('public.transmittal_number_seq')::text),
  prepared_on        date not null default current_date,
  origin             text not null,
  origin_other       text,
  check_warehouse    boolean not null default false,
  check_technical    boolean not null default false,
  check_other        text,
  priority           text not null,
  entity             text not null,
  product_other      text,
  item_location_id   uuid references public.ipas_options (id) on delete restrict,
  odoo_received_by   uuid references public.employees (id),
  odoo_received_at   timestamptz,
  odoo_receipt_ref   text,
  state              text not null default 'draft',
  prepared_by        uuid not null references public.employees (id),
  submitted_at       timestamptz,
  closed_at          timestamptz,
  cancelled_by       uuid references public.employees (id),
  cancelled_at       timestamptz,
  cancel_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint transmittals_number_key unique (number),
  constraint transmittals_origin_chk check (origin in ('purchasing', 'logistics', 'warehouse', 'other')),
  constraint transmittals_origin_other_chk check (
    origin <> 'other' or (origin_other is not null and length(btrim(origin_other)) > 0)
  ),
  constraint transmittals_checking_chk check (check_warehouse or check_technical),
  constraint transmittals_priority_chk check (priority in ('high', 'medium', 'low')),
  constraint transmittals_entity_chk check (length(btrim(entity)) > 0),
  constraint transmittals_state_chk check (state in (
    'draft', 'warehouse_checking', 'warehouse_releasing', 'technical_inspection',
    'awaiting_check', 'closed', 'cancelled'
  )),
  constraint transmittals_submitted_chk check (state = 'draft' or submitted_at is not null),
  constraint transmittals_closed_chk check (state <> 'closed' or closed_at is not null),
  constraint transmittals_cancelled_chk check (
    state <> 'cancelled'
    or (cancelled_at is not null and cancel_reason is not null and length(btrim(cancel_reason)) > 0)
  )
);

comment on table public.transmittals is
  'TG03 Transmittal (#252, spec #251): one numbered slip carrying goods from origin through the Warehouse and Technical. Header only here; lines, products and references are child tables, and stages arrive with their tickets. Written only by the transmittal_* RPCs.';

create index if not exists transmittals_state_idx on public.transmittals (state, created_at desc);
create index if not exists transmittals_prepared_by_idx on public.transmittals (prepared_by);
create index if not exists transmittals_item_location_id_idx on public.transmittals (item_location_id);

create table if not exists public.transmittal_products (
  id              uuid primary key default gen_random_uuid(),
  transmittal_id  uuid not null references public.transmittals (id) on delete cascade,
  option_id       uuid not null references public.ipas_options (id) on delete restrict,
  created_at      timestamptz not null default now(),

  constraint transmittal_products_key unique (transmittal_id, option_id)
);

create index if not exists transmittal_products_option_id_idx on public.transmittal_products (option_id);

create table if not exists public.transmittal_references (
  id              uuid primary key default gen_random_uuid(),
  transmittal_id  uuid not null references public.transmittals (id) on delete cascade,
  option_id       uuid not null references public.ipas_options (id) on delete restrict,
  created_at      timestamptz not null default now(),

  constraint transmittal_references_key unique (transmittal_id, option_id)
);

create index if not exists transmittal_references_option_id_idx on public.transmittal_references (option_id);

create table if not exists public.transmittal_lines (
  id                uuid primary key default gen_random_uuid(),
  transmittal_id    uuid not null references public.transmittals (id) on delete cascade,
  position          integer not null,
  kind              text not null,
  ipas_id           uuid references public.ipas (id) on delete restrict,
  odoo_po_line_id   integer,
  description       text not null,
  quantity          numeric not null,
  unit              text,
  opportunity_id    uuid references public.sales_opportunities (id) on delete restrict,
  serial_numbers    text,
  box_quantity      text,
  -- Warehouse and Technical ratings: created here, written by the stage tickets.
  wh_in_charge_id   uuid references public.employees (id),
  wh_rating         text,
  wh_remark         text,
  tech_in_charge_id uuid references public.employees (id),
  tech_rating       text,
  tech_remark       text,
  quantity_received numeric,
  created_at        timestamptz not null default now(),

  constraint transmittal_lines_position_key unique (transmittal_id, position),
  constraint transmittal_lines_kind_chk check (kind in ('po_line', 'typed')),
  constraint transmittal_lines_po_chk check (
    (kind = 'po_line' and ipas_id is not null and odoo_po_line_id is not null)
    or (kind = 'typed' and ipas_id is null and odoo_po_line_id is null)
  ),
  constraint transmittal_lines_description_chk check (length(btrim(description)) > 0),
  constraint transmittal_lines_quantity_chk check (quantity > 0),
  constraint transmittal_lines_wh_rating_chk check (wh_rating is null or wh_rating in ('gc', 'na')),
  constraint transmittal_lines_tech_rating_chk check (tech_rating is null or tech_rating in ('gc', 'na')),
  constraint transmittal_lines_wh_na_remark_chk check (
    wh_rating is distinct from 'na' or (wh_remark is not null and length(btrim(wh_remark)) > 0)
  ),
  constraint transmittal_lines_tech_na_remark_chk check (
    tech_rating is distinct from 'na' or (tech_remark is not null and length(btrim(tech_remark)) > 0)
  ),
  constraint transmittal_lines_quantity_received_chk check (quantity_received is null or quantity_received >= 0)
);

comment on table public.transmittal_lines is
  'Lines of a Transmittal (#252): a po_line names an IPAS and one of its Odoo PO lines (copied name and unit at pick time), a typed line carries its own description. Rating columns are created here and written by the stage tickets. Frozen once submitted, except the ratings.';

create index if not exists transmittal_lines_transmittal_id_idx on public.transmittal_lines (transmittal_id);
create index if not exists transmittal_lines_ipas_id_idx on public.transmittal_lines (ipas_id);
create index if not exists transmittal_lines_opportunity_id_idx on public.transmittal_lines (opportunity_id);

-- Derived link rows, maintained from the lines by a trigger so the IPAS and SOR
-- reads stay simple joins.
create table if not exists public.transmittal_ipas (
  id             uuid primary key default gen_random_uuid(),
  transmittal_id uuid not null references public.transmittals (id) on delete cascade,
  ipas_id        uuid not null references public.ipas (id) on delete restrict,
  created_at     timestamptz not null default now(),

  constraint transmittal_ipas_key unique (transmittal_id, ipas_id)
);

create index if not exists transmittal_ipas_ipas_id_idx on public.transmittal_ipas (ipas_id);

create table if not exists public.transmittal_sors (
  id              uuid primary key default gen_random_uuid(),
  transmittal_id  uuid not null references public.transmittals (id) on delete cascade,
  opportunity_id  uuid not null references public.sales_opportunities (id) on delete restrict,
  created_at      timestamptz not null default now(),

  constraint transmittal_sors_key unique (transmittal_id, opportunity_id)
);

create index if not exists transmittal_sors_opportunity_id_idx on public.transmittal_sors (opportunity_id);

create table if not exists public.transmittal_stages (
  id                         uuid primary key default gen_random_uuid(),
  transmittal_id             uuid not null references public.transmittals (id) on delete cascade,
  stage                      text not null,
  remarks                    text,
  no_pictures_reason         text,
  completed_by               uuid references public.employees (id),
  completed_at               timestamptz,
  first_signer_id            uuid references public.employees (id),
  first_signed_at            timestamptz,
  first_confirmed            boolean not null default false,
  first_signature_declined   boolean not null default false,
  second_signer_id           uuid references public.employees (id),
  second_signer_name         text,
  second_signed_at           timestamptz,
  second_confirmed           boolean not null default false,
  second_signature_declined  boolean not null default false,
  created_at                 timestamptz not null default now(),

  constraint transmittal_stages_key unique (transmittal_id, stage),
  constraint transmittal_stages_stage_chk check (stage in (
    'warehouse_checking', 'warehouse_releasing', 'technical_inspection'
  )),
  constraint transmittal_stages_completed_chk check (completed_at is null or completed_by is not null)
);

comment on table public.transmittal_stages is
  'The stages a Transmittal has (#252 creates the rows on submit; #253 and #254 complete them). A row exists only for a stage the slip has, or one someone has opened.';

create index if not exists transmittal_stages_transmittal_id_idx on public.transmittal_stages (transmittal_id);

create table if not exists public.pms_handoff_events (
  id           uuid primary key default gen_random_uuid(),
  record_type  text not null,
  record_id    uuid not null,
  actor_id     uuid references public.employees (id),
  kind         text not null,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),

  constraint pms_handoff_events_record_type_chk check (record_type in ('transmittal', 'packing_list')),
  constraint pms_handoff_events_kind_chk check (length(btrim(kind)) > 0),
  constraint pms_handoff_events_detail_chk check (jsonb_typeof(detail) = 'object')
);

comment on table public.pms_handoff_events is
  'PMS history (#251): one row per change to a Transmittal or Packing List, written by the RPC that made it. Append-only for every role, the service role included.';

create index if not exists pms_handoff_events_record_idx on public.pms_handoff_events (record_type, record_id, created_at);
create index if not exists pms_handoff_events_actor_id_idx on public.pms_handoff_events (actor_id);

create or replace function public.pms_handoff_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'pms_handoff_events is append-only: history can''t be changed (% refused)', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists pms_handoff_events_no_change on public.pms_handoff_events;
create trigger pms_handoff_events_no_change
  before update or delete on public.pms_handoff_events
  for each row execute function public.pms_handoff_events_append_only();

drop trigger if exists pms_handoff_events_no_truncate on public.pms_handoff_events;
create trigger pms_handoff_events_no_truncate
  before truncate on public.pms_handoff_events
  for each statement execute function public.pms_handoff_events_append_only();

revoke insert, update, delete, truncate on public.pms_handoff_events from anon, authenticated;

-- ------------------------------------------------------------------------------
-- Who may do what
-- ------------------------------------------------------------------------------

create or replace function public.transmittal_on_list(p_list_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.ipas_signer_lists l
      join public.employees e on e.id = l.employee_id
     where l.list_key = p_list_key
       and l.employee_id = public.get_employee_id()
       and not coalesce(e.is_deleted, false)
  );
$$;

comment on function public.transmittal_on_list(text) is
  '#252: whether the caller is on the given ipas_signer_lists key (one of the transmittal_* staff lists).';

create or replace function public.transmittal_can_prepare()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.has_purchasing_access(), false)
    or public.transmittal_on_list('transmittal_warehouse')
    or public.transmittal_on_list('transmittal_logistics');
$$;

comment on function public.transmittal_can_prepare() is
  '#252: whether the caller may raise a Transmittal — Purchasing access, or the Warehouse or Logistics list.';

create or replace function public.transmittal_can_read(p_transmittal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ipas_can_read()
    or public.transmittal_on_list('transmittal_warehouse')
    or public.transmittal_on_list('transmittal_technical')
    or public.transmittal_on_list('transmittal_logistics')
    or public.transmittal_on_list('transmittal_check_by')
    or exists (
      select 1 from public.transmittals t
       where t.id = p_transmittal_id
         and t.prepared_by = public.get_employee_id()
    );
$$;

comment on function public.transmittal_can_read(uuid) is
  '#252: whether the caller may read a Transmittal — ipas_can_read(), any of the four Transmittal staff lists, or its preparer.';

revoke all on function public.transmittal_on_list(text) from public, anon;
revoke all on function public.transmittal_can_prepare() from public, anon;
revoke all on function public.transmittal_can_read(uuid) from public, anon;
grant execute on function public.transmittal_on_list(text) to authenticated;
grant execute on function public.transmittal_can_prepare() to authenticated;
grant execute on function public.transmittal_can_read(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- Row level security: reads only; every write is an RPC
-- ------------------------------------------------------------------------------

alter table public.transmittals enable row level security;
alter table public.transmittal_products enable row level security;
alter table public.transmittal_references enable row level security;
alter table public.transmittal_lines enable row level security;
alter table public.transmittal_ipas enable row level security;
alter table public.transmittal_sors enable row level security;
alter table public.transmittal_stages enable row level security;
alter table public.pms_handoff_events enable row level security;

drop policy if exists transmittals_read on public.transmittals;
create policy transmittals_read on public.transmittals
  for select to authenticated
  using (public.transmittal_can_read(id));

drop policy if exists transmittal_products_read on public.transmittal_products;
create policy transmittal_products_read on public.transmittal_products
  for select to authenticated
  using (public.transmittal_can_read(transmittal_id));

drop policy if exists transmittal_references_read on public.transmittal_references;
create policy transmittal_references_read on public.transmittal_references
  for select to authenticated
  using (public.transmittal_can_read(transmittal_id));

drop policy if exists transmittal_lines_read on public.transmittal_lines;
create policy transmittal_lines_read on public.transmittal_lines
  for select to authenticated
  using (public.transmittal_can_read(transmittal_id));

drop policy if exists transmittal_ipas_read on public.transmittal_ipas;
create policy transmittal_ipas_read on public.transmittal_ipas
  for select to authenticated
  using (public.transmittal_can_read(transmittal_id));

drop policy if exists transmittal_sors_read on public.transmittal_sors;
create policy transmittal_sors_read on public.transmittal_sors
  for select to authenticated
  using (public.transmittal_can_read(transmittal_id));

drop policy if exists transmittal_stages_read on public.transmittal_stages;
create policy transmittal_stages_read on public.transmittal_stages
  for select to authenticated
  using (public.transmittal_can_read(transmittal_id));

drop policy if exists pms_handoff_events_read on public.pms_handoff_events;
create policy pms_handoff_events_read on public.pms_handoff_events
  for select to authenticated
  using (record_type = 'transmittal' and public.transmittal_can_read(record_id));

revoke insert, update, delete, truncate on public.transmittals from anon, authenticated;
revoke insert, update, delete, truncate on public.transmittal_products from anon, authenticated;
revoke insert, update, delete, truncate on public.transmittal_references from anon, authenticated;
revoke insert, update, delete, truncate on public.transmittal_lines from anon, authenticated;
revoke insert, update, delete, truncate on public.transmittal_ipas from anon, authenticated;
revoke insert, update, delete, truncate on public.transmittal_sors from anon, authenticated;
revoke insert, update, delete, truncate on public.transmittal_stages from anon, authenticated;
revoke all on sequence public.transmittal_number_seq from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Freezes (triggers, so they hold for every role)
-- ------------------------------------------------------------------------------

-- A Transmittal is never deleted. A closed or cancelled one changes nothing. A
-- submitted one keeps its header and number; only the lifecycle moves.
create or replace function public.transmittals_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'transmittal: a Transmittal is never deleted; cancel it instead' using errcode = '42501';
  end if;

  if old.state in ('closed', 'cancelled') then
    raise exception 'transmittal: % is %, and can''t change', old.number, old.state using errcode = '42501';
  end if;

  if new.number is distinct from old.number
     or new.prepared_by is distinct from old.prepared_by
     or new.prepared_on is distinct from old.prepared_on then
    raise exception 'transmittal: the number, preparer and date of % can''t change', old.number using errcode = '42501';
  end if;

  if old.state <> 'draft' and (
       new.origin, new.origin_other, new.check_warehouse, new.check_technical, new.check_other,
       new.priority, new.entity, new.product_other, new.item_location_id
     ) is distinct from (
       old.origin, old.origin_other, old.check_warehouse, old.check_technical, old.check_other,
       old.priority, old.entity, old.product_other, old.item_location_id
     ) then
    raise exception 'transmittal: % is submitted; its header is fixed', old.number using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists transmittals_guard on public.transmittals;
create trigger transmittals_guard
  before update or delete on public.transmittals
  for each row execute function public.transmittals_guard();

-- Products and references are part of the header: draft only.
create or replace function public.transmittal_children_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(new.transmittal_id, old.transmittal_id);
  v_state text;
  v_number text;
begin
  select state, number into v_state, v_number from public.transmittals where id = v_id;
  if v_state is distinct from 'draft' then
    raise exception 'transmittal: % is %, and its % can''t change', v_number, v_state, tg_table_name
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists transmittal_products_guard on public.transmittal_products;
create trigger transmittal_products_guard
  before insert or update or delete on public.transmittal_products
  for each row execute function public.transmittal_children_guard();

drop trigger if exists transmittal_references_guard on public.transmittal_references;
create trigger transmittal_references_guard
  before insert or update or delete on public.transmittal_references
  for each row execute function public.transmittal_children_guard();

-- Lines: a draft takes any change. Once submitted, the identity columns (what
-- the slip says it carries) are fixed and only the ratings move (stage tickets).
-- A closed or cancelled slip takes nothing.
create or replace function public.transmittal_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(new.transmittal_id, old.transmittal_id);
  v_state text;
  v_number text;
begin
  select state, number into v_state, v_number from public.transmittals where id = v_id;

  if tg_op = 'DELETE' then
    if v_state is distinct from 'draft' then
      raise exception 'transmittal: % is %, and its lines can''t change', v_number, v_state using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_state is distinct from 'draft' then
      raise exception 'transmittal: % is %, and its lines can''t change', v_number, v_state using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if v_state in ('closed', 'cancelled') then
    raise exception 'transmittal: % is %, and its lines can''t change', v_number, v_state using errcode = '42501';
  end if;
  if v_state = 'draft' then
    return new;
  end if;
  if (new.position, new.kind, new.ipas_id, new.odoo_po_line_id, new.description, new.quantity,
      new.unit, new.opportunity_id, new.serial_numbers, new.box_quantity)
     is distinct from
     (old.position, old.kind, old.ipas_id, old.odoo_po_line_id, old.description, old.quantity,
      old.unit, old.opportunity_id, old.serial_numbers, old.box_quantity) then
    raise exception 'transmittal: % is submitted; its lines are fixed', v_number using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists transmittal_lines_guard on public.transmittal_lines;
create trigger transmittal_lines_guard
  before insert or update or delete on public.transmittal_lines
  for each row execute function public.transmittal_lines_guard();

-- Keeps transmittal_ipas and transmittal_sors equal to the lines' IPAS and SORs.
create or replace function public._transmittal_sync_links(p_transmittal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.transmittal_ipas where transmittal_id = p_transmittal_id;
  delete from public.transmittal_sors where transmittal_id = p_transmittal_id;

  insert into public.transmittal_ipas (transmittal_id, ipas_id)
  select distinct p_transmittal_id, l.ipas_id
    from public.transmittal_lines l
   where l.transmittal_id = p_transmittal_id and l.ipas_id is not null;

  insert into public.transmittal_sors (transmittal_id, opportunity_id)
  select distinct p_transmittal_id, l.opportunity_id
    from public.transmittal_lines l
   where l.transmittal_id = p_transmittal_id and l.opportunity_id is not null;
end;
$$;

revoke all on function public._transmittal_sync_links(uuid) from public, anon, authenticated;

create or replace function public.transmittal_lines_sync_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public._transmittal_sync_links(new.transmittal_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.transmittal_id is distinct from new.transmittal_id) then
    perform public._transmittal_sync_links(old.transmittal_id);
  end if;
  return null;
end;
$$;

drop trigger if exists transmittal_lines_sync_links on public.transmittal_lines;
create trigger transmittal_lines_sync_links
  after insert or update or delete on public.transmittal_lines
  for each row execute function public.transmittal_lines_sync_links();

-- ------------------------------------------------------------------------------
-- History
-- ------------------------------------------------------------------------------

create or replace function public._transmittal_event(
  p_transmittal_id uuid,
  p_actor uuid,
  p_kind text,
  p_detail jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.pms_handoff_events (record_type, record_id, actor_id, kind, detail)
  values ('transmittal', p_transmittal_id, p_actor, p_kind, coalesce(p_detail, '{}'::jsonb));
$$;

revoke all on function public._transmittal_event(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- PO lines to pick from (no money)
-- ------------------------------------------------------------------------------

-- The PO lines of every live IPAS, for a preparer. Returns what a slip needs and
-- nothing a Warehouse or Logistics member must not see: no prices, no supplier,
-- no bank details, no IPAS content beyond the SORs.
create or replace function public.transmittal_pickable_po_lines(p_search text default null)
returns table (
  ipas_id uuid,
  ipas_number text,
  po_number text,
  odoo_po_line_id integer,
  product_name text,
  quantity numeric,
  unit text,
  entity text,
  sors jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_pickable_po_lines: only a Transmittal preparer picks PO lines' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.number,
    i.po_number,
    (l->>'line_id')::integer,
    nullif(btrim(l->>'name'), ''),
    nullif(l->>'quantity', '')::numeric,
    nullif(btrim(l->>'unit'), ''),
    coalesce(nullif(btrim(i.entity_override), ''), nullif(btrim(i.odoo_copy #>> '{po,company}'), '')),
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'sales_reference', o.sales_reference, 'project_title', o.project_title
        ) order by o.sales_reference)
        from public.ipas_sors s
        join public.sales_opportunities o on o.id = s.opportunity_id
       where s.ipas_id = i.id
    ), '[]'::jsonb)
  from public.ipas i
  cross join lateral jsonb_array_elements(coalesce(i.odoo_copy -> 'lines', '[]'::jsonb)) as l
  where i.state <> 'cancelled'
    and (
      nullif(btrim(p_search), '') is null
      or i.po_number ilike '%' || btrim(p_search) || '%'
      or (l->>'name') ilike '%' || btrim(p_search) || '%'
    )
  order by i.po_number, (l->>'line_id')::integer
  limit 200;
end;
$$;

comment on function public.transmittal_pickable_po_lines(text) is
  '#252: the PO lines of live IPAS a preparer may put on a slip. Never returns a price, supplier or bank column.';

revoke all on function public.transmittal_pickable_po_lines(text) from public, anon;
grant execute on function public.transmittal_pickable_po_lines(text) to authenticated;

-- ------------------------------------------------------------------------------
-- Writing a slip: header, products, references, lines
-- ------------------------------------------------------------------------------

-- Checks and normalises the header. Raises 22023 for a value the slip can't carry.
create or replace function public._transmittal_clean_header(p_fields jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_origin text := nullif(btrim(p_fields->>'origin'), '');
  v_origin_other text := nullif(btrim(p_fields->>'origin_other'), '');
  v_check_wh boolean := coalesce((p_fields->>'check_warehouse')::boolean, false);
  v_check_tech boolean := coalesce((p_fields->>'check_technical')::boolean, false);
  v_check_other text := nullif(btrim(p_fields->>'check_other'), '');
  v_priority text := nullif(btrim(p_fields->>'priority'), '');
  v_entity text := nullif(btrim(p_fields->>'entity'), '');
  v_product_other text := nullif(btrim(p_fields->>'product_other'), '');
  v_location uuid := nullif(p_fields->>'item_location_id', '')::uuid;
begin
  if v_origin is null or v_origin not in ('purchasing', 'logistics', 'warehouse', 'other') then
    raise exception 'transmittal: % isn''t an Origin', coalesce(v_origin, 'null') using errcode = '22023';
  end if;
  if v_origin = 'other' and v_origin_other is null then
    raise exception 'transmittal: Origin Others needs its text' using errcode = '22023';
  end if;
  if not (v_check_wh or v_check_tech) then
    raise exception 'transmittal: tick Warehouse or TCA Technical under Checking' using errcode = '22023';
  end if;
  if v_priority is null or v_priority not in ('high', 'medium', 'low') then
    raise exception 'transmittal: % isn''t a Priority', coalesce(v_priority, 'null') using errcode = '22023';
  end if;
  if v_entity is null then
    raise exception 'transmittal: a Company is needed' using errcode = '22023';
  end if;
  if v_location is not null and not exists (
    select 1 from public.ipas_options o
     where o.id = v_location and o.list = 'item_location' and o.active
  ) then
    raise exception 'transmittal: that Item Location isn''t on the list' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'origin', v_origin,
    'origin_other', case when v_origin = 'other' then v_origin_other end,
    'check_warehouse', v_check_wh,
    'check_technical', v_check_tech,
    'check_other', v_check_other,
    'priority', v_priority,
    'entity', v_entity,
    'product_other', v_product_other,
    'item_location_id', v_location
  );
end;
$$;

revoke all on function public._transmittal_clean_header(jsonb) from public, anon, authenticated;

-- Writes a slip's products, references and lines, replacing what was there.
-- Each PO line must be on its IPAS's Odoo copy and its IPAS live; its name and
-- unit are copied at this moment. An SOR defaults from the IPAS when it names
-- exactly one. Returns the warnings (a PO line of another Company).
create or replace function public._transmittal_write_children(
  p_transmittal_id uuid,
  p_product_ids uuid[],
  p_reference_ids uuid[],
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text;
  v_number text;
  v_line jsonb;
  v_position integer := 0;
  v_kind text;
  v_ipas public.ipas;
  v_po_line jsonb;
  v_ipas_entity text;
  v_quantity numeric;
  v_opportunity uuid;
  v_sor_count integer;
  v_warnings jsonb := '[]'::jsonb;
  v_products uuid[];
  v_references uuid[];
begin
  select t.entity, t.number into v_entity, v_number from public.transmittals t where t.id = p_transmittal_id;

  v_products := coalesce(p_product_ids, '{}'::uuid[]);
  v_references := coalesce(p_reference_ids, '{}'::uuid[]);

  if cardinality(v_products) > 0 and (
       select count(*) from public.ipas_options o
        where o.id = any (v_products) and o.list = 'transmittal_product' and o.active
     ) <> (select count(distinct x) from unnest(v_products) x) then
    raise exception 'transmittal: a Product isn''t on the list' using errcode = '22023';
  end if;
  if cardinality(v_references) > 0 and (
       select count(*) from public.ipas_options o
        where o.id = any (v_references) and o.list = 'transmittal_reference' and o.active
     ) <> (select count(distinct x) from unnest(v_references) x) then
    raise exception 'transmittal: a Reference Checklist item isn''t on the list' using errcode = '22023';
  end if;

  delete from public.transmittal_lines where transmittal_id = p_transmittal_id;
  delete from public.transmittal_products where transmittal_id = p_transmittal_id;
  delete from public.transmittal_references where transmittal_id = p_transmittal_id;

  insert into public.transmittal_products (transmittal_id, option_id)
  select p_transmittal_id, x from unnest(v_products) as x;

  insert into public.transmittal_references (transmittal_id, option_id)
  select p_transmittal_id, x from unnest(v_references) as x;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as value loop
    v_position := v_position + 1;
    v_kind := nullif(btrim(v_line->>'kind'), '');
    v_quantity := nullif(v_line->>'quantity', '')::numeric;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'transmittal: line % needs a quantity above zero', v_position using errcode = '22023';
    end if;

    if v_kind = 'po_line' then
      select * into v_ipas
        from public.ipas i
       where i.id = nullif(v_line->>'ipas_id', '')::uuid;
      if not found or v_ipas.state = 'cancelled' then
        raise exception 'transmittal: line % names an IPAS that isn''t live', v_position using errcode = 'P0002';
      end if;

      select l into v_po_line
        from jsonb_array_elements(coalesce(v_ipas.odoo_copy -> 'lines', '[]'::jsonb)) as l
       where (l->>'line_id')::integer = (v_line->>'odoo_po_line_id')::integer
       limit 1;
      if v_po_line is null then
        raise exception 'transmittal: line % isn''t on % Odoo copy', v_position, v_ipas.po_number
          using errcode = '22023';
      end if;

      v_ipas_entity := coalesce(
        nullif(btrim(v_ipas.entity_override), ''),
        nullif(btrim(v_ipas.odoo_copy #>> '{po,company}'), '')
      );
      if v_ipas_entity is not null and v_ipas_entity is distinct from v_entity then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'kind', 'entity', 'position', v_position, 'po_number', v_ipas.po_number, 'entity', v_ipas_entity
        ));
      end if;

      v_opportunity := nullif(v_line->>'opportunity_id', '')::uuid;
      if v_opportunity is null then
        select count(*) into v_sor_count from public.ipas_sors s where s.ipas_id = v_ipas.id;
        if v_sor_count = 1 then
          select s.opportunity_id into v_opportunity from public.ipas_sors s where s.ipas_id = v_ipas.id;
        end if;
      end if;
      if v_opportunity is not null and not exists (
           select 1 from public.sales_opportunities o
            where o.id = v_opportunity and not coalesce(o.is_deleted, false)
         ) then
        raise exception 'transmittal: line % names an SOR that no longer exists', v_position using errcode = 'P0002';
      end if;

      insert into public.transmittal_lines (
        transmittal_id, position, kind, ipas_id, odoo_po_line_id, description, quantity, unit,
        opportunity_id, serial_numbers, box_quantity
      ) values (
        p_transmittal_id, v_position, 'po_line', v_ipas.id, (v_po_line->>'line_id')::integer,
        coalesce(nullif(btrim(v_po_line->>'name'), ''), 'PO line ' || (v_po_line->>'line_id')),
        v_quantity,
        nullif(btrim(v_po_line->>'unit'), ''),
        v_opportunity,
        nullif(btrim(v_line->>'serial_numbers'), ''),
        nullif(btrim(v_line->>'box_quantity'), '')
      );

    elsif v_kind = 'typed' then
      if nullif(btrim(v_line->>'description'), '') is null then
        raise exception 'transmittal: line % needs a description', v_position using errcode = '22023';
      end if;
      if nullif(btrim(v_line->>'unit'), '') is null then
        raise exception 'transmittal: line % needs a unit', v_position using errcode = '22023';
      end if;
      v_opportunity := nullif(v_line->>'opportunity_id', '')::uuid;
      if v_opportunity is not null and not exists (
           select 1 from public.sales_opportunities o
            where o.id = v_opportunity and not coalesce(o.is_deleted, false)
         ) then
        raise exception 'transmittal: line % names an SOR that no longer exists', v_position using errcode = 'P0002';
      end if;

      insert into public.transmittal_lines (
        transmittal_id, position, kind, description, quantity, unit,
        opportunity_id, serial_numbers, box_quantity
      ) values (
        p_transmittal_id, v_position, 'typed', btrim(v_line->>'description'), v_quantity,
        btrim(v_line->>'unit'), v_opportunity,
        nullif(btrim(v_line->>'serial_numbers'), ''),
        nullif(btrim(v_line->>'box_quantity'), '')
      );

    else
      raise exception 'transmittal: line % has no kind (po_line or typed)', v_position using errcode = '22023';
    end if;
  end loop;

  return v_warnings;
end;
$$;

revoke all on function public._transmittal_write_children(uuid, uuid[], uuid[], jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- RPCs
-- ------------------------------------------------------------------------------

-- Raise a draft slip. Returns { id, number, warnings[] }.
create or replace function public.transmittal_create(
  p_fields jsonb,
  p_product_ids uuid[],
  p_reference_ids uuid[],
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_header jsonb;
  v_row public.transmittals;
  v_warnings jsonb;
begin
  if v_actor is null then
    raise exception 'transmittal_create: not signed in' using errcode = '42501';
  end if;
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_create: only Purchasing, or the Warehouse or Logistics list, raises a Transmittal'
      using errcode = '42501';
  end if;

  v_header := public._transmittal_clean_header(coalesce(p_fields, '{}'::jsonb));

  insert into public.transmittals (
    origin, origin_other, check_warehouse, check_technical, check_other, priority, entity,
    product_other, item_location_id, prepared_by
  ) values (
    v_header->>'origin',
    v_header->>'origin_other',
    (v_header->>'check_warehouse')::boolean,
    (v_header->>'check_technical')::boolean,
    v_header->>'check_other',
    v_header->>'priority',
    v_header->>'entity',
    v_header->>'product_other',
    nullif(v_header->>'item_location_id', '')::uuid,
    v_actor
  )
  returning * into v_row;

  v_warnings := public._transmittal_write_children(v_row.id, p_product_ids, p_reference_ids, p_lines);

  perform public._transmittal_event(v_row.id, v_actor, 'created', jsonb_build_object(
    'number', v_row.number,
    'lines', coalesce(jsonb_array_length(coalesce(p_lines, '[]'::jsonb)), 0)
  ));

  return jsonb_build_object('id', v_row.id, 'number', v_row.number, 'warnings', v_warnings);
end;
$$;

comment on function public.transmittal_create(jsonb, uuid[], uuid[], jsonb) is
  '#252: a preparer raises a draft TG03 slip with its header, products, references and lines. Numbers it TG03-<n>. Returns { id, number, warnings[] }.';

revoke all on function public.transmittal_create(jsonb, uuid[], uuid[], jsonb) from public, anon;
grant execute on function public.transmittal_create(jsonb, uuid[], uuid[], jsonb) to authenticated;

-- Replace a draft slip's header, products, references and lines. The preparer
-- or Purchasing access, and only while it is a draft.
create or replace function public.transmittal_update_draft(
  p_transmittal_id uuid,
  p_fields jsonb,
  p_product_ids uuid[],
  p_reference_ids uuid[],
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_header jsonb;
  v_warnings jsonb;
begin
  if v_actor is null then
    raise exception 'transmittal_update_draft: not signed in' using errcode = '42501';
  end if;
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_update_draft: only a Transmittal preparer changes a slip' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_update_draft: that Transmittal doesn''t exist' using errcode = 'P0002';
  end if;
  if not (v_row.prepared_by = v_actor or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_update_draft: only the preparer or Purchasing changes a slip' using errcode = '42501';
  end if;
  if v_row.state <> 'draft' then
    raise exception 'transmittal_update_draft: % is %; only a draft changes', v_row.number, v_row.state
      using errcode = '42501';
  end if;

  v_header := public._transmittal_clean_header(coalesce(p_fields, '{}'::jsonb));

  update public.transmittals set
    origin = v_header->>'origin',
    origin_other = v_header->>'origin_other',
    check_warehouse = (v_header->>'check_warehouse')::boolean,
    check_technical = (v_header->>'check_technical')::boolean,
    check_other = v_header->>'check_other',
    priority = v_header->>'priority',
    entity = v_header->>'entity',
    product_other = v_header->>'product_other',
    item_location_id = nullif(v_header->>'item_location_id', '')::uuid
   where id = p_transmittal_id;

  v_warnings := public._transmittal_write_children(p_transmittal_id, p_product_ids, p_reference_ids, p_lines);

  perform public._transmittal_event(p_transmittal_id, v_actor, 'draft_updated', jsonb_build_object(
    'number', v_row.number,
    'lines', coalesce(jsonb_array_length(coalesce(p_lines, '[]'::jsonb)), 0)
  ));

  return jsonb_build_object('id', p_transmittal_id, 'number', v_row.number, 'warnings', v_warnings);
end;
$$;

comment on function public.transmittal_update_draft(uuid, jsonb, uuid[], uuid[], jsonb) is
  '#252: the preparer (or Purchasing) replaces a draft slip''s header, products, references and lines. Refused once submitted. Returns { id, number, warnings[] }.';

revoke all on function public.transmittal_update_draft(uuid, jsonb, uuid[], uuid[], jsonb) from public, anon;
grant execute on function public.transmittal_update_draft(uuid, jsonb, uuid[], uuid[], jsonb) to authenticated;

-- Submit a draft: fixes the slip, creates its stage rows and opens the first
-- stage. Returns { id, number, state, notify_list }.
create or replace function public.transmittal_submit(p_transmittal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_first text;
  v_notify text;
begin
  if v_actor is null then
    raise exception 'transmittal_submit: not signed in' using errcode = '42501';
  end if;
  if not public.transmittal_can_prepare() then
    raise exception 'transmittal_submit: only a Transmittal preparer submits a slip' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_submit: that Transmittal doesn''t exist' using errcode = 'P0002';
  end if;
  if not (v_row.prepared_by = v_actor or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_submit: only the preparer or Purchasing submits a slip' using errcode = '42501';
  end if;
  if v_row.state <> 'draft' then
    raise exception 'transmittal_submit: % is already %', v_row.number, v_row.state using errcode = '22023';
  end if;
  if not exists (select 1 from public.transmittal_lines l where l.transmittal_id = p_transmittal_id) then
    raise exception 'transmittal_submit: % needs at least one line', v_row.number using errcode = '22023';
  end if;

  v_first := case when v_row.check_warehouse then 'warehouse_checking' else 'technical_inspection' end;
  v_notify := case when v_row.check_warehouse then 'transmittal_warehouse' else 'transmittal_technical' end;

  if v_row.check_warehouse then
    insert into public.transmittal_stages (transmittal_id, stage) values (p_transmittal_id, 'warehouse_checking');
  end if;
  if v_row.check_warehouse and v_row.check_technical then
    insert into public.transmittal_stages (transmittal_id, stage) values (p_transmittal_id, 'warehouse_releasing');
  end if;
  if v_row.check_technical then
    insert into public.transmittal_stages (transmittal_id, stage) values (p_transmittal_id, 'technical_inspection');
  end if;

  update public.transmittals
     set state = v_first, submitted_at = now()
   where id = p_transmittal_id;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'submitted', jsonb_build_object(
    'number', v_row.number,
    'first_stage', v_first
  ));

  -- The list's members are read here, not by the caller: the staff lists are
  -- not readable to a preparer under row level security.
  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'state', v_first,
    'notify_list', v_notify,
    'notify_ids', coalesce((
      select jsonb_agg(l.employee_id)
        from public.ipas_signer_lists l
        join public.employees e on e.id = l.employee_id
       where l.list_key = v_notify
         and not coalesce(e.is_deleted, false)
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.transmittal_submit(uuid) is
  '#252: submits a draft slip with at least one line. Creates a transmittal_stages row for each stage the slip has, opens the first (Warehouse checking, or Technical inspection on a Technical-only slip), and returns the list to notify.';

revoke all on function public.transmittal_submit(uuid) from public, anon;
grant execute on function public.transmittal_submit(uuid) to authenticated;

-- Cancel with a reason, while no stage is signed. The preparer or Purchasing.
-- Returns { id, number, prepared_by }.
create or replace function public.transmittal_cancel(p_transmittal_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then
    raise exception 'transmittal_cancel: not signed in' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_cancel: that Transmittal doesn''t exist' using errcode = 'P0002';
  end if;
  if not (v_row.prepared_by = v_actor or coalesce(public.has_purchasing_access(), false)) then
    raise exception 'transmittal_cancel: only the preparer or Purchasing cancels a slip' using errcode = '42501';
  end if;
  if v_row.state in ('closed', 'cancelled') then
    raise exception 'transmittal_cancel: % is already %', v_row.number, v_row.state using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'transmittal_cancel: a cancel needs a reason' using errcode = '22023';
  end if;
  if exists (
       select 1 from public.transmittal_stages s
        where s.transmittal_id = p_transmittal_id and s.completed_at is not null
     ) then
    raise exception 'transmittal_cancel: % has a signed stage and can''t be cancelled', v_row.number
      using errcode = '42501';
  end if;

  update public.transmittals
     set state = 'cancelled',
         cancelled_by = v_actor,
         cancelled_at = now(),
         cancel_reason = v_reason
   where id = p_transmittal_id;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'cancelled', jsonb_build_object(
    'number', v_row.number,
    'reason', v_reason,
    'from_state', v_row.state
  ));

  -- The preparer hears of a cancel by someone else; nobody hears their own.
  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'notify_id', case when v_row.prepared_by = v_actor then null else v_row.prepared_by end
  );
end;
$$;

comment on function public.transmittal_cancel(uuid, text) is
  '#252: cancels a Transmittal with a reason, by its preparer or Purchasing, until a stage is signed. The number is never reused.';

revoke all on function public.transmittal_cancel(uuid, text) from public, anon;
grant execute on function public.transmittal_cancel(uuid, text) to authenticated;

-- A person may read their own sign-off list rows (the navigation asks which
-- lists they are on). Everyone else's rows stay with ipas_can_read().
drop policy if exists ipas_signer_lists_own_read on public.ipas_signer_lists;
create policy ipas_signer_lists_own_read on public.ipas_signer_lists
  for select to authenticated
  using (employee_id = public.get_employee_id());

-- The first TG03 number, set once at go-live: Super Admins only, refused once
-- any Transmittal exists. Restarts the series at p_number.
create or replace function public.transmittal_set_first_number(p_number bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'transmittal_set_first_number: only a Super Admin sets the first number' using errcode = '42501';
  end if;
  if p_number is null or p_number < 1 then
    raise exception 'transmittal_set_first_number: the first number must be 1 or more' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('transmittal_number_seq'));
  if exists (select 1 from public.transmittals) then
    raise exception 'transmittal_set_first_number: a Transmittal already exists; the first number is fixed'
      using errcode = '42501';
  end if;

  perform setval('public.transmittal_number_seq', p_number, false);

  return jsonb_build_object('first_number', p_number, 'number_format', 'TG03-' || p_number);
end;
$$;

comment on function public.transmittal_set_first_number(bigint) is
  '#252: a Super Admin sets the first TG03 number once, before any Transmittal exists. Numbers after it are never reused.';

revoke all on function public.transmittal_set_first_number(bigint) from public, anon;
grant execute on function public.transmittal_set_first_number(bigint) to authenticated;
