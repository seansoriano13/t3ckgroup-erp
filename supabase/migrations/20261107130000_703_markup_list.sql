-- #703: the multiplier is written by the Markup list, not by everyone who touches the sheet.
--   * A 'markup' signer list, seeded with call signs 101 and 201 (a database without them seeds nothing).
--   * A 'markup' write band: the Markup list (and Super Admins). It replaces the temporary loosening of
--     20261102180000 on the multiplier columns (row override, matrix default, its preset).
--   * costing_matrix_read tells the screen whether the caller is in the 'markup' band.
-- Final Acquire data stays; only its screens go.

alter table public.costing_signer_lists drop constraint if exists costing_signer_lists_key_chk;
alter table public.costing_signer_lists add constraint costing_signer_lists_key_chk
  check (list_key in ('final_acquire', 'evaluation', 'team_rrd', 'team_ioe', 'markup'));

alter table public.costing_column_bands drop constraint if exists costing_column_bands_bands_chk;
alter table public.costing_column_bands add constraint costing_column_bands_bands_chk check (
  bands <@ array['sales', 'purchasing', 'management', 'technical', 'finance', 'super_admin_only', 'markup']::text[]
);

insert into public.costing_signer_lists (list_key, employee_id)
select 'markup', e.id
  from public.employees e
 where e.call_sign in ('101', '201') and not coalesce(e.is_deleted, false)
on conflict (list_key, employee_id) do nothing;

update public.costing_column_bands
   set bands = '{markup}'
 where (table_name, column_name) in (
   ('costing_component_costs', 'markup_factor'),
   ('costing_cost_rows', 'markup_factor'),
   ('costing_matrix_money', 'default_factor'),
   ('costing_matrix_money', 'default_preset_id')
 );

-- costing_in_band (latest: 20261102180000): adds 'markup'.
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
    when 'management' then public.costing_on_list('final_acquire')
    when 'technical' then coalesce(public.is_super_admin(), false) or public.costing_is_technical(p_opportunity_id)
    when 'finance' then public.has_finance_access() or public.costing_on_list('final_acquire')
    when 'super_admin_only' then coalesce(public.is_super_admin(), false)
    when 'markup' then coalesce(public.is_super_admin(), false) or public.costing_on_list('markup')
    else false
  end
$$;

-- costing_matrix_read (latest: 20261018100000): reports the 'markup' band too.
create or replace function public.costing_matrix_read(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier   text := public.costing_tier(p_opportunity_id);
  v_matrix uuid;
  v_def    public.costing_tables;
  v_cols   text[];
  v_virtual text;
  v_rows   jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_bands  text[];
begin
  if v_tier is null then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return null;
  end if;

  for v_def in select * from public.costing_tables order by table_name loop
    select coalesce(array_agg(c.column_name), '{}') into v_cols
    from public.costing_column_tiers c
    where c.table_name = v_def.table_name and c.column_name <> '*' and v_tier = any (c.tiers);
    if cardinality(v_cols) = 0 then
      continue;
    end if;

    -- Computed columns, only those this tier may read.
    select coalesce(string_agg(format('%L, %s', vc.column_name, vc.expression), ', '), '') into v_virtual
    from public.costing_virtual_columns vc
    where vc.table_name = v_def.table_name and vc.column_name = any (v_cols);

    execute format(
      'select coalesce(jsonb_agg(public.costing_pick(to_jsonb(t) %s, $2) order by %s), ''[]''::jsonb) from public.%I t where %s',
      case when v_virtual = '' then '' else '|| jsonb_build_object(' || v_virtual || ')' end,
      v_def.order_by,
      v_def.table_name,
      public.costing_matrix_filter(v_def.table_name)
    ) into v_rows using v_matrix, v_cols;

    v_tables := v_tables || jsonb_build_object(v_def.table_name, v_rows);
  end loop;

  -- The write bands the caller is in, so the screen can show a cell read-only.
  select coalesce(array_agg(b), '{}') into v_bands
    from unnest(array['sales', 'purchasing', 'management', 'technical', 'finance', 'super_admin_only', 'markup']) b
   where public.costing_in_band(p_opportunity_id, b);

  return jsonb_build_object('tier', v_tier, 'matrix_id', v_matrix, 'bands', to_jsonb(v_bands), 'tables', v_tables);
end;
$$;
