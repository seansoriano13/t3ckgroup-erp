-- Loosened access until the project-based gates are specified (#costing-open).
-- The Final Acquire list no longer gates the Closed Book, the Management band or the markup
-- columns. Those open to the Deal Team on the SOR (the Sales band, which includes the Sales
-- Director) and to Purchasing. Technical keeps its own limits. Super Admins keep everything.
-- Finance keeps its own access and no longer needs the list.

-- The people who see and edit the money side of one SOR's matrix.
create or replace function public.costing_is_open(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_super_admin(), false)
    or public.has_purchasing_access()
    or exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id and public.sor_is_deal_team(o, public.get_employee_id())
    )
$$;

revoke all on function public.costing_is_open(uuid) from public, anon;
grant execute on function public.costing_is_open(uuid) to authenticated;

-- The caller's read tier on an SOR. Closed Book now goes to the same people as the money columns.
create or replace function public.costing_tier(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.sales_opportunities o where o.id = p_opportunity_id) then null
    when public.costing_is_open(p_opportunity_id) then 'closed_book'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    ) then 'price'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    when public.costing_on_list('evaluation')
      and exists (select 1 from public.costing_matrices m where m.opportunity_id = p_opportunity_id)
    then 'participant'
    else null
  end
$$;

-- Who may write each band. The Management band is now the same people as costing_is_open.
create or replace function public.costing_in_band(p_opportunity_id uuid, p_band text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_band
    when 'sales' then
      coalesce(public.is_super_admin(), false)
      or exists (
        select 1 from public.sales_opportunities o
        where o.id = p_opportunity_id and public.sor_is_deal_team(o, public.get_employee_id())
      )
    when 'purchasing' then coalesce(public.is_super_admin(), false) or public.has_purchasing_access()
    when 'management' then public.costing_is_open(p_opportunity_id)
    when 'technical' then coalesce(public.is_super_admin(), false) or public.costing_is_technical(p_opportunity_id)
    when 'finance' then public.has_finance_access()
    when 'super_admin_only' then coalesce(public.is_super_admin(), false)
    else false
  end
$$;

-- The unit and factor columns that the Final Acquire list used to write.
update public.costing_column_bands
   set bands = '{sales,purchasing}'
 where (table_name, column_name) in (
   ('costing_component_costs', 'final_acquire_unit'),
   ('costing_component_costs', 'markup_factor'),
   ('costing_cost_rows', 'final_acquire_unit'),
   ('costing_cost_rows', 'markup_factor'),
   ('costing_matrix_money', 'default_factor'),
   ('costing_matrix_money', 'default_preset_id')
 );

update public.costing_column_bands
   set bands = '{finance,sales,purchasing}'
 where (table_name, column_name) in (
   ('costing_matrix_money', 'marketing'),
   ('costing_matrix_money', 'opex')
 );

-- The list-level gates (the Costing Matrix page, the markup presets, the bid decision, the
-- print sign-offs and the Final Acquire sign-off) read the Final Acquire list through
-- costing_on_list. Until those are specified per SOR, anyone who is Super Admin, in Purchasing
-- or on the Deal Team of any SOR counts as on that list too.
create or replace function public.costing_is_open_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_super_admin(), false)
    or public.has_purchasing_access()
    or exists (
      select 1 from public.sales_opportunities o
      where public.sor_is_deal_team(o, public.get_employee_id())
    )
$$;

revoke all on function public.costing_is_open_anywhere() from public, anon;
grant execute on function public.costing_is_open_anywhere() to authenticated;

create or replace function public.costing_on_list(p_list_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.costing_signer_lists l
    join public.employees e on e.id = l.employee_id
    where l.list_key = p_list_key
      and l.employee_id = public.get_employee_id()
      and not coalesce(e.is_deleted, false)
  )
  or (p_list_key = 'final_acquire' and public.costing_is_open_anywhere())
$$;
