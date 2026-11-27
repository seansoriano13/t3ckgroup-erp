-- ==============================================================================
-- 20261228162500_1258_compliance_kind_filed_guard.sql
--
-- Compliance kinds stay truthful on filed IPAS (#1258, spec #1247).
--
-- A Compliance Requirement holds its kind (DENR, MARINA, ...) by ipas_options id,
-- like a payment method or a charge kind. A filed IPAS is frozen, so a kind a
-- filed IPAS holds must keep its name: ipas_option_on_filed() now also looks at
-- ipas_compliance_requirements. That one function feeds both the rename guard
-- (ipas_options_filed_guard) and ipas_filed_option_ids() (what the settings
-- screen uses to disable Rename), so neither needs to change. Retiring (active)
-- and reordering (sort) stay allowed, as for every other list.
--
-- The grants of the function are kept by create or replace.
-- ==============================================================================

create or replace function public.ipas_option_on_filed(p_option_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from ipas i
     where i.state = 'filed'
       and (i.freight_service_id = p_option_id or i.item_location_id = p_option_id)
  ) or exists (
    select 1 from ipas_payments p join ipas i on i.id = p.ipas_id
     where i.state = 'filed' and p.method_id = p_option_id
  ) or exists (
    select 1 from ipas_charges c join ipas i on i.id = c.ipas_id
     where i.state = 'filed' and c.kind_id = p_option_id
  ) or exists (
    select 1 from ipas_documents d join ipas i on i.id = d.ipas_id
     where i.state = 'filed' and d.kind_id = p_option_id
  ) or exists (
    select 1 from ipas_compliance_requirements r join ipas i on i.id = r.ipas_id
     where i.state = 'filed' and r.kind_id = p_option_id
  );
$$;

comment on function public.ipas_option_on_filed(uuid) is
  '#241, #1258: true when any filed IPAS references the option (payment method, charge kind, document kind, freight service, item location or compliance kind).';
