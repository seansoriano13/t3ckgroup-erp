-- #822 (spec #800, ADR 0050) — Close the back doors: the database refuses direct S0 writes.
--
-- After this, sales_opportunities.sales_reference changes only through set_sales_reference (and
-- recheck_sales_reference / the retail approval), which set app.sor_set_sales_reference = 'on'
-- for their own transaction. A signed-in browser client that inserts a row with an S0, or updates
-- the S0 to a different value, is refused. Writing the same value is fine (the Odoo line sync
-- re-sends it every time).
--
-- Who is let through without the flag:
--   * service_role (edge functions, test fixtures): trusted server code; the S0 save step itself
--     runs as service_role anyway.
--   * a direct database connection with no signed-in caller (auth.uid() is null): migrations,
--     seed and rehearsal scripts.
-- Retail SORs are a report, but approve_retail_queue_item still inserts them with the Odoo S0; it
-- sets the flag itself (below) rather than exempting is_retail rows, so a client cannot mint a
-- retail row with an S0 either.
--
-- Day one: existing deals past their first Stage with an S0 are already 'locked', and those with
-- no S0 are 'fill_once', both computed by sor_sales_reference_lock (#815). Nothing to migrate.
-- The old "Sales Reference required to leave Lead" trigger is untouched.

create or replace function public.sor_guard_sales_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_old text;
  v_new text := nullif(btrim(upper(coalesce(NEW.sales_reference, ''))), '');
begin
  if coalesce(current_setting('app.sor_set_sales_reference', true), '') = 'on' then
    return NEW;
  end if;
  if auth.role() = 'service_role' or auth.uid() is null then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if v_new is not null then
      raise exception 'The S0 is set from the S0 card, not when a row is written directly.'
        using errcode = '42501', hint = 'sales_reference_direct_write';
    end if;
    return NEW;
  end if;

  v_old := nullif(btrim(upper(coalesce(OLD.sales_reference, ''))), '');
  if v_new is distinct from v_old then
    raise exception 'The S0 can only be changed from the S0 card.'
      using errcode = '42501', hint = 'sales_reference_direct_write';
  end if;
  return NEW;
end;
$function$;

comment on function public.sor_guard_sales_reference() is
  '#822 (ADR 0050): refuses a direct INSERT with an S0 or UPDATE that changes it, unless set_sales_reference / recheck / retail approval set app.sor_set_sales_reference = on. service_role and direct database connections pass.';

drop trigger if exists trg_sales_opportunities_s0_guard on public.sales_opportunities;
create trigger trg_sales_opportunities_s0_guard
  before insert or update of sales_reference on public.sales_opportunities
  for each row execute function public.sor_guard_sales_reference();

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

  -- #822: the S0 guard lets this one insert through (Retail is a report; its S0 comes from Odoo's
  -- queue, not from a person).
  perform set_config('app.sor_set_sales_reference', 'on', true);

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
