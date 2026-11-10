-- #241: the IPAS SOR lookups return only what ADR 0021's locked SOR summary
-- allows: Sales Reference, project and current Stage name. Customer name is
-- gone from both, and the search no longer matches it.
--
-- The return types change, so each function is dropped and created again.
-- Field names follow sor_locked_summary (sales_reference, project_title,
-- current_stage_name).

drop function if exists public.ipas_find_sors(text[], text);
drop function if exists public.ipas_sor_headers(uuid[]);

create function public.ipas_find_sors(p_refs text[] default null, p_search text default null)
returns table (
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  current_stage_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_refs text[];
  v_term text := lower(nullif(btrim(p_search), ''));
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_find_sors: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'ipas_find_sors: only Purchasing picks an IPAS''s SORs' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct upper(btrim(r))), '{}'::text[]) into v_refs
    from unnest(coalesce(p_refs, '{}'::text[])) r;

  return query
    select o.id, o.sales_reference, o.project_title, fs.name
      from public.sales_opportunities o
      left join public.flow_stages fs on fs.id = o.flow_stage_id
     where not coalesce(o.is_deleted, false)
       and not coalesce(o.is_scratch, false)
       and o.sales_reference is not null
       and (
         o.sales_reference = any (v_refs)
         or (
           v_term is not null
           and (
             position(v_term in lower(o.sales_reference)) > 0
             or position(v_term in lower(o.project_title)) > 0
           )
         )
       )
     order by o.sales_reference desc
     limit 25;
end;
$$;

comment on function public.ipas_find_sors(text[], text) is
  '#241 / ADR 0021: SORs a purchaser may attach to a Project IPAS, by exact Sales Reference (p_refs, for the suggestions) or a search over reference and project. Returns the locked summary only (reference, project, current Stage name), never the customer; Purchasing access only.';

revoke all on function public.ipas_find_sors(text[], text) from public, anon;
grant execute on function public.ipas_find_sors(text[], text) to authenticated;

create function public.ipas_sor_headers(p_ipas_ids uuid[] default null)
returns table (
  ipas_id uuid,
  opportunity_id uuid,
  sales_reference text,
  project_title text,
  current_stage_name text
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
    select s.ipas_id, s.opportunity_id, o.sales_reference, o.project_title, fs.name
      from public.ipas_sors s
      join public.sales_opportunities o on o.id = s.opportunity_id
      left join public.flow_stages fs on fs.id = o.flow_stage_id
     where s.ipas_id = any (p_ipas_ids)
     order by o.sales_reference;
end;
$$;

comment on function public.ipas_sor_headers(uuid[]) is
  '#241 / ADR 0021: the SORs each named IPAS has, as the locked summary (reference, project, current Stage name; never the customer), for anyone who can read IPAS (who may not be able to read the SOR itself). A null or empty id list, or no IPAS access, returns no rows.';

revoke all on function public.ipas_sor_headers(uuid[]) from public, anon;
grant execute on function public.ipas_sor_headers(uuid[]) to authenticated;
