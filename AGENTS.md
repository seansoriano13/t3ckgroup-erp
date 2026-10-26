## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `seansoriano13/t3ckgroup-erp`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root, created lazily as needed. See `docs/agents/domain.md`.

### UI Primitives

Anything in `src/components/ui/` is a **Primitive**. Never write raw `<button>`, `<input>`,
`<textarea>`, `<select>`, `<label>`, `<table>`, `<img>`, `<a>` or a hand-rolled full-screen
modal outside that folder — use the Primitive. The catalog is DESIGN.md → Components →
"Primitive catalog" (what to use, its props, what it replaces). If no Primitive fits,
**stop and ask the maintainer**; don't hand-roll a workaround. **Never disable the lint rule**
(`eslint-disable`) for this. There is no baseline: `pnpm lint:primitives` fails on any raw
covered HTML (CI blocks on it). See `docs/adr/0025-one-primitive-system-enforced-by-lint.md`.

Every routed Page renders through **PageShell** (`ui/PageShell.jsx`), directly or through a
layout that does; PageHeader renders only inside it. `local/require-page-shell` enforces
this in the same gate and can't be disabled inline either. See DESIGN.md → "Pages" and
`docs/adr/0029-pages-share-one-skeleton-pageshell-and-page-types.md`.

### Branch topology

`staging` is the permanent integration branch — everything accepted but not yet
released. `main` is stable: what is actually deployed to production (Vercel deploys
every push to `main` immediately, no gate — see `docs/adr/`). Work lands on `staging`
first; it reaches `main` on release, never the other way except a deliberate hotfix.

When `main` is ahead of `staging` — legitimate for a hotfix, but a state someone should
decide about rather than let sit — `scripts/hooks/pre-push` warns on push and lists the
commits. It only warns; it never blocks.

**Purchasing is built on `integrate/purchasing`, not `staging`.** The
purchasing module (#209's tickets onward) lives on one long-lived branch,
checked out in its own worktree (`../t3ckgroup-erp-purchasing`), so `staging`
stays releasable for bug fixes. Commit each ticket straight onto
`integrate/purchasing` (`feat(purchasing): … (#NNN)`), with its tests green and,
for a schema ticket, the policy tier too. Never commit purchasing work to
`staging` or branch a purchasing ticket off it.

- **Keep it current:** after every push to `staging`, merge `staging` into
  `integrate/purchasing`. Merge, never rebase: the branch is pushed.
- **It lands once, as a complete slice** (first slice: the #209 block, #303–#314
  and #318). Re-stamp its migrations to sort after staging's newest one: they
  have never been on `staging` or `main`, so this is not the rename the
  migration rules forbid. Then open a PR `integrate/purchasing → staging`, so
  the migration gate and policy tests run before anything reaches the staging
  database.
- **Short soak:** merge to `staging` only when it can ship to `main` within 2–3
  days. A bug found in that window is fixed on `staging` and ships with it; a
  `hotfix/*` off `main` is for a production outage only.
- **One local Supabase stack** serves both worktrees: `pnpm db:reset` when you
  switch between them, or the other branch's migrations are in the way.

### Local-first development

Default to the local Supabase stack (see "Local development" below) for
anything that touches data — testing a fix, checking a query, exploring the
schema, reproducing a bug. `STAGING_DB_URL` and `PROD_DB_URL` in `.env.local`
exist only for the specific scripts that already use them
(`scripts/db-snapshot.mjs`'s drift checks, `scripts/seed-dump.mjs`'s
read-only pull, `scripts/db-ledger-check.mjs`'s ledger diff) — reaching
either database any other way, including an ad hoc query to "just check
something," is not part of the local workflow.

Schema changes follow the same principle one level up: CI applies
migrations, never a developer machine or an agent acting as one (see
"Database migrations" immediately below) — `supabase db reset` against the
local stack is how a migration gets proven, not how it reaches staging or
production.

### Database migrations

Read `docs/migrations.md` before you touch `supabase/migrations/`, the migration ledger or
`supabase/schema/`. Three rules hold even before you read it: the migration set is
append-only (never rename, renumber, reorder or edit a migration that is on `staging` or
`main`); CI applies migrations, never a developer machine or an MCP tool (`apply_migration`,
remote `execute_sql`); author and prove every migration on the local stack.

### Local development

Read `docs/local-development.md` for setup, resets, seed data, the magic login and the
local edge functions. `pnpm dev` talks to local Supabase only; edge functions run locally
too, with real Odoo reads when `supabase/functions/.env` holds the Odoo secrets.

### Review standards

`CODING_STANDARDS.md` holds the judgement rules the reviewer applies: the render path must not throw, migration review points, data access, changelog wording. Read it when a change touches one of those.

### Changelog updates

Whenever you complete a task that changes the application's behavior or UI, you must add an entry to `src/data/changelog.json` before pushing to origin. 
This ensures all users see a "What's Changed" announcement modal on their next login. Keep the descriptions high-level, simple, and easy to understand for non-technical users.

### Shell on Windows

In the Bash tool write paths with forward slashes (`/d/Sean/t3ckgroup-erp`). Backslashes are swallowed and leave stray files in the repo root. Put scratch output in `scratch/` (gitignored).

### Running tests

Never run the whole suite (`pnpm test`, `pnpm vitest run`) while working. It is 360+
files, one forked process each, and each page test boots jsdom, MSW and a fake database
parsed from the migrations: about 20 minutes on a 4-core machine. Run only what you
touched:

- a folder or file: `pnpm vitest run src/components/ipas`
- everything that imports your change: `pnpm vitest run --changed HEAD` (or `HEAD~N`
  after committing); widely shared files such as `StatusBadge` still take ~10 minutes
- pure logic only: `pnpm test:unit`

The full suite runs once, in `pnpm preflight`, before a push to `staging`. A test that
fails only in the full run and passes alone is load flake; say so, don't chase it.

### Pushing to staging

Pushing to `staging` auto-applies pending migrations to the staging database and
deploys the staging site, so a finished feature or bug fix goes through a fixed
routine first: run `pnpm preflight` and walk `docs/pre-staging-checklist.md`. The
mechanical gates (lint, tests, build, and — when `supabase/migrations/**`
changed — the local schema check `migration-gate.yml` runs) are in `preflight`;
the checklist adds what CI can't see, chiefly a smoke test on seeded data and
reconciling any `[auth]` change in `supabase/config.toml` against the staging
Supabase dashboard, which a deploy does not touch.
