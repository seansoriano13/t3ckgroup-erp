#!/usr/bin/env node
/**
 * Installs scripts/hooks/* into .git/hooks/ so they run for everyone who
 * runs `pnpm install`, without needing a hook-management dependency.
 * Silently does nothing outside a git checkout (e.g. a CI build of a tarball).
 */
import { copyFileSync, chmodSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const gitHooksDir = join(repoRoot, '.git', 'hooks');
const sourceDir = join(repoRoot, 'scripts', 'hooks');

if (!existsSync(join(repoRoot, '.git'))) {
  process.exit(0);
}

for (const file of readdirSync(sourceDir)) {
  const src = join(sourceDir, file);
  const dest = join(gitHooksDir, file);
  copyFileSync(src, dest);
  chmodSync(dest, 0o755);
  console.log(`Installed git hook: ${file}`);
}
