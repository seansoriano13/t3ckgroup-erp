-- ==============================================================================
-- 20261013100100_ipas.sql
--
-- Issue #242 (IPAS, spec #241) — raise, list and cancel an IPAS.
--
-- The tracer bullet: the IPAS header, its SORs, its history, the sign-off
-- lists' table (empty) and who may read all of it. Payments, charges,
-- documents, bank details, sign-offs and the option lists arrive with their own
-- tickets (#243 onward) as new tables beside these.
--
-- ONE LIVE IPAS PER PURCHASE ORDER
-- `ipas.po_number` is the Odoo PO ("P" then digits, exactly as Odoo names it).
-- A partial unique index allows one IPAS per PO that isn't cancelled; cancelling
-- frees the PO for a new IPAS. The PO number never changes after insert (a
-- trigger refuses it): a wrong PO means cancelling and raising a new IPAS.
--
-- NUMBERING
-- `ipas.number` is `TGIPAS_` and a zero-padded sequence value, three digits
-- minimum. One sequence for every entity, never handed back, so a cancelled
-- number is never reused. It starts at 49: the sheet's last number is TGIPAS_048
-- and the ERP carries on from there (Purchasing confirms before this merges).
--
-- SORs
-- A Project IPAS names one or more SORs; Inventory, Supplies and Events name
-- none. A deferred constraint trigger refuses to commit anything else, so the
-- RPCs below can replace the rows in any order inside one transaction.
--
-- HISTORY IS APPEND-ONLY
-- `ipas_events` has no update or delete policy, no update/delete grant, and a
-- trigger that refuses UPDATE, DELETE and TRUNCATE for every role (the service
-- role included). An IPAS with history therefore can't be deleted either.
--
-- WHO READS
-- `ipas_can_read()`: Purchasing access, Finance access, a Super Admin, or
-- anyone on a sign-off list. The IPAS tables have read policies only; every
-- change is a security-definer RPC that checks the actor and the state and
-- writes an `ipas_events` row in the same transaction (ADR 0013).
--
-- THE ODOO COPY
-- `odoo_copy` holds what the client read from `odoo-po-ipas`, shaped
--   { po, supplier, lines[], receipts, bills }
-- with `lines[].line_id` the Odoo purchase.order.line id. `odoo_fetched_at` is
-- when it was stored. Refreshing it, overrides and the statuses read from it
-- are #243.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: new tables,
-- a new sequence and new functions, nothing existing altered. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Numbering
-- ------------------------------------------------------------------------------

create sequence if not exists public.ipas_number_seq start with 49 minvalue 1;

comment on sequence public.ipas_number_seq is
  'IPAS numbers (#242). One series for every entity, carrying on from the sheet''s last number (TGIPAS_048). Never handed back, so a cancelled number is never reused.';

-- ------------------------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------------------------

create table if not exists public.ipas (
  id              uuid primary key default gen_random_uuid(),
  number          text not null default ('TGIPAS_' || lpad(nextval('public.ipas_number_seq')::text, 3, '0')),
  po_number       text not null,
  odoo_po_id      integer,
  priority        text not null,
  source          text not null,
  purpose         text not null,
  remarks         text,
  odoo_copy       jsonb not null,
  odoo_fetched_at timestamptz not null default now(),
  state           text not null default 'open',
  cancel_reason   text,
  cancelled_by    uuid references public.employees (id),
  cancelled_at    timestamptz,
  filed_at        timestamptz,
  created_by      uuid references public.employees (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ipas_number_key unique (number),
  constraint ipas_po_number_chk check (po_number ~ '^P[0-9]+$'),
  constraint ipas_priority_chk check (priority in ('very_high', 'high', 'medium')),
  constraint ipas_source_chk check (source in ('import', 'local')),
  constraint ipas_purpose_chk check (purpose in ('project', 'inventory', 'supplies', 'events')),
  constraint ipas_state_chk check (state in ('open', 'filed', 'cancelled')),
  constraint ipas_odoo_copy_chk check (jsonb_typeof(odoo_copy) = 'object'),
  constraint ipas_cancelled_chk check (
    state <> 'cancelled'
    or (cancelled_at is not null and cancel_reason is not null and length(btrim(cancel_reason)) > 0)
  )
);

comment on table public.ipas is
  'IPAS (#241): one per Odoo purchase order that needs one, raised by Purchasing. po_number is fixed; at most one live (not cancelled) IPAS per PO; number is TGIPAS_ + a zero-padded sequence, never reused. odoo_copy is the stored copy of the Odoo PO (po, supplier, lines, receipts, bills) read through odoo-po-ipas.';
comment on column public.ipas.odoo_copy is
  '{ po: {id, name, state, company, company_id, currency, origin, partner_ref}, supplier: {id, name, contact}, lines: [{line_id, product_id, name, quantity, unit, price_unit, price_subtotal, taxes, analytic, brand}], receipts: {status, done, total}, bills: {count, draft} } as read from Odoo. lines[].line_id is the purchase.order.line id (see _ipas_po_line_ids).';

-- One live IPAS per PO: cancelling frees the PO.
create unique index if not exists ipas_live_po_number_key
  on public.ipas (po_number) where state <> 'cancelled';
create index if not exists ipas_state_idx on public.ipas (state, created_at desc);
create index if not exists ipas_created_by_idx on public.ipas (created_by);

create or replace function public.set_ipas_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ipas_updated_at on public.ipas;
create trigger ipas_updated_at
  before update on public.ipas
  for each row execute function public.set_ipas_updated_at();

-- The number and the PO never change after insert.
create or replace function public.ipas_guard()
returns trigger
language plpgsql
as $$
begin
  if new.number is distinct from old.number then
    raise exception 'ipas: the number of % can''t change', old.number using errcode = '42501';
  end if;
  if new.po_number is distinct from old.po_number then
    raise exception 'ipas: the PO of % can''t change; cancel it and raise a new IPAS', old.number
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ipas_guard on public.ipas;
create trigger ipas_guard
  before update on public.ipas
  for each row execute function public.ipas_guard();

create table if not exists public.ipas_sors (
  id             uuid primary key default gen_random_uuid(),
  ipas_id        uuid not null references public.ipas (id) on delete cascade,
  opportunity_id uuid not null references public.sales_opportunities (id) on delete restrict,
  created_at     timestamptz not null default now(),

  constraint ipas_sors_ipas_opportunity_key unique (ipas_id, opportunity_id)
);

comment on table public.ipas_sors is
  'The SORs a Project IPAS names (#241). A deferred constraint trigger keeps the rule: a Project IPAS has at least one, any other Purpose has none.';

create index if not exists ipas_sors_opportunity_id_idx on public.ipas_sors (opportunity_id);

-- A Project IPAS needs an SOR; every other Purpose may carry none. Deferred, so
-- the RPCs can insert the IPAS and its SORs (or swap both) in one transaction
-- and the rule is checked once, at commit.
create or replace function public.ipas_enforce_sor_rule()
returns trigger
language plpgsql
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_purpose text;
  v_number text;
  v_count integer;
begin
  if tg_table_name = 'ipas' then
    v_ids := array[new.id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.ipas_id];
  elsif tg_op = 'UPDATE' and new.ipas_id is distinct from old.ipas_id then
    v_ids := array[new.ipas_id, old.ipas_id];
  else
    v_ids := array[new.ipas_id];
  end if;

  foreach v_id in array v_ids loop
    select i.purpose, i.number into v_purpose, v_number from public.ipas i where i.id = v_id;
    -- The IPAS itself is gone (a cascade): nothing left to hold to the rule.
    if v_purpose is null then
      continue;
    end if;
    select count(*) into v_count from public.ipas_sors s where s.ipas_id = v_id;
    if v_purpose = 'project' and v_count = 0 then
      raise exception '% is a Project IPAS and needs at least one SOR', v_number using errcode = '23514';
    end if;
    if v_purpose <> 'project' and v_count > 0 then
      raise exception '% is not a Project IPAS and can''t name an SOR', v_number using errcode = '23514';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists ipas_sor_rule_on_ipas on public.ipas;
create constraint trigger ipas_sor_rule_on_ipas
  after insert or update of purpose on public.ipas
  deferrable initially deferred
  for each row execute function public.ipas_enforce_sor_rule();

drop trigger if exists ipas_sor_rule_on_sors on public.ipas_sors;
create constraint trigger ipas_sor_rule_on_sors
  after insert or update or delete on public.ipas_sors
  deferrable initially deferred
  for each row execute function public.ipas_enforce_sor_rule();

create table if not exists public.ipas_events (
  id         uuid primary key default gen_random_uuid(),
  ipas_id    uuid not null references public.ipas (id) on delete cascade,
  actor_id   uuid references public.employees (id),
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint ipas_events_kind_chk check (length(btrim(kind)) > 0),
  constraint ipas_events_detail_chk check (jsonb_typeof(detail) = 'object')
);

comment on table public.ipas_events is
  'IPAS history (#241): one row per change, written by the RPC that made it. Append-only for every role, the service role included.';

create index if not exists ipas_events_ipas_id_idx on public.ipas_events (ipas_id, created_at);
create index if not exists ipas_events_actor_id_idx on public.ipas_events (actor_id);

create or replace function public.ipas_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ipas_events is append-only: history can''t be changed (% refused)', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists ipas_events_no_change on public.ipas_events;
create trigger ipas_events_no_change
  before update or delete on public.ipas_events
  for each row execute function public.ipas_events_append_only();

drop trigger if exists ipas_events_no_truncate on public.ipas_events;
create trigger ipas_events_no_truncate
  before truncate on public.ipas_events
  for each statement execute function public.ipas_events_append_only();

revoke insert, update, delete, truncate on public.ipas_events from anon, authenticated;

create table if not exists public.ipas_signer_lists (
  id          uuid primary key default gen_random_uuid(),
  list_key    text not null,
  employee_id uuid not null references public.employees (id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint ipas_signer_lists_key_chk check (list_key in (
    's1_approved', 's3_approved', 's7_received', 's7_noted', 's7_checked', 's7_approved'
  )),
  constraint ipas_signer_lists_key_employee_key unique (list_key, employee_id)
);

comment on table public.ipas_signer_lists is
  'Who may give each IPAS sign-off after Prepared (#241). Empty until the sections 1 and 3 ticket seeds it; membership already makes someone a full IPAS reader (ipas_can_read). Edited by Super Admins only.';

create index if not exists ipas_signer_lists_employee_id_idx on public.ipas_signer_lists (employee_id);

-- ------------------------------------------------------------------------------
-- Who reads
-- ------------------------------------------------------------------------------

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
        or exists (select 1 from ipas_signer_lists l where l.employee_id = e.id)
      )
  );
$$;

comment on function public.ipas_can_read() is
  '#242: whether the caller may read every IPAS — Purchasing access, Finance access, a Super Admin, or anyone on a sign-off list (never a soft-deleted employee).';

grant execute on function public.ipas_can_read() to authenticated;

alter table public.ipas enable row level security;
alter table public.ipas_sors enable row level security;
alter table public.ipas_events enable row level security;
alter table public.ipas_signer_lists enable row level security;

drop policy if exists ipas_read on public.ipas;
create policy ipas_read on public.ipas
  for select to authenticated
  using (public.ipas_can_read());

drop policy if exists ipas_sors_read on public.ipas_sors;
create policy ipas_sors_read on public.ipas_sors
  for select to authenticated
  using (public.ipas_can_read());

drop policy if exists ipas_events_read on public.ipas_events;
create policy ipas_events_read on public.ipas_events
  for select to authenticated
  using (public.ipas_can_read());

drop policy if exists ipas_signer_lists_read on public.ipas_signer_lists;
create policy ipas_signer_lists_read on public.ipas_signer_lists
  for select to authenticated
  using (public.ipas_can_read());

drop policy if exists ipas_signer_lists_write on public.ipas_signer_lists;
create policy ipas_signer_lists_write on public.ipas_signer_lists
  for all to authenticated
  using (coalesce(public.is_super_admin(), false))
  with check (coalesce(public.is_super_admin(), false));

-- ------------------------------------------------------------------------------
-- Internals
-- ------------------------------------------------------------------------------

-- The IPAS's SORs, cleaned and checked against its Purpose. Returns the ids
-- de-duplicated. Raises 22023 for a rule broken and P0002 for an unknown SOR.
create or replace function public._ipas_clean_sor_ids(p_fn text, p_purpose text, p_sor_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_found integer;
begin
  if p_sor_ids is not null and array_position(p_sor_ids, null) is not null then
    raise exception '%: an SOR id is missing', p_fn using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct s), '{}'::uuid[]) into v_ids from unnest(coalesce(p_sor_ids, '{}'::uuid[])) s;

  if p_purpose = 'project' and cardinality(v_ids) = 0 then
    raise exception '%: a Project IPAS needs at least one SOR', p_fn using errcode = '22023';
  end if;
  if p_purpose <> 'project' and cardinality(v_ids) > 0 then
    raise exception '%: an Inventory, Supplies or Events IPAS can''t name an SOR; put the note in Remarks', p_fn
      using errcode = '22023';
  end if;

  if cardinality(v_ids) > 0 then
    select count(*) into v_found
      from public.sales_opportunities o
     where o.id = any (v_ids) and not coalesce(o.is_deleted, false);
    if v_found <> cardinality(v_ids) then
      raise exception '%: one of those SORs no longer exists', p_fn using errcode = 'P0002';
    end if;
  end if;
  return v_ids;
end;
$$;

revoke all on function public._ipas_clean_sor_ids(text, text, uuid[]) from public, anon, authenticated;

create or replace function public._ipas_write_event(
  p_ipas_id uuid,
  p_actor uuid,
  p_kind text,
  p_detail jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ipas_events (ipas_id, actor_id, kind, detail)
  values (p_ipas_id, p_actor, p_kind, coalesce(p_detail, '{}'::jsonb));
$$;

revoke all on function public._ipas_write_event(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Raise
-- ------------------------------------------------------------------------------

create or replace function public.ipas_create(
  p_po_number text,
  p_priority text,
  p_source text,
  p_purpose text,
  p_sor_ids uuid[],
  p_remarks text,
  p_odoo_copy jsonb
) returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_po text := upper(btrim(p_po_number));
  v_sors uuid[];
  v_existing text;
  v_row public.ipas;
begin
  if v_actor is null then
    raise exception 'ipas_create: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_create: only Purchasing raises an IPAS' using errcode = '42501';
  end if;

  if v_po is null or v_po !~ '^P[0-9]+$' then
    raise exception 'ipas_create: % isn''t an Odoo PO number ("P" then digits, e.g. P01234)', coalesce(p_po_number, 'null')
      using errcode = '22023';
  end if;
  if p_priority is null or p_priority not in ('very_high', 'high', 'medium') then
    raise exception 'ipas_create: % isn''t a Priority', coalesce(p_priority, 'null') using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('import', 'local') then
    raise exception 'ipas_create: % isn''t a Source', coalesce(p_source, 'null') using errcode = '22023';
  end if;
  if p_purpose is null or p_purpose not in ('project', 'inventory', 'supplies', 'events') then
    raise exception 'ipas_create: % isn''t a Purpose', coalesce(p_purpose, 'null') using errcode = '22023';
  end if;

  -- The copy is what the service read from Odoo for exactly this PO.
  if p_odoo_copy is null
     or jsonb_typeof(p_odoo_copy) <> 'object'
     or jsonb_typeof(p_odoo_copy->'po') is distinct from 'object'
     or jsonb_typeof(p_odoo_copy->'lines') is distinct from 'array' then
    raise exception 'ipas_create: the Odoo copy is missing' using errcode = '22023';
  end if;
  if upper(btrim(p_odoo_copy->'po'->>'name')) is distinct from v_po then
    raise exception 'ipas_create: the Odoo copy is for %, not %', coalesce(p_odoo_copy->'po'->>'name', 'no PO'), v_po
      using errcode = '22023';
  end if;

  v_sors := public._ipas_clean_sor_ids('ipas_create', p_purpose, p_sor_ids);

  select i.number into v_existing
    from public.ipas i
   where i.po_number = v_po and i.state <> 'cancelled';
  if v_existing is not null then
    raise exception 'ipas_create: % already has a live IPAS (%); cancel it to raise a new one', v_po, v_existing
      using errcode = '23505';
  end if;

  insert into public.ipas (
    po_number, odoo_po_id, priority, source, purpose, remarks, odoo_copy, created_by
  ) values (
    v_po,
    case when (p_odoo_copy->'po'->>'id') ~ '^[0-9]+$' then (p_odoo_copy->'po'->>'id')::integer end,
    p_priority,
    p_source,
    p_purpose,
    nullif(btrim(p_remarks), ''),
    p_odoo_copy,
    v_actor
  )
  returning * into v_row;

  insert into public.ipas_sors (ipas_id, opportunity_id)
  select v_row.id, s from unnest(v_sors) s;

  perform public._ipas_write_event(v_row.id, v_actor, 'created', jsonb_build_object(
    'number', v_row.number,
    'po_number', v_row.po_number,
    'priority', v_row.priority,
    'source', v_row.source,
    'purpose', v_row.purpose,
    'sor_ids', to_jsonb(v_sors)
  ));

  return v_row;
end;
$$;

comment on function public.ipas_create(text, text, text, text, uuid[], text, jsonb) is
  '#242: Purchasing raises an IPAS against an Odoo PO the service just read (p_odoo_copy). Gives it the next TGIPAS_ number, refuses a second live IPAS for the PO, and keeps the Project-needs-an-SOR rule. Writes a "created" event.';

revoke all on function public.ipas_create(text, text, text, text, uuid[], text, jsonb) from public, anon;
grant execute on function public.ipas_create(text, text, text, text, uuid[], text, jsonb) to authenticated;

-- ------------------------------------------------------------------------------
-- Change Purpose and SORs
-- ------------------------------------------------------------------------------

create or replace function public.ipas_set_purpose_and_sors(
  p_ipas_id uuid,
  p_purpose text,
  p_sor_ids uuid[]
) returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas;
  v_before uuid[];
  v_after uuid[];
  v_from text;
begin
  if v_actor is null then
    raise exception 'ipas_set_purpose_and_sors: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_set_purpose_and_sors: only Purchasing changes an IPAS' using errcode = '42501';
  end if;
  if p_purpose is null or p_purpose not in ('project', 'inventory', 'supplies', 'events') then
    raise exception 'ipas_set_purpose_and_sors: % isn''t a Purpose', coalesce(p_purpose, 'null') using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_set_purpose_and_sors: IPAS % not found', p_ipas_id using errcode = 'P0002';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_set_purpose_and_sors: % is filed; a Super Admin reopens it first', v_row.number
      using errcode = '55000';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_set_purpose_and_sors: % is cancelled', v_row.number using errcode = '55000';
  end if;

  v_after := public._ipas_clean_sor_ids('ipas_set_purpose_and_sors', p_purpose, p_sor_ids);
  select coalesce(array_agg(s.opportunity_id order by s.opportunity_id), '{}'::uuid[]) into v_before
    from public.ipas_sors s where s.ipas_id = v_row.id;
  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_after from unnest(v_after) x;

  if v_row.purpose = p_purpose and v_before = v_after then
    return v_row;
  end if;

  v_from := v_row.purpose;
  delete from public.ipas_sors where ipas_id = v_row.id;
  update public.ipas set purpose = p_purpose where id = v_row.id returning * into v_row;
  insert into public.ipas_sors (ipas_id, opportunity_id)
  select v_row.id, s from unnest(v_after) s;

  perform public._ipas_write_event(v_row.id, v_actor, 'purpose_sors_changed', jsonb_build_object(
    'purpose_from', v_from,
    'purpose_to', v_row.purpose,
    'sor_ids_from', to_jsonb(v_before),
    'sor_ids_to', to_jsonb(v_after)
  ));

  return v_row;
end;
$$;

comment on function public.ipas_set_purpose_and_sors(uuid, text, uuid[]) is
  '#242: Purchasing changes an open IPAS''s Purpose and SORs together (a Project needs one or more SORs, any other Purpose none). Refuses a filed or cancelled IPAS. Writes a "purpose_sors_changed" event when something changed.';

revoke all on function public.ipas_set_purpose_and_sors(uuid, text, uuid[]) from public, anon;
grant execute on function public.ipas_set_purpose_and_sors(uuid, text, uuid[]) to authenticated;

-- ------------------------------------------------------------------------------
-- Cancel
-- ------------------------------------------------------------------------------

create or replace function public.ipas_cancel(p_ipas_id uuid, p_reason text)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_row public.ipas;
begin
  if v_actor is null then
    raise exception 'ipas_cancel: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_cancel: only Purchasing cancels an IPAS' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'ipas_cancel: a cancelled IPAS needs a reason' using errcode = '22023';
  end if;

  select * into v_row from public.ipas where id = p_ipas_id for update;
  if v_row.id is null then
    raise exception 'ipas_cancel: IPAS % not found', p_ipas_id using errcode = 'P0002';
  end if;
  if v_row.state = 'filed' then
    raise exception 'ipas_cancel: % is filed; a Super Admin reopens it before it can be cancelled', v_row.number
      using errcode = '55000';
  end if;
  if v_row.state = 'cancelled' then
    raise exception 'ipas_cancel: % is already cancelled', v_row.number using errcode = '55000';
  end if;

  update public.ipas
     set state = 'cancelled',
         cancel_reason = v_reason,
         cancelled_by = v_actor,
         cancelled_at = now()
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'cancelled', jsonb_build_object('reason', v_reason));

  return v_row;
end;
$$;

comment on function public.ipas_cancel(uuid, text) is
  '#242: Purchasing cancels an open IPAS by hand, with a reason. The number is kept and the IPAS stays readable; a filed IPAS must be reopened first. Writes a "cancelled" event.';

revoke all on function public.ipas_cancel(uuid, text) from public, anon;
grant execute on function public.ipas_cancel(uuid, text) to authenticated;

-- ------------------------------------------------------------------------------
-- SORs, for the people who can't read them
--
-- A purchaser raising a Project IPAS can't read most SORs (ADR 0021), but has
-- to pick them and see their reference, project and customer. Both functions
-- return only that header, the same locked header the Procurement Queue gives
-- Purchasing.
-- ------------------------------------------------------------------------------

create or replace function public.ipas_find_sors(p_refs text[] default null, p_search text default null)
returns table (
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  client_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_refs text[];
  v_term text := lower(nullif(btrim(p_search), ''));
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_find_sors: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_find_sors: only Purchasing picks an IPAS''s SORs' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct upper(btrim(r))), '{}'::text[]) into v_refs
    from unnest(coalesce(p_refs, '{}'::text[])) r;

  return query
    select o.id, o.sales_reference, o.project_title, o.client_name
      from public.sales_opportunities o
     where not coalesce(o.is_deleted, false)
       and not coalesce(o.is_scratch, false)
       and o.sales_reference is not null
       and (
         o.sales_reference = any (v_refs)
         or (
           v_term is not null
           and (
             position(v_term in lower(o.sales_reference)) > 0
             or position(v_term in lower(o.project_title)) > 0
             or position(v_term in lower(o.client_name)) > 0
           )
         )
       )
     order by o.sales_reference desc
     limit 25;
end;
$$;

comment on function public.ipas_find_sors(text[], text) is
  '#242: SORs a purchaser may attach to a Project IPAS, by exact Sales Reference (p_refs, for the suggestions) or a search over reference, project and customer. Returns the locked header only; Purchasing access only.';

revoke all on function public.ipas_find_sors(text[], text) from public, anon;
grant execute on function public.ipas_find_sors(text[], text) to authenticated;

create or replace function public.ipas_sor_headers(p_ipas_ids uuid[] default null)
returns table (
  ipas_id uuid,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  client_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_sor_headers: not signed in' using errcode = '42501';
  end if;
  if not public.ipas_can_read() then
    return;
  end if;

  return query
    select s.ipas_id, s.opportunity_id, o.sales_reference, o.project_title, o.client_name
      from public.ipas_sors s
      join public.sales_opportunities o on o.id = s.opportunity_id
     where p_ipas_ids is null or s.ipas_id = any (p_ipas_ids)
     order by o.sales_reference;
end;
$$;

comment on function public.ipas_sor_headers(uuid[]) is
  '#242: the SORs each IPAS names, as reference, project and customer, for anyone who can read IPAS (who may not be able to read the SOR itself). Null ids = every IPAS; no IPAS access = no rows.';

revoke all on function public.ipas_sor_headers(uuid[]) from public, anon;
grant execute on function public.ipas_sor_headers(uuid[]) to authenticated;
