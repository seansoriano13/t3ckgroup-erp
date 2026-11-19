-- Spec #1104 / ticket #1107: a purchaser must not see the bid panel's figures.
-- Cause: costing_tier gives 'closed_book' to anyone costing_is_open() covers, and that includes
-- has_purchasing_access() (20261102170000), so a purchaser with no part in the deal received the Bid Decision
-- (with its stamped Final Offer / ABC totals) and BidDecisionPanel drew them. Purchasing KEEPS the Closed Book on
-- the Costing sheet; only the Bid Decision is narrowed, to the Deal Team, the decider list and Super Admins.

create or replace function public.costing_sees_bid(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_super_admin(), false)
    or public.costing_on_list('final_acquire')
    or exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id and public.sor_is_deal_team(o, public.get_employee_id())
    )
$$;

revoke all on function public.costing_sees_bid(uuid) from public, anon;
grant execute on function public.costing_sees_bid(uuid) to authenticated;

drop policy if exists costing_bid_decisions_read on public.costing_bid_decisions;
create policy costing_bid_decisions_read on public.costing_bid_decisions
  for select to authenticated
  using (
    public.costing_tier(public.costing_matrix_opp(matrix_id)) = 'closed_book'
    and public.costing_sees_bid(public.costing_matrix_opp(matrix_id))
  );

-- costing_matrix_read (was: 20261107130000_703): no Bid Decision table unless costing_sees_bid; reports bid_visible.
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
  v_sees_bid boolean := public.costing_sees_bid(p_opportunity_id);
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
    -- #1107: the Bid Decision is not sent to a purchaser who is not the Deal Team, a decider or a Super Admin.
    if v_def.table_name = 'costing_bid_decisions' and not v_sees_bid then
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

  return jsonb_build_object('tier', v_tier, 'matrix_id', v_matrix, 'bands', to_jsonb(v_bands), 'bid_visible', v_sees_bid, 'tables', v_tables);
end;
$$;

-- costing_history (was: 20261018100000): no Bid Decision events unless costing_sees_bid.
create or replace function public.costing_history(
  p_opportunity_id uuid,
  p_table text default null,
  p_row uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier   text := public.costing_tier(p_opportunity_id);
  v_matrix uuid;
  v_result jsonb;
begin
  if v_tier is null then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return null;
  end if;

  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id), '[]'::jsonb) into v_result
  from (
    select e.id, e.created_at,
      jsonb_build_object(
        'id', e.id,
        'at', e.created_at,
        'actor_id', e.actor_id,
        'kind', e.kind,
        'detail', case
          when e.detail ? 'column' then e.detail
          else jsonb_build_object('table', e.detail -> 'table', 'row', e.detail -> 'row')
            || jsonb_build_object('values', public.costing_pick(
              e.detail -> 'values',
              (select coalesce(array_agg(c.column_name), '{}') from public.costing_column_tiers c
                where c.table_name = e.detail ->> 'table' and c.column_name <> '*' and v_tier = any (c.tiers))
            ))
        end
      ) as item
    from public.costing_events e
    where e.matrix_id = v_matrix
      and (p_table is null or e.detail ->> 'table' = p_table)
      and (p_row is null or e.detail ->> 'row' = p_row::text)
      and (e.detail ->> 'table' is distinct from 'costing_bid_decisions' or public.costing_sees_bid(p_opportunity_id))
      and (
        case
          when e.detail ? 'column' then exists (
            select 1 from public.costing_column_tiers c
            where c.table_name = e.detail ->> 'table' and c.column_name = e.detail ->> 'column' and v_tier = any (c.tiers)
          )
          else exists (
            select 1 from public.costing_column_tiers c
            where c.table_name = e.detail ->> 'table' and c.column_name <> '*' and v_tier = any (c.tiers)
          )
        end
      )
    order by e.created_at desc, e.id
    limit greatest(coalesce(p_limit, 100), 1)
  ) x;

  return v_result;
end;
$$;
