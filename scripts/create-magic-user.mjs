import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_LOCAL_DB_URL, loadDotEnvLocal } from './lib/seedShared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

async function run() {
  const env = loadDotEnvLocal(repoRoot);
  const dbUrl = process.env.LOCAL_DB_URL ?? env.LOCAL_DB_URL ?? DEFAULT_LOCAL_DB_URL;
  const email = process.env.VITE_MAGIC_LOGIN_EMAIL || env.VITE_MAGIC_LOGIN_EMAIL || 'dev@local.com';
  const password = process.env.VITE_MAGIC_LOGIN_PASSWORD || env.VITE_MAGIC_LOGIN_PASSWORD || 'password123';
  const userId = '00000000-0000-0000-0000-000000000000';

  const client = new pg.Client({ connectionString: dbUrl });

  try {
    await client.connect();

    // Upsert user into auth.users (confirmed_at is generated, omit it)
    await client.query(`
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
        $1::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid,
        $2::text,
        crypt($3::text, gen_salt('bf')),
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
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        'authenticated',
        'authenticated'
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        encrypted_password = EXCLUDED.encrypted_password,
        email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
        created_at = coalesce(auth.users.created_at, now()),
        updated_at = now();
    `, [userId, email, password]);

    // Upsert identity into auth.identities
    await client.query(`
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
        $1::uuid,
        $1::uuid,
        $2::text,
        jsonb_build_object('sub', $1::text, 'email', $2::text),
        'email',
        now(),
        now(),
        now()
      )
      ON CONFLICT (provider_id, provider) DO UPDATE SET
        identity_data = EXCLUDED.identity_data,
        updated_at = now();
    `, [userId, email]);

    // Upsert employee into public.employees
    await client.query(`
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
        $1::uuid,
        $2::text,
        'Local Solo Dev',
        'Engineering',
        'Super Admin',
        true,
        false
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        is_super_admin = true,
        is_deleted = false;
    `, [userId, email]);

    console.log(`Magic dev user successfully ensured for: ${email}`);
  } catch (err) {
    console.error('Failed to create/ensure magic dev user:', err);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

run();
