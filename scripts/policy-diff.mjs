#!/usr/bin/env node
/**
 * Cutover gate: compares every public RLS policy (name, command, definition)
 * between production and staging. Prints nothing and exits 0 when they match;
 * lists each differing policy and exits 1 otherwise. Read-only.
 *
 * Prod's migration ledger isn't proof a migration is applied, so this is the
 * pass/fail gate (docs/production-cutover-runbook.md).
 *
 * Usage: pnpm db:policy-diff
 * Reads PROD_DB_URL and STAGING_DB_URL from .env.local or the environment.
 */
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadDotEnvLocal } from './lib/seedShared.mjs';
import { POLICY_SQL, diffPolicies } from './lib/policyDiff.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = loadDotEnvLocal(repoRoot);

async function policies(envVar) {
  const url = env[envVar] ?? process.env[envVar];
  if (!url) {
    console.error(`Missing ${envVar}. Set it in .env.local or the environment.`);
    process.exit(2);
  }
  const isLocal = /@(127.0.0.1|localhost)[:/]/.test(url);
  const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    return (await client.query(POLICY_SQL)).rows;
  } finally {
    await client.end();
  }
}

const diff = diffPolicies(await policies('PROD_DB_URL'), await policies('STAGING_DB_URL'));
for (const d of diff) {
  console.log(`${d.kind}: ${d.policy}`);
  if (d.kind === 'differs') {
    console.log(`  prod:    ${JSON.stringify(d.prod)}`);
    console.log(`  staging: ${JSON.stringify(d.staging)}`);
  }
}
process.exit(diff.length ? 1 : 0);
