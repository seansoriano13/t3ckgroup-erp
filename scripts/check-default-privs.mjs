#!/usr/bin/env node
/**
 * Local-only diagnostic: the default privileges new objects in public will inherit.
 *
 * Points at the local Supabase stack (127.0.0.1:54322) and nothing else —
 * these exist to inspect a `supabase start` database while debugging, not to
 * touch staging or production. Written while chasing the missing public-schema
 * grants that `20260907034734_restore_public_grants.sql` repairs.
 */
import pg from 'pg';

const client = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
await client.connect();
const res = await client.query('SELECT defaclacl FROM pg_default_acl');
console.log(res.rows);
await client.end();
