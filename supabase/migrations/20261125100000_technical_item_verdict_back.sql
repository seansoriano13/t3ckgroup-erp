-- Per-item Complies / Deviates and a remark per product are back, written by the Technical in-charge.
--
-- WHY: #908 made the Technical verdict one answer for the whole S0 Evaluation and froze each Component's own
-- verdict as read-only history. The Technical side wants the per-product verdict and remark back, next to the
-- offer-level one (which stays, and still gates "Evaluation approved").
--
-- WHAT THIS CHANGES
--   * costing_components.compliance, compliance_note and recommended_alternative are the Technical band's again
--     (costing_column_bands), and costing_component_verdict_guard now lets exactly one person write them: the
--     Technical in-charge named on the Component's matrix. Not Purchasing access, not a Super Admin, not the Deal
--     Team. A change of verdict or note stamps complied_by with the writer.
--   * The remark is compliance_note and may be kept under either verdict; a deviation still needs one
--     (costing_components_deviation_note_chk, unchanged).
--
-- UNCHANGED: the offer-level verdict, who approves, the trigger that clears "Evaluation approved" when a verdict or
-- note changes (costing_clear_evaluation_components), and every old per-Component verdict already stored.
--
-- SAFE TO RUN AT ANY TIME: create or replace of the same function, and an upsert of the registry rows. Idempotent.

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_components', 'compliance', '{technical}'),
  ('costing_components', 'compliance_note', '{technical}'),
  ('costing_components', 'recommended_alternative', '{technical}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

create or replace function public.costing_component_verdict_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_incharge uuid;
begin
  if (new.compliance is not distinct from old.compliance)
     and (new.compliance_note is not distinct from old.compliance_note)
     and (new.recommended_alternative is not distinct from old.recommended_alternative) then
    return new;
  end if;
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or coalesce(current_setting('costing.bypass', true), '') = 'on' then
    return new;
  end if;

  select m.technical_incharge_id
    into v_incharge
    from public.costing_tender_lines l
    join public.costing_matrices m on m.id = l.matrix_id
   where l.id = new.tender_line_id;

  if v_incharge is null then
    raise exception 'costing_technical: name the Technical in-charge first' using errcode = '42501';
  end if;
  if v_actor is distinct from v_incharge then
    raise exception 'costing_technical: only the Technical in-charge can give a Component''s verdict' using errcode = '42501';
  end if;
  if new.compliance is distinct from old.compliance or new.compliance_note is distinct from old.compliance_note then
    new.complied_by := v_actor;
  end if;
  return new;
end;
$$;

revoke all on function public.costing_component_verdict_guard() from public, anon, authenticated;
