#!/usr/bin/env node
// Migration gate step: a migration file is named with a UTC timestamp
// specifically so `supabase db push` can order it against what staging has
// already applied (see AGENTS.md > Database migrations). That guarantee only
// holds if the timestamp is also newer than everything already on staging at
// merge time — a branch cut before another migration landed can still carry
// an earlier timestamp than staging's current tip, and `db push` then refuses
// the whole batch post-merge instead of just this file (see the incident this
// script exists to prevent: 20260908090000_department_head_approval_stage.sql
// landed after 20260908101315 was already applied to staging).
//
// This runs on every PR touching supabase/migrations/, using the PR's own
// diff against its merge-base — so it re-checks on every push/rebase and
// catches the collision before merge, not after.

import { execFileSync } from "node:child_process";

const BASE_REF = process.env.MIGRATION_GATE_BASE_REF || "origin/staging";
const MIGRATIONS_DIR = "supabase/migrations";
const TIMESTAMP_RE = /^(\d{14})_/;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function timestampOf(filename) {
  const match = TIMESTAMP_RE.exec(filename);
  return match ? match[1] : null;
}

// Every migration filename staging already has, as of the PR's merge-base —
// not the PR's own branch, which may be missing files that landed on staging
// after the branch was cut.
function existingStagingTimestamps() {
  const mergeBase = git(["merge-base", "HEAD", BASE_REF]);
  const listing = git(["ls-tree", "-r", "--name-only", mergeBase, MIGRATIONS_DIR]);
  return listing
    .split("\n")
    .map((path) => path.split("/").pop())
    .map(timestampOf)
    .filter(Boolean);
}

// Files this PR adds, whether authored fresh or renamed from something else —
// a rename still needs to clear the same bar under its new name.
function addedMigrationFiles() {
  const mergeBase = git(["merge-base", "HEAD", BASE_REF]);
  const diff = git(["diff", "--name-status", "--diff-filter=AR", mergeBase, "HEAD", "--", MIGRATIONS_DIR]);
  if (!diff) return [];
  return diff
    .split("\n")
    .map((line) => line.split("\t").pop())
    .map((path) => path.split("/").pop())
    .filter((name) => name.endsWith(".sql"));
}

const existing = existingStagingTimestamps();
const maxExisting = existing.length ? existing.reduce((a, b) => (a > b ? a : b)) : "0";
const added = addedMigrationFiles();

const stale = added.filter((name) => {
  const ts = timestampOf(name);
  return ts && ts <= maxExisting;
})

if (stale.length > 0) {
  console.error(
    `\nMigration ordering check failed: staging's ledger already has a migration timestamped ${maxExisting}.\n` +
    `The following new migration(s) are timestamped at or before that, so \`supabase db push\` will refuse them ` +
    `(and everything queued behind them) once this PR merges:\n\n` +
    stale.map((name) => `  - ${name}`).join("\n") +
    `\n\nRename the file(s) with a UTC timestamp later than ${maxExisting} (e.g. \`date -u +%Y%m%d%H%M%S\`), ` +
    `updating any comments elsewhere that reference the old filename. See AGENTS.md > Database migrations.\n`
  );
  process.exit(1);
}

console.log(`Migration ordering check passed (${added.length} new file(s), staging tip is ${maxExisting}).`);
