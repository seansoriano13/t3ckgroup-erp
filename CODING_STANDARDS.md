# Coding standards

The reviewer reads this file against a diff. It holds judgement calls only. Anything a tool can
check is a lint rule or a CI job instead: raw HTML outside `src/components/ui/` and pages that skip
PageShell (`pnpm lint:primitives`), new lint errors (`pnpm lint:ratchet`), migration renames and
deletes (`migration-immutability.yml`), a schema that no longer matches `supabase/schema/staging.sql`
(`migration-gate.yml`).

## Render path must not throw

JSX, live previews and `useMemo` or inline derivations must not call a function that throws on
half-typed input (an end date before a start date, a partial time window). The router's default error
element shows the user a raw stack trace before the app's `ErrorBoundary` can catch it. Use the
non-throwing variant on the render path: `safeDeriveHours` in `src/utils/time.js`, not `deriveHours`.
Add a `safe*` variant when none exists. Wrap submit-time validation in `try/catch` and show
`err.message` with `toast.error(...)`.

## Migrations

- A diff must not edit the SQL of a migration that is already on `staging` or `main`. CI catches a
  rename or delete, not an edit. A wrong shipped migration gets a new migration that fixes the result.
- `drop policy if exists "<old>"` followed by `create policy "<new>"` is not a guard. Drop the name
  you are about to create.
- A row the app needs to run (a lead source, a stage, a rate) is an idempotent `insert` inside a
  migration, not a script.
- A schema change updates `supabase/schema/staging.sql` in the same PR.
- Full rules and remedies: `docs/migrations.md`.

## Data access

Code and scripts reach the local Supabase stack only. Only the scripts named in `AGENTS.md`
("Local-first development") may touch the staging or production database, and none may delete
production data.

## Changelog

A change to what a user sees or can do needs an entry in `src/data/changelog.json`
(`node scripts/add-changelog.mjs`). Write it for a non-technical reader, in everyday words.
`pnpm preflight` warns when `src/` changed and the changelog did not.

## Branches

Purchasing tickets (#209 onward) commit to `integrate/purchasing`, never to `staging`. See
`AGENTS.md` ("Branch topology").
