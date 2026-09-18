#!/usr/bin/env node
/**
 * Prints the divergence between a live database's migration ledger
 * (supabase_migrations.schema_migrations) and the files under
 * supabase/migrations/. Strictly read-only — it never writes to either side.
 *
 * This exists so "the ledger and the files disagree" is something you can
 * *look at* before deciding what to do, instead of something you infer from a
 * failed `supabase db push` log at 3am. Every remedy in AGENTS.md's "The
 * migration set is append-only" section starts by running this.
 *
 * The failure it is built to explain:
 *
 *   Remote migration versions not found in local migrations directory.
 *
 * That means the ledger holds a version with no matching file — an ORPHAN —
 * and `db push` will refuse to apply anything at all until it is reconciled.
 * The fix is always to correct the LEDGER (via the repair workflow), never to
 * rename a file to match it: a file's timestamp is its identity, and renaming
 * one that a ledger has already recorded is what creates the next orphan.
 *
 * Usage:
 *   pnpm db:ledger:check staging
 *   pnpm db:ledger:check prod
 *
 * Reads STAGING_DB_URL / PROD_DB_URL from .env.local (or from the environment
 * in CI) — the same read-only connection scripts/db-snapshot.mjs uses.
 *
 * Exit codes: 0 = safe to push, 1 = orphans or out-of-order pending migrations
 * (push blocked, or would skip/apply around them). migrate-prod runs this as a
 * hard pre-flight gate before `db push` (#332).
 */
import pg from 'pg';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadDotEnvLocal } from './lib/seedShared.mjs';
import { analyzeLedger } from './lib/ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const target = process.argv[2];
if (!['prod', 'staging'].includes(target)) {
  console.error('Usage: node scripts/db-ledger-check.mjs <prod|staging>');
  process.exit(1);
}

const envVar = target === 'prod' ? 'PROD_DB_URL' : 'STAGING_DB_URL';
const projectRef = target === 'prod' ? 'epqmberwewztzbrkhhss' : 'fpjxdyowngpnovotbzqi';

const dbUrl = loadDotEnvLocal(repoRoot)[envVar] ?? process.env[envVar];
if (!dbUrl) {
  console.error(`Missing ${envVar}. Set it in .env.local (local) or as a repo secret (CI).`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows: ledger } = await client.query(`
  select version,
         name,
         coalesce(array_length(statements, 1), 0) as stmt_count
  from supabase_migrations.schema_migrations
  order by version;
`);
await client.end();

// A migration file's name is "<14-digit UTC timestamp>_<name>.sql". Anything
// else under the directory (notably _archive/, superseded by the baseline) is
// not part of the set the ledger tracks.
const files = readdirSync(join(repoRoot, 'supabase', 'migrations'));

// `db push` applies pending migrations in filename order and will not reach
// back past what the remote has already recorded without --include-all. A
// pending file that sorts before the tip is the "my timestamp is too early"
// trap — the remedy is a NEW file with a current timestamp, never a rename.
const { orphans, pending, outOfOrder, remoteTip, fileCount, ok } = analyzeLedger({ ledger, files });

const bold = (s) => `[1m${s}[0m`;
console.log(`\n${bold(`Migration ledger — ${target}`)} (${projectRef})\n`);
console.log(`  applied on remote : ${ledger.length}`);
console.log(`  local files       : ${fileCount}`);
console.log(`  remote tip        : ${remoteTip ?? '(empty ledger)'}`);

if (orphans.length) {
  console.log(`\n${bold('ORPHANS')} — recorded in the ledger, no matching file.`);
  console.log('  These block `supabase db push` entirely; nothing applies until they are reconciled.');
  for (const o of orphans) {
    const evidence =
      o.stmt_count === 0
        ? 'NO SQL BODY — asserted by `repair --status applied`, no evidence it ever ran'
        : `${o.stmt_count} statement${o.stmt_count === 1 ? '' : 's'} recorded`;
    console.log(`    ${o.version}  ${(o.name ?? '').padEnd(38)}  ${evidence}`);
  }
  console.log('\n  For each: check whether its objects actually exist in the live database.');
  console.log('    objects present  → the migration ran under an older filename. Repair the ledger to');
  console.log('                       the file\'s current version (reverted + applied via the repair workflow).');
  console.log('    objects absent   → the row is a lie. Mark it `reverted`.');
  console.log('  Do not rename a file to match a ledger row. See AGENTS.md, "The migration set is append-only".');
}

if (outOfOrder.length) {
  console.log(`\n${bold('OUT OF ORDER')} — pending, but sorts before the remote tip (${remoteTip}).`);
  console.log('  `db push` will not reach back past the tip. Do NOT rename these forward —');
  console.log('  write a new migration with a current timestamp that makes the same change.');
  for (const f of outOfOrder) console.log(`    ${f}`);
}

if (pending.length) {
  console.log(`\n${bold('PENDING')} — present locally, not yet applied to ${target}.`);
  for (const f of pending) console.log(`    ${f}${outOfOrder.includes(f) ? '   (out of order)' : ''}`);
}

if (!orphans.length && !pending.length) {
  console.log(`\n${bold('Clean')} — every local migration is recorded, and the ledger claims nothing extra.`);
}

console.log('');
if (!ok) {
  console.log(`${bold('BLOCKED')} — ${orphans.length} orphan(s), ${outOfOrder.length} out-of-order pending migration(s). Do not push.
`);
}
process.exit(ok ? 0 : 1);
