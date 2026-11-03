-- #836: Purchasing sees the full S0 Evaluation header (bug log item A3).
-- Returns the narrow SOR header fields needed by the Costing Desk header, breadcrumbs,
-- and Sales Incharge resolution, only for callers who have read access to the matrix (costing_tier).

create or replace function public.costing_matrix_header(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier text := public.costing_tier(p_opportunity_id);
  v_opp record;
begin
  if v_tier is null then
    return null;
  end if;
  select id, sor_code, client_name, project_title, sales_reference, deal_owner_id
    into v_opp
    from public.sales_opportunities
   where id = p_opportunity_id;
  if v_opp.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_opp.id,
    'sor_code', v_opp.sor_code,
    'client_name', v_opp.client_name,
    'project_title', v_opp.project_title,
    'sales_reference', v_opp.sales_reference,
    'deal_owner_id', v_opp.deal_owner_id
  );
end;
$$;

revoke all on function public.costing_matrix_header(uuid) from public, anon;
grant execute on function public.costing_matrix_header(uuid) to authenticated;
