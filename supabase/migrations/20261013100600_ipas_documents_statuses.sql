-- ==============================================================================
-- 20261013100600_ipas_documents_statuses.sql
--
-- Issue #246 (IPAS, spec #241) — documents, Supplier Origin and the buyer track.
--
-- WHAT THIS ADDS
--   ipas_documents      One list per IPAS, two ticks per row: Purchasing has it,
--                       Finance has it. Each row can carry an attachment. A row
--                       is either a kind from the `document_kind` option list or
--                       a hand-added one with its own label (kind_id null).
--   document kinds      Seeded into ipas_options, each marked Import / Local /
--                       Both (applies_to) and documentation / filing / both
--                       (used_for). An IPAS is given a row for every active kind
--                       matching its Source when it is raised, and Purchasing can
--                       add the rest by hand. Section 7's filing checklist (#248)
--                       reads the same rows: a Waybill ticked in section 3 is
--                       already ticked at Filing.
--   item locations     Seeded into ipas_options (list item_location). The IPAS
--                       carries one typed Item Location, item_location_id.
--                       TG03 Location is gone.
--   Supplier Origin     Four typed dates, accepted only on an Import IPAS. The
--                       database refuses them on a Local one twice over: the RPC
--                       says so, and a CHECK keeps the columns empty.
--   the buyer track     import_clearance_on (Import only) and delivered_on are
--                       typed, with who typed them and when. Actual Checking is
--                       stamped by Purchasing (actual_checking_by / _at). With
--                       P.O.P is derived from the payments, so it has no column.
--
-- WHO MAY WRITE (enforced here, not by the page)
--   The tables carry read policies only; every write is a function.
--   Purchasing access does everything except the Finance tick. Finance access
--   sets only finance_has (ipas_tick_document, side 'finance'). Neither flag
--   substitutes for the other: a Purchasing user cannot tick Finance has it for
--   Finance, and Finance cannot tick Purchasing has it. Every tick, attachment,
--   status and date change writes an ipas_events row with who and what.
--
-- TRANSMITTALS: none. Section 5 shows the typed Item Location only; Delivered
-- and Actual Checking use their typed and stamped paths until step 2 extends
-- them (spec 'Read from step 2'). No Transmittal table, column or flag here.
--
-- The filed freeze (#248) will also refuse writes to ipas_documents through a
-- trigger; until then each function refuses a filed or cancelled IPAS itself
-- (_ipas_lock_open).
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: a new table,
-- new nullable columns, new functions, option rows inserted if missing.
-- Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Document kinds are always marked
-- ------------------------------------------------------------------------------

-- A document kind says which Source it is suggested for and whether it is
-- documentation, filing or both; one without them couldn't be placed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ipas_options_document_kind_marked_chk' and conrelid = 'public.ipas_options'::regclass
  ) then
    alter table public.ipas_options add constraint ipas_options_document_kind_marked_chk
      check (list <> 'document_kind' or (applies_to is not null and used_for is not null));
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- IPAS columns: Supplier Origin, the buyer track, Item Location
-- ------------------------------------------------------------------------------

alter table public.ipas
  add column if not exists shipped_out_on date,
  add column if not exists onboard_on date,
  add column if not exists arrived_in_ph_on date,
  add column if not exists arrived_in_whs_on date,
  add column if not exists import_clearance_on date,
  add column if not exists import_clearance_typed_by uuid references public.employees (id),
  add column if not exists import_clearance_typed_at timestamptz,
  add column if not exists delivered_on date,
  add column if not exists delivered_typed_by uuid references public.employees (id),
  add column if not exists delivered_typed_at timestamptz,
  add column if not exists actual_checking_by uuid references public.employees (id),
  add column if not exists actual_checking_at timestamptz,
  add column if not exists item_location_id uuid references public.ipas_options (id);

comment on column public.ipas.shipped_out_on is
  '#246 Supplier Origin: the day the goods shipped out. Typed. Import IPAS only (ipas_supplier_origin_import_chk).';
comment on column public.ipas.onboard_on is
  '#246 Supplier Origin: the day the goods were onboard. Typed. Import IPAS only.';
comment on column public.ipas.arrived_in_ph_on is
  '#246 Supplier Origin: the day the goods arrived in the Philippines. Typed. Import IPAS only.';
comment on column public.ipas.arrived_in_whs_on is
  '#246 Supplier Origin: the day the goods arrived in the warehouse. Typed. Import IPAS only.';
comment on column public.ipas.import_clearance_on is
  '#246 buyer track: Import Clearance, typed by Purchasing. Import IPAS only.';
comment on column public.ipas.import_clearance_typed_by is
  '#246: who last typed import_clearance_on; cleared with it.';
comment on column public.ipas.import_clearance_typed_at is
  '#246: when import_clearance_on was last typed; cleared with it.';
comment on column public.ipas.delivered_on is
  '#246 buyer track: Delivered, typed by Purchasing. Step 2 also stamps it from a Transmittal; the typed date stays beside that.';
comment on column public.ipas.delivered_typed_by is
  '#246: who last typed delivered_on; cleared with it.';
comment on column public.ipas.delivered_typed_at is
  '#246: when delivered_on was last typed; cleared with it.';
comment on column public.ipas.actual_checking_by is
  '#246 buyer track: who stamped Actual Checking (Purchasing). Null = not stamped. Step 2 derives it from Transmittals; this stays for purchases with none.';
comment on column public.ipas.actual_checking_at is
  '#246 buyer track: when Actual Checking was stamped.';
comment on column public.ipas.item_location_id is
  '#246 section 5: the typed Item Location, an ipas_options row of list item_location. Step 2''s Transmittal location sits beside it; the typed value wins where set.';

create index if not exists ipas_item_location_id_idx on public.ipas (item_location_id);
create index if not exists ipas_import_clearance_typed_by_idx on public.ipas (import_clearance_typed_by);
create index if not exists ipas_delivered_typed_by_idx on public.ipas (delivered_typed_by);
create index if not exists ipas_actual_checking_by_idx on public.ipas (actual_checking_by);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ipas_supplier_origin_import_chk' and conrelid = 'public.ipas'::regclass) then
    alter table public.ipas add constraint ipas_supplier_origin_import_chk
      check (
        source = 'import'
        or (shipped_out_on is null and onboard_on is null and arrived_in_ph_on is null and arrived_in_whs_on is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipas_import_clearance_import_chk' and conrelid = 'public.ipas'::regclass) then
    alter table public.ipas add constraint ipas_import_clearance_import_chk
      check (source = 'import' or import_clearance_on is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipas_actual_checking_pair_chk' and conrelid = 'public.ipas'::regclass) then
    alter table public.ipas add constraint ipas_actual_checking_pair_chk
      check ((actual_checking_by is null) = (actual_checking_at is null));
  end if;
end;
$$;

-- ------------------------------------------------------------------------------
-- Documents
-- ------------------------------------------------------------------------------

create table if not exists public.ipas_documents (
  id             uuid primary key default gen_random_uuid(),
  ipas_id        uuid not null references public.ipas (id) on delete cascade,
  kind_id        uuid references public.ipas_options (id),
  label          text,
  attachment_url text,
  purchasing_has boolean not null default false,
  finance_has    boolean not null default false,
  created_by     uuid references public.employees (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint ipas_documents_kind_or_label_chk check (
    (kind_id is not null and label is null)
    or (kind_id is null and label is not null and length(btrim(label)) > 0 and length(label) <= 200)
  ),
  constraint ipas_documents_attachment_url_chk check (attachment_url is null or attachment_url ~* '^https?://')
);

comment on table public.ipas_documents is
  'IPAS documents (#241, #246): one list per IPAS with two ticks per row (Purchasing has it, Finance has it) and an optional attachment. A row is a document kind (ipas_options, list document_kind) or a hand-added one (kind_id null, with label). Section 7''s filing items are the same rows. Written only through the ipas_*_document functions: Purchasing sets everything but finance_has, Finance sets only finance_has.';
comment on column public.ipas_documents.kind_id is
  'The document kind, or null for a row added by hand (then label names it).';
comment on column public.ipas_documents.label is
  'Hand-added rows only: what the document is called. Null on a kind row (the kind''s label is used).';
comment on column public.ipas_documents.attachment_url is
  'Optional link to the uploaded file (Cloudinary, as a payment''s proof_url).';
comment on column public.ipas_documents.purchasing_has is
  'Purchasing has the paper. Ticked by Purchasing access only.';
comment on column public.ipas_documents.finance_has is
  'Finance has the paper. Ticked by Finance access only: Purchasing can''t tick it for them.';

create unique index if not exists ipas_documents_kind_key
  on public.ipas_documents (ipas_id, kind_id) where kind_id is not null;
create unique index if not exists ipas_documents_label_key
  on public.ipas_documents (ipas_id, lower(btrim(label))) where kind_id is null;
create index if not exists ipas_documents_kind_id_idx on public.ipas_documents (kind_id);
create index if not exists ipas_documents_created_by_idx on public.ipas_documents (created_by);

drop trigger if exists ipas_documents_updated_at on public.ipas_documents;
create trigger ipas_documents_updated_at
  before update on public.ipas_documents
  for each row execute function public.set_ipas_updated_at();

alter table public.ipas_documents enable row level security;

drop policy if exists ipas_documents_read on public.ipas_documents;
create policy ipas_documents_read on public.ipas_documents
  for select to authenticated
  using (public.ipas_can_read());

-- Reads only through the API: the two ticks have different owners, which a
-- plain UPDATE policy can't express, so every write is a function.
revoke insert, update, delete, truncate on public.ipas_documents from anon, authenticated;

-- ------------------------------------------------------------------------------
-- Seed: document kinds and item locations
-- ------------------------------------------------------------------------------

-- The sheet's values aren't in the repo; these are a sensible starting point the
-- business edits in IPAS settings. Insert-if-missing, so a re-run (or a list
-- already edited) is left alone.
insert into public.ipas_options (list, label, sort, applies_to, used_for)
select 'document_kind', v.label, v.sort, v.applies_to, v.used_for
  from (values
    ('Quotation', 10, 'local', 'documentation'),
    ('Signed Purchase Order', 20, 'both', 'documentation'),
    ('Proforma Invoice', 30, 'import', 'documentation'),
    ('Commercial Invoice', 40, 'import', 'both'),
    ('Packing List', 50, 'import', 'both'),
    ('Bill of Lading (BL)', 60, 'import', 'both'),
    ('Waybill', 70, 'import', 'both'),
    ('Certificate of Origin', 80, 'import', 'documentation'),
    ('Customs Import Entry', 90, 'import', 'filing'),
    ('Brokerage Billing Statement', 100, 'import', 'filing'),
    ('Supplier Sales Invoice', 110, 'local', 'both'),
    ('Delivery Receipt', 120, 'local', 'both'),
    ('Official Receipt', 130, 'both', 'filing'),
    ('BIR 2307', 140, 'both', 'filing')
  ) as v(label, sort, applies_to, used_for)
 where not exists (
   select 1 from public.ipas_options o
    where o.list = 'document_kind' and lower(btrim(o.label)) = lower(v.label)
 );

insert into public.ipas_options (list, label, sort)
select 'item_location', v.label, v.sort
  from (values
    ('Main Warehouse', 10),
    ('Showroom', 20),
    ('Office', 30),
    ('Project Site', 40),
    ('Customer Site', 50),
    ('Other', 60)
  ) as v(label, sort)
 where not exists (
   select 1 from public.ipas_options o
    where o.list = 'item_location' and lower(btrim(o.label)) = lower(v.label)
 );

-- ------------------------------------------------------------------------------
-- Internals
-- ------------------------------------------------------------------------------

-- Gives an IPAS a row for every active document kind matching its Source (Import
-- or Local, plus the Both kinds) that it doesn't have yet. Returns the labels
-- added, in list order.
create or replace function public._ipas_suggest_documents(p_ipas_id uuid, p_actor uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
  v_labels text[];
begin
  select source into v_source from public.ipas where id = p_ipas_id;
  if v_source is null then
    return '{}';
  end if;

  with added as (
    insert into public.ipas_documents (ipas_id, kind_id, created_by)
    select p_ipas_id, o.id, p_actor
      from public.ipas_options o
     where o.list = 'document_kind'
       and o.active
       and o.applies_to in (v_source, 'both')
       and not exists (
         select 1 from public.ipas_documents d where d.ipas_id = p_ipas_id and d.kind_id = o.id
       )
    returning kind_id
  )
  select coalesce(array_agg(o.label order by o.sort, o.label), '{}')
    into v_labels
    from added a
    join public.ipas_options o on o.id = a.kind_id;

  return v_labels;
end;
$$;

revoke all on function public._ipas_suggest_documents(uuid, uuid) from public, anon, authenticated;

-- Every new IPAS starts with the documents its Source asks for.
create or replace function public.ipas_suggest_documents_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._ipas_suggest_documents(new.id, new.created_by);
  return null;
end;
$$;

revoke all on function public.ipas_suggest_documents_on_insert() from public, anon, authenticated;

drop trigger if exists ipas_suggest_documents on public.ipas;
create trigger ipas_suggest_documents
  after insert on public.ipas
  for each row execute function public.ipas_suggest_documents_on_insert();

-- Purchasing access, or a refusal.
create or replace function public._ipas_purchasing_writer(p_fn text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
begin
  if v_actor is null then
    raise exception '%: not signed in', p_fn using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception '%: only Purchasing changes an IPAS', p_fn using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

revoke all on function public._ipas_purchasing_writer(text) from public, anon, authenticated;

-- A document row and the label it goes by, with its IPAS locked open.
create or replace function public._ipas_lock_document(p_fn text, p_document_id uuid)
returns public.ipas_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ipas_documents;
begin
  select * into v_row from public.ipas_documents where id = p_document_id;
  if v_row.id is null then
    raise exception '%: document % not found', p_fn, p_document_id using errcode = 'P0002';
  end if;
  perform public._ipas_lock_open(p_fn, v_row.ipas_id);
  select * into v_row from public.ipas_documents where id = p_document_id for update;
  if v_row.id is null then
    raise exception '%: document % not found', p_fn, p_document_id using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public._ipas_lock_document(text, uuid) from public, anon, authenticated;

create or replace function public._ipas_document_label(p_document public.ipas_documents)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_document.label,
    (select o.label from public.ipas_options o where o.id = p_document.kind_id)
  );
$$;

revoke all on function public._ipas_document_label(public.ipas_documents) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Documents: suggest, add, attach, tick, remove
-- ------------------------------------------------------------------------------

create or replace function public.ipas_suggest_documents(p_ipas_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_suggest_documents');
  v_ipas public.ipas;
  v_labels text[];
begin
  v_ipas := public._ipas_lock_open('ipas_suggest_documents', p_ipas_id);
  v_labels := public._ipas_suggest_documents(v_ipas.id, v_actor);

  if cardinality(v_labels) > 0 then
    perform public._ipas_write_event(v_ipas.id, v_actor, 'documents_suggested', jsonb_build_object(
      'source', v_ipas.source,
      'labels', to_jsonb(v_labels)
    ));
  end if;

  return jsonb_build_object('added', to_jsonb(v_labels));
end;
$$;

comment on function public.ipas_suggest_documents(uuid) is
  '#246: Purchasing adds a row for every active document kind matching the IPAS''s Source (Import or Local, plus Both) that it doesn''t have yet. A new IPAS gets these at insert; this catches kinds added to the list later. Rows already there, ticked or not, are untouched. Returns { added: [labels] }.';

revoke all on function public.ipas_suggest_documents(uuid) from public, anon;
grant execute on function public.ipas_suggest_documents(uuid) to authenticated;

create or replace function public.ipas_add_document(
  p_ipas_id uuid,
  p_kind_id uuid,
  p_label text,
  p_attachment_url text
) returns public.ipas_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_add_document');
  v_ipas public.ipas;
  v_label text := nullif(btrim(p_label), '');
  v_url text := nullif(btrim(p_attachment_url), '');
  v_kind_label text;
  v_row public.ipas_documents;
begin
  v_ipas := public._ipas_lock_open('ipas_add_document', p_ipas_id);

  if p_kind_id is not null and v_label is not null then
    raise exception 'ipas_add_document: pick a document kind or type a name, not both' using errcode = '22023';
  end if;
  if p_kind_id is null and v_label is null then
    raise exception 'ipas_add_document: pick a document kind or type the document''s name' using errcode = '22023';
  end if;
  if v_label is not null and length(v_label) > 200 then
    raise exception 'ipas_add_document: a document''s name is 200 characters at most' using errcode = '22023';
  end if;
  if v_url is not null and v_url !~* '^https?://' then
    raise exception 'ipas_add_document: the attachment must be a link to the uploaded file' using errcode = '22023';
  end if;
  if p_kind_id is not null then
    v_kind_label := public._ipas_check_option('ipas_add_document', p_kind_id, 'document_kind', null, 'document kind');
  end if;

  begin
    insert into public.ipas_documents (ipas_id, kind_id, label, attachment_url, created_by)
    values (v_ipas.id, p_kind_id, v_label, v_url, v_actor)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'ipas_add_document: % is already on %', coalesce(v_kind_label, v_label), v_ipas.number
      using errcode = '23505';
  end;

  perform public._ipas_write_event(v_ipas.id, v_actor, 'document_added', jsonb_build_object(
    'document_id', v_row.id,
    'kind_id', v_row.kind_id,
    'label', coalesce(v_kind_label, v_label),
    'by_hand', v_row.kind_id is null,
    'has_attachment', v_row.attachment_url is not null
  ));

  return v_row;
end;
$$;

comment on function public.ipas_add_document(uuid, uuid, text, text) is
  '#246: Purchasing adds a document to an open IPAS: either an active document kind (p_kind_id) or a hand-added one with its own name (p_label), never both. A kind or a name appears once per IPAS. Both ticks start false. Writes a "document_added" event.';

revoke all on function public.ipas_add_document(uuid, uuid, text, text) from public, anon;
grant execute on function public.ipas_add_document(uuid, uuid, text, text) to authenticated;

create or replace function public.ipas_set_document_attachment(
  p_document_id uuid,
  p_attachment_url text
) returns public.ipas_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_set_document_attachment');
  v_row public.ipas_documents;
  v_url text := nullif(btrim(p_attachment_url), '');
begin
  v_row := public._ipas_lock_document('ipas_set_document_attachment', p_document_id);

  if v_url is not null and v_url !~* '^https?://' then
    raise exception 'ipas_set_document_attachment: the attachment must be a link to the uploaded file'
      using errcode = '22023';
  end if;
  if v_url is not distinct from v_row.attachment_url then
    return v_row;
  end if;

  update public.ipas_documents set attachment_url = v_url where id = v_row.id returning * into v_row;

  perform public._ipas_write_event(v_row.ipas_id, v_actor,
    case when v_url is null then 'document_attachment_removed' else 'document_attachment_set' end,
    jsonb_build_object('document_id', v_row.id, 'label', public._ipas_document_label(v_row)));

  return v_row;
end;
$$;

comment on function public.ipas_set_document_attachment(uuid, text) is
  '#246: Purchasing attaches (or, with null, removes) a document''s file on an open IPAS. The link must be http(s). Writes "document_attachment_set" or "document_attachment_removed".';

revoke all on function public.ipas_set_document_attachment(uuid, text) from public, anon;
grant execute on function public.ipas_set_document_attachment(uuid, text) to authenticated;

create or replace function public.ipas_tick_document(
  p_document_id uuid,
  p_side text,
  p_value boolean
) returns public.ipas_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.ipas_documents;
  v_before boolean;
begin
  if v_actor is null then
    raise exception 'ipas_tick_document: not signed in' using errcode = '42501';
  end if;
  if p_side is null or p_side not in ('purchasing', 'finance') then
    raise exception 'ipas_tick_document: tick Purchasing has it or Finance has it' using errcode = '22023';
  end if;
  if p_value is null then
    raise exception 'ipas_tick_document: tick it or untick it' using errcode = '22023';
  end if;

  -- Each tick belongs to its own department. One flag never ticks for the other.
  if p_side = 'purchasing' and not public.has_purchasing_access() then
    raise exception 'ipas_tick_document: only Purchasing ticks Purchasing has it' using errcode = '42501';
  end if;
  if p_side = 'finance' and not public.has_finance_access() then
    raise exception 'ipas_tick_document: only Finance ticks Finance has it' using errcode = '42501';
  end if;

  v_row := public._ipas_lock_document('ipas_tick_document', p_document_id);
  v_before := case p_side when 'purchasing' then v_row.purchasing_has else v_row.finance_has end;
  if v_before = p_value then
    return v_row;
  end if;

  if p_side = 'purchasing' then
    update public.ipas_documents set purchasing_has = p_value where id = v_row.id returning * into v_row;
  else
    update public.ipas_documents set finance_has = p_value where id = v_row.id returning * into v_row;
  end if;

  perform public._ipas_write_event(v_row.ipas_id, v_actor, 'document_ticked', jsonb_build_object(
    'document_id', v_row.id,
    'label', public._ipas_document_label(v_row),
    'side', p_side,
    'value', p_value
  ));

  return v_row;
end;
$$;

comment on function public.ipas_tick_document(uuid, text, boolean) is
  '#246: ticks or unticks one side of a document on an open IPAS. side ''purchasing'' needs Purchasing access; side ''finance'' needs Finance access and nothing else counts (a Purchasing user can''t tick Finance has it, Finance can''t tick Purchasing has it). Writes a "document_ticked" event with who, which side and the value; no change writes nothing.';

revoke all on function public.ipas_tick_document(uuid, text, boolean) from public, anon;
grant execute on function public.ipas_tick_document(uuid, text, boolean) to authenticated;

create or replace function public.ipas_remove_document(p_document_id uuid)
returns public.ipas_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_remove_document');
  v_row public.ipas_documents;
  v_label text;
begin
  v_row := public._ipas_lock_document('ipas_remove_document', p_document_id);
  if v_row.finance_has then
    raise exception 'ipas_remove_document: Finance has ticked this document; ask Finance to untick it first'
      using errcode = '55000';
  end if;
  v_label := public._ipas_document_label(v_row);

  delete from public.ipas_documents where id = v_row.id;

  perform public._ipas_write_event(v_row.ipas_id, v_actor, 'document_removed', jsonb_build_object(
    'document_id', v_row.id,
    'label', v_label,
    'purchasing_has', v_row.purchasing_has,
    'had_attachment', v_row.attachment_url is not null
  ));

  return v_row;
end;
$$;

comment on function public.ipas_remove_document(uuid) is
  '#246: Purchasing removes a document row from an open IPAS, unless Finance has ticked it. The history keeps what was removed. A removed kind comes back only through ipas_suggest_documents or ipas_add_document.';

revoke all on function public.ipas_remove_document(uuid) from public, anon;
grant execute on function public.ipas_remove_document(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- Supplier Origin
-- ------------------------------------------------------------------------------

-- A date typed into a jsonb field: a 'YYYY-MM-DD' string, or null / '' to clear.
create or replace function public._ipas_read_date(p_fn text, p_fields jsonb, p_key text, p_label text, p_current date)
returns date
language plpgsql
immutable
as $$
declare
  v_raw jsonb;
  v_text text;
begin
  if not jsonb_exists(p_fields, p_key) then
    return p_current;
  end if;
  v_raw := p_fields->p_key;
  if jsonb_typeof(v_raw) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v_raw) <> 'string' then
    raise exception '%: % must be a date', p_fn, p_label using errcode = '22023';
  end if;
  v_text := btrim(p_fields->>p_key);
  if v_text = '' then
    return null;
  end if;
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception '%: % must be a date', p_fn, p_label using errcode = '22023';
  end if;
  begin
    return v_text::date;
  exception when others then
    raise exception '%: % must be a real date', p_fn, p_label using errcode = '22023';
  end;
end;
$$;

revoke all on function public._ipas_read_date(text, jsonb, text, text, date) from public, anon, authenticated;

create or replace function public.ipas_set_supplier_origin(p_ipas_id uuid, p_fields jsonb)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_set_supplier_origin');
  v_row public.ipas;
  v_key text;
  v_shipped date;
  v_onboard date;
  v_ph date;
  v_whs date;
  v_changes jsonb := '{}'::jsonb;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'ipas_set_supplier_origin: the fields must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in ('shipped_out_on', 'onboard_on', 'arrived_in_ph_on', 'arrived_in_whs_on') then
      raise exception 'ipas_set_supplier_origin: % isn''t a Supplier Origin date', v_key using errcode = '22023';
    end if;
  end loop;

  v_row := public._ipas_lock_open('ipas_set_supplier_origin', p_ipas_id);
  if v_row.source <> 'import' then
    raise exception 'ipas_set_supplier_origin: % is a Local IPAS; Supplier Origin is for Import only', v_row.number
      using errcode = '22023';
  end if;

  v_shipped := public._ipas_read_date('ipas_set_supplier_origin', p_fields, 'shipped_out_on', 'Shipped Out', v_row.shipped_out_on);
  v_onboard := public._ipas_read_date('ipas_set_supplier_origin', p_fields, 'onboard_on', 'Onboard', v_row.onboard_on);
  v_ph := public._ipas_read_date('ipas_set_supplier_origin', p_fields, 'arrived_in_ph_on', 'Arrived in PH', v_row.arrived_in_ph_on);
  v_whs := public._ipas_read_date('ipas_set_supplier_origin', p_fields, 'arrived_in_whs_on', 'Arrived in Whs.', v_row.arrived_in_whs_on);

  if v_shipped is distinct from v_row.shipped_out_on then
    v_changes := v_changes || jsonb_build_object('shipped_out_on', jsonb_build_object('from', v_row.shipped_out_on, 'to', v_shipped));
  end if;
  if v_onboard is distinct from v_row.onboard_on then
    v_changes := v_changes || jsonb_build_object('onboard_on', jsonb_build_object('from', v_row.onboard_on, 'to', v_onboard));
  end if;
  if v_ph is distinct from v_row.arrived_in_ph_on then
    v_changes := v_changes || jsonb_build_object('arrived_in_ph_on', jsonb_build_object('from', v_row.arrived_in_ph_on, 'to', v_ph));
  end if;
  if v_whs is distinct from v_row.arrived_in_whs_on then
    v_changes := v_changes || jsonb_build_object('arrived_in_whs_on', jsonb_build_object('from', v_row.arrived_in_whs_on, 'to', v_whs));
  end if;
  if v_changes = '{}'::jsonb then
    return v_row;
  end if;

  update public.ipas
     set shipped_out_on = v_shipped,
         onboard_on = v_onboard,
         arrived_in_ph_on = v_ph,
         arrived_in_whs_on = v_whs
   where id = v_row.id
  returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'supplier_origin_changed', jsonb_build_object('fields', v_changes));

  return v_row;
end;
$$;

comment on function public.ipas_set_supplier_origin(uuid, jsonb) is
  '#246: Purchasing types the four Supplier Origin dates (shipped_out_on, onboard_on, arrived_in_ph_on, arrived_in_whs_on) on an open IMPORT IPAS. Keys present are set, null or blank clears. A Local IPAS is refused (22023), and a CHECK keeps its columns empty. Writes one "supplier_origin_changed" event with what changed.';

revoke all on function public.ipas_set_supplier_origin(uuid, jsonb) from public, anon;
grant execute on function public.ipas_set_supplier_origin(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------------------
-- The buyer track: typed statuses, Actual Checking, Item Location
-- ------------------------------------------------------------------------------

create or replace function public.ipas_set_typed_status(p_ipas_id uuid, p_status text, p_date date)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_set_typed_status');
  v_row public.ipas;
  v_from date;
begin
  if p_status is null or p_status not in ('import_clearance', 'delivered') then
    raise exception 'ipas_set_typed_status: Import Clearance and Delivered are the typed statuses' using errcode = '22023';
  end if;

  v_row := public._ipas_lock_open('ipas_set_typed_status', p_ipas_id);
  if p_status = 'import_clearance' and v_row.source <> 'import' then
    raise exception 'ipas_set_typed_status: % is a Local IPAS; Import Clearance is for Import only', v_row.number
      using errcode = '22023';
  end if;

  v_from := case p_status when 'import_clearance' then v_row.import_clearance_on else v_row.delivered_on end;
  if v_from is not distinct from p_date then
    return v_row;
  end if;

  if p_status = 'import_clearance' then
    update public.ipas
       set import_clearance_on = p_date,
           import_clearance_typed_by = case when p_date is null then null else v_actor end,
           import_clearance_typed_at = case when p_date is null then null else now() end
     where id = v_row.id
    returning * into v_row;
  else
    update public.ipas
       set delivered_on = p_date,
           delivered_typed_by = case when p_date is null then null else v_actor end,
           delivered_typed_at = case when p_date is null then null else now() end
     where id = v_row.id
    returning * into v_row;
  end if;

  perform public._ipas_write_event(v_row.id, v_actor,
    case when p_date is null then 'status_cleared' else 'status_typed' end,
    jsonb_build_object('status', p_status, 'from', v_from, 'to', p_date));

  return v_row;
end;
$$;

comment on function public.ipas_set_typed_status(uuid, text, date) is
  '#246: Purchasing types Import Clearance (Import IPAS only) or Delivered on an open IPAS, or clears it with a null date. Stores who typed it and when beside the date, and writes "status_typed" / "status_cleared". Step 2 also stamps Delivered from a Transmittal; the typed date stays beside that.';

revoke all on function public.ipas_set_typed_status(uuid, text, date) from public, anon;
grant execute on function public.ipas_set_typed_status(uuid, text, date) to authenticated;

create or replace function public.ipas_stamp_actual_checking(p_ipas_id uuid, p_stamped boolean default true)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_stamp_actual_checking');
  v_row public.ipas;
  v_was_by uuid;
  v_was_at timestamptz;
begin
  if p_stamped is null then
    raise exception 'ipas_stamp_actual_checking: stamp it or clear it' using errcode = '22023';
  end if;

  v_row := public._ipas_lock_open('ipas_stamp_actual_checking', p_ipas_id);
  v_was_by := v_row.actual_checking_by;
  v_was_at := v_row.actual_checking_at;

  if p_stamped then
    if v_was_by is not null then
      return v_row;
    end if;
    update public.ipas
       set actual_checking_by = v_actor, actual_checking_at = now()
     where id = v_row.id
    returning * into v_row;
    perform public._ipas_write_event(v_row.id, v_actor, 'actual_checking_stamped', jsonb_build_object(
      'by', v_actor, 'at', v_row.actual_checking_at
    ));
  else
    if v_was_by is null then
      return v_row;
    end if;
    update public.ipas
       set actual_checking_by = null, actual_checking_at = null
     where id = v_row.id
    returning * into v_row;
    perform public._ipas_write_event(v_row.id, v_actor, 'actual_checking_cleared', jsonb_build_object(
      'was_by', v_was_by, 'was_at', v_was_at
    ));
  end if;

  return v_row;
end;
$$;

comment on function public.ipas_stamp_actual_checking(uuid, boolean) is
  '#246: Purchasing stamps Actual Checking on an open IPAS (who and when kept on the row and in history), or clears the stamp with p_stamped = false. Stamping twice changes nothing. Step 2 derives it from Transmittals where any were raised.';

revoke all on function public.ipas_stamp_actual_checking(uuid, boolean) from public, anon;
grant execute on function public.ipas_stamp_actual_checking(uuid, boolean) to authenticated;

create or replace function public.ipas_set_item_location(p_ipas_id uuid, p_option_id uuid)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_purchasing_writer('ipas_set_item_location');
  v_row public.ipas;
  v_from_label text;
  v_to_label text;
begin
  v_row := public._ipas_lock_open('ipas_set_item_location', p_ipas_id);

  if p_option_id is not null then
    v_to_label := public._ipas_check_option(
      'ipas_set_item_location', p_option_id, 'item_location', v_row.item_location_id, 'item location'
    );
  end if;
  if p_option_id is not distinct from v_row.item_location_id then
    return v_row;
  end if;
  select o.label into v_from_label from public.ipas_options o where o.id = v_row.item_location_id;

  update public.ipas set item_location_id = p_option_id where id = v_row.id returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'item_location_changed', jsonb_build_object(
    'from', v_from_label,
    'to', v_to_label
  ));

  return v_row;
end;
$$;

comment on function public.ipas_set_item_location(uuid, uuid) is
  '#246: Purchasing types the Item Location of an open IPAS from the item_location list (an active option, or null to clear). Writes "item_location_changed" with the labels.';

revoke all on function public.ipas_set_item_location(uuid, uuid) from public, anon;
grant execute on function public.ipas_set_item_location(uuid, uuid) to authenticated;
