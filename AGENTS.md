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

**A row the application needs to function travels in a migration, not a
script.** A lead source, a pipeline stage, a leave category, a commission
rate — anything the app requires to exist — belongs in an idempotent `insert`
inside a migration, so it reaches staging and production through the same
reviewed path as a schema change. There is no longer a script that writes
such rows straight to a live project with the anon key.

### Local development

`pnpm dev` talks to a local Supabase project, not staging or production —
`.env.local` carries its URL and anon key, and Vite's env precedence means it
overrides `.env` in every mode. Nothing in a development build can reach a
remote project: there is no browser flag or env var that switches the
Supabase client to a different URL at runtime, on purpose (issue #87).

```
supabase start                      # first time: pulls images, applies every
                                     # migration from empty, prints the local
                                     # URL/anon key/Studio link
pnpm dev                            # talks to that local instance
supabase db reset                   # rebuild from the migrations, wipes local data
```

Seeing staging requires typing a different command: `pnpm dev:staging` runs
Vite in `staging` mode against `.env.staging`, which is not overridden by
`.env.local` (a mode-specific env file outranks it). There is deliberately no
equivalent for production.

Local data is disposable by design and never committed:

- `pnpm db:seed:dump` — pulls a sanitized snapshot of staging's data into a
  gitignored cache file (`supabase/.seed/`). Sanitization rules live in
  `src/lib/seedSanitize.js`, tested without a database; re-run this only when
  you deliberately want fresher data, since it's a live pull from staging.
- `pnpm db:seed:restore` — loads that cache into the local database and
  resets every account's password to `VITE_TEST_PASSWORD`, pairing with
  `VITE_ALLOW_TEST_LOGIN` so you can sign in locally as any role.
- `pnpm db:seed:snapshot` — saves the local database's *current* data before
  a deliberate `supabase db reset`, if there's a working set worth keeping;
  restore it with `pnpm db:seed:restore -- <the file it printed>`.

The edge functions (`odoo-*`) are not run locally — they need live Odoo
credentials to do anything, so `edge_runtime` is disabled in
`supabase/config.toml`. They stay declared there so "Deploy to production"
keeps auto-shipping function changes.

### Changelog updates

Whenever you complete a task that changes the application's behavior or UI, you must add an entry to `src/data/changelog.json` before pushing to origin. 
This ensures all users see a "What's Changed" announcement modal on their next login. Keep the descriptions high-level, simple, and easy to understand for non-technical users.
