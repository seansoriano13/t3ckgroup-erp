-- #538 ticket 4: undo a signature on a Transmittal (Transmittals only; not Packing Lists).
--
-- Someone allowed to sign a stage, Received in Odoo by, or a Check by can undo
-- that signature with a reason. The signature is cleared and kept as history:
-- who signed, who cleared it, when, and why (public.transmittal_cleared_signatures),
-- the way ipas_signoffs keeps a cleared sign-off. Ratings, remarks and pictures
-- are untouched.
--
-- ONE MOVE. Not IPAS's Return plus Undo approval pair: a Transmittal stage has
-- no separate "prepared" step to return to.
--
-- ORDER. Steps are undone latest first, so the slip never holds a signature
-- whose predecessor is gone:
--   - a stage can be undone only while no later stage and no Check by is signed;
--   - Received in Odoo can be undone only while no Check by is signed;
--   - a Check by can be undone any time after it is signed, and undoing one on
--     a closed slip reopens it to Awaiting Check by.
--
-- FREEZES. A closed slip and a signed stage still refuse every other write for
-- every role. transmittal_undo_signature, and only it, sets the transaction-local
-- flag app.transmittal_undo for the length of its own update, which the two
-- guards below honour.
--
-- SAFE TO RUN AT ANY TIME: a new table, a new function, two guard functions
-- replaced in place (no data change). Idempotent.

-- ------------------------------------------------------------------------------
-- History of cleared signatures
-- ------------------------------------------------------------------------------

create table if not exists public.transmittal_cleared_signatures (
  id                 uuid primary key default gen_random_uuid(),
  transmittal_id     uuid not null references public.transmittals (id) on delete cascade,
  kind               text not null,
  stage              text,
  slot               int,
  signer_id          uuid references public.employees (id),
  signer_name        text,
  signed_at          timestamptz,
  other_signer_id    uuid references public.employees (id),
  other_signer_name  text,
  receipt_ref        text,
  cleared_by         uuid not null references public.employees (id),
  cleared_at         timestamptz not null default now(),
  cleared_reason     text not null,

  constraint transmittal_cleared_signatures_kind_chk check (kind in ('stage', 'odoo', 'check_by')),
  constraint transmittal_cleared_signatures_stage_chk check (
    (kind = 'stage') = (stage is not null)
    and (stage is null or stage in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection'))
  ),
  constraint transmittal_cleared_signatures_slot_chk check (
    (kind = 'check_by') = (slot is not null) and (slot is null or slot in (1, 2))
  ),
  constraint transmittal_cleared_signatures_reason_chk check (length(btrim(cleared_reason)) > 0)
);

comment on table public.transmittal_cleared_signatures is
  '#538: a Transmittal signature that was undone, kept as history with who signed it, who cleared it, when and why. Written only by transmittal_undo_signature. Append-only for every role.';

create index if not exists transmittal_cleared_signatures_transmittal_idx
  on public.transmittal_cleared_signatures (transmittal_id, cleared_at);
create index if not exists transmittal_cleared_signatures_signer_idx on public.transmittal_cleared_signatures (signer_id);
create index if not exists transmittal_cleared_signatures_other_signer_idx
  on public.transmittal_cleared_signatures (other_signer_id);
create index if not exists transmittal_cleared_signatures_cleared_by_idx on public.transmittal_cleared_signatures (cleared_by);

alter table public.transmittal_cleared_signatures enable row level security;

drop policy if exists transmittal_cleared_signatures_read on public.transmittal_cleared_signatures;
create policy transmittal_cleared_signatures_read on public.transmittal_cleared_signatures
  for select to authenticated
  using (public.transmittal_can_read(transmittal_id));

revoke insert, update, delete, truncate on public.transmittal_cleared_signatures from anon, authenticated;

create or replace function public.transmittal_cleared_signatures_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'transmittal_cleared_signatures is append-only: history can''t be changed (% refused)', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists transmittal_cleared_signatures_no_change on public.transmittal_cleared_signatures;
create trigger transmittal_cleared_signatures_no_change
  before update or delete on public.transmittal_cleared_signatures
  for each row execute function public.transmittal_cleared_signatures_append_only();

-- ------------------------------------------------------------------------------
-- Guards: as before, plus the undo's own flag
-- ------------------------------------------------------------------------------

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

  -- transmittal_undo_signature clears a signature, and reopens a closed slip when it clears a Check by.
  if coalesce(current_setting('app.transmittal_undo', true), '') = 'on' then
    return new;
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

create or replace function public.transmittal_stages_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number text;
begin
  if tg_op = 'DELETE' then
    raise exception 'transmittal: a stage is never deleted' using errcode = '42501';
  end if;

  if old.completed_at is null then
    return new;
  end if;

  -- transmittal_undo_signature clears the signature columns of a signed stage.
  if coalesce(current_setting('app.transmittal_undo', true), '') = 'on' then
    return new;
  end if;

  if (new.id, new.transmittal_id, new.stage, new.remarks, new.no_pictures_reason, new.completed_by,
      new.completed_at, new.first_signer_id, new.first_signed_at, new.second_signer_id, new.second_signer_name, new.second_signed_at,
      new.created_at)
     is distinct from
     (old.id, old.transmittal_id, old.stage, old.remarks, old.no_pictures_reason, old.completed_by,
      old.completed_at, old.first_signer_id, old.first_signed_at, old.second_signer_id, old.second_signer_name, old.second_signed_at,
      old.created_at) then
    select number into v_number from public.transmittals where id = old.transmittal_id;
    raise exception 'transmittal: the % stage of % is signed; its remarks and signatures can''t change',
      old.stage, v_number using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------------------------
-- transmittal_undo_signature
-- ------------------------------------------------------------------------------

-- p_kind is 'stage' (with p_stage), 'odoo' or 'check_by' (with p_slot, 1 or 2).
-- Returns { id, number, state, kind, notify_ids } where notify_ids are the people
-- whose signature was cleared and the preparer, without the caller.
create or replace function public.transmittal_undo_signature(
  p_transmittal_id uuid,
  p_kind text,
  p_reason text,
  p_stage text default null,
  p_slot int default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_row public.transmittals;
  v_stage public.transmittal_stages;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_order int;
  v_state text;
  v_notify uuid[] := '{}';
  v_signer uuid;
  v_signer_name text;
  v_signed_at timestamptz;
  v_other uuid;
  v_other_name text;
  v_ref text;
begin
  if v_actor is null then
    raise exception 'transmittal_undo_signature: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'transmittal_undo_signature: give the reason for undoing the signature' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('stage', 'odoo', 'check_by') then
    raise exception 'transmittal_undo_signature: undo a stage, Received in Odoo or a Check by' using errcode = '22023';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id for update;
  if not found then
    raise exception 'transmittal_undo_signature: that Transmittal doesn''t exist' using errcode = 'P0002';
  end if;
  if v_row.state in ('draft', 'cancelled') then
    raise exception 'transmittal_undo_signature: % is %; nothing is signed', v_row.number, v_row.state
      using errcode = '42501';
  end if;

  if p_kind = 'stage' then
    if p_stage is null or p_stage not in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection') then
      raise exception 'transmittal_undo_signature: name the stage' using errcode = '22023';
    end if;
    -- Whoever may sign the stage may undo it.
    if p_stage = 'technical_inspection' then
      if not public.transmittal_on_list('transmittal_technical') then
        raise exception 'transmittal_undo_signature: only the Technical list undoes Technical inspection'
          using errcode = '42501';
      end if;
    elsif not public.transmittal_on_list('transmittal_warehouse') then
      raise exception 'transmittal_undo_signature: only the Warehouse list undoes a Warehouse stage'
        using errcode = '42501';
    end if;
    if v_row.state = 'closed' or v_row.check_by_first_id is not null or v_row.check_by_second_id is not null then
      raise exception 'transmittal_undo_signature: % has a Check by signed; undo that first', v_row.number
        using errcode = '42501';
    end if;

    select * into v_stage from public.transmittal_stages s
     where s.transmittal_id = p_transmittal_id and s.stage = p_stage
     for update;
    if not found or v_stage.completed_at is null then
      raise exception 'transmittal_undo_signature: the % stage of % isn''t signed', p_stage, v_row.number
        using errcode = '22023';
    end if;

    v_order := case p_stage when 'warehouse_checking' then 1 when 'warehouse_releasing' then 2 else 3 end;
    if exists (
      select 1 from public.transmittal_stages s
       where s.transmittal_id = p_transmittal_id
         and s.completed_at is not null
         and (case s.stage when 'warehouse_checking' then 1 when 'warehouse_releasing' then 2 else 3 end) > v_order
    ) then
      raise exception 'transmittal_undo_signature: a later stage of % is signed; undo that first', v_row.number
        using errcode = '42501';
    end if;

    v_signer := v_stage.first_signer_id;
    v_signed_at := v_stage.completed_at;
    v_other := v_stage.second_signer_id;
    v_other_name := v_stage.second_signer_name;
    select e.name into v_signer_name from public.employees e where e.id = v_signer;
    v_notify := array_remove(array[v_stage.first_signer_id, v_stage.second_signer_id, v_stage.completed_by], null);

    insert into public.transmittal_cleared_signatures
      (transmittal_id, kind, stage, signer_id, signer_name, signed_at, other_signer_id, other_signer_name,
       cleared_by, cleared_reason)
    values
      (p_transmittal_id, 'stage', p_stage, v_signer, v_signer_name, v_signed_at, v_other, v_other_name,
       v_actor, v_reason);

    perform set_config('app.transmittal_undo', 'on', true);
    update public.transmittal_stages
       set completed_by = null,
           completed_at = null,
           first_signer_id = null,
           first_signed_at = null,
           first_confirmed = false,
           first_signature_declined = false,
           second_signer_id = null,
           second_signer_name = null,
           second_signed_at = null,
           second_confirmed = false,
           second_signature_declined = false
     where id = v_stage.id;

    -- The stage is the one being worked again. Warehouse releasing on a
    -- Warehouse-only slip is optional and leaves the state where it is.
    v_state := case
      when p_stage = 'warehouse_releasing' and not v_row.check_technical then v_row.state
      else p_stage
    end;
    if v_state is distinct from v_row.state then
      update public.transmittals set state = v_state where id = p_transmittal_id;
    end if;
    perform set_config('app.transmittal_undo', 'off', true);

  elsif p_kind = 'odoo' then
    if not (public.transmittal_on_list('transmittal_warehouse') or coalesce(public.has_purchasing_access(), false)) then
      raise exception 'transmittal_undo_signature: only the Warehouse list or Purchasing undoes the Odoo receipt'
        using errcode = '42501';
    end if;
    if v_row.odoo_received_at is null then
      raise exception 'transmittal_undo_signature: % has no Odoo receipt to undo', v_row.number using errcode = '22023';
    end if;
    if v_row.state = 'closed' or v_row.check_by_first_id is not null or v_row.check_by_second_id is not null then
      raise exception 'transmittal_undo_signature: % has a Check by signed; undo that first', v_row.number
        using errcode = '42501';
    end if;

    v_signer := v_row.odoo_received_by;
    v_signed_at := v_row.odoo_received_at;
    v_ref := v_row.odoo_receipt_ref;
    select e.name into v_signer_name from public.employees e where e.id = v_signer;
    v_notify := array_remove(array[v_signer], null);

    insert into public.transmittal_cleared_signatures
      (transmittal_id, kind, signer_id, signer_name, signed_at, receipt_ref, cleared_by, cleared_reason)
    values
      (p_transmittal_id, 'odoo', v_signer, v_signer_name, v_signed_at, v_ref, v_actor, v_reason);

    perform set_config('app.transmittal_undo', 'on', true);
    update public.transmittals
       set odoo_received_by = null, odoo_received_at = null, odoo_receipt_ref = null
     where id = p_transmittal_id;
    perform set_config('app.transmittal_undo', 'off', true);
    v_state := v_row.state;

  else
    if not public.transmittal_on_list('transmittal_check_by') then
      raise exception 'transmittal_undo_signature: only the Check by list undoes a Check by' using errcode = '42501';
    end if;
    if v_row.prepared_by = v_actor then
      raise exception 'transmittal_undo_signature: the preparer can''t check their own slip' using errcode = '42501';
    end if;
    if p_slot is null or p_slot not in (1, 2) then
      raise exception 'transmittal_undo_signature: the slot is 1 or 2' using errcode = '22023';
    end if;

    v_signer := case p_slot when 1 then v_row.check_by_first_id else v_row.check_by_second_id end;
    v_signed_at := case p_slot when 1 then v_row.check_by_first_at else v_row.check_by_second_at end;
    if v_signer is null then
      raise exception 'transmittal_undo_signature: Check by (%) of % isn''t signed', p_slot, v_row.number
        using errcode = '22023';
    end if;
    select e.name into v_signer_name from public.employees e where e.id = v_signer;
    v_notify := array[v_signer];

    insert into public.transmittal_cleared_signatures
      (transmittal_id, kind, slot, signer_id, signer_name, signed_at, cleared_by, cleared_reason)
    values
      (p_transmittal_id, 'check_by', p_slot, v_signer, v_signer_name, v_signed_at, v_actor, v_reason);

    -- One statement: the slot goes and, on a closed slip, the slip reopens with it (a closed slip
    -- must hold its second signature, so the two can't be separate updates).
    perform set_config('app.transmittal_undo', 'on', true);
    update public.transmittals
       set check_by_first_id = case when p_slot = 1 then null else check_by_first_id end,
           check_by_first_at = case when p_slot = 1 then null else check_by_first_at end,
           check_by_second_id = case when p_slot = 2 then null else check_by_second_id end,
           check_by_second_at = case when p_slot = 2 then null else check_by_second_at end,
           state = case when state = 'closed' then 'awaiting_check' else state end,
           closed_at = case when state = 'closed' then null else closed_at end
     where id = p_transmittal_id
     returning state into v_state;
    perform set_config('app.transmittal_undo', 'off', true);
  end if;

  perform public._transmittal_event(p_transmittal_id, v_actor, 'signature_undone', jsonb_build_object(
    'number', v_row.number,
    'kind', p_kind,
    'stage', p_stage,
    'slot', p_slot,
    'state_to', v_state,
    'reason', v_reason
  ));

  return jsonb_build_object(
    'id', p_transmittal_id,
    'number', v_row.number,
    'kind', p_kind,
    'state', v_state,
    'notify_ids', to_jsonb(array(
      select distinct u from unnest(array_append(v_notify, v_row.prepared_by)) as u
       where u is not null and u <> v_actor
    ))
  );
end;
$$;

comment on function public.transmittal_undo_signature(uuid, text, text, text, int) is
  '#538: undo one signature on a Transmittal (a stage, Received in Odoo by, or a Check by) with a reason, by whoever may sign it. The signature is kept as history. Latest step first. Ratings, remarks and pictures are untouched.';

revoke all on function public.transmittal_undo_signature(uuid, text, text, text, int) from public, anon;
grant execute on function public.transmittal_undo_signature(uuid, text, text, text, int) to authenticated;
