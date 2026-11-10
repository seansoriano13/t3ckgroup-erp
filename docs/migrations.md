# Database migrations

Read this before touching `supabase/migrations/`, the ledger, or `supabase/schema/`.

**The migration set is append-only.** A migration's timestamp is its
*identity*, not its position. The moment any database records that identity in
`supabase_migrations.schema_migrations`, the name is frozen — permanently, on
every branch. **Never rename, renumber, reorder, delete, or edit the SQL of a
migration that exists on `staging` or `main`.** Not to fix build order, not to
move it past a remote's applied tip, not to make it match what a ledger
recorded, not to turn a red `db push` green.

When a file and a ledger disagree, **the ledger is the fact and the file is the
claim** — the ledger records what a database actually ran. Reconcile the ledger
to reflect that. Never reshape files to flatter a ledger.

This is enforced, not trusted: `.github/workflows/migration-immutability.yml`
fails any pull request that renames or deletes a migration already on
`staging`. It is git-only — no database, no secrets — so it cannot be routed
around by an unreachable project. A deliberate re-baseline (ADR 0011) is the
one legitimate exception; label the PR `migration-baseline`.

Begin every migration confusion by looking at the real divergence rather than
inferring it from a failed CI log:

```
pnpm db:ledger:check staging      # or prod
```

It prints orphan ledger rows (recorded, no file — these block `db push`
entirely), pending files, and which pending files sort before the remote's
tip. One of these remedies always applies, so there is never a reason to
rename:

| Situation | Remedy |
|---|---|
| `db push`: "Remote migration versions not found in local migrations directory" | An orphan row. If its objects **are** live, the migration ran under an older filename — `renumber` the row to the file's current version via the *Repair migration history* workflow. If its objects are **absent**, the row is a lie — mark it `reverted`. Never touch the file. |
| Your migration's timestamp sorts before the remote's applied tip | Nothing. CI runs `db push --include-all`; it will apply in filename order. |
| The set builds the wrong schema from empty (`migration-gate.yml` fails) | Add a **new** forward migration that corrects the end state. Never reorder. |
| A change reached a database outside a migration (hand-applied, or MCP `apply_migration`) | Write a **new** guarded migration (`if not exists`) that reconciles it — see `20260909140000_reconcile_sor_register_serial_no.sql`. |
| A shipped migration's SQL is wrong | Write a **new** migration that alters the result. The shipped file is history. |
| Two different files share one version, each recorded by a different database (a `main` hotfix and a staging migration) | The one exception to "never rename". Keep the file prod's ledger holds. Renumber the other to a version that still sorts **before** any later migration redefining the same objects (e.g. `…200000` → `…200001`, not past the tip), give both the `allow-out-of-order` marker, and `renumber` its row in the other database's ledger via the *Repair migration history* workflow, run from a branch that has the new filename. See #415. |

Write migrations so a re-run cannot fail, and check that the guard guards the
thing you are about to create. `drop policy if exists "<old name>"` followed by
`create policy "<new name>"` is a *rename*, not a guard — it reads as
idempotent and is not, because nothing protects the new name. That exact shape
in `20260909080000_retail_queue_atomic_approve.sql` failed with
`policy ... already exists (SQLSTATE 42710)` and stopped a nineteen-migration
backlog twelve migrations in. Postgres has no `create policy if not exists`, so
drop the name you are creating:

```
drop policy if exists "Retail handlers can view queue" on public.odoo_retail_queue;
create policy "Retail handlers can view queue" ...
```

Ledger repair happens through the *Repair migration history* workflow, never by
hand and never through an MCP `execute_sql` against a remote project — the
same rule as migrations themselves, for the same reason.
`migration repair --status applied` writes a row with **no SQL body**: it
asserts a change ran without carrying evidence that it did. Use it only once
you have confirmed the objects exist in the live database. A false `applied`
stays invisible until it isn't — `20260906104842 calendar_leaves_view` sat in
staging's ledger for days claiming a view that had never been created, which is
why `db:ledger:check` flags bodiless rows as `NO SQL BODY`.

**Dispatch the repair workflow from a branch that contains the migration
file.** `--status applied` reads the file to record it and fails with
`glob supabase/migrations/<version>_*.sql: file does not exist` otherwise —
so repairing a migration that lives only on `staging` must be run against
`staging`, not the default branch. `--status reverted` only deletes a row and
works from anywhere, which makes this easy to get wrong: the two reverts
succeed from `main` and the `applied` then fails.

Why this section is emphatic: between 2026-09-07 and 2026-09-09 four commits
renamed migrations, each a fix for the breakage the previous rename caused. The
last left two orphans in staging's ledger and blocked nineteen migrations for
two days. A rule against this already existed in this file, and was read and
broken anyway — because it stated a prohibition without a remedy for the state
you are actually standing in. The table above is that remedy; the workflow is
what makes it real.

Name new migrations with a UTC timestamp prefix — `20260831143022_name.sql` — never the
next sequential number. Sequential numbering collides silently across branches: git
merges the two files without a conflict because their names differ, and Supabase then
applies only one of them. Existing numbered migrations keep their names — like
every other migration, they are frozen (see above). See `docs/adr/0007-timestamped-migration-filenames.md`.

Migrations are applied by CI only, never from a developer machine. Pushing to
`staging` applies pending migrations to the staging database automatically
(`.github/workflows/migrate-staging.yml`); production only applies via a manually
triggered workflow (`.github/workflows/migrate-prod.yml`) — a human decides *when*,
but never runs the command by hand. `scripts/hooks/pre-push` prints a one-line
reminder of this whenever a push includes changes under `supabase/migrations/`.

This applies to an agent's tools exactly as much as a terminal: a Supabase MCP
server's `apply_migration` and `execute_sql` (DDL) are the same act as running
`supabase db push` or `psql` by hand, just through a different door — never call
either against a remote `project_id` (staging is `fpjxdyowngpnovotbzqi`, production
is `epqmberwewztzbrkhhss` — verify against `.env`, not whatever a `list_projects`
call happens to return first). `apply_migration` also doesn't use the migration
file's own filename — it stamps the version by wall-clock time when it runs, so a
file applied this way and then committed will *always* disagree with what CI's
ledger already expects, which is exactly the "before the last migration on remote"
class of failure this section exists to prevent. Prove a migration against the local
stack (`supabase db reset` / `supabase migration up`, or `execute_sql` against a
local Postgres — never a remote `project_id`), then commit and let the push trigger
CI.

`supabase/schema/{prod,staging}.sql` are generated, read-only mirrors of each
database's live schema — never edit or apply them directly. Regenerate with
`pnpm db:snapshot:prod` / `pnpm db:snapshot:staging`; a scheduled CI job
(`.github/workflows/schema-drift.yml`) fails if either drifts from what is
actually live, which is how an out-of-band change to a database gets caught
the next morning instead of months later.

`supabase/migrations/` is baselined (`20260904000000_baseline_schema.sql`,
issue #87; see `docs/adr/0011-migration-baseline.md`): the files alone build
the full schema from nothing, not just what changed most recently. A pull
request touching `supabase/migrations/**` runs
`.github/workflows/migration-gate.yml`, which boots a throwaway local
Postgres, applies the baseline and every migration from empty, and asserts
the result matches `supabase/schema/staging.sql` using the same comparator
(`scripts/db-snapshot.mjs`) the drift job uses. A migration that does not
apply cleanly, or produces the wrong schema, cannot reach staging. Run the
same check locally before pushing:

```
supabase start
node scripts/db-snapshot.mjs --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres --check --against supabase/schema/staging.sql
```

**Author a migration against the local database, never against staging or
production directly.** Two ways in, both write a normally-committed file
under `supabase/migrations/` with a correctly timestamped name — nothing
about them bypasses "CI applies migrations, not a developer machine" above,
they only decide how the file's SQL gets written:

- Hand-write the SQL: `supabase migration new <name>` scaffolds an empty
  timestamped file; edit it directly, then `supabase db reset` to prove it
  applies cleanly from empty (this replays the whole migration set, same as
  `migration-gate.yml` does on a PR).
- Extract it from a live change: edit the schema directly against the local
  database (Studio's table editor, or raw SQL through any client pointed at
  `127.0.0.1:54322`), then `supabase db diff --local -f <name>` — it diffs
  the local database against what `supabase/migrations/` would build and
  writes the difference as a new migration file. Review the generated SQL
  before committing; a diff tool doesn't know your intent, only the before
  and after.

A migration that changes the schema also updates
`supabase/schema/staging.sql` in the same PR, since that is what the gate
compares against: `supabase db reset`, then `pnpm db:snapshot:local`, and
commit the diff with the migration.

Either way, re-run the `db-snapshot.mjs --check` command above before
pushing — it's the same check the PR gate runs, just faster to get feedback
from locally.

**A row the application needs to function travels in a migration, not a
script.** A lead source, a pipeline stage, a leave category, a commission
rate — anything the app requires to exist — belongs in an idempotent `insert`
inside a migration, so it reaches staging and production through the same
reviewed path as a schema change. There is no longer a script that writes
such rows straight to a live project with the anon key.
