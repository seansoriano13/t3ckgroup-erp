-- Issue #297 (part of #208, ADR 0021) — wiring the access model into the SOR
-- modal itself.
--
-- `sor_participant_record` (#295) returned only the handful of columns its
-- first caller needed. The modal's Now/Details/Items tabs need the rest of
-- the SOR's non-money fields to render for a Participant at all — status,
-- Sales Division, dates, Lead Source, Lost Reason, ITB, and which Sales Flow
-- it runs. Still no `expected_value`, `odoo_partner_id`, `contract_date` or
-- `metadata` — those stay out of reach for a Participant exactly as before,
-- not merely unread by this one caller.

create or replace function public.sor_participant_record(p_opportunity_id uuid)
returns table (
  id uuid,
  opportunity_no text,
  client_name text,
  contact_person text,
  project_title text,
  project_type text,
  sales_reference text,
  status text,
  lost_reason text,
  registration_date date,
  expected_award_date date,
  po_date date,
  lead_source text,
  lead_source_detail text,
  itb_number text,
  itb_exempt boolean,
  is_scratch boolean,
  sale_type_id uuid,
  flow_stage_id uuid,
  flow_snapshot_id uuid,
  registered_by uuid,
  deal_owner_id uuid,
  closing_sales_id uuid,
  support_sales_1_id uuid,
  support_sales_2_id uuid,
  sales_director_id uuid
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    o.id,
    o.opportunity_no,
    o.client_name,
    o.contact_person,
    o.project_title,
    o.project_type,
    o.sales_reference,
    o.status,
    o.lost_reason,
    o.registration_date,
    o.expected_award_date,
    o.po_date,
    o.lead_source,
    o.lead_source_detail,
    o.itb_number,
    o.itb_exempt,
    o.is_scratch,
    o.sale_type_id,
    o.flow_stage_id,
    o.flow_snapshot_id,
    o.registered_by,
    o.deal_owner_id,
    o.closing_sales_id,
    o.support_sales_1_id,
    o.support_sales_2_id,
    o.sales_director_id
  from public.sales_opportunities o
  where o.id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant')
$function$;

comment on function public.sor_participant_record(uuid) is
  'ADR 0021 / #295 & #297: the SOR projection with no expected_value column '
  'reachable, ever — not a UI hide, the money column is simply not selected '
  'here. Widened by #297 to carry every other field the SOR modal renders. '
  'Returns no rows below participant access.';

-- ===========================================================================
-- sor_can_view_journey: whether the caller may open the Journey tab.
--
-- A full-access caller (Deal Team or Always sees, per sor_access_level) can
-- always see Journey — unchanged from before #297. A Participant's access is
-- governed by the owning Sales Flow's `journey_viewers` selectors
-- (flow_access_settings, #292): matched the same way sor_always_sees matches
-- `always_sees`. `journey_viewers is null` means "Deal Team plus Always
-- sees" (#292's documented default) — both already resolve to 'full' access,
-- so a Participant (who is neither) sees no Journey until a flow's Access
-- tab names them explicitly. Locked and below never reach this: the modal's
-- locked view has no Journey tab to gate.
-- ===========================================================================

create or replace function public.sor_can_view_journey(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when public.sor_access_level(p_opportunity_id) = 'full' then true
    when public.sor_access_level(p_opportunity_id) != 'participant' then false
    else coalesce((
      select exists (
        select 1
        from public.sales_opportunities o
        join public.sales_flows f on f.sale_type_id = o.sale_type_id
        join public.flow_access_settings fas on fas.flow_id = f.id
        cross join lateral jsonb_array_elements(coalesce(fas.journey_viewers, '[]'::jsonb)) as selector
        where o.id = p_opportunity_id
          and fas.journey_viewers is not null
          and (
            (
              selector->>'type' = 'employee'
              and (selector->>'id')::uuid = public.get_employee_id()
            )
            or (
              selector->>'type' = 'group'
              and exists (
                select 1 from public.employee_group_member_ids((selector->>'id')::uuid) gm
                where gm = public.get_employee_id()
              )
            )
            or (
              selector->>'type' = 'team'
              and exists (
                select 1 from public.employees e
                where e.id = public.get_employee_id()
                  and upper(trim(e.sub_department)) = upper(trim(selector->>'team'))
              )
            )
            or (
              selector->>'type' = 'role'
              and (
                (selector->>'role' = 'deal_owner' and o.deal_owner_id = public.get_employee_id())
                or (selector->>'role' = 'closing_sales' and o.closing_sales_id = public.get_employee_id())
                or (selector->>'role' = 'sales_director' and o.sales_director_id = public.get_employee_id())
                or (selector->>'role' = 'registrar' and o.registered_by = public.get_employee_id())
                or (
                  selector->>'role' = 'support_sales'
                  and (o.support_sales_1_id = public.get_employee_id() or o.support_sales_2_id = public.get_employee_id())
                )
              )
            )
          )
      )
    ), false)
  end
$function$;

comment on function public.sor_can_view_journey(uuid) is
  'ADR 0021 / #297: whether the caller may open the SOR modal''s Journey tab. '
  'Always true at full access; at participant access, matched against the '
  'owning flow''s journey_viewers selectors (null selectors excludes a '
  'Participant, since null means Deal Team plus Always sees); false '
  'otherwise.';
