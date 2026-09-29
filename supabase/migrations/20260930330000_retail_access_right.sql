-- ==============================================================================
-- 20260930330000_retail_access_right.sql
--
-- Retail becomes a System Access Right, open to Sales by default.
--
-- Issue #173 gated the Retail screen and its queue to "a Super Admin, or a Sales
-- Director on a live opportunity" — a state derived from which opportunities
-- name someone, not a right anybody can grant or take back. The people who
-- actually handle marketplace orders are the whole Sales team, so this replaces
-- that predicate with a flag beside `has_sales_flow`, `has_task_flow` and
-- `has_purchasing_flow`: `employees.has_retail_access`, toggled in the employee
-- form under System Access Rights.
--
-- OPEN FOR SALES BY DEFAULT
-- Every existing employee whose department is SALES gets the right here. New
-- SALES employees get it from the employee form / employeeService, which
-- switch it on when the department is SALES. It stays a stored boolean on
-- purpose (see 0054's argument against gating on the free-text department at
-- read time): a Super Admin can see it, and turn it off for one person.
--
-- WHAT CHANGES IN THE DATABASE
-- `can_handle_retail_queue()` — the predicate behind the queue table's select
-- and dismiss policies — and `approve_retail_queue_item()` both now ask
-- "Super Admin, or has_retail_access" instead of the Sales Director query.
-- Approve is SECURITY DEFINER and bypasses RLS, so it keeps its own check
-- against get_employee_id() rather than trusting anything the client sends.
--
-- Someone who was a Sales Director but sits outside SALES loses access until a
-- Super Admin grants the right. The first select below is not a backfill of
-- those people, on purpose: it is a visible, one-line decision, not a guess.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new NOT NULL DEFAULT false column; a frontend that never names it is
--     unaffected, and it can only widen access (SALES employees), never narrow
--     it for anyone the old gate admitted from the SALES department.
--   * Idempotent.
-- ==============================================================================

alter table public.employees
  add column if not exists has_retail_access boolean not null default false;

comment on column public.employees.has_retail_access is
  'Retail access right: shows the Retail screen and lets the holder approve or dismiss marketplace orders in the retail queue. On by default for SALES employees. Enforced by can_handle_retail_queue() and approve_retail_queue_item().';

update public.employees
   set has_retail_access = true
 where upper(btrim(department)) = 'SALES'
   and has_retail_access = false;

create or replace function public.can_handle_retail_queue()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and (e.is_super_admin or e.has_retail_access)
  );
$$;

grant execute on function public.can_handle_retail_queue() to authenticated;

create or replace function public.approve_retail_queue_item(
  p_queue_item_id uuid,
  p_client_name text default null,
  p_contact_person text default null,
  p_project_title text default null,
  p_expected_value numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_reviewer uuid;
  v_new_id uuid;
begin
  v_reviewer := get_employee_id();
  if v_reviewer is null then
    raise exception 'Not signed in as a recognized employee.';
  end if;

  if not can_handle_retail_queue() then
    raise exception 'You do not have Retail access.';
  end if;

  select * into v_item from odoo_retail_queue where id = p_queue_item_id for update;
  if not found then
    raise exception 'Queue item not found.';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'Queue item is no longer pending.';
  end if;

  insert into sales_opportunities (
    sales_reference, client_name, contact_person, project_title, expected_value,
    lead_source, registered_by, registration_date, is_retail
  ) values (
    v_item.odoo_so_number,
    coalesce(p_client_name, v_item.client_name, v_item.odoo_partner_name),
    coalesce(p_contact_person, v_item.contact_person, v_item.odoo_person_name),
    coalesce(p_project_title, v_item.project_title, 'Retail: ' || v_item.odoo_partner_name),
    coalesce(p_expected_value, v_item.expected_value, v_item.odoo_amount),
    coalesce(v_item.lead_source, 'SHOPEE'),
    v_reviewer,
    coalesce(v_item.odoo_create_date::date, current_date),
    true
  ) returning id into v_new_id;

  update odoo_retail_queue set
    status = 'approved',
    reviewed_by = v_reviewer,
    reviewed_at = now(),
    opportunity_id = v_new_id,
    client_name = coalesce(p_client_name, client_name),
    contact_person = coalesce(p_contact_person, contact_person),
    project_title = coalesce(p_project_title, project_title),
    expected_value = coalesce(p_expected_value, expected_value)
  where id = p_queue_item_id;

  return v_new_id;
end;
$$;

grant execute on function public.approve_retail_queue_item(uuid, text, text, text, numeric) to authenticated;
