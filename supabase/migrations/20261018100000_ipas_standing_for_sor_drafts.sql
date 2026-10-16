-- ==============================================================================
-- #265 review fix: a draft Transmittal counts as "raised"
--
-- `ipas_standing_for_sor` (20261017220000) left drafts out, so an order whose
-- only Transmittal was still a draft read "Delivered — no Transmittal raised" on
-- the SOR, while the Order Monitoring page (which now knows about drafts) did
-- not. The slips it returns now include drafts (state 'draft'); the service
-- drops them from the slips it checks and only uses them to know a Transmittal
-- has been started. A draft carries no stages or ratings. Same signature and
-- same columns, so nothing else changes. Cancelled Transmittals stay out.
--
-- SAFE TO RUN AT ANY TIME: redefines one function with the same signature.
-- ==============================================================================

create or replace function public.ipas_standing_for_sor(p_opportunity_id uuid)
returns table (
  ipas_id uuid,
  source text,
  created_at timestamptz,
  updated_at timestamptz,
  costs_completed_at timestamptz,
  proof_paid_on date,
  shipped_out_on date,
  onboard_on date,
  arrived_in_ph_on date,
  arrived_in_whs_on date,
  import_clearance_on date,
  delivered_on date,
  actual_checking_stamped boolean,
  actual_checking_at timestamptz,
  slips jsonb
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    i.id,
    i.source,
    i.created_at,
    i.updated_at,
    (
      select max(e.created_at)
        from public.ipas_events e
       where e.ipas_id = i.id
         and e.kind = 'header_changed'
         and e.detail #>> '{fields,computation_status,to}' in ('lc_odoo_done', 'checked')
    ),
    (
      select max(p.paid_on)
        from public.ipas_payments p
       where p.ipas_id = i.id and coalesce(p.proof_url, '') <> ''
    ),
    i.shipped_out_on,
    i.onboard_on,
    i.arrived_in_ph_on,
    i.arrived_in_whs_on,
    i.import_clearance_on,
    i.delivered_on,
    i.actual_checking_by is not null,
    i.actual_checking_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'number', t.number,
          'prepared_on', t.prepared_on,
          'created_at', t.created_at,
          'submitted_at', t.submitted_at,
          'state', t.state,
          'check_warehouse', t.check_warehouse,
          'check_technical', t.check_technical,
          'stages', coalesce((
            select jsonb_agg(jsonb_build_object('stage', st.stage, 'completed_at', st.completed_at))
              from public.transmittal_stages st
             where st.transmittal_id = t.id
          ), '[]'::jsonb),
          'lines', coalesce((
            select jsonb_agg(jsonb_build_object(
              'ipas_id', l.ipas_id,
              'odoo_po_line_id', l.odoo_po_line_id,
              'wh_rating', l.wh_rating,
              'tech_rating', l.tech_rating
            ))
              from public.transmittal_lines l
             where l.transmittal_id = t.id and l.ipas_id = i.id
          ), '[]'::jsonb)
        )
        order by t.prepared_on, t.created_at, t.number
      )
        from public.transmittals t
       where t.state <> 'cancelled'
         and exists (
           select 1 from public.transmittal_lines l
            where l.transmittal_id = t.id and l.ipas_id = i.id
         )
    ), '[]'::jsonb)
  from public.ipas i
  where (select public.sor_access_level(p_opportunity_id)) = 'full'
    and i.purpose = 'project'
    and exists (
      select 1 from public.ipas_sors s
      where s.ipas_id = i.id and s.opportunity_id = p_opportunity_id
    )
  order by i.number;
$function$;

comment on function public.ipas_standing_for_sor(uuid) is
  '#265: the dates and Transmittal facts the SOR''s IPAS section needs to say where each order stands (next thing, owner, days waiting, late), for anyone who can read the SOR (sor_access_level = full). Never money or bank columns. No SOR access -> no rows. Uncancelled Transmittals, drafts included (a draft only tells the service one has been raised).';

revoke all on function public.ipas_standing_for_sor(uuid) from public, anon;
grant execute on function public.ipas_standing_for_sor(uuid) to authenticated;
