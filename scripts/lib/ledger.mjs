// The comparison behind scripts/db-ledger-check.mjs, kept pure so the gate's
// pass/fail rule is unit-tested (#332) without a database.

const MIGRATION_FILE_RE = /^\d{14}_.*\.sql$/;

// Ledger rows that name a different migration than the file now at their version, already dealt
// with. A misnamed row means the file at that version may never have run: the ledger counts it as
// applied because the version matches. 20261104120000: prod applied group_task_reopen under it
// before that file was renumbered to 20261105060000, so requested_item_new_status_words never ran
// on prod; 20261201125000_676_status_words_on_prod makes its change there.
export const KNOWN_MISNAMED = new Map([["20261104120000", "group_task_reopen"]]);

/**
 * @param {{ ledger: Array<{version: string, name?: string, stmt_count?: number}>, files: string[] }} input
 *   `ledger` is supabase_migrations.schema_migrations, `files` the names
 *   under supabase/migrations/. `includeAll` mirrors `db push --include-all`:
 *   out-of-order pending files are tolerated (orphans still fail).
 * @returns {{ orphans, pending, outOfOrder, misnamed, remoteTip, fileCount, ok }}
 *   ok is false on any orphan (push refuses everything), any pending file
 *   that sorts before the remote tip (push skips it, or applies around it), or
 *   any ledger row whose name is not the file's at that version, unless it is in
 *   KNOWN_MISNAMED (the file may never have run, and push will never run it).
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

  const fileName = new Map(migrationFiles.map((f) => [f.slice(0, 14), f.slice(15, -4)]));
  const misnamed = sortedLedger
    .filter((r) => r.name && fileName.has(r.version) && fileName.get(r.version) !== r.name)
    .map((r) => ({
      version: r.version,
      ledgerName: r.name,
      fileName: fileName.get(r.version),
      known: KNOWN_MISNAMED.get(r.version) === r.name,
    }));

  return {
    orphans,
    pending,
    outOfOrder,
    misnamed,
    remoteTip,
    fileCount: migrationFiles.length,
    ok:
      orphans.length === 0 &&
      (includeAll || outOfOrder.length === 0) &&
      misnamed.every((m) => m.known),
  };
}
