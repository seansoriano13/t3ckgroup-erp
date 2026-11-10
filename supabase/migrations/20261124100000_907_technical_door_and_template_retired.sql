-- The Evaluation list gets a door; the evaluation task template is retired (spec #907, decision 10).
--
-- WHY: a person on the Evaluation list can read any S0 Evaluation in the database (costing_tier gives them the
-- participant tier), but the app had no page that listed the evaluations waiting for them: the Technical page showed
-- only the SORs where the caller is the in-charge. And "Technical" could still be reached a second way, through a
-- group task made from the Evaluation of Specification template, which the in-charge model (#908) made redundant.
--
-- WHAT THIS CHANGES
--   * costing_technical_list() serves every SOR that has a Technical in-charge to someone on the Evaluation list,
--     as it already does to a Super Admin. is_mine still marks only the caller's own SORs as theirs. The rows carry
--     SOR names and counts, no money, as before.
--   * costing_is_technical() is the in-charge of this SOR or Purchasing access. Membership of a group task from the
--     evaluation template no longer makes anyone Technical.
--   * costing_evaluation_settings (the one row naming that template) is dropped. Nothing else reads it.
--
-- UNCHANGED: who may approve (the Evaluation list, never the SOR's in-charge: #911), the participant-tier read of the
-- Evaluation list, and every grant on the two functions.
--
-- SAFE TO RUN AT ANY TIME: create or replace of the same signatures, and drop if exists. Idempotent.

-- ---------------------------------------------------------------------------
-- The Technical list: the Evaluation list sees what waits for it
-- ---------------------------------------------------------------------------

create or replace function public.costing_technical_list()
returns table (
  opportunity_id uuid,
  sor_code text,
  sales_reference text,
  project_title text,
  client_name text,
  stage text,
  team text,
  rows_total integer,
  rows_judged integer,
  approved boolean,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.get_employee_id();
  -- A Super Admin reads every in-charge's SOR; so does someone on the Evaluation list, who approves them.
  v_all boolean := coalesce(public.is_super_admin(), false) or public.costing_on_list('evaluation');
begin
  if v_me is null then
    raise exception 'costing_technical_list: not signed in' using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.sor_code,
    o.sales_reference,
    o.project_title,
    o.client_name,
    fs.name,
    'Technical'::text,
    (select count(*)::integer from public.costing_tender_lines l where l.matrix_id = m.id),
    case when m.compliance is null then 0
         else (select count(*)::integer from public.costing_tender_lines l where l.matrix_id = m.id)
    end,
    exists (
      select 1 from public.costing_signoffs s
      where s.matrix_id = m.id and s.role = 'evaluation_approved' and s.cleared_at is null
    ),
    m.technical_incharge_id = v_me
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  where m.technical_incharge_id is not null
    and not coalesce(o.is_deleted, false)
    and not coalesce(o.is_scratch, false)
    and (v_all or m.technical_incharge_id = v_me)
  order by o.serial_no desc;
end;
$$;

revoke all on function public.costing_technical_list() from public, anon;
grant execute on function public.costing_technical_list() to authenticated;

-- ---------------------------------------------------------------------------
-- Technical: the in-charge or Purchasing, no longer a task from a template
-- ---------------------------------------------------------------------------

create or replace function public.costing_is_technical(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_purchasing_access()
    or exists (
      select 1 from public.costing_matrices m
      where m.opportunity_id = p_opportunity_id
        and m.technical_incharge_id = public.get_employee_id()
    )
$$;

-- ---------------------------------------------------------------------------
-- The template setting goes with the check that read it
-- ---------------------------------------------------------------------------

drop table if exists public.costing_evaluation_settings;
