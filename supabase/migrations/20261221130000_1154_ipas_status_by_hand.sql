-- #1154 (spec #1151, T2): the IPAS Status, stored and set by hand on the record (ADR 0054).
--
-- Storage
--   ipas.status               one of the eleven keys, or null on a cancelled IPAS
--   ipas_status_steps         one row per reached step: the current step and every step before it that was dated.
--                             Rows exist only for the current step and steps before it, so the current step is
--                             always the furthest dated one.
-- Setting it
--   ipas_set_status           Purchasing access, Logistics access or a Super Admin, on an open IPAS
--   ipas_set_status_date      the same date rules, for an earlier step that already has a date
-- Lifecycle (one trigger, so the big sign / reopen / header functions are not rewritten)
--   a new IPAS                starts at order_draft, dated its raise day
--   filing (state -> filed)   writes done; reopen deletes it and falls back to the furthest dated step
--   Import -> Local           deletes customs, local_hub and out_for_delivery
--   cancelling                clears the status
-- Order-Draft is dated the raise day and is no floor for the steps after it: an order raised today can have
--   been Ordered last week.
-- Retired
--   ipas_set_supplier_origin and ipas_set_typed_status lose their grants; the old date columns stay, read-only.
-- Switch-over, once, at the foot of this file.

-- ------------------------------------------------------------------------------
-- The steps, in order
-- ------------------------------------------------------------------------------

create or replace function public._ipas_status_order(p_step text)
returns integer
language sql
immutable
set search_path = public
as $$
  select array_position(array[
    'order_draft', 'payment_approval', 'ordered', 'processing', 'shipped', 'in_transit',
    'customs', 'local_hub', 'out_for_delivery', 'delivered', 'done'
  ]::text[], p_step);
$$;

revoke all on function public._ipas_status_order(text) from public, anon;
grant execute on function public._ipas_status_order(text) to authenticated;

create or replace function public._ipas_status_label(p_step text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_step
    when 'order_draft' then 'Order-Draft'
    when 'payment_approval' then 'Payment Approval'
    when 'ordered' then 'Ordered'
    when 'processing' then 'Processing / Preparing Shipment'
    when 'shipped' then 'Shipped / Picked Up'
    when 'in_transit' then 'In Transit'
    when 'customs' then 'Customs / Port Hold'
    when 'local_hub' then 'Arrived at Local Hub'
    when 'out_for_delivery' then 'Out for Delivery'
    when 'delivered' then 'Delivered'
    when 'done' then 'Done'
    else p_step
  end;
$$;

revoke all on function public._ipas_status_label(text) from public, anon;
grant execute on function public._ipas_status_label(text) to authenticated;

create or replace function public._ipas_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;

revoke all on function public._ipas_today() from public, anon;
grant execute on function public._ipas_today() to authenticated;

-- ------------------------------------------------------------------------------
-- Storage
-- ------------------------------------------------------------------------------

alter table public.ipas add column if not exists status text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ipas_status_chk' and conrelid = 'public.ipas'::regclass) then
    alter table public.ipas add constraint ipas_status_chk
      check (status is null or public._ipas_status_order(status) is not null);
  end if;
end;
$$;

comment on column public.ipas.status is
  '#1154 (ADR 0054): the IPAS Status, set by hand: order_draft, payment_approval, ordered, processing, shipped, in_transit, customs, local_hub, out_for_delivery, delivered or done. Null on a cancelled IPAS. done comes only from filing. Always the furthest step that has a row in ipas_status_steps.';

create table if not exists public.ipas_status_steps (
  ipas_id    uuid not null references public.ipas (id) on delete cascade,
  step       text not null,
  reached_on date not null,
  set_by     uuid references public.employees (id),
  set_at     timestamptz not null default now(),

  primary key (ipas_id, step),
  constraint ipas_status_steps_step_chk check (public._ipas_status_order(step) is not null)
);

comment on table public.ipas_status_steps is
  '#1154 (ADR 0054): the day each reached step of an IPAS happened. A row exists only while the step is reached: the current step and the dated steps before it. Written only by ipas_set_status, ipas_set_status_date and the lifecycle trigger.';

create index if not exists ipas_status_steps_set_by_idx on public.ipas_status_steps (set_by);

alter table public.ipas_status_steps enable row level security;

drop policy if exists ipas_status_steps_read on public.ipas_status_steps;
create policy ipas_status_steps_read on public.ipas_status_steps
  for select to authenticated
  using (public.ipas_can_read());

revoke insert, update, delete, truncate on public.ipas_status_steps from anon, authenticated;

-- ------------------------------------------------------------------------------
-- Who may set it
-- ------------------------------------------------------------------------------

create or replace function public._ipas_status_writer(p_fn text)
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
  if not (
    coalesce(public.has_purchasing_access(), false)
    or coalesce(public.has_logistics_access(), false)
    or coalesce(public.is_super_admin(), false)
  ) then
    raise exception '%: only Purchasing, Logistics or a Super Admin sets the status', p_fn using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

revoke all on function public._ipas_status_writer(text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- ipas_set_status
-- ------------------------------------------------------------------------------

create or replace function public.ipas_set_status(p_ipas_id uuid, p_step text, p_reached_on date default null)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_status_writer('ipas_set_status');
  v_row public.ipas;
  v_new integer := public._ipas_status_order(p_step);
  v_cur integer;
  v_existing date;
  v_date date;
  v_prev date;
  v_cleared text[];
  v_from text;
begin
  if v_new is null then
    raise exception 'ipas_set_status: % isn''t a status step', coalesce(p_step, 'null') using errcode = '22023';
  end if;
  if p_step = 'done' then
    raise exception 'ipas_set_status: Done comes from filing; it can''t be picked by hand' using errcode = '22023';
  end if;

  v_row := public._ipas_lock_open('ipas_set_status', p_ipas_id);
  if v_row.source = 'local' and p_step in ('customs', 'local_hub', 'out_for_delivery') then
    raise exception 'ipas_set_status: % is a Local IPAS; % is for Import only', v_row.number, public._ipas_status_label(p_step)
      using errcode = '22023';
  end if;

  v_from := v_row.status;
  v_cur := coalesce(public._ipas_status_order(v_row.status), 0);
  select s.reached_on into v_existing from public.ipas_status_steps s where s.ipas_id = v_row.id and s.step = p_step;

  -- Moving back to a step that already has a day keeps that day unless a new one is given.
  v_date := coalesce(p_reached_on, case when v_new <= v_cur then v_existing end, public._ipas_today());
  perform public._ipas_check_date('ipas_set_status', v_date, 'the ' || public._ipas_status_label(p_step) || ' date');

  select max(s.reached_on) into v_prev
    from public.ipas_status_steps s
   where s.ipas_id = v_row.id and public._ipas_status_order(s.step) < v_new and s.step <> 'order_draft';
  if v_prev is not null and v_date < v_prev then
    raise exception 'ipas_set_status: the % date cannot be before the step before it (%)', public._ipas_status_label(p_step), v_prev
      using errcode = '22023';
  end if;

  if v_from is not distinct from p_step and v_existing is not distinct from v_date then
    return v_row;
  end if;

  with gone as (
    delete from public.ipas_status_steps s
     where s.ipas_id = v_row.id and public._ipas_status_order(s.step) > v_new
    returning s.step
  )
  select array_agg(step order by public._ipas_status_order(step)) into v_cleared from gone;

  insert into public.ipas_status_steps (ipas_id, step, reached_on, set_by, set_at)
  values (v_row.id, p_step, v_date, v_actor, now())
  on conflict (ipas_id, step) do update
    set reached_on = excluded.reached_on, set_by = excluded.set_by, set_at = excluded.set_at;

  update public.ipas set status = p_step where id = v_row.id returning * into v_row;

  perform public._ipas_write_event(v_row.id, v_actor, 'status_changed', jsonb_build_object(
    'from', v_from,
    'to', p_step,
    'date', v_date,
    'cleared', coalesce(to_jsonb(v_cleared), '[]'::jsonb)
  ));

  return v_row;
end;
$$;

comment on function public.ipas_set_status(uuid, text, date) is
  '#1154: sets the IPAS Status (Purchasing access, Logistics access or a Super Admin, open IPAS). Any step forward or back; skipped steps stay blank; going back deletes the rows after it. The date defaults to today (Asia/Manila), never later, never before the previous dated step. Refuses done, and customs / local_hub / out_for_delivery on a Local IPAS. Writes one "status_changed" event.';

revoke all on function public.ipas_set_status(uuid, text, date) from public, anon;
grant execute on function public.ipas_set_status(uuid, text, date) to authenticated;

-- ------------------------------------------------------------------------------
-- ipas_set_status_date: change the day of a step already reached
-- ------------------------------------------------------------------------------

create or replace function public.ipas_set_status_date(p_ipas_id uuid, p_step text, p_on date)
returns public.ipas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._ipas_status_writer('ipas_set_status_date');
  v_row public.ipas;
  v_order integer := public._ipas_status_order(p_step);
  v_existing date;
  v_prev date;
  v_next date;
begin
  if v_order is null then
    raise exception 'ipas_set_status_date: % isn''t a status step', coalesce(p_step, 'null') using errcode = '22023';
  end if;
  if p_step = 'done' then
    raise exception 'ipas_set_status_date: Done comes from filing' using errcode = '22023';
  end if;
  if p_on is null then
    raise exception 'ipas_set_status_date: give the date' using errcode = '22023';
  end if;

  v_row := public._ipas_lock_open('ipas_set_status_date', p_ipas_id);
  select s.reached_on into v_existing from public.ipas_status_steps s where s.ipas_id = v_row.id and s.step = p_step;
  if v_existing is null then
    raise exception 'ipas_set_status_date: % has not reached %', v_row.number, public._ipas_status_label(p_step)
      using errcode = '22023';
  end if;

  perform public._ipas_check_date('ipas_set_status_date', p_on, 'the ' || public._ipas_status_label(p_step) || ' date');

  select max(s.reached_on) into v_prev
    from public.ipas_status_steps s where s.ipas_id = v_row.id and public._ipas_status_order(s.step) < v_order and s.step <> 'order_draft';
  select min(s.reached_on) into v_next
    from public.ipas_status_steps s where s.ipas_id = v_row.id and public._ipas_status_order(s.step) > v_order and s.step <> 'done';
  if v_prev is not null and p_on < v_prev then
    raise exception 'ipas_set_status_date: the % date cannot be before the step before it (%)', public._ipas_status_label(p_step), v_prev
      using errcode = '22023';
  end if;
  if v_next is not null and p_on > v_next and p_step <> 'order_draft' then
    raise exception 'ipas_set_status_date: the % date cannot be after the step after it (%)', public._ipas_status_label(p_step), v_next
      using errcode = '22023';
  end if;

  if v_existing = p_on then
    return v_row;
  end if;

  update public.ipas_status_steps
     set reached_on = p_on, set_by = v_actor, set_at = now()
   where ipas_id = v_row.id and step = p_step;

  perform public._ipas_write_event(v_row.id, v_actor, 'status_date_changed', jsonb_build_object(
    'step', p_step, 'from', v_existing, 'to', p_on
  ));

  select * into v_row from public.ipas where id = v_row.id;
  return v_row;
end;
$$;

comment on function public.ipas_set_status_date(uuid, text, date) is
  '#1154: changes the day of a status step already reached, under the same date rules as ipas_set_status (never later than today, never before the previous dated step, never after the next one). Writes "status_date_changed".';

revoke all on function public.ipas_set_status_date(uuid, text, date) from public, anon;
grant execute on function public.ipas_set_status_date(uuid, text, date) to authenticated;

-- ------------------------------------------------------------------------------
-- Lifecycle: a new IPAS, filing, reopen, source change, cancel
-- ------------------------------------------------------------------------------

create or replace function public.ipas_status_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ipas_status_steps (ipas_id, step, reached_on, set_by)
  values (new.id, 'order_draft', (new.created_at at time zone 'Asia/Manila')::date, public.get_employee_id())
  on conflict (ipas_id, step) do nothing;
  return new;
end;
$$;

revoke all on function public.ipas_status_on_insert() from public, anon, authenticated;

create or replace function public.ipas_status_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last text;
begin
  if new.state is distinct from old.state then
    if new.state = 'filed' then
      insert into public.ipas_status_steps (ipas_id, step, reached_on, set_by)
      values (new.id, 'done', public._ipas_today(), public.get_employee_id())
      on conflict (ipas_id, step) do update set reached_on = excluded.reached_on, set_by = excluded.set_by, set_at = now();
      new.status := 'done';
    elsif old.state = 'filed' and new.state = 'open' then
      delete from public.ipas_status_steps where ipas_id = new.id and step = 'done';
      select s.step into v_last from public.ipas_status_steps s
       where s.ipas_id = new.id order by public._ipas_status_order(s.step) desc limit 1;
      new.status := coalesce(v_last, 'order_draft');
    elsif new.state = 'cancelled' then
      new.status := null;
    end if;
  end if;

  if new.source is distinct from old.source and new.source = 'local' then
    delete from public.ipas_status_steps
     where ipas_id = new.id and step in ('customs', 'local_hub', 'out_for_delivery');
    if new.status in ('customs', 'local_hub', 'out_for_delivery') then
      select s.step into v_last from public.ipas_status_steps s
       where s.ipas_id = new.id order by public._ipas_status_order(s.step) desc limit 1;
      new.status := coalesce(v_last, 'order_draft');
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.ipas_status_lifecycle() from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Retired writers, and Logistics waits for Delivered
-- ------------------------------------------------------------------------------

revoke execute on function public.ipas_set_supplier_origin(uuid, jsonb) from authenticated;
revoke execute on function public.ipas_set_typed_status(uuid, text, date) from authenticated;

create or replace function public._ipas_logistics_missing(p_ipas_id uuid)
returns text[]
language sql
stable
set search_path = public
as $$
  select array_remove(array[
    case when i.item_location_id is null and not exists (
      select 1 from public.transmittal_ipas ti
        join public.transmittals t on t.id = ti.transmittal_id
       where ti.ipas_id = i.id and t.item_location_id is not null
    ) then 'the Item Location' end,
    case when not exists (select 1 from public.transmittal_ipas ti where ti.ipas_id = i.id)
      then 'a Transmittal' end,
    case when not exists (
      select 1 from public.ipas_status_steps s where s.ipas_id = i.id and s.step = 'delivered'
    ) then 'the Delivered status' end
  ], null)
  from public.ipas i
  where i.id = p_ipas_id;
$$;

revoke all on function public._ipas_logistics_missing(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Switch-over, once
-- ------------------------------------------------------------------------------
-- filed -> done; cancelled -> null; otherwise the furthest of the facts the IPAS already holds:
--   arrived_in_whs_on or delivered_on -> delivered; arrived_in_ph_on -> customs (Import);
--   onboard_on -> in_transit; shipped_out_on -> shipped; Odoo PO state purchase / done -> ordered;
--   a live section 1 Prepared -> payment_approval; else order_draft.
-- Each mapped date carries over. A step with no date of its own takes the day the fact was recorded, or the
-- raise day. import_clearance_on maps to nothing. on_hold is untouched.
--
-- Kept as a function so it can be proven on seeded IPAS; it is run for every IPAS below, once, and no role
-- may call it.

create or replace function public._ipas_status_switch_over(p_ipas_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ipas_status_steps (ipas_id, step, reached_on, set_by, set_at)
  select i.id, s.step, s.on_day, null, now()
    from public.ipas i
   cross join lateral (values
     ('order_draft', (i.created_at at time zone 'Asia/Manila')::date),
     ('payment_approval', (
        select (min(g.signed_at) at time zone 'Asia/Manila')::date
          from public.ipas_signoffs g
         where g.ipas_id = i.id and g.section = 1 and g.role = 'prepared' and g.cleared_at is null)),
     ('ordered', case when i.odoo_copy -> 'po' ->> 'state' in ('purchase', 'done')
                      then (i.odoo_fetched_at at time zone 'Asia/Manila')::date end),
     ('shipped', i.shipped_out_on),
     ('in_transit', i.onboard_on),
     ('customs', case when i.source = 'import' then i.arrived_in_ph_on end),
     ('delivered', coalesce(i.arrived_in_whs_on, i.delivered_on))
   ) s(step, on_day)
   where i.state <> 'cancelled'
     and s.on_day is not null
     and (p_ipas_id is null or i.id = p_ipas_id)
  on conflict (ipas_id, step) do nothing;

  insert into public.ipas_status_steps (ipas_id, step, reached_on, set_by, set_at)
  select i.id, 'done', (coalesce(i.filed_at, i.updated_at) at time zone 'Asia/Manila')::date, null, now()
    from public.ipas i
   where i.state = 'filed'
     and (p_ipas_id is null or i.id = p_ipas_id)
  on conflict (ipas_id, step) do nothing;

  -- A filed IPAS is frozen; this one update goes through the reopening switch, and the
  -- updated_at stamp is left alone so the list order does not move.
  perform set_config('ipas.reopening', 'on', true);
  alter table public.ipas disable trigger ipas_updated_at;

  update public.ipas i
     set status = case
       when i.state = 'cancelled' then null
       when i.state = 'filed' then 'done'
       else coalesce((
         select s.step from public.ipas_status_steps s
          where s.ipas_id = i.id
          order by public._ipas_status_order(s.step) desc limit 1
       ), 'order_draft')
     end
   where p_ipas_id is null or i.id = p_ipas_id;

  alter table public.ipas enable trigger ipas_updated_at;
  perform set_config('ipas.reopening', 'off', true);
end;
$$;

revoke all on function public._ipas_status_switch_over(uuid) from public, anon, authenticated;

select public._ipas_status_switch_over(null);

alter table public.ipas alter column status set default 'order_draft';

drop trigger if exists ipas_status_on_insert on public.ipas;
create trigger ipas_status_on_insert
  after insert on public.ipas
  for each row execute function public.ipas_status_on_insert();

drop trigger if exists ipas_status_lifecycle on public.ipas;
create trigger ipas_status_lifecycle
  before update of state, source on public.ipas
  for each row execute function public.ipas_status_lifecycle();
