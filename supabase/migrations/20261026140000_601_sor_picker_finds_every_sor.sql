-- #601 (spec #595): the SOR picker finds every SOR and remembers the last ones.
--
-- 1. ipas_find_sors searches by SOR number (SOR-198, also typed "sor198" or
--    "198"), SO number (Sales Reference, plus the older opportunity_no) and
--    project name, case-insensitively, and no longer leaves out an SOR that has
--    no SO number yet. It also returns the SOR number. Still the locked SOR
--    summary of ADR 0021 (never the customer), and still open to the same
--    callers as before: Purchasing, and the Warehouse list for its Packing List
--    picker (20261015600000).
-- 2. ipas_recent_sors: up to 5 SORs most recently named on IPAS the caller
--    raised, newest first, as the same summary. Purchasing access only.
--
-- The return type of ipas_find_sors gains sor_code, so it is dropped and
-- created again.

drop function if exists public.ipas_find_sors(text[], text);

create function public.ipas_find_sors(p_refs text[] default null, p_search text default null)
returns table (
  opportunity_id uuid,
  sor_code text,
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
  -- "SOR-198", "sor 198" and "sor198" are the same thing to a person.
  v_squash text := nullif(regexp_replace(lower(coalesce(p_search, '')), '[\s-]', '', 'g'), '');
begin
  if public.get_employee_id() is null then
    raise exception 'ipas_find_sors: not signed in' using errcode = '42501';
  end if;
  if not (coalesce(public.has_purchasing_access(), false) or public.transmittal_on_list('transmittal_warehouse')) then
    raise exception 'ipas_find_sors: only Purchasing or the Warehouse list looks up SORs' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct upper(btrim(r))), '{}'::text[]) into v_refs
    from unnest(coalesce(p_refs, '{}'::text[])) r;

  return query
    select o.id, o.sor_code, o.sales_reference, o.project_title, fs.name
      from public.sales_opportunities o
      left join public.flow_stages fs on fs.id = o.flow_stage_id
     where not coalesce(o.is_deleted, false)
       and not coalesce(o.is_scratch, false)
       and (
         o.sales_reference = any (v_refs)
         or (
           v_term is not null
           and (
             position(v_term in lower(coalesce(o.sales_reference, ''))) > 0
             or position(v_term in lower(coalesce(o.opportunity_no, ''))) > 0
             or position(v_term in lower(coalesce(o.project_title, ''))) > 0
             or (
               v_squash is not null
               and position(v_squash in regexp_replace(lower(coalesce(o.sor_code, '')), '[\s-]', '', 'g')) > 0
             )
           )
         )
       )
     order by o.serial_no desc
     limit 25;
end;
$$;

comment on function public.ipas_find_sors(text[], text) is
  '#601 / ADR 0021: SORs a purchaser may attach to a Project IPAS, by exact Sales Reference (p_refs, for the suggestions) or a case-insensitive search over SOR number, SO number (Sales Reference and the older opportunity_no) and project name. SORs with no SO number are found. Returns the locked summary only (SOR number, SO number, project, current Stage name), never the customer; Purchasing, or the Warehouse list.';

revoke all on function public.ipas_find_sors(text[], text) from public, anon;
grant execute on function public.ipas_find_sors(text[], text) to authenticated;

create function public.ipas_recent_sors()
returns table (
  opportunity_id uuid,
  sor_code text,
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
  v_me uuid := public.get_employee_id();
begin
  if v_me is null then
    raise exception 'ipas_recent_sors: not signed in' using errcode = '42501';
  end if;
  if not coalesce(public.has_purchasing_access(), false) then
    raise exception 'ipas_recent_sors: only Purchasing picks an IPAS''s SORs' using errcode = '42501';
  end if;

  return query
    select o.id, o.sor_code, o.sales_reference, o.project_title, fs.name
      from (
        select s.opportunity_id as opp_id, max(s.created_at) as last_named
          from public.ipas_sors s
          join public.ipas i on i.id = s.ipas_id
         where i.created_by = v_me
         group by s.opportunity_id
      ) r
      join public.sales_opportunities o on o.id = r.opp_id
      left join public.flow_stages fs on fs.id = o.flow_stage_id
     where not coalesce(o.is_deleted, false)
       and not coalesce(o.is_scratch, false)
     order by r.last_named desc, o.serial_no desc
     limit 5;
end;
$$;

comment on function public.ipas_recent_sors() is
  '#601: up to 5 SORs most recently named on IPAS the caller raised, newest first, as the locked summary (SOR number, SO number, project, current Stage name; never the customer). Purchasing access only.';

revoke all on function public.ipas_recent_sors() from public, anon;
grant execute on function public.ipas_recent_sors() to authenticated;
