-- ==============================================================================
-- 20260909080000_retail_queue_atomic_approve.sql
--
-- Issue #173, three defects in the retail queue:
--
-- 1. Approve was not transactional — the SOR insert and the queue update were
--    two separate round trips from the client, so a failure between them
--    orphaned a record with the queue item still pending, and re-approving
--    inserted a second SOR for the same order. Moved into a single
--    SECURITY DEFINER function so both writes commit or fail together, with
--    `FOR UPDATE` to serialize a double-click into one insert and a refused
--    second call rather than two inserts.
--
-- 2. No role gating on the write path at all (the RLS policies below use
--    USING (true)). Restricted to the same actor set #170 identifies as
--    already having retail-adjacent authority: a Super Admin, or a Sales
--    Director on a live (non-scratch, non-retail) opportunity — the exact
--    predicate in commissionService.isSalesDirector. Because this function is
--    SECURITY DEFINER it bypasses table RLS entirely, so the check has to
--    happen inside the function itself, against get_employee_id() rather
--    than a client-supplied id — trusting the JWT, not the argument.
--
-- 4. Terminal stage, project type, ITB exemption and participant assignments
--    (deal_owner_id, sales_director_id) are dropped from the insert — the
--    column defaults ('LEAD', 'SSP', false, null, null) apply instead, since
--    none of it means anything once the record is marked retail and excluded
--    from every register, board and commission read (issue #171).
-- ==============================================================================

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

  if not (
    exists (select 1 from employees e where e.id = v_reviewer and e.is_super_admin)
    or exists (
      select 1 from sales_opportunities o
      where o.sales_director_id = v_reviewer
        and o.is_scratch = false
        and o.is_retail = false
    )
  ) then
    raise exception 'Only a Sales Director or Super Admin can approve a retail order.';
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

-- Same authorization predicate for dismiss and for reading the queue —
-- "restrict it to the people who handle retail" (issue #173).
create or replace function public.can_handle_retail_queue()
returns boolean
language sql
security definer
stable
as $$
  select
    exists (select 1 from employees e where e.id = get_employee_id() and e.is_super_admin)
    or exists (
      select 1 from sales_opportunities o
      where o.sales_director_id = get_employee_id()
        and o.is_scratch = false
        and o.is_retail = false
    );
$$;

grant execute on function public.can_handle_retail_queue() to authenticated;

drop policy if exists "Sales can view queue" on public.odoo_retail_queue;
create policy "Retail handlers can view queue"
  on public.odoo_retail_queue for select
  to authenticated
  using (can_handle_retail_queue());

drop policy if exists "Sales can update queue items" on public.odoo_retail_queue;
create policy "Retail handlers can dismiss queue items"
  on public.odoo_retail_queue for update
  to authenticated
  using (can_handle_retail_queue() and status = 'pending')
  with check (can_handle_retail_queue());
