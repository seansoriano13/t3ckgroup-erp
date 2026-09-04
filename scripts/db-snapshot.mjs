#!/usr/bin/env node
/**
 * Generates a read-only schema mirror (supabase/schema/{prod,staging}.sql)
 * from the live database's pg_catalog, and optionally checks it against the
 * committed file without writing (--check), for the drift-detection CI job.
 *
 * Usage:
 *   node scripts/db-snapshot.mjs prod          # regenerate supabase/schema/prod.sql
 *   node scripts/db-snapshot.mjs staging       # regenerate supabase/schema/staging.sql
 *   node scripts/db-snapshot.mjs prod --check  # exit 1 if live schema != committed file
 *
 * Reads the connection string from PROD_DB_URL or STAGING_DB_URL (.env.local
 * locally, repo secrets in CI). This queries pg_catalog directly rather than
 * shelling out to pg_dump, so it has no Docker dependency.
 */
import pg from 'pg';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const target = process.argv[2];
const checkOnly = process.argv.includes('--check');

if (!['prod', 'staging'].includes(target)) {
  console.error('Usage: node scripts/db-snapshot.mjs <prod|staging> [--check]');
  process.exit(1);
}

const envVar = target === 'prod' ? 'PROD_DB_URL' : 'STAGING_DB_URL';
const dbUrl = process.env[envVar];
if (!dbUrl) {
  console.error(`Missing ${envVar}. Set it in .env.local (local) or as a repo secret (CI).`);
  process.exit(1);
}

const projectRef = target === 'prod' ? 'epqmberwewztzbrkhhss' : 'fpjxdyowngpnovotbzqi';
const outFile = join(repoRoot, 'supabase', 'schema', `${target}.sql`);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const q = (sql, params) => client.query(sql, params).then((r) => r.rows);
const out = [];
const section = (title) => out.push(`\n-- ============================================================\n-- ${title}\n-- ============================================================\n`);

section('Extensions');
const extensions = await q(`
  select extname, n.nspname as schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where extname not in ('plpgsql')
  order by extname;
`);
for (const e of extensions) {
  out.push(`create extension if not exists "${e.extname}" with schema "${e.schema}";`);
}

section('Tables');
const tables = await q(`
  select c.relname as table_name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname;
`);

for (const t of tables) {
  const tbl = t.table_name;
  const cols = await q(`
    select column_name, data_type, udt_name, is_nullable, column_default,
           character_maximum_length, numeric_precision, numeric_scale,
           is_identity, identity_generation
    from information_schema.columns
    where table_schema = 'public' and table_name = $1
    order by ordinal_position;
  `, [tbl]);

  const colDefs = cols.map((c) => {
    let type = c.data_type === 'USER-DEFINED' ? c.udt_name
      : c.data_type === 'ARRAY' ? `${c.udt_name.replace(/^_/, '')}[]`
      : c.data_type;
    if (c.character_maximum_length && /char/.test(type)) type += `(${c.character_maximum_length})`;
    if (c.numeric_precision && type === 'numeric') {
      type += c.numeric_scale ? `(${c.numeric_precision},${c.numeric_scale})` : `(${c.numeric_precision})`;
    }
    let line = `  "${c.column_name}" ${type}`;
    if (c.is_nullable === 'NO') line += ' not null';
    if (c.is_identity === 'YES') line += ` generated ${c.identity_generation === 'ALWAYS' ? 'always' : 'by default'} as identity`;
    if (c.column_default && c.is_identity !== 'YES') line += ` default ${c.column_default}`;
    return line;
  });

  out.push(`\ncreate table if not exists public."${tbl}" (\n${colDefs.join(',\n')}\n);`);
}

section('Constraints (primary key, unique, foreign key, check)');
const constraints = await q(`
  select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as def, contype
  from pg_constraint
  where connamespace = 'public'::regnamespace
  order by contype, conrelid::regclass::text, conname;
`);
for (const c of constraints) {
  out.push(`alter table ${c.table_name} add constraint "${c.conname}" ${c.def};`);
}

section('Indexes (excluding those backing constraints)');
const indexes = await q(`
  select indexname, indexdef
  from pg_indexes
  where schemaname = 'public'
    and indexname not in (select conname from pg_constraint where connamespace = 'public'::regnamespace)
  order by tablename, indexname;
`);
for (const i of indexes) {
  out.push(`${i.indexdef};`);
}

section('Row Level Security (enable/force)');
const rlsTables = await q(`
  select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  order by c.relname;
`);
for (const t of rlsTables) {
  out.push(`alter table public."${t.table_name}" enable row level security;`);
  if (t.rls_forced) out.push(`alter table public."${t.table_name}" force row level security;`);
}

section('RLS Policies');
const policies = await q(`
  select schemaname, tablename, policyname, permissive,
         array_to_string(roles, ', ') as roles_list, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public'
  order by tablename, policyname;
`);
for (const p of policies) {
  let stmt = `create policy "${p.policyname}" on public."${p.tablename}"\n`;
  stmt += `  as ${p.permissive === 'PERMISSIVE' ? 'permissive' : 'restrictive'}\n`;
  stmt += `  for ${p.cmd.toLowerCase()}\n`;
  stmt += `  to ${p.roles_list}\n`;
  if (p.qual) stmt += `  using (${p.qual})\n`;
  if (p.with_check) stmt += `  with check (${p.with_check})\n`;
  out.push(stmt.trimEnd() + ';');
}

section('Functions');
const functions = await q(`
  select p.oid, p.proname, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
  order by p.proname;
`);
for (const f of functions) {
  out.push(`${f.def};`);
}

section('Triggers');
const triggers = await q(`
  select t.tgname, pg_get_triggerdef(t.oid) as def
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
  order by c.relname, t.tgname;
`);
for (const t of triggers) {
  out.push(`${t.def};`);
}

section('Views');
const views = await q(`
  select viewname, definition
  from pg_views
  where schemaname = 'public'
  order by viewname;
`);
for (const v of views) {
  out.push(`create or replace view public."${v.viewname}" as\n${v.definition.trim()}`);
}

await client.end();

const label = target === 'prod' ? 'production' : 'staging';
const otherLabel = target === 'prod' ? 'staging' : 'prod';
const header = `-- ==============================================================================
-- GENERATED — DO NOT EDIT OR APPLY
--
-- Schema mirror — ${label} (${projectRef})
-- Regenerate with: pnpm db:snapshot:${target}
--
-- This is a read-only snapshot of the live schema for reference and drift
-- detection. It is NOT a migration file, is not in supabase/migrations/,
-- and must never be run against any database — running it against
-- ${otherLabel} would error on objects the two databases already have in
-- common (or lack entirely).
-- ==============================================================================
`;

const body = header + out.join('\n') + '\n';

if (checkOnly) {
  if (!existsSync(outFile)) {
    console.error(`${outFile} does not exist — run without --check first.`);
    process.exit(1);
  }
  const committed = readFileSync(outFile, 'utf8');
  // Normalize line endings (a prior commit or a Windows checkout can carry
  // CRLF) and ignore the header block, so neither produces a false failure —
  // only the actual schema content (Tables onward) is compared.
  const normalize = (s) => s.replace(/\r\n/g, '\n');
  const stripHeader = (s) => s.split('-- ============================================================\n-- Tables').slice(1).join('-- ============================================================\n-- Tables');
  if (stripHeader(normalize(committed)) !== stripHeader(normalize(body))) {
    console.error(`DRIFT DETECTED: live ${label} schema no longer matches supabase/schema/${target}.sql`);
    console.error(`Run 'pnpm db:snapshot:${target}' locally, review the diff, and commit it.`);
    process.exit(1);
  }
  console.log(`No drift: supabase/schema/${target}.sql matches live ${label} schema.`);
  process.exit(0);
}

writeFileSync(outFile, body);
console.log(`Wrote ${outFile}`);
console.log(`Tables: ${tables.length}, Constraints: ${constraints.length}, Indexes: ${indexes.length}, Policies: ${policies.length}, Functions: ${functions.length}, Triggers: ${triggers.length}, Views: ${views.length}, Extensions: ${extensions.length}`);
