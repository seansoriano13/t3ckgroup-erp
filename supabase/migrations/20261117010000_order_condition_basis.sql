-- Goods checked and Orders filed show their basis (follow-up to #465, #466).
--
-- WHAT THIS CHANGES
--   order_condition_inputs(opp) keeps its two counts and adds the records they are counted from,
--   so the Stage Checklist can name them and the condition is never ticked without a basis:
--     slips    every submitted, uncancelled Transmittal with a line naming the SOR (Drafts and
--              Cancelled slips left out), as { number, state }, oldest first.
--     orders   every uncancelled IPAS naming the SOR, as { number, state }, oldest first.
--   The front end now holds Goods checked unmet while `slips` is empty and Orders filed unmet while
--   `orders` is empty, the way the costing kinds wait for an S0 Evaluation.
--
-- ACCESS: unchanged. Anyone who can see the SOR at all may ask; the answer is read past RLS and
-- holds each record's number and state only, nothing else of the Transmittal or IPAS.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: create-or-replace function.

create or replace function public.order_condition_inputs(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.get_employee_id() is null then
    raise exception 'order_condition_inputs: sign in first' using errcode = '42501';
  end if;
  if public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'order_condition_inputs: you can''t see this SOR' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'unclosed_slips',
      (select count(distinct t.id)
         from public.transmittals t
         join public.transmittal_lines l on l.transmittal_id = t.id
        where l.opportunity_id = p_opportunity_id
          and t.state in ('warehouse_checking', 'warehouse_releasing', 'technical_inspection', 'awaiting_check')),
    'unfiled_orders',
      (select count(distinct i.id)
         from public.ipas i
         join public.ipas_sors s on s.ipas_id = i.id
        where s.opportunity_id = p_opportunity_id
          and i.state = 'open'),
    'slips',
      coalesce((select jsonb_agg(jsonb_build_object('number', t.number, 'state', t.state) order by t.submitted_at, t.number)
                  from public.transmittals t
                 where t.state not in ('draft', 'cancelled')
                   and exists (select 1 from public.transmittal_lines l
                                where l.transmittal_id = t.id and l.opportunity_id = p_opportunity_id)), '[]'::jsonb),
    'orders',
      coalesce((select jsonb_agg(jsonb_build_object('number', i.number, 'state', i.state) order by i.created_at, i.number)
                  from public.ipas i
                 where i.state <> 'cancelled'
                   and exists (select 1 from public.ipas_sors s
                                where s.ipas_id = i.id and s.opportunity_id = p_opportunity_id)), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.order_condition_inputs(uuid) from public, anon;
grant execute on function public.order_condition_inputs(uuid) to authenticated;
