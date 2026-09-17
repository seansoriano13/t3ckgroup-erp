-- Issue #293 (part of #208, ADR 0021) — Deal Team cutover on SOR reads.
--
-- Replaces the all-or-nothing `sales_opportunities` SELECT policy (registrar,
-- Deal Owner, Support Sales 1/2, Sales Director, every head, every HR
-- employee, Super Admins) with the Deal Team plus Always sees model ADR 0021
-- decided and #292 gave a settings shape to.
--
-- `sor_is_deal_team` takes the row itself rather than an opportunity id: like
-- the inlined predicate it replaces (20260908101315), `sales_opportunities`'
-- own read policy cannot call a helper that re-queries `sales_opportunities`,
-- because Postgres checks a table's SELECT policy against an INSERT's
-- RETURNING output using the statement's own snapshot, which does not yet see
-- a row that same statement just inserted. Passing the row avoids the
-- re-query entirely, so this one is safe to reuse anywhere the row is already
-- in hand.
--
-- `sor_always_sees` resolves the owning Sales Flow's `always_sees` selectors
-- (`src/utils/resolvePeople.js`) against the caller. It is SECURITY DEFINER so
-- a caller who cannot otherwise read `employees`/`employee_group_members`
-- still gets a correct answer — the same reasoning `employee_group_member_ids`
-- already documents.
--
-- Stage Participants and Restricted Stages are later tickets (#294-#297), so
-- for now the Deal Team sees every Stage Visit without exception, and Heads
-- and HR lose automatic access unless a Sales Flow names them in Always sees.
-- Everything else about `sales_opportunities` — insert, update, delete — is
-- untouched; #293 is a read-only cutover.

create or replace function public.sor_is_deal_team(p_opp public.sales_opportunities, p_employee_id uuid)
returns boolean
language sql
stable
as $function$
  select
    p_opp.registered_by = p_employee_id
    or p_opp.deal_owner_id = p_employee_id
    or p_opp.closing_sales_id = p_employee_id
    or p_opp.support_sales_1_id = p_employee_id
    or p_opp.support_sales_2_id = p_employee_id
    or p_opp.sales_director_id = p_employee_id
$function$;

create or replace function public.sor_always_sees(p_opp public.sales_opportunities, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.sales_flows f
    join public.flow_access_settings fas on fas.flow_id = f.id
    cross join lateral jsonb_array_elements(coalesce(fas.always_sees, '[]'::jsonb)) as selector
    where f.sale_type_id = p_opp.sale_type_id
      and (
        (
          selector->>'type' = 'employee'
          and (selector->>'id')::uuid = p_employee_id
        )
        or (
          selector->>'type' = 'group'
          and exists (
            select 1 from public.employee_group_member_ids((selector->>'id')::uuid) gm
            where gm = p_employee_id
          )
        )
        or (
          selector->>'type' = 'team'
          and exists (
            select 1 from public.employees e
            where e.id = p_employee_id
              and upper(trim(e.sub_department)) = upper(trim(selector->>'team'))
          )
        )
        or (
          selector->>'type' = 'role'
          and (
            (selector->>'role' = 'deal_owner' and p_opp.deal_owner_id = p_employee_id)
            or (selector->>'role' = 'closing_sales' and p_opp.closing_sales_id = p_employee_id)
            or (selector->>'role' = 'sales_director' and p_opp.sales_director_id = p_employee_id)
            or (selector->>'role' = 'registrar' and p_opp.registered_by = p_employee_id)
            or (
              selector->>'role' = 'support_sales'
              and (p_opp.support_sales_1_id = p_employee_id or p_opp.support_sales_2_id = p_employee_id)
            )
          )
        )
      )
  )
$function$;

drop policy if exists "sor_read" on public."sales_opportunities";
create policy "sor_read" on public."sales_opportunities"
  as permissive
  for select
  to authenticated
  using (
    public.is_super_admin()
    or public.sor_is_deal_team(sales_opportunities, public.get_employee_id())
    or public.sor_always_sees(sales_opportunities, public.get_employee_id())
  );
