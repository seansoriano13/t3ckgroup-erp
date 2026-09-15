-- Issue #203, story 27 — converts every live, unarchived `field` condition
-- into a required Stage Field, then archives the condition. `field` is a
-- removed kind (the evaluator now reports it not_applicable regardless), so
-- without this conversion every SOR relying on one would silently stop being
-- gated the moment this ships. Draft and published flows both get converted
-- here; the next Publish carries a draft's change forward, and an SOR
-- pinned to an older Flow Snapshot keeps reading that snapshot's own
-- (unconverted, but now not_applicable) copy of the condition — same as any
-- other post-publish rule change.
--
-- `src/constants/stageFields.js` names the four SOR fields on offer:
-- expected_award_date, sales_reference, contact_person, client_name. A
-- `field` condition whose config.column matches one of those becomes an
-- `sor`-source field; anything else (a metadata key, or a column this list
-- doesn't offer) becomes a `custom` text field, keyed by the old column name
-- so the label at least says what it used to watch.

do $$
declare
  v_condition record;
  v_source text;
  v_sor_field text;
  v_next_sort integer;
begin
  for v_condition in
    select * from public.stage_conditions
    where kind = 'field' and archived_at is null
  loop
    if v_condition.config->>'column' in
      ('expected_award_date', 'sales_reference', 'contact_person', 'client_name')
    then
      v_source := 'sor';
      v_sor_field := v_condition.config->>'column';
    else
      v_source := 'custom';
      v_sor_field := null;
    end if;

    select coalesce(max(sort_order), -1) + 1 into v_next_sort
      from public.flow_stage_fields where stage_id = v_condition.stage_id;

    insert into public.flow_stage_fields
      (stage_id, label, source, sor_field, field_type, is_required, sort_order)
    values (
      v_condition.stage_id,
      v_condition.label,
      v_source,
      v_sor_field,
      case when v_sor_field = 'expected_award_date' then 'date' else 'text' end,
      true,
      v_next_sort
    );

    update public.stage_conditions
      set archived_at = now()
      where id = v_condition.id;
  end loop;
end $$;
