-- Issue #206 — a Deleted view for the CRM, with restore and a guarded
-- permanent delete. Soft-delete today is a single boolean flag with no
-- audit trail; this adds who and when, and the one RPC that actually
-- destroys a row.

ALTER TABLE public.sales_opportunities ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.sales_opportunities ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.employees(id);

-- Existing deleted rows predate this column — left null rather than
-- backfilled with a guess, so the register can say "deleted before this was
-- recorded" instead of asserting a false actor or timestamp.

/**
 * Super Admin only, permanent. Refuses unless `p_confirm_text` matches the
 * SOR's Sales Reference, or its Company when there is no Sales Reference on
 * record — typing the record's own name is what stands between this and a
 * misclick, since nothing else about this call is undoable.
 *
 * Deleting the row lets its own foreign keys do the rest: `tasks` and
 * `committee_tasks` reference it ON DELETE SET NULL (a task is an
 * employee's logged work, kept but unlinked — destroying it with the deal
 * would reach into HR records), and every real child table (items, notes,
 * members, condition status, inclusions, procurement requests, project
 * evaluations, PO links) references it ON DELETE CASCADE. Returns a summary
 * of what was unlinked so the audit log can say more than "deleted".
 */
CREATE OR REPLACE FUNCTION public.sor_purge_opportunity(p_id uuid, p_confirm_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := public.get_employee_id();
  v_row record;
  v_task_count int;
  v_committee_task_count int;
  v_expect text;
begin
  if v_actor is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can permanently delete an SOR.' using errcode = '42501';
  end if;

  select * into v_row from public.sales_opportunities where id = p_id;
  if v_row is null then
    raise exception 'That SOR no longer exists.' using errcode = '22023';
  end if;

  v_expect := coalesce(v_row.sales_reference, v_row.client_name);
  if p_confirm_text is null or btrim(p_confirm_text) <> v_expect then
    raise exception 'Confirmation text does not match — type % to permanently delete this SOR.', v_expect
      using errcode = '22023';
  end if;

  select count(*) into v_task_count from public.tasks where opportunity_id = p_id;
  select count(*) into v_committee_task_count from public.committee_tasks where opportunity_id = p_id;

  delete from public.sales_opportunities where id = p_id;

  return jsonb_build_object(
    'id', p_id,
    'client_name', v_row.client_name,
    'sales_reference', v_row.sales_reference,
    'tasks_unlinked', v_task_count,
    'committee_tasks_unlinked', v_committee_task_count
  );
end $function$
;
