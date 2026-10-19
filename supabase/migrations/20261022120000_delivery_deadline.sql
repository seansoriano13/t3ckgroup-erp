-- Order Monitoring shows the client's delivery deadline (#467, spec #461 Q5 and Q15).
--
-- 1. `order_deadline_setting`: one row holding N, the days before the client's
--    delivery deadline at which an order not yet Received in Odoo is marked
--    near. Default 5. Same access as the ageing rules (#262): any employee
--    reads, Purchasing access and Super Admins write, never deleted.
--
-- 2. `sor_delivery_deadlines(p_opportunity_ids)`: the due date of each SOR's
--    `deadline` condition, read from the SOR's own Flow Snapshot. The date is
--    the entry time of the SOR's latest visit to the stage that carries the
--    condition, plus the condition's days. Government's 15-day Delivery
--    Deadline sits on NTP, but orders matter later at Project Delivery, so the
--    stage the SOR is on now is not enough. An SOR whose snapshot has no
--    deadline condition, or that never reached that stage, returns no row.
--    Dates only; nothing is blocked or sent.
--
-- SAFE TO RUN AT ANY TIME: a new table, its policies, a seed and a new function.

create table if not exists public.order_deadline_setting (
  id          boolean primary key default true,
  near_days   integer not null default 5,
  updated_by  uuid references public.employees (id) on delete set null,
  updated_at  timestamptz not null default now(),

  constraint order_deadline_setting_one_row_chk check (id = true),
  constraint order_deadline_setting_days_chk check (near_days > 0)
);

comment on table public.order_deadline_setting is
  '#467: N, the days before the client''s delivery deadline at which an unreceived order is marked near. One row. Read by any authenticated employee; written by Purchasing access and Super Admins.';

create or replace function public.order_deadline_setting_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = coalesce(public.get_employee_id(), new.updated_by);
  return new;
end;
$$;

revoke all on function public.order_deadline_setting_stamp() from public, anon, authenticated;

drop trigger if exists order_deadline_setting_stamp on public.order_deadline_setting;
create trigger order_deadline_setting_stamp
  before insert or update on public.order_deadline_setting
  for each row execute function public.order_deadline_setting_stamp();

insert into public.order_deadline_setting (id, near_days) values (true, 5)
on conflict (id) do nothing;

alter table public.order_deadline_setting enable row level security;

drop policy if exists order_deadline_setting_read on public.order_deadline_setting;
create policy order_deadline_setting_read on public.order_deadline_setting
  for select to authenticated
  using (public.get_employee_id() is not null);

drop policy if exists order_deadline_setting_insert on public.order_deadline_setting;
create policy order_deadline_setting_insert on public.order_deadline_setting
  for insert to authenticated
  with check (public.has_purchasing_access() or coalesce(public.is_super_admin(), false));

drop policy if exists order_deadline_setting_update on public.order_deadline_setting;
create policy order_deadline_setting_update on public.order_deadline_setting
  for update to authenticated
  using (public.has_purchasing_access() or coalesce(public.is_super_admin(), false))
  with check (public.has_purchasing_access() or coalesce(public.is_super_admin(), false));

revoke delete, truncate on public.order_deadline_setting from anon, authenticated;

create or replace function public.sor_delivery_deadlines(p_opportunity_ids uuid[])
returns table (opportunity_id uuid, due_at timestamptz, days integer)
language sql
stable
security definer
set search_path = public
as $function$
  with asked as (
    select o.id, o.flow_snapshot_id
      from public.sales_opportunities o
     where public.get_employee_id() is not null
       and o.id = any (coalesce(p_opportunity_ids, '{}'::uuid[]))
       and not o.is_deleted
       and (
         coalesce(public.has_purchasing_access(), false)
         or coalesce(public.has_finance_access(), false)
         or coalesce(public.is_super_admin(), false)
         or coalesce(public.sor_access_level(o.id), 'none') <> 'none'
       )
  ),
  conds as (
    select a.id as opportunity_id,
           c.cond->>'stage_id' as stage_id,
           (c.cond->'config'->>'days')::integer as days
      from asked a
      join public.flow_snapshots fs on fs.id = a.flow_snapshot_id
      cross join lateral (
        select e.cond
          from jsonb_array_elements(
                 case jsonb_typeof(fs.snapshot_data->'conditions')
                   when 'array' then fs.snapshot_data->'conditions'
                   when 'object' then (
                     select coalesce(jsonb_agg(x.val), '[]'::jsonb)
                       from jsonb_each(fs.snapshot_data->'conditions') je,
                            jsonb_array_elements(je.value) x(val)
                      where jsonb_typeof(je.value) = 'array'
                   )
                   else '[]'::jsonb
                 end
               ) e(cond)
         where e.cond->>'kind' = 'deadline'
           and (e.cond->>'archived_at') is null
           and (e.cond->'config'->>'days') ~ '^[0-9]+$'
      ) c
  ),
  dated as (
    select c.opportunity_id,
           c.days,
           (
             select v.entered_at
               from public.sor_stage_visits v
              where v.opportunity_id = c.opportunity_id
                and v.flow_stage_id::text = c.stage_id
                and v.undone_at is null
              order by v.entered_at desc
              limit 1
           ) as entered_at
      from conds c
     where c.days > 0
  )
  select distinct on (d.opportunity_id)
         d.opportunity_id,
         d.entered_at + (d.days || ' days')::interval as due_at,
         d.days
    from dated d
   where d.entered_at is not null
   order by d.opportunity_id, d.entered_at + (d.days || ' days')::interval;
$function$;

revoke all on function public.sor_delivery_deadlines(uuid[]) from public, anon;
grant execute on function public.sor_delivery_deadlines(uuid[]) to authenticated;
