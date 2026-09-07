-- Insert a magic dev user into Supabase Auth
INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
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
    '{"provider":"email","providers":["email"]}',
    '{}',
    'authenticated',
    'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- Insert the corresponding identity
INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    format('{"sub":"%s","email":"%s"}', '00000000-0000-0000-0000-000000000000', 'dev@local.com')::jsonb,
    'email',
    now(),
    now(),
    now()
) ON CONFLICT (provider, id) DO NOTHING;

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
) ON CONFLICT (id) DO NOTHING;
