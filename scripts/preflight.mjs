#!/usr/bin/env node
/**
 * One command to run after finishing a feature or a bug fix, before pushing to
 * `staging`. Pushing to `staging` auto-applies migrations to the staging
 * database and deploys the staging site, so the point of this is that nothing
 * about the push is a surprise.
 *
 * It runs the mechanical gates locally, in the same order CI will, and stops at
 * the first failure. Then it prints the checklist CI can't cover — a real smoke
 * test on seeded data, and the `[auth]` config in supabase/config.toml that
 * only drives the local stack and has a hand-maintained twin in the staging
 * dashboard.
 *
 *   pnpm preflight            # lint, affected tests, build, + conditional checks
 *
 * Lint is split the way ci.yml splits it: `lint:tests` and the lint ratchet fail
 * the run (errors may fall below scripts/lint-baseline.json, never rise above it).
 *   pnpm preflight --quick    # skip `vite build`
 *   pnpm preflight --full     # run the whole test suite, whatever changed
 *   pnpm preflight --strict   # missing changelog entry fails instead of warning
 *
 * Nothing here touches a remote database. The migration check runs against the
 * local stack (127.0.0.1:54322) only, and only when migrations changed.
 */
import { execSync } from "child_process"
import { chooseTestRun } from "./lib/testSelection.mjs"

const args = process.argv.slice(2)
const quick = args.includes("--quick")
const strict = args.includes("--strict")
const full = args.includes("--full")

const bold = (s) => `\x1b[1m${s}\x1b[0m`
const results = []
let failed = false

/** Run a command with its output streamed through; record pass/fail. */
function step(label, cmd, { soft = false } = {}) {
  process.stdout.write(`\n${bold(`▶ ${label}`)}\n`)
  try {
    execSync(cmd, { stdio: "inherit" })
    results.push(`  ✅ ${label}`)
    return true
  } catch {
    results.push(`  ${soft ? "⚠️ " : "❌"} ${label}`)
    if (!soft) failed = true
    return false
  }
}

/** Quiet git read; "" on any failure. */
function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return ""
  }
}

const mergeBase = git("merge-base HEAD origin/staging")

/** Every file this branch changes relative to what it will merge into. */
function changedFiles() {
  const base = mergeBase || git("rev-parse HEAD~1")
  const sources = [
    base && `diff --name-only ${base}...HEAD`,
    "diff --name-only HEAD", // unstaged
    "diff --name-only --cached", // staged
    // new, not yet added — a fresh migration must still widen the test run
    "ls-files --others --exclude-standard",
  ].filter(Boolean)
  const set = new Set()
  for (const s of sources) {
    for (const f of git(s).split("\n").filter(Boolean)) set.add(f)
  }
  return [...set]
}

const changed = changedFiles()
const touchedMigrations = changed.some((f) => f.startsWith("supabase/migrations/"))
const touchedBehaviour = changed.some(
  (f) =>
    f.startsWith("src/") &&
    !f.startsWith("src/test/") &&
    !/\.(test|stories)\.[jt]sx?$/.test(f),
)
const touchedChangelog = changed.includes("src/data/changelog.json")
const touchedAuthConfig =
  changed.includes("supabase/config.toml") ||
  changed.some((f) => f.startsWith("supabase/templates/"))

// --- always ---------------------------------------------------------------
// ci.yml hard-gates on `lint:tests` and on the lint ratchet (the app-wide backlog may
// shrink, never grow). Mirror it, so preflight and CI agree.
step("Lint tests (eslint on test files)", "pnpm lint:tests")
step("Lint app ratchet (no new errors above scripts/lint-baseline.json)", "pnpm lint:ratchet")
// CI runs the full suite on every push, so locally only the tests this branch
// can reach are run — unless the change is one the import graph cannot see.
// The rule lives in scripts/lib/testSelection.mjs, where it is tested.
const testRun = chooseTestRun({ changedFiles: changed, base: mergeBase, full })
if (testRun.mode === "full") {
  step(`Tests (full Vitest suite — ${testRun.reason})`, `pnpm exec ${testRun.command}`)
} else {
  step("Tests (affected by this branch — CI runs the full suite)", `pnpm exec ${testRun.command}`)
  results.push("  ℹ️  Scoped test run. `pnpm preflight --full` runs every test.")
}
if (!quick) step("Build (vite build)", "pnpm build")

// --- only if migrations changed -----------------------------------------
if (touchedMigrations) {
  step(
    "Migration schema check (local stack vs supabase/schema/staging.sql)",
    "node scripts/db-snapshot.mjs --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres --check --against supabase/schema/staging.sql",
  )
  results.push(
    "  ℹ️  supabase/schema/staging.sql is a mirror; if it's stale run `pnpm db:snapshot:staging` (needs STAGING_DB_URL) then re-check.",
  )
} else {
  results.push("  ⏭️  No migrations changed — schema gate skipped.")
}

// --- changelog (AGENTS.md: an entry is required before pushing) ---------
if (touchedBehaviour && !touchedChangelog) {
  const msg =
    "src/ changed but src/data/changelog.json did not — AGENTS.md requires a changelog entry before pushing."
  if (strict) {
    results.push(`  ❌ ${msg}`)
    failed = true
  } else {
    results.push(`  ⚠️  ${msg}`)
  }
} else if (touchedChangelog) {
  results.push("  ✅ Changelog entry is part of this diff.")
}

// --- summary + the part no script can do -------------------------------
process.stdout.write("\n" + "─".repeat(70) + "\n")
process.stdout.write(results.join("\n") + "\n")

process.stdout.write(`\n${bold("Still on you — CI does not check these:")}\n`)
process.stdout.write(`
  1. Smoke-test the change on seeded data, as a user would:
       pnpm db:reset && pnpm dev        (staging-shaped, sanitized data)
`)
if (touchedAuthConfig || !changed.length) {
  process.stdout.write(`  2. supabase/config.toml [auth] only drives the LOCAL stack. Reconcile
     the STAGING Supabase dashboard by hand — a deploy will not:
       - Auth ▸ URL Configuration: Site URL + redirect allowlist (…/**)
       - Auth ▸ Email Templates: body matches supabase/templates/*.html
         (deploy the code FIRST — a token_hash template on an older deploy
          dead-ends every reset; the reverse order is safe)
       - Auth ▸ Emails ▸ SMTP Settings: custom SMTP is set. The built-in
         provider mails only Supabase org members, 2/hour, so an end-to-end
         auth-email test cannot pass on it.
`)
}
process.stdout.write(`  3. You are merging into staging, not main:
       git log --oneline origin/staging..HEAD

  Full routine: docs/pre-staging-checklist.md
`)

process.stdout.write(
  failed
    ? `\n\x1b[31m✗ preflight failed — fix the above before pushing.\x1b[0m\n`
    : `\n\x1b[32m✓ preflight passed.\x1b[0m\n`,
)
process.exit(failed ? 1 : 0)
