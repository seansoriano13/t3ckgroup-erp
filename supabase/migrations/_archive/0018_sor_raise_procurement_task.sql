-- ==============================================================================
-- 0018_sor_raise_procurement_task.sql
--
-- Lets a salesperson open the purchasing task that carries their procurement
-- request, without widening who may insert into `tasks` generally.
--
-- ── The failure this fixes ──────────────────────────────────────────────────
--   new row violates row-level security policy for table "tasks"
--
-- A requisition task is deliberately owned by somebody else: `logged_by` is the
-- purchasing employee who will do the work, while the person clicking Send is
-- in sales. Whatever INSERT policy `tasks` carries does not allow that, so the
-- request died at the first write.
--
-- ── Why a function rather than a new policy ─────────────────────────────────
-- `tasks` has RLS enabled but NO policy defined anywhere in this repo — it was
-- created through the dashboard. Dropping and recreating a policy that cannot
-- be read first would be guessing at the access rules of the app's core table,
-- and a wrong guess silently breaks task logging for everyone. Adding a second
-- permissive policy has the opposite problem: to be permissive enough to cover
-- this case it would have to allow inserting a task for an arbitrary employee,
-- since nothing on the row marks it as a requisition at insert time.
--
-- A SECURITY DEFINER function sidesteps both. It touches no existing policy,
-- and it can only ever create this one shape of task. The gate is
-- sor_can_edit_opportunity() — exactly the same permission that already
-- governs inserting the sor_procurement_requests rows this task exists to
-- carry, so the two halves of a request cannot come apart.
--
-- SAFE TO RUN AT ANY TIME: creates one function, alters nothing. Idempotent.
-- Run BEFORE deploying the frontend that calls it — procurementService invokes
-- this by name and a missing function surfaces as a failed request.
-- ==============================================================================

create or replace function public.sor_raise_procurement_task(
  p_opportunity_id uuid,
  p_assignee_id    uuid,
  p_description    text,
  p_checklist      jsonb,
  p_project_title  text,
  p_category_id    text,
  p_reported_to    uuid,
  p_remarks        text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := public.get_employee_id();
  v_task_id uuid;
begin
  if v_actor is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_assignee_id is null then
    raise exception 'A requisition needs a named owner.' using errcode = '22023';
  end if;

  -- The caller must be someone who could already act on this deal. Without
  -- this the function would be an open door onto the tasks table for any
  -- signed-in employee.
  if not public.sor_can_edit_opportunity(p_opportunity_id) then
    raise exception 'You cannot raise a procurement request on this opportunity.'
      using errcode = '42501';
  end if;

  -- The assignee has to be a real, current employee: `logged_by` drives whose
  -- performance record this lands on.
  if not exists (
    select 1 from public.employees e
    where e.id = p_assignee_id and coalesce(e.is_deleted, false) = false
  ) then
    raise exception 'That employee no longer exists.' using errcode = '23503';
  end if;

  insert into public.tasks (
    task_description,
    checklist,
    project_title,
    category_id,
    logged_by,
    reported_to,
    priority,
    remarks,
    status,
    start_at
  )
  values (
    p_description,
    p_checklist,
    p_project_title,
    p_category_id,
    p_assignee_id,
    p_reported_to,
    'MEDIUM',
    p_remarks,
    'INCOMPLETE',
    now()
  )
  returning id into v_task_id;

  return v_task_id;
end $$;

-- SECURITY DEFINER functions are callable by PUBLIC unless told otherwise, and
-- this one writes to tasks — so the grant is narrowed to signed-in users and
-- the implicit public grant is revoked.
revoke all on function public.sor_raise_procurement_task(
  uuid, uuid, text, jsonb, text, text, uuid, text
) from public;

grant execute on function public.sor_raise_procurement_task(
  uuid, uuid, text, jsonb, text, text, uuid, text
) to authenticated;
