#!/usr/bin/env node
/**
 * Local-only diagnostic: one ad-hoc SQL statement, passed as an argument.
 *
 * Points at the local Supabase stack (127.0.0.1:54322) and nothing else —
 * these exist to inspect a `supabase start` database while debugging, not to
 * touch staging or production. Written while chasing the missing public-schema
 * grants that `20260907034734_restore_public_grants.sql` repairs.
 */
import pg from 'pg';

const sql = process.argv[2];
if (!sql) {
  console.error('Usage: node scripts/query.mjs "SELECT ..."');
  process.exit(1);
}

const client = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
await client.connect();
const res = await client.query(sql);
console.log(res.rows);
await client.end();
