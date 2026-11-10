-- ==============================================================================
-- 20261015140000_handoffs_for_sor.sql
--
-- Issue #257 (SOR shows its Transmittals and Packing Lists, spec #251).
--
-- `handoffs_for_sor(p_opportunity_id)` returns the Transmittals and Packing
-- Lists that name one SOR, as summaries, for the SOR's section.
--
-- WHO GETS ROWS
-- Only callers who can read the SOR under the SOR read rule (sor_read: super
-- admin, deal team, or sor_always_sees). Anyone else gets empty lists.
--
-- WHAT COMES BACK
-- Transmittal: id, number, prepared_on, priority, state, na_count (lines whose
-- Warehouse or Technical rating is NA), can_open. Packing List: id, number,
-- state, box_count, odoo_delivery_ref, can_open. `can_open` is the record's own
-- read rule. Never remarks, files, evidence paths or contents.
--
-- SAFE TO RUN AT ANY TIME: one new function. Idempotent.
-- ==============================================================================

create or replace function public.handoffs_for_sor(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_sor public.sales_opportunities;
  v_transmittals jsonb := '[]'::jsonb;
  v_packing_lists jsonb := '[]'::jsonb;
begin
  select * into v_sor from public.sales_opportunities o where o.id = p_opportunity_id;
  -- coalesce: an SOR with an empty deal-team column makes sor_is_deal_team NULL,
  -- and `not NULL` would skip this refusal and leak the handoffs to a non-reader.
  if not found or not coalesce(
    public.is_super_admin()
    or public.sor_is_deal_team(v_sor, v_actor)
    or public.sor_always_sees(v_sor, v_actor),
    false
  ) then
    return jsonb_build_object('transmittals', v_transmittals, 'packing_lists', v_packing_lists);
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.prepared_on desc, t.number desc), '[]'::jsonb)
    into v_transmittals
    from (
      select tr.id,
             tr.number,
             tr.prepared_on,
             tr.priority,
             tr.state,
             (select count(*)::int
                from public.transmittal_lines l
               where l.transmittal_id = tr.id
                 and (l.wh_rating = 'na' or l.tech_rating = 'na')) as na_count,
             public.transmittal_can_read(tr.id) as can_open
        from public.transmittals tr
       where exists (
         select 1 from public.transmittal_lines l
          where l.transmittal_id = tr.id and l.opportunity_id = p_opportunity_id
       )
    ) t;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.number desc), '[]'::jsonb)
    into v_packing_lists
    from (
      select pl.id,
             pl.number,
             pl.state,
             (select count(*)::int from public.packing_list_boxes b where b.packing_list_id = pl.id) as box_count,
             pl.odoo_delivery_ref,
             public.packing_list_can_read(pl.id) as can_open
        from public.packing_lists pl
       where pl.opportunity_id = p_opportunity_id
    ) p;

  return jsonb_build_object('transmittals', v_transmittals, 'packing_lists', v_packing_lists);
end;
$$;

comment on function public.handoffs_for_sor(uuid) is
  '#257: the Transmittals and Packing Lists naming an SOR, as summaries (no remarks, files or evidence). Empty unless the caller can read the SOR.';

revoke all on function public.handoffs_for_sor(uuid) from public, anon;
grant execute on function public.handoffs_for_sor(uuid) to authenticated;
