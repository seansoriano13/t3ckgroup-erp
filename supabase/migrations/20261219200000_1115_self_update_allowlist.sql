-- ==============================================================================
-- #1115 (spec #1114): self-update on `employees` becomes an allowlist
--
-- Until now prevent_role_escalation() blocked a list of columns for a person
-- editing their own row, so department, role, name, is_deleted, has_sales_flow,
-- has_task_flow, is_role_simulator, has_retail_access, has_bug_report_access and
-- is_issued_password could all be rewritten through the API. Now a person who is
-- not HR or a Super Admin, editing their own row, may change only avatar_path,
-- dashboard_banner_path, dashboard_quote, signature_path, updated_at and
-- last_seen_changelog_version (the changelog modal writes it from the browser).
-- Anything else raises 42501. HR and Super Admin rules are unchanged.
-- dashboard_quote is also limited to 100 characters, for every caller.
-- (#1116) dashboard_banner_path must be empty, an https:// address or a storage
-- path (no scheme before the first slash); javascript:, http:, data: are refused
-- for every caller. Only checked when the banner changes.
--
-- Prior shape: 20261013100700_ipas_signoffs.sql. Every earlier rule is kept.
-- SAFE TO RUN AT ANY TIME: one `create or replace`, no data change. Idempotent.
-- ==============================================================================

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
  v_self_allowed             text[] := ARRAY[
    'avatar_path', 'dashboard_banner_path', 'dashboard_quote', 'signature_path',
    'updated_at', 'last_seen_changelog_version'
  ];
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

  -- Self-update allowlist (#1115, spec #1114 D1/D2). Refused with an error, not
  -- reverted, so nobody believes a save worked when it did not. Compared as whole
  -- rows, so a column added later is refused by default. A caller with no
  -- employee row (service role, migration) is trusted, as before.
  IF v_caller_id IS NOT NULL
     AND OLD.id = v_caller_id
     AND NOT v_is_privileged
     AND (to_jsonb(NEW) - v_self_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_self_allowed)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: you can change only your avatar, banner, quote and signature.'
      USING ERRCODE = '42501';
  END IF;

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
