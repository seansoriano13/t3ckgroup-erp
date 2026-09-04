## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `seansoriano13/t3ckgroup-erp`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root, created lazily as needed. See `docs/agents/domain.md`.

### Branch topology

`staging` is the permanent integration branch — everything accepted but not yet
released. `main` is stable: what is actually deployed to production (Vercel deploys
every push to `main` immediately, no gate — see `docs/adr/`). Work lands on `staging`
first; it reaches `main` on release, never the other way except a deliberate hotfix.

When `main` is ahead of `staging` — legitimate for a hotfix, but a state someone should
decide about rather than let sit — `scripts/hooks/pre-push` warns on push and lists the
commits. It only warns; it never blocks.

### Database migrations

Name new migrations with a UTC timestamp prefix — `20260831143022_name.sql` — never the
next sequential number. Sequential numbering collides silently across branches: git
merges the two files without a conflict because their names differ, and Supabase then
applies only one of them. Existing numbered migrations keep their names; do not
renumber anything a ledger has already recorded. See `docs/adr/0007-timestamped-migration-filenames.md`.

Migrations are applied by CI only, never from a developer machine. Pushing to
`staging` applies pending migrations to the staging database automatically
(`.github/workflows/migrate-staging.yml`); production only applies via a manually
triggered workflow (`.github/workflows/migrate-prod.yml`) — a human decides *when*,
but never runs the command by hand. `scripts/hooks/pre-push` prints a one-line
reminder of this whenever a push includes changes under `supabase/migrations/`.

`supabase/schema/{prod,staging}.sql` are generated, read-only mirrors of each
database's live schema — never edit or apply them directly. Regenerate with
`pnpm db:snapshot:prod` / `pnpm db:snapshot:staging`; a scheduled CI job
(`.github/workflows/schema-drift.yml`) fails if either drifts from what is
actually live, which is how an out-of-band change to a database gets caught
the next morning instead of months later.

### Changelog updates

Whenever you complete a task that changes the application's behavior or UI, you must add an entry to `src/data/changelog.json` before pushing to origin. 
This ensures all users see a "What's Changed" announcement modal on their next login. Keep the descriptions high-level, simple, and easy to understand for non-technical users.
