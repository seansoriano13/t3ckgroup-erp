-- ============================================================================
-- Staging Database Sanitization Script
-- 
-- RUN THIS IMMEDIATELY AFTER IMPORTING PRODUCTION DATA INTO STAGING.
-- This script scrubs PII (emails, contact numbers, passwords) to ensure 
-- no real clients or employees can be accidentally contacted or logged in as
-- by unauthorized persons in the staging environment.
-- ============================================================================

-- 1. Sanitize Supabase Auth Users
-- Replaces emails with a dummy format: [user_id]@staging.example.com
-- Replaces the phone number with null
-- Sets the encrypted_password to a known dummy hash.
-- Note: The hash below is for 'password123'. You can generate a specific hash if you prefer using VITE_TEST_PASSWORD.
UPDATE auth.users 
SET 
  email = id || '@staging.example.com',
  phone = NULL,
  encrypted_password = crypt('password123', gen_salt('bf'));

-- 2. Sanitize Employee Records
UPDATE public.employees 
SET 
  email = id || '@staging.example.com';

-- 3. Sanitize Sales Activities (Client PII)
UPDATE public.sales_activities 
SET 
  email_address = 'client_' || id || '@staging.example.com',
  contact_number = '555-0000',
  contact_person = 'Sanitized Contact';

-- Done.
