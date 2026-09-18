# Staging Is a Working Environment, Not a Refreshable Mirror

Supersedes [0005](0005-staging-environment-data-strategy.md).

ADR 0005 described staging as an isolated Supabase project periodically refreshed by
a sanitized dump from production, kept synchronized by `scripts/sync-data.mjs` (and its
shell sibling `scripts/sync-staging-db.sh`). That stopped being true once people began
working directly in staging: it now holds Flow Canvas configuration (issue #36) —
`sale_types`, `sales_flows`, `flow_stages`, `flow_edges`, `flow_plans`, `flow_snapshots`,
`sor_condition_status` and related tables — that exists nowhere else, built up over
weeks of exploratory work with real users on staging exercising it.

`scripts/sync-data.mjs` truncates 39 tables including `employees`, and because
`TRUNCATE ... CASCADE` ignores `ON DELETE` rules and follows references transitively,
every one of those Flow Canvas tables was reachable from that truncate and would have
been emptied by the next sync. The direction ADR 0005 assumed — production is the
source of truth, staging is disposable — had already inverted: staging is now
*upstream* of production, holding work production has not seen yet.

## Decision

Staging is a permanent working environment, matching the branch topology in
[0008](0008-branch-topology-and-deploy-triggers.md): `staging` the branch and staging
the database both hold everything accepted but not yet released. It is never bulk
truncated or overwritten from production again.

`scripts/sync-data.mjs` and `scripts/sync-staging-db.sh` are deleted rather than
guarded — there is no safe mode for a script whose only job is truncating tables that
may hold unreleased work nobody wants to lose.

Fresh, realistic data now flows the other way: [issue #87](../..) adds a local
Supabase stack seeded from a *sanitized dump of staging* (`pnpm db:seed:dump` /
`db:seed:restore`), never written back. Local is where fresh, disposable,
production-shaped data goes; staging is where real work happens undisturbed.

`supabase/sanitization.sql` — the SQL script this decision's PII scrub used to run
immediately after each production→staging import — is deleted along with the import
it supported. The same rules continue as `src/lib/seedSanitize.js`, a tested pure
function module the local seed-dump script applies before anything touches a laptop.

## Consequence

Staging schema and staging data can now diverge from production for extended periods
(Flow Canvas already had, unnoticed, for weeks) — this is accepted, not a defect: it is
what "staging is upstream" means. `.github/workflows/schema-drift.yml` still catches an
out-of-band *schema* change to either database; nothing now claims staging's *data*
should match production's.
