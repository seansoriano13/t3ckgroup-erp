// The comparison behind scripts/db-ledger-check.mjs, kept pure so the gate's
// pass/fail rule is unit-tested (#332) without a database.

const MIGRATION_FILE_RE = /^\d{14}_.*\.sql$/;

/**
 * @param {{ ledger: Array<{version: string, name?: string, stmt_count?: number}>, files: string[] }} input
 *   `ledger` is supabase_migrations.schema_migrations, `files` the names
 *   under supabase/migrations/. `includeAll` mirrors `db push --include-all`:
 *   out-of-order pending files are tolerated (orphans still fail).
 * @returns {{ orphans, pending, outOfOrder, remoteTip, fileCount, ok }}
 *   ok is false on any orphan (push refuses everything) or any pending file
 *   that sorts before the remote tip (push skips it, or applies around it).
 */
export function analyzeLedger({ ledger, files, includeAll = false }) {
  const migrationFiles = files.filter((f) => MIGRATION_FILE_RE.test(f)).sort();
  const sortedLedger = [...ledger].sort((a, b) => a.version.localeCompare(b.version));

  const fileVersions = new Set(migrationFiles.map((f) => f.slice(0, 14)));
  const ledgerVersions = new Set(sortedLedger.map((r) => r.version));

  const orphans = sortedLedger.filter((r) => !fileVersions.has(r.version));
  const pending = migrationFiles.filter((f) => !ledgerVersions.has(f.slice(0, 14)));
  const remoteTip = sortedLedger.length ? sortedLedger[sortedLedger.length - 1].version : null;
  const outOfOrder = remoteTip ? pending.filter((f) => f.slice(0, 14) < remoteTip) : [];

  return {
    orphans,
    pending,
    outOfOrder,
    remoteTip,
    fileCount: migrationFiles.length,
    ok: orphans.length === 0 && (includeAll || outOfOrder.length === 0),
  };
}
