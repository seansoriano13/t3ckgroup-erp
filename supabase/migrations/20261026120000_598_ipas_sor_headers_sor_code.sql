-- #598 (spec #595): the IPAS list finds an IPAS by its SORs' SOR number
-- (SOR-198) as well as the SO number and project name.
--
-- ipas_sor_headers already gives the SO number (sales_reference), project and
-- Stage of each of an IPAS's SORs, for anyone who can read IPAS (who may not be
-- able to read the SOR itself). It now also gives the SOR number (sor_code),
-- which every SOR has, so the list can show "SOR-198 · Project" for an SOR with
-- no SO number yet and search by it. Same rule as before: a null or empty id
-- list, or no IPAS access, returns no rows; never the customer.
--
-- A return-type change needs a drop first; the grants are given again.

drop function if exists public.ipas_sor_headers(uuid[]);

create function public.ipas_sor_headers(p_ipas_ids uuid[] default null)
returns table (
  ipas_id uuid,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  current_stage_name text,
  sor_code text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_sor_headers: not signed in' using errcode = '42501';
  end if;
  if not public.ipas_can_read() then
    return;
  end if;
  -- Ask for the IPAS you mean: no ids, no rows.
  if p_ipas_ids is null or cardinality(p_ipas_ids) = 0 then
    return;
  end if;

  return query
    select s.ipas_id, s.opportunity_id, o.sales_reference, o.project_title, fs.name, o.sor_code
      from public.ipas_sors s
      join public.sales_opportunities o on o.id = s.opportunity_id
      left join public.flow_stages fs on fs.id = o.flow_stage_id
     where s.ipas_id = any (p_ipas_ids)
     order by o.sales_reference nulls last, o.sor_code;
end;
$$;

comment on function public.ipas_sor_headers(uuid[]) is
  '#241 / ADR 0021 / #598: the SORs each named IPAS has, as the locked summary (SO number, SOR number, project, current Stage name; never the customer), for anyone who can read IPAS (who may not be able to read the SOR itself). A null or empty id list, or no IPAS access, returns no rows.';

revoke all on function public.ipas_sor_headers(uuid[]) from public, anon;
grant execute on function public.ipas_sor_headers(uuid[]) to authenticated;
