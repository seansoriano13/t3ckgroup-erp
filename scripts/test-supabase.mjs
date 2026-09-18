#!/usr/bin/env node
/**
 * Local-only diagnostic: whether an account can sign in and read its own employee row.
 *
 * Points at the local Supabase stack (127.0.0.1:54322) and nothing else —
 * these exist to inspect a `supabase start` database while debugging, not to
 * touch staging or production. Written while chasing the missing public-schema
 * grants that `20260907034734_restore_public_grants.sql` repairs.
 */
import { createClient } from '@supabase/supabase-js';

// The local anon key is a committed, deterministic value derived from
// supabase/config.toml — see .env.local.example and issue #87. The password is
// whatever `pnpm db:seed:restore` set every account to.
const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

const email = process.argv[2];
const password = process.env.VITE_TEST_PASSWORD;

if (!email || !password) {
  console.error('Usage: VITE_TEST_PASSWORD=... node scripts/test-supabase.mjs <email>');
  process.exit(1);
}

const supabase = createClient(LOCAL_URL, LOCAL_ANON_KEY);

const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
console.log('Auth Error:', authError);
console.log('Auth User Email:', authData?.user?.email);

const { data, error } = await supabase
  .from('employees')
  .select('*')
  .eq('email', authData?.user?.email)
  .neq('is_deleted', true)
  .single();

console.log('Employee Data:', data ? 'Found' : 'Not Found');
console.log('Employee Error:', error);
