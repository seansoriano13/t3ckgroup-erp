#!/usr/bin/env node
/**
 * Local-only diagnostic: every grant on one table (defaults to employees).
 *
 * Points at the local Supabase stack (127.0.0.1:54322) and nothing else —
 * these exist to inspect a `supabase start` database while debugging, not to
 * touch staging or production. Written while chasing the missing public-schema
 * grants that `20260907034734_restore_public_grants.sql` repairs.
 */
import pg from 'pg';

const table = process.argv[2] ?? 'employees';

const client = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
await client.connect();
const res = await client.query(`
  SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_name = $1
`, [table]);
console.log(res.rows);
await client.end();
