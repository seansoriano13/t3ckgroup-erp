-- ==============================================================================
-- 20261221120000_1152_logistics_access_flag.sql
--
-- Issue #1152 (spec #1151, T1) — Logistics access, and who may grant it.
--
-- `employees.has_logistics_flow` is built exactly like `has_finance_flow`
-- (20261013100000): a stored boolean, never inferred from department text,
-- changed only by a Super Admin or HR through prevent_role_escalation(), and HR
-- cannot change their own. A change by anyone else is reverted silently.
--
-- It reads every IPAS (ipas_can_read, _ipas_employee_can_read). Bank details
-- stay Finance-only. It is NOT the `logistics_signed` signer list: it does not
-- let anyone sign Logistics, and ipas_set_item_location keeps its own rule.
--
-- Everyone on the `logistics_signed` list gets the flag once, below.
--
-- SAFE TO RUN AT ANY TIME: one NOT NULL DEFAULT false column, one helper, three
-- `create or replace`, one idempotent backfill.
-- ==============================================================================

alter table public.employees
  add column if not exists has_logistics_flow boolean not null default false;

comment on column public.employees.has_logistics_flow is
  'Logistics access (#1151): reads every IPAS (not bank details), sets the IPAS Status and Direct delivery. Granted per employee by HR or a Super Admin; not the logistics_signed signer list. Changed only through prevent_role_escalation().';

create or replace function public.has_logistics_access()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and e.has_logistics_flow
      and not coalesce(e.is_deleted, false)
  );
$$;

comment on function public.has_logistics_access() is
  '#1152: whether the caller holds Logistics access (employees.has_logistics_flow) and is not soft-deleted. Not satisfied by Super Admin; mirrors has_finance_access().';

grant execute on function public.has_logistics_access() to authenticated;

-- Logistics access reads every IPAS.
create or replace function public.ipas_can_read()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = get_employee_id()
      and not coalesce(e.is_deleted, false)
      and (
        coalesce(e.has_purchasing_flow, false)
        or coalesce(e.has_finance_flow, false)
        or coalesce(e.has_logistics_flow, false)
        or coalesce(e.is_super_admin, false)
        or exists (
          select 1 from ipas_signer_lists l
           where l.employee_id = e.id
             and l.list_key not like 'transmittal\_%' escape '\'
        )
      )
  );
$$;

comment on function public.ipas_can_read() is
  '#242, widened in #252 and #1152: whether the caller may read every IPAS — Purchasing, Finance or Logistics access, a Super Admin, or anyone on an IPAS sign-off list (never a Transmittal staff list alone; never a soft-deleted employee).';

create or replace function public._ipas_employee_can_read(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee_id
      and not coalesce(e.is_deleted, false)
      and (
        coalesce(e.has_purchasing_flow, false)
        or coalesce(e.has_finance_flow, false)
        or coalesce(e.has_logistics_flow, false)
        or coalesce(e.is_super_admin, false)
        or exists (
          select 1 from ipas_signer_lists l
           where l.employee_id = e.id
             and l.list_key not like 'transmittal\_%' escape '\'
        )
      )
  );
$$;

-- prevent_role_escalation(): the body of 20261219200000_1115 with the Logistics
-- flag guarded beside Purchasing and Finance. Nothing else changes.
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_caller_id                UUID;
  v_caller_is_super_admin    BOOLEAN;
  v_caller_is_hr             BOOLEAN;
  v_caller_can_manage_leaves BOOLEAN;
  v_caller_is_role_simulator BOOLEAN;
  v_is_privileged            BOOLEAN;
BEGIN
  v_caller_id := public.get_employee_id();

  SELECT is_super_admin, is_hr, can_manage_leaves, is_role_simulator
  INTO   v_caller_is_super_admin, v_caller_is_hr, v_caller_can_manage_leaves, v_caller_is_role_simulator
  FROM   public.employees
  WHERE  id = v_caller_id;

  v_is_privileged := (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE);

  -- Quote length (#1115). Only checked when the quote changes, so an older,
  -- longer quote does not block an unrelated edit of that person.
  IF NEW.dashboard_quote IS DISTINCT FROM OLD.dashboard_quote
     AND char_length(NEW.dashboard_quote) > 100
  THEN
    RAISE EXCEPTION 'The quote can be at most 100 characters.'
      USING ERRCODE = '23514';
  END IF;

  -- Banner address (#1116). Allowed: empty, an https:// address, or a storage
  -- path (no scheme before the first slash).
  IF NEW.dashboard_banner_path IS DISTINCT FROM OLD.dashboard_banner_path
     AND NEW.dashboard_banner_path IS NOT NULL
     AND NEW.dashboard_banner_path <> ''
     AND NEW.dashboard_banner_path !~* '^https://'
     AND NEW.dashboard_banner_path !~ '^[^:/]*/'
  THEN
    RAISE EXCEPTION 'The banner must be a web address that starts with https://.'
      USING ERRCODE = '23514';
  END IF;

  IF v_caller_is_role_simulator IS TRUE THEN
    RETURN NEW;
  END IF;

  -- The self-update allowlist lives in employees_self_update_allowlist() below.

  IF NOT v_is_privileged THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      NEW.is_super_admin := OLD.is_super_admin;
    END IF;
    IF NEW.is_hr IS DISTINCT FROM OLD.is_hr THEN
      NEW.is_hr := OLD.is_hr;
    END IF;
    IF NEW.is_head IS DISTINCT FROM OLD.is_head THEN
      NEW.is_head := OLD.is_head;
    END IF;
  END IF;

  IF NEW.is_super_admin = TRUE
     AND OLD.is_super_admin = FALSE
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can grant super-admin status.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_manage_leaves IS DISTINCT FROM OLD.can_manage_leaves
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change leave-management access.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_edit_sales_flows IS DISTINCT FROM OLD.can_edit_sales_flows
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change Flow editor access.'
      USING ERRCODE = '42501';
  END IF;

  -- Purchasing and Finance access (#242). Only a Super Admin or HR grants
  -- them, and HR cannot grant themselves (a Super Admin may). A caller with no
  -- employee row is the service role or a migration, and is trusted.
  IF v_caller_id IS NOT NULL
     AND (
       NOT v_is_privileged
       OR (OLD.id = v_caller_id AND NOT (v_caller_is_super_admin IS TRUE))
     )
  THEN
    IF NEW.has_purchasing_flow IS DISTINCT FROM OLD.has_purchasing_flow THEN
      NEW.has_purchasing_flow := OLD.has_purchasing_flow;
    END IF;
    IF NEW.has_finance_flow IS DISTINCT FROM OLD.has_finance_flow THEN
      NEW.has_finance_flow := OLD.has_finance_flow;
    END IF;
    IF NEW.has_logistics_flow IS DISTINCT FROM OLD.has_logistics_flow THEN
      NEW.has_logistics_flow := OLD.has_logistics_flow;
    END IF;
  END IF;

  -- Call sign (#247). Only HR and Super Admins set one, their own included.
  IF v_caller_id IS NOT NULL
     AND NOT v_is_privileged
     AND NEW.call_sign IS DISTINCT FROM OLD.call_sign
  THEN
    NEW.call_sign := OLD.call_sign;
  END IF;

  -- Nobody edits their own hidden-navigation override — server-side, not by
  -- hiding the control — and only HR/Super Admin may edit anyone else's.
  IF NEW.hidden_nav_keys IS DISTINCT FROM OLD.hidden_nav_keys THEN
    IF OLD.id = v_caller_id OR NOT v_is_privileged THEN
      NEW.hidden_nav_keys := OLD.hidden_nav_keys;
    END IF;
  END IF;

  IF v_caller_can_manage_leaves IS TRUE
     AND NOT v_is_privileged
     AND OLD.id IS DISTINCT FROM v_caller_id
  THEN
    NEW := jsonb_populate_record(OLD, jsonb_build_object(
      'offset_hours_balance', NEW.offset_hours_balance,
      'sil_hours_balance', NEW.sil_hours_balance,
      'updated_at', NEW.updated_at
    ));
  END IF;

  RETURN NEW;
END;
$function$;

-- Everyone already on the Logistics sign-off list gets the flag, once.
update public.employees e
   set has_logistics_flow = true
 where not e.has_logistics_flow
   and exists (
     select 1 from public.ipas_signer_lists l
      where l.employee_id = e.id and l.list_key = 'logistics_signed'
   );
