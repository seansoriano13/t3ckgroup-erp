-- ==============================================================================
-- 20261015300000_packing_lists.sql
--
-- Issue #255 (Packing Lists: record and pack boxes for an SOR, spec #251).
--
-- A Packing List records what is in each box the Warehouse packs for one SOR.
-- It moves no stock and writes nothing to Odoo. Signing Packed by closes it.
--
-- NUMBERING
-- `packing_lists.number` is `PKL_` and the value of `packing_list_number_seq`,
-- zero-padded to three digits, never handed back.
--
-- WHO MAKES ONE
-- `packing_list_can_create()`: Purchasing access, or on the transmittal_warehouse
-- list. Boxes and contents are edited by the creator or Purchasing access, while
-- the list is a draft. Packing is by the same people and needs at least one box
-- with contents.
--
-- WHO READS
-- `packing_list_can_read(id)`: ipas_can_read(), the Warehouse list, the creator
-- or packer, or anyone who can read the SOR under the SOR read rule (sor_read).
--
-- FREEZE
-- A packed Packing List, and its boxes and contents, refuse every change and
-- every delete. Triggers, so the service role is held too.
--
-- HISTORY
-- Every RPC writes a pms_handoff_events row (record_type = 'packing_list') in the
-- same transaction. That table is append-only (#252).
--
-- SAFE TO RUN AT ANY TIME: new tables, a new sequence, new functions and policies
-- only. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Sequence and tables
-- ------------------------------------------------------------------------------

create sequence if not exists public.packing_list_number_seq start with 1 minvalue 1;

comment on sequence public.packing_list_number_seq is
  'Packing List numbers (#255): PKL_ plus the zero-padded value. Never handed back.';

create table if not exists public.packing_lists (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null default ('PKL_' || lpad(nextval('public.packing_list_number_seq')::text, 3, '0')),
  opportunity_id     uuid not null references public.sales_opportunities (id) on delete restrict,
  odoo_delivery_ref  text,
  state              text not null default 'draft',
  packed_by          uuid references public.employees (id),
  packed_at          timestamptz,
  signature_declined boolean not null default false,
  created_by         uuid not null references public.employees (id),
  created_at         timestamptz not null default now(),

  constraint packing_lists_number_key unique (number),
  constraint packing_lists_state_chk check (state in ('draft', 'packed')),
  constraint packing_lists_packed_chk check (
    state <> 'packed' or (packed_by is not null and packed_at is not null)
  ),
  constraint packing_lists_delivery_ref_chk check (
    odoo_delivery_ref is null or length(btrim(odoo_delivery_ref)) > 0
  )
);

comment on table public.packing_lists is
  'Packing List (#255, spec #251): one SOR, its boxes packed by the Warehouse. Written only by the packing_list_* RPCs. Frozen once packed.';

create index if not exists packing_lists_opportunity_id_idx on public.packing_lists (opportunity_id);
create index if not exists packing_lists_created_by_idx on public.packing_lists (created_by);

create table if not exists public.packing_list_boxes (
  id                 uuid primary key default gen_random_uuid(),
  packing_list_id    uuid not null references public.packing_lists (id) on delete cascade,
  box_no             integer not null,
  marks              text,
  seal_no            text,
  gross_weight_kg    numeric,
  created_at         timestamptz not null default now(),

  constraint packing_list_boxes_key unique (packing_list_id, box_no),
  constraint packing_list_boxes_box_no_chk check (box_no >= 1),
  constraint packing_list_boxes_weight_chk check (gross_weight_kg is null or gross_weight_kg >= 0)
);

create index if not exists packing_list_boxes_packing_list_id_idx on public.packing_list_boxes (packing_list_id);

create table if not exists public.packing_list_contents (
  id                 uuid primary key default gen_random_uuid(),
  box_id             uuid not null references public.packing_list_boxes (id) on delete cascade,
  position           integer not null,
  description        text not null,
  quantity           numeric not null,
  unit               text,
  -- The SOR's Product List line as it was when picked: { name, quantity, unit }.
  -- Null for a typed content. Kept after the SOR's lines change.
  sor_line_snapshot  jsonb,
  created_at         timestamptz not null default now(),

  constraint packing_list_contents_key unique (box_id, position),
  constraint packing_list_contents_description_chk check (length(btrim(description)) > 0),
  constraint packing_list_contents_quantity_chk check (quantity > 0),
  constraint packing_list_contents_snapshot_chk check (
    sor_line_snapshot is null or jsonb_typeof(sor_line_snapshot) = 'object'
  )
);

create index if not exists packing_list_contents_box_id_idx on public.packing_list_contents (box_id);

-- ------------------------------------------------------------------------------
-- Who may do what
-- ------------------------------------------------------------------------------

create or replace function public.packing_list_can_create()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.has_purchasing_access(), false)
    or public.transmittal_on_list('transmittal_warehouse');
$$;

comment on function public.packing_list_can_create() is
  '#255: whether the caller may make a Packing List: Purchasing access, or the Warehouse list.';

create or replace function public.packing_list_can_read(p_packing_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ipas_can_read()
    or public.transmittal_on_list('transmittal_warehouse')
    or exists (
      select 1 from public.packing_lists p
       where p.id = p_packing_list_id
         and (p.created_by = public.get_employee_id() or p.packed_by = public.get_employee_id())
    )
    or exists (
      select 1 from public.packing_lists p
        join public.sales_opportunities o on o.id = p.opportunity_id
       where p.id = p_packing_list_id
         and (
           public.is_super_admin()
           or public.sor_is_deal_team(o, public.get_employee_id())
           or public.sor_always_sees(o, public.get_employee_id())
         )
    );
$$;

comment on function public.packing_list_can_read(uuid) is
  '#255: whether the caller may read a Packing List: ipas_can_read(), the Warehouse list, its creator or packer, or anyone who can read its SOR.';

create or replace function public.packing_list_box_can_read(p_box_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.packing_list_can_read(b.packing_list_id)
    from public.packing_list_boxes b
   where b.id = p_box_id;
$$;

comment on function public.packing_list_box_can_read(uuid) is
  '#255: whether the caller may read a box (and so its contents): the read rule of its Packing List.';

revoke all on function public.packing_list_can_create() from public, anon;
revoke all on function public.packing_list_can_read(uuid) from public, anon;
revoke all on function public.packing_list_box_can_read(uuid) from public, anon;
grant execute on function public.packing_list_can_create() to authenticated;
grant execute on function public.packing_list_can_read(uuid) to authenticated;
grant execute on function public.packing_list_box_can_read(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- Row level security: reads only; every write is an RPC
-- ------------------------------------------------------------------------------

alter table public.packing_lists enable row level security;
alter table public.packing_list_boxes enable row level security;
alter table public.packing_list_contents enable row level security;

drop policy if exists packing_lists_read on public.packing_lists;
create policy packing_lists_read on public.packing_lists
  for select to authenticated
  using (public.packing_list_can_read(id));

drop policy if exists packing_list_boxes_read on public.packing_list_boxes;
create policy packing_list_boxes_read on public.packing_list_boxes
  for select to authenticated
  using (public.packing_list_can_read(packing_list_id));

drop policy if exists packing_list_contents_read on public.packing_list_contents;
create policy packing_list_contents_read on public.packing_list_contents
  for select to authenticated
  using (public.packing_list_box_can_read(box_id));

drop policy if exists pms_handoff_events_packing_list_read on public.pms_handoff_events;
create policy pms_handoff_events_packing_list_read on public.pms_handoff_events
  for select to authenticated
  using (record_type = 'packing_list' and public.packing_list_can_read(record_id));

revoke insert, update, delete, truncate on public.packing_lists from anon, authenticated;
revoke insert, update, delete, truncate on public.packing_list_boxes from anon, authenticated;
revoke insert, update, delete, truncate on public.packing_list_contents from anon, authenticated;
revoke all on sequence public.packing_list_number_seq from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Freezes (triggers, so they hold for every role, the service role included)
-- ------------------------------------------------------------------------------

create or replace function public.packing_lists_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'packing_lists: a Packing List is never deleted' using errcode = '42501';
  end if;
  if old.state = 'packed' then
    raise exception 'packing_lists: % is packed and can''t be changed', old.number using errcode = '42501';
  end if;
  if new.state = 'packed' and (new.packed_by is null or new.packed_at is null) then
    raise exception 'packing_lists: packing signs Packed by' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists packing_lists_guard on public.packing_lists;
create trigger packing_lists_guard
  before update or delete on public.packing_lists
  for each row execute function public.packing_lists_guard();

create or replace function public.packing_list_boxes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list uuid := coalesce(new.packing_list_id, old.packing_list_id);
begin
  if exists (select 1 from public.packing_lists p where p.id = v_list and p.state = 'packed') then
    raise exception 'packing_list_boxes: a packed Packing List''s boxes can''t be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists packing_list_boxes_guard on public.packing_list_boxes;
create trigger packing_list_boxes_guard
  before insert or update or delete on public.packing_list_boxes
  for each row execute function public.packing_list_boxes_guard();

create or replace function public.packing_list_contents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box uuid := coalesce(new.box_id, old.box_id);
begin
  if exists (
    select 1
      from public.packing_list_boxes b
      join public.packing_lists p on p.id = b.packing_list_id
     where b.id = v_box and p.state = 'packed'
  ) then
    raise exception 'packing_list_contents: a packed Packing List''s contents can''t be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists packing_list_contents_guard on public.packing_list_contents;
create trigger packing_list_contents_guard
  before insert or update or delete on public.packing_list_contents
  for each row execute function public.packing_list_contents_guard();

-- ------------------------------------------------------------------------------
-- History
-- ------------------------------------------------------------------------------

create or replace function public._packing_list_event(
  p_packing_list_id uuid,
  p_actor uuid,
  p_kind text,
  p_detail jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.pms_handoff_events (record_type, record_id, actor_id, kind, detail)
  values ('packing_list', p_packing_list_id, p_actor, p_kind, coalesce(p_detail, '{}'::jsonb));
$$;

revoke all on function public._packing_list_event(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- RPCs
-- ------------------------------------------------------------------------------

-- The caller's edit right over a draft Packing List, locked for the change.
create or replace function public._packing_list_editable(p_packing_list_id uuid)
returns public.packing_lists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.packing_lists;
begin
  if v_actor is null then
    raise exception 'packing list: not signed in' using errcode = '42501';
  end if;
  select * into v_row from public.packing_lists where id = p_packing_list_id for update;
  if not found then
    raise exception 'packing list: no such Packing List' using errcode = 'P0002';
  end if;
  if not (coalesce(public.has_purchasing_access(), false) or v_row.created_by = v_actor) then
    raise exception 'packing list: only its creator or Purchasing changes a Packing List' using errcode = '42501';
  end if;
  if v_row.state <> 'draft' then
    raise exception 'packing list: % is packed and can''t be changed', v_row.number using errcode = '42501';
  end if;
  return v_row;
end;
$$;

revoke all on function public._packing_list_editable(uuid) from public, anon, authenticated;

create or replace function public.packing_list_create(
  p_opportunity_id uuid,
  p_odoo_delivery_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.packing_lists;
begin
  if v_actor is null then
    raise exception 'packing_list_create: not signed in' using errcode = '42501';
  end if;
  if not public.packing_list_can_create() then
    raise exception 'packing_list_create: only Purchasing, or the Warehouse list, makes a Packing List'
      using errcode = '42501';
  end if;
  if p_opportunity_id is null or not exists (
    select 1 from public.sales_opportunities o where o.id = p_opportunity_id and not coalesce(o.is_deleted, false)
  ) then
    raise exception 'packing_list_create: a Packing List is for one SOR' using errcode = '22023';
  end if;

  insert into public.packing_lists (opportunity_id, odoo_delivery_ref, created_by)
  values (p_opportunity_id, nullif(btrim(coalesce(p_odoo_delivery_ref, '')), ''), v_actor)
  returning * into v_row;

  perform public._packing_list_event(v_row.id, v_actor, 'created', jsonb_build_object('number', v_row.number));

  return jsonb_build_object('id', v_row.id, 'number', v_row.number);
end;
$$;

comment on function public.packing_list_create(uuid, text) is
  '#255: makes a draft Packing List for one SOR, numbered PKL_<n>. Purchasing access or the Warehouse list.';

create or replace function public.packing_list_update_header(
  p_packing_list_id uuid,
  p_odoo_delivery_ref text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.packing_lists := public._packing_list_editable(p_packing_list_id);
begin
  update public.packing_lists
     set odoo_delivery_ref = nullif(btrim(coalesce(p_odoo_delivery_ref, '')), '')
   where id = v_row.id;
  perform public._packing_list_event(v_row.id, public.get_employee_id(), 'header_updated', jsonb_build_object(
    'odoo_delivery_ref', nullif(btrim(coalesce(p_odoo_delivery_ref, '')), '')
  ));
end;
$$;

create or replace function public.packing_list_add_box(
  p_packing_list_id uuid,
  p_marks text default null,
  p_seal_no text default null,
  p_gross_weight_kg numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.packing_lists := public._packing_list_editable(p_packing_list_id);
  v_box public.packing_list_boxes;
begin
  insert into public.packing_list_boxes (packing_list_id, box_no, marks, seal_no, gross_weight_kg)
  values (
    v_row.id,
    (select coalesce(max(b.box_no), 0) + 1 from public.packing_list_boxes b where b.packing_list_id = v_row.id),
    nullif(btrim(coalesce(p_marks, '')), ''),
    nullif(btrim(coalesce(p_seal_no, '')), ''),
    p_gross_weight_kg
  )
  returning * into v_box;

  perform public._packing_list_event(v_row.id, public.get_employee_id(), 'box_added', jsonb_build_object('box_no', v_box.box_no));
  return jsonb_build_object('id', v_box.id, 'box_no', v_box.box_no);
end;
$$;

create or replace function public.packing_list_update_box(
  p_box_id uuid,
  p_marks text default null,
  p_seal_no text default null,
  p_gross_weight_kg numeric default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box public.packing_list_boxes;
  v_row public.packing_lists;
begin
  select * into v_box from public.packing_list_boxes where id = p_box_id;
  if not found then
    raise exception 'packing list: no such box' using errcode = 'P0002';
  end if;
  v_row := public._packing_list_editable(v_box.packing_list_id);
  update public.packing_list_boxes
     set marks = nullif(btrim(coalesce(p_marks, '')), ''),
         seal_no = nullif(btrim(coalesce(p_seal_no, '')), ''),
         gross_weight_kg = p_gross_weight_kg
   where id = v_box.id;
  perform public._packing_list_event(v_row.id, public.get_employee_id(), 'box_updated', jsonb_build_object('box_no', v_box.box_no));
end;
$$;

create or replace function public.packing_list_remove_box(p_box_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box public.packing_list_boxes;
  v_row public.packing_lists;
begin
  select * into v_box from public.packing_list_boxes where id = p_box_id;
  if not found then
    raise exception 'packing list: no such box' using errcode = 'P0002';
  end if;
  v_row := public._packing_list_editable(v_box.packing_list_id);
  delete from public.packing_list_boxes where id = v_box.id;
  perform public._packing_list_event(v_row.id, public.get_employee_id(), 'box_removed', jsonb_build_object('box_no', v_box.box_no));
end;
$$;

-- Replaces a box's contents. p_contents: [{ description, quantity, unit, snapshot }],
-- where snapshot is { name, quantity, unit } for a line picked from the SOR's
-- Product List (copied at that moment) and null or absent for a typed line.
create or replace function public.packing_list_set_contents(
  p_box_id uuid,
  p_contents jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box public.packing_list_boxes;
  v_row public.packing_lists;
  v_item jsonb;
  v_pos integer := 0;
begin
  select * into v_box from public.packing_list_boxes where id = p_box_id;
  if not found then
    raise exception 'packing list: no such box' using errcode = 'P0002';
  end if;
  v_row := public._packing_list_editable(v_box.packing_list_id);

  delete from public.packing_list_contents where box_id = v_box.id;

  for v_item in select * from jsonb_array_elements(coalesce(p_contents, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.packing_list_contents (box_id, position, description, quantity, unit, sor_line_snapshot)
    values (
      v_box.id,
      v_pos,
      btrim(coalesce(v_item->>'description', '')),
      (v_item->>'quantity')::numeric,
      nullif(btrim(coalesce(v_item->>'unit', '')), ''),
      case when jsonb_typeof(v_item->'snapshot') = 'object' then v_item->'snapshot' else null end
    );
  end loop;

  perform public._packing_list_event(v_row.id, public.get_employee_id(), 'contents_set', jsonb_build_object(
    'box_no', v_box.box_no,
    'lines', v_pos
  ));
end;
$$;

-- Packs the list: needs at least one box, and every box at least one content.
-- Signs Packed by for the caller and closes the list.
create or replace function public.packing_list_pack(p_packing_list_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.packing_lists := public._packing_list_editable(p_packing_list_id);
  v_boxes integer;
  v_empty integer;
begin
  select count(*), count(*) filter (where not exists (
           select 1 from public.packing_list_contents c where c.box_id = b.id))
    into v_boxes, v_empty
    from public.packing_list_boxes b
   where b.packing_list_id = v_row.id;

  if v_boxes = 0 then
    raise exception 'packing list: % has no boxes, so it can''t be packed', v_row.number using errcode = '22023';
  end if;
  if v_empty > 0 then
    raise exception 'packing list: % has % box(es) with no contents', v_row.number, v_empty using errcode = '22023';
  end if;

  update public.packing_lists
     set state = 'packed', packed_by = v_actor, packed_at = now()
   where id = v_row.id;

  perform public._packing_list_event(v_row.id, v_actor, 'packed', jsonb_build_object(
    'number', v_row.number,
    'boxes', v_boxes
  ));

  return jsonb_build_object('id', v_row.id, 'number', v_row.number, 'boxes', v_boxes);
end;
$$;

comment on function public.packing_list_pack(uuid) is
  '#255: signs Packed by and closes a Packing List. Refused with no box or with an empty box.';

revoke all on function public.packing_list_create(uuid, text) from public, anon;
revoke all on function public.packing_list_update_header(uuid, text) from public, anon;
revoke all on function public.packing_list_add_box(uuid, text, text, numeric) from public, anon;
revoke all on function public.packing_list_update_box(uuid, text, text, numeric) from public, anon;
revoke all on function public.packing_list_remove_box(uuid) from public, anon;
revoke all on function public.packing_list_set_contents(uuid, jsonb) from public, anon;
revoke all on function public.packing_list_pack(uuid) from public, anon;
grant execute on function public.packing_list_create(uuid, text) to authenticated;
grant execute on function public.packing_list_update_header(uuid, text) to authenticated;
grant execute on function public.packing_list_add_box(uuid, text, text, numeric) to authenticated;
grant execute on function public.packing_list_update_box(uuid, text, text, numeric) to authenticated;
grant execute on function public.packing_list_remove_box(uuid) to authenticated;
grant execute on function public.packing_list_set_contents(uuid, jsonb) to authenticated;
grant execute on function public.packing_list_pack(uuid) to authenticated;
