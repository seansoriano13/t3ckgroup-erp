-- #1206 (spec #1205): the IPAS Status gains For Payment, and Processing / Preparing Shipment is split into
-- In Production and Ready for Shipment (ADR 0054, amended 2026-11-24).
--
-- The new list, in order:
--   order_draft, payment_approval, for_payment, ordered, in_production, ready_for_shipment, shipped,
--   in_transit, customs, local_hub, out_for_delivery, delivered, done
--
-- This migration
--   1. replaces the step order and the label function (the status check and the step-row check read the
--      order function, so they follow)
--   2. moves every IPAS on processing to in_production, and its dated step row with it, keeping the day
--   3. carries the processing Ageing rule over to in_production; for_payment and ready_for_shipment start
--      with no rule; the Ageing rule check follows the new list
--   4. rewrites the Chat lines of past status changes that named the old step, so the old words are gone
--      (the append-only event log is left alone; the label function reads a stored 'processing' as
--      In Production)
--
-- The Chat labels of new status changes come from the label function, so they follow step 1.
-- Nothing is posted for step 2: the status trigger that writes Chat lines is off for that one update.
-- SAFE TO RUN ONCE; re-running finds nothing left on processing.

-- ------------------------------------------------------------------------------
-- 1. The steps, in order, and their words
-- ------------------------------------------------------------------------------

create or replace function public._ipas_status_order(p_step text)
returns integer
language sql
immutable
set search_path = public
as $$
  select array_position(array[
    'order_draft', 'payment_approval', 'for_payment', 'ordered', 'in_production', 'ready_for_shipment',
    'shipped', 'in_transit', 'customs', 'local_hub', 'out_for_delivery', 'delivered', 'done'
  ]::text[], p_step);
$$;

create or replace function public._ipas_status_label(p_step text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_step
    when 'order_draft' then 'Order-Draft'
    when 'payment_approval' then 'Payment Approval'
    when 'for_payment' then 'For Payment'
    when 'ordered' then 'Ordered'
    when 'in_production' then 'In Production'
    when 'ready_for_shipment' then 'Ready for Shipment'
    when 'processing' then 'In Production'
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

comment on column public.ipas.status is
  '#1154, #1206 (ADR 0054): the IPAS Status, set by hand: order_draft, payment_approval, for_payment, ordered, in_production, ready_for_shipment, shipped, in_transit, customs, local_hub, out_for_delivery, delivered or done. Null on a cancelled IPAS. done comes only from filing. Always the furthest step that has a row in ipas_status_steps.';

-- ------------------------------------------------------------------------------
-- 2. processing -> in_production, with its day
-- ------------------------------------------------------------------------------

-- Not an in-between state: a row with an old key would break the checks the moment it is touched.
update public.ipas_status_steps set step = 'in_production' where step = 'processing';

-- The same quiet update the switch-over used: a filed IPAS is frozen, the list order must not move, and
-- the move must not post a Chat line for every IPAS.
select set_config('ipas.reopening', 'on', true);
alter table public.ipas disable trigger ipas_updated_at;
alter table public.ipas disable trigger ipas_status_to_chat;

update public.ipas set status = 'in_production' where status = 'processing';

alter table public.ipas enable trigger ipas_status_to_chat;
alter table public.ipas enable trigger ipas_updated_at;
select set_config('ipas.reopening', 'off', true);

-- ------------------------------------------------------------------------------
-- 3. The Ageing rule
-- ------------------------------------------------------------------------------

alter table public.order_ageing_rules drop constraint if exists order_ageing_rules_step_chk;

insert into public.order_ageing_rules (step, days, updated_by, updated_at)
select 'in_production', r.days, r.updated_by, r.updated_at
  from public.order_ageing_rules r
 where r.step = 'processing'
on conflict (step) do update set days = excluded.days, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

delete from public.order_ageing_rules where step = 'processing';

insert into public.order_ageing_rules (step) values ('for_payment'), ('in_production'), ('ready_for_shipment')
on conflict (step) do nothing;

alter table public.order_ageing_rules add constraint order_ageing_rules_step_chk check (step in (
  'order_draft', 'payment_approval', 'for_payment', 'ordered', 'in_production', 'ready_for_shipment', 'shipped',
  'in_transit', 'customs', 'local_hub', 'out_for_delivery', 'delivered',
  'no_transmittal', 'check_open', 'section_3_approval', 'ready_to_file'
));

-- ------------------------------------------------------------------------------
-- 4. Past status lines in the Chat
-- ------------------------------------------------------------------------------

update public.ipas_messages
   set content = replace(content, 'Processing / Preparing Shipment', 'In Production'),
       metadata = metadata
         || case when metadata ->> 'from' = 'processing' then jsonb_build_object('from', 'in_production') else '{}'::jsonb end
         || case when metadata ->> 'to' = 'processing' then jsonb_build_object('to', 'in_production') else '{}'::jsonb end
 where metadata ->> 'event' = 'status_changed'
   and (content like '%Processing / Preparing Shipment%'
        or metadata ->> 'from' = 'processing' or metadata ->> 'to' = 'processing');
