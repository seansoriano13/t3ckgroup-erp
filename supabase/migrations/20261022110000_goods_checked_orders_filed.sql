-- Goods checked and Orders filed, two Stage Conditions (#465, #466, spec #461, ADR 0033).
--
-- WHAT THIS ADDS
--   stage_conditions kinds  'goods_checked' and 'orders_filed' (no config). One migration for both:
--                           each rewrites the kind CHECK with the full list, so two migrations
--                           would have the later one drop the earlier one's kind. The list keeps
--                           every older kind (published Flow Snapshots and a snapshot restore
--                           re-insert them).
--   order_condition_inputs(opp)
--                           the gate's evidence for both kinds, counts only:
--                             unclosed_slips   submitted, uncancelled Transmittals with a line
--                                              naming the SOR that are not Closed yet (a slip
--                                              still in checking, releasing, technical
--                                              inspection or awaiting Check by). Drafts and
--                                              Cancelled slips don't count. One slip with lines
--                                              for two SORs counts for both.
--                             unfiled_orders   IPAS naming the SOR (ipas_sors) that are still
--                                              open: not filed and not cancelled.
--                           Goods checked is met at unclosed_slips = 0, Orders filed at
--                           unfiled_orders = 0; an SOR with none of either meets both.
--
-- ACCESS: anyone who can see the SOR at all (sor_access_level <> 'none'). The mover may not be
-- able to read Transmittals or IPAS, so the answer is read past RLS and holds counts only.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: drop-then-add constraint, create-or-replace function.

alter table public.stage_conditions drop constraint if exists stage_conditions_kind_chk;
alter table public.stage_conditions add constraint stage_conditions_kind_chk check (kind in ('attachment', 'field', 'tickbox', 'assignment', 'deadline', 'project_evaluation', 'inclusions', 'purchasing', 'purchasing_settled', 'costing_settled', 'costing_priced', 'goods_checked', 'orders_filed'));

-- Functions
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
          and i.state = 'open')
  );
end;
$$;

revoke all on function public.order_condition_inputs(uuid) from public, anon;
grant execute on function public.order_condition_inputs(uuid) to authenticated;
