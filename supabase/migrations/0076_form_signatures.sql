-- ==============================================================================
-- 0076_form_signatures.sql
--
-- Adds signature and hash tracking to offset_leaves, sil_leaves, and overtime_requests.
-- Fixes an issue in 0075_verification_tokens.sql where e.first_name was used instead of e.name.
-- Updates verify_form_token to return the new hashing and signature fields,
-- and gathers group-level raw data so the client can verify the hashes.
-- ==============================================================================

-- 1. Add signature columns to sil_leaves
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS application_hash TEXT;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS approval_hash TEXT;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS employee_signature_version TEXT;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS employee_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS hr_signature_version TEXT;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS hr_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS approval_credits_snapshot NUMERIC;

-- 2. Add signature columns to offset_leaves
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS application_hash TEXT;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS approval_hash TEXT;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS employee_signature_version TEXT;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS employee_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS hr_signature_version TEXT;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS hr_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS approval_credits_snapshot NUMERIC;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS hr_processed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;

-- 3. Add signature columns to overtime_requests
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS application_hash TEXT;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS approval_hash TEXT;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS employee_signature_version TEXT;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS employee_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS hr_signature_version TEXT;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS hr_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS approval_credits_snapshot NUMERIC;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS hr_processed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;

-- 4. Recreate verify_form_token to fix e.name and include new fields + raw group data
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
  found_id UUID;
  group_dates TEXT[];
  group_hours NUMERIC;
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
  SELECT jsonb_build_object(
    'form_type', 'Leave',
    'employee_name', e.name,
    'employee_id', e.id,
    'category', c.label,
    'category_id', s.category_id,
    'inclusive_dates', to_char(s.date, 'Mon DD, YYYY'),
    'raw_date', s.date,
    'reason', s.reason,
    'status', s.status,
    'approver_name', COALESCE(hr.name, settings.approver_name),
    'approver_id', s.hr_processed_by,
    'approval_date', COALESCE(to_char(s.hr_processed_at, 'Mon DD, YYYY'), to_char(s.updated_at, 'Mon DD, YYYY')),
    'application_hash', s.application_hash,
    'approval_hash', s.approval_hash,
    'employee_signature_version', s.employee_signature_version,
    'employee_signature_timestamp', s.employee_signature_timestamp,
    'hr_signature_version', s.hr_signature_version,
    'hr_signature_timestamp', s.hr_signature_timestamp,
    'leave_group_id', s.leave_group_id,
    'approval_credits_snapshot', s.approval_credits_snapshot
  ) INTO result_json
  FROM public.sil_leaves s
  JOIN public.employees e ON s.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON s.category_id = c.id
  LEFT JOIN public.employees hr ON s.hr_processed_by = hr.id
  WHERE s.verification_token = lookup_token;

  IF FOUND THEN
    SELECT array_agg(date::TEXT ORDER BY date), sum(hours) INTO group_dates, group_hours 
    FROM public.sil_leaves WHERE leave_group_id = (result_json->>'leave_group_id')::UUID;
    
    result_json := result_json || jsonb_build_object('group_dates', group_dates, 'total_hours', group_hours);
    RETURN result_json;
  END IF;

  -- Try Offset Leaves
  SELECT jsonb_build_object(
    'form_type', 'Offset',
    'employee_name', e.name,
    'employee_id', e.id,
    'category', c.label,
    'category_id', o.category_id,
    'inclusive_dates', to_char(o.date, 'Mon DD, YYYY'),
    'raw_date', o.date,
    'reason', o.reason,
    'status', o.status,
    'approver_name', COALESCE(hr.name, settings.approver_name),
    'approver_id', o.hr_processed_by,
    'approval_date', to_char(o.updated_at, 'Mon DD, YYYY'),
    'application_hash', o.application_hash,
    'approval_hash', o.approval_hash,
    'employee_signature_version', o.employee_signature_version,
    'employee_signature_timestamp', o.employee_signature_timestamp,
    'hr_signature_version', o.hr_signature_version,
    'hr_signature_timestamp', o.hr_signature_timestamp,
    'leave_group_id', o.leave_group_id,
    'approval_credits_snapshot', o.approval_credits_snapshot
  ) INTO result_json
  FROM public.offset_leaves o
  JOIN public.employees e ON o.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON o.category_id = c.id
  LEFT JOIN public.employees hr ON o.hr_processed_by = hr.id
  WHERE o.verification_token = lookup_token;

  IF FOUND THEN
    SELECT array_agg(date::TEXT ORDER BY date), sum(hours) INTO group_dates, group_hours 
    FROM public.offset_leaves WHERE leave_group_id = (result_json->>'leave_group_id')::UUID;

    result_json := result_json || jsonb_build_object('group_dates', group_dates, 'total_hours', group_hours);
    RETURN result_json;
  END IF;

  -- Try Overtime Requests
  SELECT jsonb_build_object(
    'form_type', 'Overtime',
    'employee_name', e.name,
    'employee_id', e.id,
    'category', c.label,
    'category_id', ot.category_id,
    'inclusive_dates', to_char(ot.date, 'Mon DD, YYYY'),
    'raw_date', ot.date,
    'total_hours', ot.hours,
    'group_dates', array[ot.date::TEXT],
    'reason', ot.reason,
    'status', ot.status,
    'approver_name', COALESCE(hr.name, settings.approver_name),
    'approver_id', ot.hr_processed_by,
    'approval_date', to_char(ot.updated_at, 'Mon DD, YYYY'),
    'application_hash', ot.application_hash,
    'approval_hash', ot.approval_hash,
    'employee_signature_version', ot.employee_signature_version,
    'employee_signature_timestamp', ot.employee_signature_timestamp,
    'hr_signature_version', ot.hr_signature_version,
    'hr_signature_timestamp', ot.hr_signature_timestamp,
    'approval_credits_snapshot', ot.approval_credits_snapshot
  ) INTO result_json
  FROM public.overtime_requests ot
  JOIN public.employees e ON ot.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON ot.category_id = c.id
  LEFT JOIN public.employees hr ON ot.hr_processed_by = hr.id
  WHERE ot.verification_token = lookup_token;

  IF FOUND THEN
    RETURN result_json;
  END IF;

  -- If not found
  RETURN NULL;
END;
$$;
