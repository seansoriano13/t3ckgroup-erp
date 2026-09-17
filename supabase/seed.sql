-- Insert a magic dev user into Supabase Auth
INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    phone_change,
    phone_change_token,
    phone_change_sent_at,
    raw_app_meta_data,
    raw_user_meta_data,
    aud,
    role
)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    'dev@local.com',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    null,
    '{"provider":"email","providers":["email"]}',
    '{}',
    'authenticated',
    'authenticated'
) ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
    created_at = coalesce(auth.users.created_at, now()),
    updated_at = now();

-- Insert the corresponding identity
INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    'dev@local.com',
    format('{"sub":"%s","email":"%s"}', '00000000-0000-0000-0000-000000000000', 'dev@local.com')::jsonb,
    'email',
    now(),
    now(),
    now()
) ON CONFLICT (provider_id, provider) DO UPDATE SET
    identity_data = EXCLUDED.identity_data,
    updated_at = now();

-- Insert the employee record so the frontend allows login
INSERT INTO public.employees (
    id,
    email,
    name,
    department,
    role,
    is_super_admin,
    is_deleted
)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'dev@local.com',
    'Local Solo Dev',
    'Engineering',
    'Super Admin',
    true,
    false
) ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    is_super_admin = true,
    is_deleted = false;
