-- Order Monitoring ageing rules (#262, spec #261).
--
-- One row per step of an order's life, holding how many days the order may
-- sit at that step before it counts as late. `days` null means no rule: a step
-- with no rule never goes late. Every step is seeded blank, so nothing is late
-- until Purchasing sets a rule.
--
-- Its own table rather than ipas_options: option lists are labelled choices,
-- while these are fixed keys with a number. A developer adds a step; the
-- business edits only the days.
--
-- ACCESS. Any authenticated employee reads the rules (the SOR summary needs
-- them). Purchasing access and Super Admins write them, through the same
-- helpers the IPAS option lists use. Rules are never deleted.
--
-- SAFE TO RUN AT ANY TIME: a new table, its policies and a seed. Idempotent.

create table if not exists public.order_ageing_rules (
  step        text primary key,
  days        integer,
  updated_by  uuid references public.employees (id) on delete set null,
  updated_at  timestamptz not null default now(),

  constraint order_ageing_rules_step_chk check (step in (
    'purchase_order', 'with_pop', 'import_clearance', 'delivered', 'received_in_odoo',
    'create_bill', 'actual_checking',
    'no_transmittal', 'check_open', 'ready_to_file'
  )),
  constraint order_ageing_rules_days_chk check (days is null or days > 0)
);

comment on table public.order_ageing_rules is
  '#262: how many days an order may sit at each step before it is late (null = no rule). Read by any authenticated employee; written by Purchasing access and Super Admins. Never deleted.';
comment on column public.order_ageing_rules.days is
  'Positive whole days; null means the step has no rule and never goes late.';

-- Stamps who changed a rule and when. A service-role write has no employee, so
-- it keeps whatever updated_by it was given.
create or replace function public.order_ageing_rules_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = coalesce(public.get_employee_id(), new.updated_by);
  return new;
end;
$$;

revoke all on function public.order_ageing_rules_stamp() from public, anon, authenticated;

drop trigger if exists order_ageing_rules_stamp on public.order_ageing_rules;
create trigger order_ageing_rules_stamp
  before insert or update on public.order_ageing_rules
  for each row execute function public.order_ageing_rules_stamp();

-- Every step, blank.
insert into public.order_ageing_rules (step) values
  ('purchase_order'), ('with_pop'), ('import_clearance'), ('delivered'), ('received_in_odoo'),
  ('create_bill'), ('actual_checking'),
  ('no_transmittal'), ('check_open'), ('ready_to_file')
on conflict (step) do nothing;

alter table public.order_ageing_rules enable row level security;

drop policy if exists order_ageing_rules_read on public.order_ageing_rules;
create policy order_ageing_rules_read on public.order_ageing_rules
  for select to authenticated
  using (public.get_employee_id() is not null);

drop policy if exists order_ageing_rules_insert on public.order_ageing_rules;
create policy order_ageing_rules_insert on public.order_ageing_rules
  for insert to authenticated
  with check (public.has_purchasing_access() or coalesce(public.is_super_admin(), false));

drop policy if exists order_ageing_rules_update on public.order_ageing_rules;
create policy order_ageing_rules_update on public.order_ageing_rules
  for update to authenticated
  using (public.has_purchasing_access() or coalesce(public.is_super_admin(), false))
  with check (public.has_purchasing_access() or coalesce(public.is_super_admin(), false));

-- Rules are never deleted, by anyone through the API.
revoke delete, truncate on public.order_ageing_rules from anon, authenticated;
