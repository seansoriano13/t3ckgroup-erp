-- #381's move-only guard compares the whole row minus the columns a move may
-- change. 20260930270000_sor_code added `sor_code`, a stored generated
-- column, and a BEFORE trigger sees a generated column as NULL in NEW (it is
-- computed after BEFORE triggers run), so every move by a caller with full
-- access but no edit right read as an edit and was refused. `sor_code` is
-- never written by anyone, so leaving it out of the comparison loses nothing.

create or replace function public.sor_guard_non_editor_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.role() = 'service_role' or auth.uid() is null then
    return NEW;
  end if;

  if public.sor_can_edit_opportunity(OLD.id) then
    return NEW;
  end if;

  if (to_jsonb(NEW) - 'flow_stage_id' - 'contract_date' - 'updated_at' - 'sor_code')
     is distinct from (to_jsonb(OLD) - 'flow_stage_id' - 'contract_date' - 'updated_at' - 'sor_code') then
    raise exception 'You can move this SOR, but not edit it.' using errcode = '42501';
  end if;

  return NEW;
end;
$function$;

comment on function public.sor_guard_non_editor_update() is
  '#381: a caller with full access but no edit right may move the Stage and nothing else. Generated columns (sor_code) are ignored: NULL in NEW before the row is stored.';
