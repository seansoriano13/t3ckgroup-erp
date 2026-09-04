-- ==============================================================================
-- 0075_verification_tokens.sql
--
-- Adds public verification tokens for leave, offset, and overtime records.
-- ==============================================================================

-- 1. Add verification tokens
ALTER TABLE public.sil_leaves 
  ADD COLUMN IF NOT EXISTS verification_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex');

ALTER TABLE public.offset_leaves 
  ADD COLUMN IF NOT EXISTS verification_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex');

ALTER TABLE public.overtime_requests 
  ADD COLUMN IF NOT EXISTS verification_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex');

-- 2. Create Rate Limiting Table
CREATE TABLE IF NOT EXISTS public.verification_rate_limits (
  ip_address TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 1,
  last_request TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- This project's Postgres default privileges grant anon/authenticated full
-- DML on newly created public tables. Without RLS, this table is
-- anon-readable (leaking every verifier's IP) and anon-deletable (letting
-- anyone reset their own rate limit). No policies are defined: the only
-- legitimate access is through verify_form_token, a SECURITY DEFINER
-- function that runs as its owner and so bypasses RLS entirely.
ALTER TABLE public.verification_rate_limits ENABLE ROW LEVEL SECURITY;

-- 3. Create RPC for verifying records by token
-- SECURITY DEFINER allows it to read records bypassing RLS for anon access
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
BEGIN
  -- Extract client IP (Supabase exposes this in request.headers)
  client_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
  IF client_ip IS NULL THEN
    client_ip := 'unknown';
  ELSE
    -- Take the first IP if multiple
    client_ip := split_part(client_ip, ',', 1);
  END IF;

  -- Simple rate limiting logic (e.g., max 20 requests per minute per IP)
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

  -- Fetch default form settings for fallback approver
  SELECT * INTO settings FROM public.hr_form_settings WHERE id = 1;

  -- Try SIL Leaves
  SELECT jsonb_build_object(
    'form_type', 'Leave',
    'employee_name', e.first_name || ' ' || e.last_name,
    'category', c.label,
    'inclusive_dates', to_char(s.date, 'Mon DD, YYYY'),
    'total_hours', s.hours,
    'status', s.status,
    'approver_name', COALESCE(hr.first_name || ' ' || hr.last_name, settings.approver_name),
    'approval_date', COALESCE(to_char(s.hr_processed_at, 'Mon DD, YYYY'), to_char(s.updated_at, 'Mon DD, YYYY'))
  ) INTO result_json
  FROM public.sil_leaves s
  JOIN public.employees e ON s.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON s.category_id = c.id
  LEFT JOIN public.employees hr ON s.hr_processed_by = hr.id
  WHERE s.verification_token = lookup_token;

  IF FOUND THEN
    RETURN result_json;
  END IF;

  -- Try Offset Leaves
  SELECT jsonb_build_object(
    'form_type', 'Offset',
    'employee_name', e.first_name || ' ' || e.last_name,
    'category', c.label,
    'inclusive_dates', to_char(o.date, 'Mon DD, YYYY'),
    'total_hours', o.hours,
    'status', o.status,
    'approver_name', settings.approver_name,
    'approval_date', to_char(o.updated_at, 'Mon DD, YYYY')
  ) INTO result_json
  FROM public.offset_leaves o
  JOIN public.employees e ON o.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON o.category_id = c.id
  WHERE o.verification_token = lookup_token;

  IF FOUND THEN
    RETURN result_json;
  END IF;

  -- Try Overtime Requests
  SELECT jsonb_build_object(
    'form_type', 'Overtime',
    'employee_name', e.first_name || ' ' || e.last_name,
    'category', c.label,
    'inclusive_dates', to_char(ot.date, 'Mon DD, YYYY'),
    'total_hours', ot.hours,
    'status', ot.status,
    'approver_name', settings.approver_name,
    'approval_date', to_char(ot.updated_at, 'Mon DD, YYYY')
  ) INTO result_json
  FROM public.overtime_requests ot
  JOIN public.employees e ON ot.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON ot.category_id = c.id
  WHERE ot.verification_token = lookup_token;

  IF FOUND THEN
    RETURN result_json;
  END IF;

  -- If not found
  RETURN NULL;
END;
$$;

-- Ensure public access to the verification endpoint
GRANT EXECUTE ON FUNCTION public.verify_form_token(TEXT) TO anon, authenticated;
