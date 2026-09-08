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

### Local-first development

Default to the local Supabase stack (see "Local development" below) for
anything that touches data — testing a fix, checking a query, exploring the
schema, reproducing a bug. `STAGING_DB_URL` and `PROD_DB_URL` in `.env.local`
exist only for the specific scripts that already use them
(`scripts/db-snapshot.mjs`'s drift checks, `scripts/seed-dump.mjs`'s
read-only pull) — reaching either database any other way, including an ad
hoc query to "just check something," is not part of the local workflow.

Schema changes follow the same principle one level up: CI applies
migrations, never a developer machine or an agent acting as one (see
"Database migrations" immediately below) — `supabase db reset` against the
local stack is how a migration gets proven, not how it reaches staging or
production.

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

Either way, re-run the `db-snapshot.mjs --check` command above before
pushing — it's the same check the PR gate runs, just faster to get feedback
from locally.

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

**New machine (including switching between two machines you already work
from):**

```
pnpm install
cp .env.local.example .env.local     # then fill in STAGING_DB_URL, PROD_DB_URL,
                                      # VERCEL_OIDC_TOKEN from wherever the team
                                      # keeps them — everything else in the file
                                      # is already correct, see why below
supabase start                       # first time: pulls images, applies every
                                      # migration from empty
pnpm db:seed:fresh                   # pulls + sanitizes + loads a staging snapshot
pnpm dev
```

**Magic Local Login (Zero Seeding):**
To avoid needing to run `pnpm db:seed:fresh` every time you start fresh, you can use the magic local login feature.
Add these variables to your `.env.local`:
```
VITE_MAGIC_LOGIN_EMAIL=dev@local.com
VITE_MAGIC_LOGIN_PASSWORD=password123
```
This automatically pre-fills the login form on load.
When you run `supabase start` or `supabase db reset`, this user is automatically created via `supabase/seed.sql`.
If you run `pnpm db:seed:fresh` (which wipes the database and pulls from staging), the `scripts/create-magic-user.mjs` is automatically executed at the end of the script to ensure your magic account is always preserved!

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local.example` are
committed as real, working values on purpose, not placeholders — they're
derived entirely from `supabase/config.toml`'s committed `project_id` and the
CLI's default local JWT secret, so they come out identical on every machine.
Verified by deleting this project's Docker volumes outright and confirming
every key `supabase start` prints (anon, service-role, the newer publishable/
secret pair, even the S3 storage credentials) came back byte-for-byte
unchanged. There's nothing to run `supabase status` and paste in.

**Day to day, once set up:**

```
supabase start                      # resumes with your data intact — see below
pnpm dev                            # talks to that local instance
supabase stop                       # pauses; local data survives to next `start`
pnpm db:reset                       # rebuilds from migrations AND restores cached seed data (~5s total)
supabase db reset                   # rebuilds from migrations only (clean, unseeded state for tests)
```

`supabase stop` alone preserves the local database's Docker volume — your
seeded data is still there next time you `supabase start`, on this machine.
Only `supabase stop --no-backup` deletes it, so save that for a deliberate
wipe, not routine shutdown. Data does not travel *between* machines either
way — `.env.local` isn't committed, and `supabase/.seed/`'s cached dump is
gitignored — so getting a second machine to the same working state means
running the bootstrap above on it, not copying volumes across.

Seeing staging requires typing a different command: `pnpm dev:staging` runs
Vite in `staging` mode against `.env.staging`, which is not overridden by
`.env.local` (a mode-specific env file outranks it). There is deliberately no
equivalent for production.

Local data is disposable by design and never committed:

- `pnpm db:reset` — runs `supabase db reset` and immediately restores local seed
  data via `pnpm db:seed:restore`. The fastest way to reset and test migrations locally.
- `pnpm db:seed:restore` — loads the local cached dump into the local database
  (restores ~12,500 rows in ~1s via batched inserts) and resets every account's
  password to `VITE_TEST_PASSWORD`, pairing with `VITE_ALLOW_TEST_LOGIN` so you
  can sign in locally as any role.
- `pnpm db:seed:dump` — pulls a sanitized snapshot of staging's data into a
  gitignored cache file (`supabase/.seed/`). Sanitization rules live in
  `src/lib/seedSanitize.js`, tested without a database; re-run this only when
  you deliberately want fresher data from the remote staging database.
- `pnpm db:seed:fresh` — `db:seed:dump` + `db:seed:restore` chained. Use this
  only on initial setup of a fresh machine or when intentionally refreshing
  the staging cache over the network. For routine resets, use `pnpm db:reset`.
- `pnpm db:seed:snapshot` — saves the local database's *current* data before
  a deliberate reset, if there's a working set worth keeping;
  restore it with `pnpm db:seed:restore -- <the file it printed>`.

The edge functions (`odoo-*`) are not run locally — they need live Odoo
credentials to do anything, so `edge_runtime` is disabled in
`supabase/config.toml`. They stay declared there so "Deploy to production"
keeps auto-shipping function changes.

### Changelog updates

Whenever you complete a task that changes the application's behavior or UI, you must add an entry to `src/data/changelog.json` before pushing to origin. 
This ensures all users see a "What's Changed" announcement modal on their next login. Keep the descriptions high-level, simple, and easy to understand for non-technical users.
