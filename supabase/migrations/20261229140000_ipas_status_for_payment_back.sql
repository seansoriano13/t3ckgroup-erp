-- ==============================================================================
-- For Payment comes back as an IPAS Status step (ADR 0054 / 0055 amendments of
-- 2026-11-27). It reverses the For Payment half of #1221; Payment Approval stays
-- retired.
--
-- For Payment is a side step: money is asked at many points of the goods'
-- journey (a down payment at Order-Draft, a Balance while In Transit, duties at
-- Customs), so picking it must not wipe where the goods are.
--
-- 1. The step list (_ipas_status_order) takes for_payment again, right after
--    Order-Draft (the team's place for it before #1221).
-- 2. ipas.status_before_payment remembers the goods step For Payment was picked
--    over. Picking For Payment deletes no later step and keeps their days.
--    Leaving it by hand drops its step row; the goods step's day stays.
-- 3. When no payment request is left open (each paid or withdrawn) and the IPAS
--    is still on For Payment, the Status goes back to the remembered step (or
--    Order-Draft). The Chat line says the app moved it. A Status moved by hand
--    in the meantime is left alone.
-- 4. Filing, reopening and the Local switch skip the For Payment row when they
--    look for the furthest goods step.
-- 5. The Ageing rule for For Payment is back (Order Monitoring reads every step).
--
-- Nothing is moved: an IPAS keeps its Status until someone picks For Payment.
-- SAFE TO RUN ONCE; the function and trigger bodies are idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. The step list
-- ------------------------------------------------------------------------------

create or replace function public._ipas_status_order(p_step text)
returns integer
language sql
immutable
set search_path = public
as $$
  select array_position(array[
    'order_draft', 'for_payment', 'ordered', 'in_production', 'ready_for_shipment',
    'shipped', 'in_transit', 'customs', 'local_hub', 'out_for_delivery', 'delivered', 'done'
  ]::text[], p_step);
$$;

-- Steps that may sit in ipas_status_steps (Payment Approval rows are kept history from before #1221).
create or replace function public._ipas_status_step_known(p_step text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public._ipas_status_order(p_step) is not null or p_step = 'payment_approval';
$$;

-- ------------------------------------------------------------------------------
-- 2. The goods step under For Payment
-- ------------------------------------------------------------------------------

alter table public.ipas add column if not exists status_before_payment text;

alter table public.ipas drop constraint if exists ipas_status_before_payment_chk;
alter table public.ipas add constraint ipas_status_before_payment_chk check (
  status_before_payment is null
  or (public._ipas_status_order(status_before_payment) is not null and status_before_payment <> 'for_payment')
);

comment on column public.ipas.status_before_payment is
  'ADR 0054 amendment of 2026-11-27: the goods step For Payment was picked over; the Status goes back to it when no payment request is left open. Null unless the Status is For Payment.';

comment on column public.ipas.status is
  '#1154, #1206, #1221, 2026-11-27 (ADR 0054): the IPAS Status, set by hand: order_draft, for_payment, ordered, in_production, ready_for_shipment, shipped, in_transit, customs, local_hub, out_for_delivery, delivered or done. Null on a cancelled IPAS. done comes only from filing. for_payment is a side step over the goods step in status_before_payment; otherwise the furthest step with a row in ipas_status_steps. Payment Approval was retired in #1221; its kept step rows are history only.';

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
  v_cleared text[];
  v_from text;
  v_goods text;
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
  -- On For Payment, the goods step under it is where the order really is.
  v_goods := case when v_from = 'for_payment' then coalesce(v_row.status_before_payment, 'order_draft') else v_from end;
  v_cur := coalesce(public._ipas_status_order(v_goods), 0);
  select s.reached_on into v_existing from public.ipas_status_steps s where s.ipas_id = v_row.id and s.step = p_step;

  -- Moving back to a step that already has a day keeps that day unless a new one is given.
  v_date := coalesce(p_reached_on, case when p_step <> 'for_payment' and v_new <= v_cur then v_existing end,
                     case when v_from = p_step then v_existing end, public._ipas_today());
  perform public._ipas_check_date('ipas_set_status', v_date, 'the ' || public._ipas_status_label(p_step) || ' date');

  -- Dates out of order are allowed (#1151 follow-up): the record shows a warning instead of refusing.

  if v_from is not distinct from p_step and v_existing is not distinct from v_date then
    return v_row;
  end if;

  if p_step = 'for_payment' then
    -- A side step: every goods step keeps its row and day.
    insert into public.ipas_status_steps (ipas_id, step, reached_on, set_by, set_at)
    values (v_row.id, p_step, v_date, v_actor, now())
    on conflict (ipas_id, step) do update
      set reached_on = excluded.reached_on, set_by = excluded.set_by, set_at = excluded.set_at;

    update public.ipas set status = p_step, status_before_payment = v_goods
     where id = v_row.id returning * into v_row;
  else
    with gone as (
      delete from public.ipas_status_steps s
       where s.ipas_id = v_row.id and s.step <> 'for_payment' and public._ipas_status_order(s.step) > v_new
      returning s.step
    )
    select array_agg(step order by public._ipas_status_order(step)) into v_cleared from gone;

    delete from public.ipas_status_steps s where s.ipas_id = v_row.id and s.step = 'for_payment';

    insert into public.ipas_status_steps (ipas_id, step, reached_on, set_by, set_at)
    values (v_row.id, p_step, v_date, v_actor, now())
    on conflict (ipas_id, step) do update
      set reached_on = excluded.reached_on, set_by = excluded.set_by, set_at = excluded.set_at;

    update public.ipas set status = p_step, status_before_payment = null
     where id = v_row.id returning * into v_row;
  end if;

  perform public._ipas_write_event(v_row.id, v_actor, 'status_changed', jsonb_build_object(
    'from', v_from,
    'to', p_step,
    'date', v_date,
    'cleared', coalesce(to_jsonb(v_cleared), '[]'::jsonb)
  ));

  return v_row;
end;
$$;

revoke all on function public.ipas_set_status(uuid, text, date) from public, anon;
grant execute on function public.ipas_set_status(uuid, text, date) to authenticated;

-- ------------------------------------------------------------------------------
-- 3. Back to the goods step once no payment request is open
-- ------------------------------------------------------------------------------

create or replace function public._ipas_status_back_from_payment(p_ipas_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ipas;
  v_back text;
begin
  select * into v_row from public.ipas where id = p_ipas_id for update;
  if not found or v_row.state <> 'open' or v_row.status is distinct from 'for_payment' then
    return;
  end if;
  if exists (select 1 from public.ipas_payment_asks a where a.ipas_id = p_ipas_id and a.closed_at is null) then
    return;
  end if;

  v_back := coalesce(v_row.status_before_payment, 'order_draft');
  -- A Local IPAS can't sit on an Import-only step (the source may have changed while on For Payment).
  if v_row.source = 'local' and v_back in ('customs', 'local_hub', 'out_for_delivery') then
    v_back := 'order_draft';
  end if;

  delete from public.ipas_status_steps s where s.ipas_id = p_ipas_id and s.step = 'for_payment';
  insert into public.ipas_status_steps (ipas_id, step, reached_on, set_by, set_at)
  values (p_ipas_id, v_back, public._ipas_today(), null, now())
  on conflict (ipas_id, step) do nothing;

  perform set_config('ipas.status_note', 'Moved back by the app: no payment request is open.', true);
  update public.ipas set status = v_back, status_before_payment = null where id = p_ipas_id;
  perform set_config('ipas.status_note', '', true);

  perform public._ipas_write_event(p_ipas_id, public.get_employee_id(), 'status_changed', jsonb_build_object(
    'from', 'for_payment',
    'to', v_back,
    'cleared', '[]'::jsonb,
    'by', 'app'
  ));
end;
$$;

comment on function public._ipas_status_back_from_payment(uuid) is
  'ADR 0054 amendment of 2026-11-27: an open IPAS on For Payment with no open payment request goes back to the goods step under it (status_before_payment, else Order-Draft). Called by the ipas_payment_asks trigger; no role may call it.';

revoke all on function public._ipas_status_back_from_payment(uuid) from public, anon, authenticated;

create or replace function public._ipas_payment_asks_status_back()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public._ipas_status_back_from_payment(old.ipas_id);
  elsif old.closed_at is null and new.closed_at is not null then
    perform public._ipas_status_back_from_payment(new.ipas_id);
  end if;
  return null;
end;
$$;

revoke all on function public._ipas_payment_asks_status_back() from public, anon, authenticated;

drop trigger if exists ipas_payment_asks_status_back on public.ipas_payment_asks;
create trigger ipas_payment_asks_status_back
after delete or update of closed_at on public.ipas_payment_asks
for each row
execute function public._ipas_payment_asks_status_back();

-- The Chat line names the app's move.
create or replace function public._ipas_status_to_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text;
  v_note text := nullif(current_setting('ipas.status_note', true), '');
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  if new.status is null then
    v_text := 'Status cleared (was ' || public._ipas_status_label(old.status) || ').';
  elsif old.status is null then
    v_text := 'Status set to ' || public._ipas_status_label(new.status) || '.';
  else
    v_text := 'Status set to ' || public._ipas_status_label(new.status)
           || ' (was ' || public._ipas_status_label(old.status) || ').';
  end if;
  if v_note is not null then
    v_text := v_text || ' ' || v_note;
  end if;

  insert into public.ipas_messages (ipas_id, author_id, content, metadata)
  values (
    new.id,
    public.get_employee_id(),
    v_text,
    jsonb_build_object('event', 'status_changed', 'from', old.status, 'to', new.status)
  );

  return null;
end;
$$;

revoke all on function public._ipas_status_to_chat() from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. Filing, reopening and the Local switch skip For Payment
-- ------------------------------------------------------------------------------

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
      delete from public.ipas_status_steps where ipas_id = new.id and step = 'for_payment';
      insert into public.ipas_status_steps (ipas_id, step, reached_on, set_by)
      values (new.id, 'done', public._ipas_today(), public.get_employee_id())
      on conflict (ipas_id, step) do update set reached_on = excluded.reached_on, set_by = excluded.set_by, set_at = now();
      new.status := 'done';
      new.status_before_payment := null;
    elsif old.state = 'filed' and new.state = 'open' then
      delete from public.ipas_status_steps where ipas_id = new.id and step = 'done';
      select s.step into v_last from public.ipas_status_steps s
       where s.ipas_id = new.id and s.step <> 'for_payment' and public._ipas_status_order(s.step) is not null
       order by public._ipas_status_order(s.step) desc limit 1;
      new.status := coalesce(v_last, 'order_draft');
    elsif new.state = 'cancelled' then
      new.status := null;
      new.status_before_payment := null;
    end if;
  end if;

  if new.source is distinct from old.source and new.source = 'local' then
    delete from public.ipas_status_steps
     where ipas_id = new.id and step in ('customs', 'local_hub', 'out_for_delivery');
    if new.status in ('customs', 'local_hub', 'out_for_delivery')
       or new.status_before_payment in ('customs', 'local_hub', 'out_for_delivery') then
      select s.step into v_last from public.ipas_status_steps s
       where s.ipas_id = new.id and s.step <> 'for_payment' and public._ipas_status_order(s.step) is not null
       order by public._ipas_status_order(s.step) desc limit 1;
      if new.status = 'for_payment' then
        new.status_before_payment := coalesce(v_last, 'order_draft');
      else
        new.status := coalesce(v_last, 'order_draft');
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.ipas_status_lifecycle() from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. Order Monitoring: the For Payment Ageing rule
-- ------------------------------------------------------------------------------

alter table public.order_ageing_rules drop constraint if exists order_ageing_rules_step_chk;

insert into public.order_ageing_rules (step) values ('for_payment')
on conflict (step) do nothing;

alter table public.order_ageing_rules add constraint order_ageing_rules_step_chk check (step in (
  'order_draft', 'for_payment', 'ordered', 'in_production', 'ready_for_shipment', 'shipped',
  'in_transit', 'customs', 'local_hub', 'out_for_delivery', 'delivered',
  'no_transmittal', 'check_open', 'section_3_approval', 'ready_to_file'
));
