#!/usr/bin/env node
/**
 * Installs scripts/hooks/* into the repository's hooks directory so they run
 * for everyone who runs `pnpm install`, without needing a hook-management
 * dependency. Silently does nothing outside a git checkout (e.g. a CI build of
 * a tarball).
 *
 * The directory comes from git rather than `<repo>/.git/hooks`: in a linked
 * worktree `.git` is a file pointing at the main checkout, and the hooks live
 * in the main checkout's git directory, shared by every worktree.
 */
import { copyFileSync, chmodSync, mkdirSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const sourceDir = join(repoRoot, 'scripts', 'hooks');

let gitHooksDir;
try {
  const path = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  gitHooksDir = resolve(repoRoot, path);
} catch {
  process.exit(0);
}
mkdirSync(gitHooksDir, { recursive: true });

for (const file of readdirSync(sourceDir)) {
  const src = join(sourceDir, file);
  const dest = join(gitHooksDir, file);
  copyFileSync(src, dest);
  chmodSync(dest, 0o755);
  console.log(`Installed git hook: ${file}`);
}
