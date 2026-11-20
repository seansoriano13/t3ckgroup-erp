-- ==============================================================================
-- 20261220010000_1127_cancel_drafts.sql
--
-- Spec #1123, ticket #1127 (tracker B2, C2, Decision 4).
--
-- 1. A draft Transmittal can be cancelled. `transmittals_submitted_chk` wanted a
--    submitted_at for every state but draft, so cancelling a draft hit the raw
--    "violates check constraint" text. It now also lets `cancelled` through with
--    no submitted_at. `transmittal_cancel` already allows a draft, with a reason.
-- 2. A draft Packing List can be cancelled with a reason: a `cancelled` state,
--    cancelled_by / cancelled_at / cancel_reason, and `packing_list_cancel`. A
--    packed list keeps today's rule. Nothing is ever deleted. A cancelled list is
--    frozen like a packed one (itself, its boxes and its contents).
--
-- SAFE TO RUN AT ANY TIME: one constraint swapped, new columns, functions
-- replaced. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Transmittals: a draft may be cancelled
-- ------------------------------------------------------------------------------

alter table public.transmittals drop constraint if exists transmittals_submitted_chk;
alter table public.transmittals add constraint transmittals_submitted_chk
  check (state = 'draft' or state = 'cancelled' or submitted_at is not null);

-- ------------------------------------------------------------------------------
-- Packing Lists: the cancelled state
-- ------------------------------------------------------------------------------

alter table public.packing_lists
  add column if not exists cancelled_by uuid references public.employees (id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

alter table public.packing_lists drop constraint if exists packing_lists_state_chk;
alter table public.packing_lists add constraint packing_lists_state_chk
  check (state in ('draft', 'packed', 'cancelled'));

alter table public.packing_lists drop constraint if exists packing_lists_cancelled_chk;
alter table public.packing_lists add constraint packing_lists_cancelled_chk check (
  state <> 'cancelled'
  or (cancelled_by is not null and cancelled_at is not null
      and cancel_reason is not null and length(btrim(cancel_reason)) > 0)
);

create index if not exists packing_lists_cancelled_by_idx on public.packing_lists (cancelled_by);

-- A packed or cancelled list changes nothing and is never deleted.
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
  if old.state in ('packed', 'cancelled') then
    raise exception 'packing_lists: % is % and can''t be changed', old.number, old.state using errcode = '42501';
  end if;
  if new.state = 'packed' and (new.packed_by is null or new.packed_at is null) then
    raise exception 'packing_lists: packing signs Packed by' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.packing_list_boxes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list uuid := coalesce(new.packing_list_id, old.packing_list_id);
begin
  if exists (select 1 from public.packing_lists p where p.id = v_list and p.state in ('packed', 'cancelled')) then
    raise exception 'packing_list_boxes: a packed or cancelled Packing List''s boxes can''t be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

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
     where b.id = v_box and p.state in ('packed', 'cancelled')
  ) then
    raise exception 'packing_list_contents: a packed or cancelled Packing List''s contents can''t be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Same rule as 20261022100000, with the refusal naming the real state.
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
  if not (public.packing_list_can_create() or v_row.created_by = v_actor) then
    raise exception 'packing list: only its creator, Purchasing or the Warehouse list changes a Packing List' using errcode = '42501';
  end if;
  if v_row.state <> 'draft' then
    raise exception 'packing list: % is % and can''t be changed', v_row.number, v_row.state using errcode = '42501';
  end if;
  return v_row;
end;
$$;

-- Cancels a draft with a reason, by the people who may change it.
create or replace function public.packing_list_cancel(p_packing_list_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row public.packing_lists;
begin
  if v_actor is null then
    raise exception 'packing_list_cancel: not signed in' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'packing_list_cancel: a cancel needs a reason' using errcode = '22023';
  end if;

  v_row := public._packing_list_editable(p_packing_list_id);

  update public.packing_lists
     set state = 'cancelled',
         cancelled_by = v_actor,
         cancelled_at = now(),
         cancel_reason = v_reason
   where id = v_row.id;

  perform public._packing_list_event(v_row.id, v_actor, 'cancelled', jsonb_build_object(
    'number', v_row.number,
    'reason', v_reason
  ));

  return jsonb_build_object('id', v_row.id, 'number', v_row.number);
end;
$$;

comment on function public.packing_list_cancel(uuid, text) is
  '#1127: cancels a draft Packing List with a reason, by its creator, Purchasing or the Warehouse list. A packed or cancelled list is refused. Never deletes.';

revoke all on function public.packing_list_cancel(uuid, text) from public, anon;
grant execute on function public.packing_list_cancel(uuid, text) to authenticated;
