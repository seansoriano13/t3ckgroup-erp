-- ==============================================================================
-- 0079_verify_form_token_hash_verdicts.sql
--
-- Ticket #76: verify_form_token used to return the raw reason and every raw
-- hash-input field (application_hash, approval_hash, employee_id,
-- category_id, raw_date) so the client could recompute the hash itself and
-- compare. That's exactly what #65's "reason and attachments absent from the
-- unauthenticated response itself" requirement rules out — an anonymous
-- caller could always read `reason` straight off the RPC response, hash
-- comparison notwithstanding.
--
-- This version computes both comparisons itself and returns two booleans,
-- application_valid and approval_valid, in their place. Numeric hash inputs
-- (total hours, the credits snapshot) are canonicalized with trim_scale() so
-- a Postgres NUMERIC and the JS float sum that produced it hash identically
-- — see src/utils/formHashes.js's canonicalNumber(), which the write side
-- and this function must agree on byte-for-byte.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.verify_form_token(lookup_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  client_ip TEXT;
  rate_limit_row RECORD;
  result_json JSONB;
  settings RECORD;
  rec RECORD;
  group_dates TEXT[];
  group_hours NUMERIC;
  dates_string TEXT;
  canon_hours TEXT;
  canon_credits TEXT;
  computed_app_hash TEXT;
  computed_appr_hash TEXT;
  app_valid BOOLEAN;
  appr_valid BOOLEAN;
BEGIN
  -- Extract client IP
  client_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
  IF client_ip IS NULL THEN
    client_ip := 'unknown';
  ELSE
    client_ip := split_part(client_ip, ',', 1);
  END IF;

  -- Simple rate limiting logic
  SELECT * INTO rate_limit_row FROM public.verification_rate_limits WHERE ip_address = client_ip;
  IF FOUND THEN
    IF rate_limit_row.last_request > NOW() - INTERVAL '1 minute' THEN
      IF rate_limit_row.request_count >= 20 THEN
        RAISE EXCEPTION 'Rate limit exceeded. Please try again later.';
      ELSE
        UPDATE public.verification_rate_limits
        SET request_count = request_count + 1, last_request = NOW()
        WHERE ip_address = client_ip;
      END IF;
    ELSE
      UPDATE public.verification_rate_limits
      SET request_count = 1, last_request = NOW()
      WHERE ip_address = client_ip;
    END IF;
  ELSE
    INSERT INTO public.verification_rate_limits (ip_address, request_count, last_request)
    VALUES (client_ip, 1, NOW());
  END IF;

  SELECT * INTO settings FROM public.hr_form_settings WHERE id = 1;

  -- Try SIL Leaves
  SELECT s.*, e.name AS employee_name, c.label AS category_label,
         hr.name AS hr_name
  INTO rec
  FROM public.sil_leaves s
  JOIN public.employees e ON s.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON s.category_id = c.id
  LEFT JOIN public.employees hr ON s.hr_processed_by = hr.id
  WHERE s.verification_token = lookup_token;

  IF FOUND THEN
    SELECT array_agg(date::TEXT ORDER BY date), sum(hours) INTO group_dates, group_hours
    FROM public.sil_leaves WHERE leave_group_id = rec.leave_group_id;

    dates_string := array_to_string(group_dates, ',');
    canon_hours := COALESCE(trim_scale(round(group_hours, 2))::text, '');
    computed_app_hash := encode(digest(
      format('%s|%s|%s|%s|%s', rec.employee_id, COALESCE(rec.category_id::text, ''), dates_string, canon_hours, COALESCE(rec.reason, '')),
      'sha256'), 'hex');
    app_valid := (rec.application_hash IS NOT NULL) AND (computed_app_hash = rec.application_hash);

    appr_valid := NULL;
    IF rec.approval_hash IS NOT NULL AND (rec.status LIKE 'APPROVED%' OR rec.status = 'REJECTED') THEN
      canon_credits := CASE WHEN rec.approval_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(rec.approval_credits_snapshot, 2))::text END;
      computed_appr_hash := encode(digest(
        format('%s|%s|%s|%s', rec.application_hash, rec.status, COALESCE(rec.hr_processed_by::text, ''), canon_credits),
        'sha256'), 'hex');
      appr_valid := (computed_appr_hash = rec.approval_hash);
    END IF;

    result_json := jsonb_build_object(
      'form_type', 'Leave',
      'employee_name', rec.employee_name,
      'category', rec.category_label,
      'inclusive_dates', to_char(rec.date, 'Mon DD, YYYY'),
      'total_hours', group_hours,
      'status', rec.status,
      'approver_name', COALESCE(rec.hr_name, settings.approver_name),
      'approval_date', COALESCE(to_char(rec.hr_processed_at, 'Mon DD, YYYY'), to_char(rec.updated_at, 'Mon DD, YYYY')),
      'application_valid', app_valid,
      'approval_valid', appr_valid,
      'employee_signature_timestamp', rec.employee_signature_timestamp,
      'hr_signature_timestamp', rec.hr_signature_timestamp
    );
    RETURN result_json;
  END IF;

  -- Try Offset Leaves
  SELECT o.*, e.name AS employee_name, c.label AS category_label,
         hr.name AS hr_name
  INTO rec
  FROM public.offset_leaves o
  JOIN public.employees e ON o.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON o.category_id = c.id
  LEFT JOIN public.employees hr ON o.hr_processed_by = hr.id
  WHERE o.verification_token = lookup_token;

  IF FOUND THEN
    SELECT array_agg(date::TEXT ORDER BY date), sum(hours) INTO group_dates, group_hours
    FROM public.offset_leaves WHERE leave_group_id = rec.leave_group_id;

    dates_string := array_to_string(group_dates, ',');
    canon_hours := COALESCE(trim_scale(round(group_hours, 2))::text, '');
    computed_app_hash := encode(digest(
      format('%s|%s|%s|%s|%s', rec.employee_id, COALESCE(rec.category_id::text, ''), dates_string, canon_hours, COALESCE(rec.reason, '')),
      'sha256'), 'hex');
    app_valid := (rec.application_hash IS NOT NULL) AND (computed_app_hash = rec.application_hash);

    appr_valid := NULL;
    IF rec.approval_hash IS NOT NULL AND (rec.status LIKE 'APPROVED%' OR rec.status = 'REJECTED') THEN
      canon_credits := CASE WHEN rec.approval_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(rec.approval_credits_snapshot, 2))::text END;
      computed_appr_hash := encode(digest(
        format('%s|%s|%s|%s', rec.application_hash, rec.status, COALESCE(rec.hr_processed_by::text, ''), canon_credits),
        'sha256'), 'hex');
      appr_valid := (computed_appr_hash = rec.approval_hash);
    END IF;

    result_json := jsonb_build_object(
      'form_type', 'Offset',
      'employee_name', rec.employee_name,
      'category', rec.category_label,
      'inclusive_dates', to_char(rec.date, 'Mon DD, YYYY'),
      'total_hours', group_hours,
      'status', rec.status,
      'approver_name', COALESCE(rec.hr_name, settings.approver_name),
      'approval_date', to_char(rec.updated_at, 'Mon DD, YYYY'),
      'application_valid', app_valid,
      'approval_valid', appr_valid,
      'employee_signature_timestamp', rec.employee_signature_timestamp,
      'hr_signature_timestamp', rec.hr_signature_timestamp
    );
    RETURN result_json;
  END IF;

  -- Try Overtime Requests
  SELECT ot.*, e.name AS employee_name, c.label AS category_label,
         hr.name AS hr_name
  INTO rec
  FROM public.overtime_requests ot
  JOIN public.employees e ON ot.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON ot.category_id = c.id
  LEFT JOIN public.employees hr ON ot.hr_processed_by = hr.id
  WHERE ot.verification_token = lookup_token;

  IF FOUND THEN
    canon_hours := COALESCE(trim_scale(round(rec.hours, 2))::text, '');
    computed_app_hash := encode(digest(
      format('%s|%s|%s|%s|%s', rec.employee_id, COALESCE(rec.category_id::text, ''), rec.date::TEXT, canon_hours, COALESCE(rec.reason, '')),
      'sha256'), 'hex');
    app_valid := (rec.application_hash IS NOT NULL) AND (computed_app_hash = rec.application_hash);

    appr_valid := NULL;
    IF rec.approval_hash IS NOT NULL AND (rec.status LIKE 'APPROVED%' OR rec.status = 'REJECTED') THEN
      canon_credits := CASE WHEN rec.approval_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(rec.approval_credits_snapshot, 2))::text END;
      computed_appr_hash := encode(digest(
        format('%s|%s|%s|%s', rec.application_hash, rec.status, COALESCE(rec.hr_processed_by::text, ''), canon_credits),
        'sha256'), 'hex');
      appr_valid := (computed_appr_hash = rec.approval_hash);
    END IF;

    result_json := jsonb_build_object(
      'form_type', 'Overtime',
      'employee_name', rec.employee_name,
      'category', rec.category_label,
      'inclusive_dates', to_char(rec.date, 'Mon DD, YYYY'),
      'total_hours', rec.hours,
      'status', rec.status,
      'approver_name', COALESCE(rec.hr_name, settings.approver_name),
      'approval_date', to_char(rec.updated_at, 'Mon DD, YYYY'),
      'application_valid', app_valid,
      'approval_valid', appr_valid,
      'employee_signature_timestamp', rec.employee_signature_timestamp,
      'hr_signature_timestamp', rec.hr_signature_timestamp
    );
    RETURN result_json;
  END IF;

  -- If not found
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_form_token(TEXT) TO anon, authenticated;
