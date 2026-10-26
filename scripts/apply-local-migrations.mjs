#!/usr/bin/env node
/**
 * Brings the LOCAL Supabase database up to date with supabase/migrations/.
 * Run by the post-commit and post-merge git hooks (scripts/hooks), so a local
 * database never falls behind the migration files without anyone noticing.
 *
 * It only ever runs `supabase migration up --local --include-all`: it adds
 * what is missing and never resets or deletes data. It does nothing when the
 * local stack is not running, and it never fails the git command that called it.
 * Remote databases (staging, prod) are untouched: CI applies those.
 *
 * Skip it with SKIP_LOCAL_MIGRATIONS=1.
 */
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const say = (message) => console.log(`[local migrations] ${message}`);

if (process.env.SKIP_LOCAL_MIGRATIONS === '1' || process.env.CI) process.exit(0);
if (!existsSync(join(root, 'supabase', 'migrations'))) process.exit(0);

const config = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
if (!projectId) process.exit(0);

// The local stack is running when its database container is.
let running = '';
try {
  running = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 });
} catch {
  process.exit(0);
}
if (!running.split(/\r?\n/).includes(`supabase_db_${projectId}`)) process.exit(0);

const result = spawnSync('supabase', ['migration', 'up', '--local', '--include-all'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  timeout: 120000,
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
if (result.status === 0) {
  const applied = (output.match(/^Applying migration /gm) ?? []).length;
  if (applied > 0) say(`applied ${applied} migration${applied === 1 ? '' : 's'} to your local database.`);
} else {
  say('could not update your local database. Run `supabase migration up --local --include-all` to see why.');
}
process.exit(0);
