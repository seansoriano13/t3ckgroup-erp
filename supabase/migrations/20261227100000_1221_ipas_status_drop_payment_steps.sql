-- ==============================================================================
-- #1221 (spec #1220, ADR 0054 / 0055 amendments of 2026-11-25): the IPAS Status
-- tracks the goods only. Payment Approval and For Payment leave the step list;
-- money waiting to be paid belongs to the Payment status.
--
-- 1. An IPAS sitting on either step moves to Order-Draft. The existing status
--    trigger writes "Status set to Order-Draft (was ...)" in the IPAS Chat, so
--    the move is visible. Updated_at is left alone so the list order does not move.
-- 2. The step list (_ipas_status_order) drops the two keys, so ipas.status and the
--    pickers refuse them. The label function still names them, so an old Chat line
--    or history entry reads in words.
-- 3. Step dates already stored are kept; no column is dropped. The step-row check
--    uses a wider "known step" function so kept rows survive an UPDATE or a
--    dump / restore; the reopen and source-change lookups skip those rows.
-- 4. The one-time switch-over function no longer writes a Payment Approval row.
-- 5. The two Ageing rules go (Order Monitoring no longer reads those steps).
--
-- The move is a function so a test can call it; it runs once below and no role may
-- call it. SAFE TO RUN ONCE; re-running finds nothing left on the two steps.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Move IPAS off the two steps (before the step list changes)
-- ------------------------------------------------------------------------------

create or replace function public._ipas_status_drop_payment_steps(p_ipas_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moved integer;
begin
  insert into public.ipas_status_steps (ipas_id, step, reached_on, set_by, set_at)
  select i.id, 'order_draft', (i.created_at at time zone 'Asia/Manila')::date, null, now()
    from public.ipas i
   where i.status in ('payment_approval', 'for_payment')
     and (p_ipas_id is null or i.id = p_ipas_id)
  on conflict (ipas_id, step) do nothing;

  -- A filed IPAS sits on done, never on these steps, so the reopening switch is not needed;
  -- the status trigger stays on so each move posts its line in the Chat.
  alter table public.ipas disable trigger ipas_updated_at;

  update public.ipas i
     set status = 'order_draft'
   where i.status in ('payment_approval', 'for_payment')
     and (p_ipas_id is null or i.id = p_ipas_id);
  get diagnostics v_moved = row_count;

  alter table public.ipas enable trigger ipas_updated_at;
  return v_moved;
end;
$$;

comment on function public._ipas_status_drop_payment_steps(uuid) is
  '#1221: moves an IPAS on Payment Approval or For Payment to Order-Draft (all IPAS when null); the status trigger posts the Chat line. Returns how many moved. Run once by the migration; no role may call it.';

revoke all on function public._ipas_status_drop_payment_steps(uuid) from public, anon, authenticated;

select public._ipas_status_drop_payment_steps(null);

-- ------------------------------------------------------------------------------
-- 2. The step list and its words
-- ------------------------------------------------------------------------------

create or replace function public._ipas_status_order(p_step text)
returns integer
language sql
immutable
set search_path = public
as $$
  select array_position(array[
    'order_draft', 'ordered', 'in_production', 'ready_for_shipment',
    'shipped', 'in_transit', 'customs', 'local_hub', 'out_for_delivery', 'delivered', 'done'
  ]::text[], p_step);
$$;

-- Steps that may still sit in ipas_status_steps as kept history (dates are never dropped).
create or replace function public._ipas_status_step_known(p_step text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public._ipas_status_order(p_step) is not null or p_step in ('payment_approval', 'for_payment');
$$;

revoke all on function public._ipas_status_step_known(text) from public, anon;
grant execute on function public._ipas_status_step_known(text) to authenticated;

alter table public.ipas_status_steps drop constraint if exists ipas_status_steps_step_chk;
alter table public.ipas_status_steps add constraint ipas_status_steps_step_chk
  check (public._ipas_status_step_known(step));

comment on column public.ipas.status is
  '#1154, #1206, #1221 (ADR 0054): the IPAS Status, set by hand: order_draft, ordered, in_production, ready_for_shipment, shipped, in_transit, customs, local_hub, out_for_delivery, delivered or done. Null on a cancelled IPAS. done comes only from filing. Always the furthest step that has a row in ipas_status_steps. Payment Approval and For Payment were retired in #1221; their kept step rows are history only.';

-- ------------------------------------------------------------------------------
-- 3. Reopen / Local switch: pick the furthest CURRENT step, never a kept retired row
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
      insert into public.ipas_status_steps (ipas_id, step, reached_on, set_by)
      values (new.id, 'done', public._ipas_today(), public.get_employee_id())
      on conflict (ipas_id, step) do update set reached_on = excluded.reached_on, set_by = excluded.set_by, set_at = now();
      new.status := 'done';
    elsif old.state = 'filed' and new.state = 'open' then
      delete from public.ipas_status_steps where ipas_id = new.id and step = 'done';
      select s.step into v_last from public.ipas_status_steps s
       where s.ipas_id = new.id and public._ipas_status_order(s.step) is not null
       order by public._ipas_status_order(s.step) desc limit 1;
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
       where s.ipas_id = new.id and public._ipas_status_order(s.step) is not null
       order by public._ipas_status_order(s.step) desc limit 1;
      new.status := coalesce(v_last, 'order_draft');
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.ipas_status_lifecycle() from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. The one-time switch-over no longer writes a Payment Approval row
-- ------------------------------------------------------------------------------

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

  perform set_config('ipas.reopening', 'on', true);
  alter table public.ipas disable trigger ipas_updated_at;

  update public.ipas i
     set status = case
       when i.state = 'cancelled' then null
       when i.state = 'filed' then 'done'
       else coalesce((
         select s.step from public.ipas_status_steps s
          where s.ipas_id = i.id and public._ipas_status_order(s.step) is not null
          order by public._ipas_status_order(s.step) desc limit 1
       ), 'order_draft')
     end
   where p_ipas_id is null or i.id = p_ipas_id;

  alter table public.ipas enable trigger ipas_updated_at;
  perform set_config('ipas.reopening', 'off', true);
end;
$$;

revoke all on function public._ipas_status_switch_over(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. Order Monitoring: the two Ageing rules go
-- ------------------------------------------------------------------------------

alter table public.order_ageing_rules drop constraint if exists order_ageing_rules_step_chk;

delete from public.order_ageing_rules where step in ('payment_approval', 'for_payment');

alter table public.order_ageing_rules add constraint order_ageing_rules_step_chk check (step in (
  'order_draft', 'ordered', 'in_production', 'ready_for_shipment', 'shipped',
  'in_transit', 'customs', 'local_hub', 'out_for_delivery', 'delivered',
  'no_transmittal', 'check_open', 'section_3_approval', 'ready_to_file'
));
