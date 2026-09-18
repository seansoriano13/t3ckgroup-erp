# Production Deployment Gap

Recorded 31 August 2026, read directly from both databases. Nothing was written to
production in producing this document.

Read this before planning the next production deployment. The short version: the
Sales Flow work has not shipped to production at all, and production's migration
ledger cannot be trusted to drive the run that ships it.

## The headline problem

**Production's schema is ahead of its own ledger.** Objects exist in production that
its `supabase_migrations.schema_migrations` table has no record of creating.

Verified present in production but absent from its ledger:

| Object | Migration that creates it |
|---|---|
| `crm_pipeline_stages` table | `0033_crm_pipeline_stages` |
| `chat_read_receipts` table | `0040_chat_read_receipts_rls` |
| `sales_opportunities` ITB columns (2) | `0035_opportunity_itb` |
| `sales_opportunities.po_date` | `0039_opportunity_po_date` |
| `committee_task_members.attachments` | main's `0041_group_task_member_attachments` |
| `toggle_chat_reaction()` function | main's `0065_chat_reactions_rpc` |
| UPDATE policies on `task_activity` and `committee_task_activity`, plus `committee_task_activity` in the realtime publication | main's `0066_chat_reaction_rls_and_realtime` |

This means schema changes have been reaching production by a path that does not
record them — direct SQL, dashboard edits, or a push followed by a repair. The
practical consequence:

> A clean `supabase db push` against production would attempt to re-apply migrations
> that have in fact already run. Several are not idempotent as written — `CREATE POLICY`
> without a preceding drop, and `ALTER PUBLICATION ... ADD TABLE` on a table already
> published — so the run would fail partway, having already applied some of the
> preceding statements.

**Do not plan the Sales Flow deployment as a straight migration run.** The ledger must
be reconciled against the actual schema first, the same exercise done for staging in
the codebase-cleanup series.

## What production is missing

Production has **none** of the 13 Sales Flow tables:

`sale_types`, `sales_flows`, `flow_stages`, `flow_edges`, `flow_stage_actions`,
`flow_plans`, `flow_snapshots`, `sor_inclusions`, `sor_canvasses`,
`sor_canvass_offers`, `sor_project_evaluations`, `sor_purchase_order_links`,
`stage_conditions`

It still carries `stage_requirements` and `sor_requirement_status`, so it predates the
rename of Stage Requirements to Stage Conditions.

In feature terms, production has no Sale Types, no Sales Flows, no Flow Canvas, no
Stage Gate Engine, no Canvass, no Inclusions, no Project Evaluations, and no purchase
order rollup.

## What production already has

All of main's Group Task and chat work is live in production — member attachments,
the reaction RPC, the reaction RLS policies and the realtime publication entry —
despite none of it appearing in the ledger. Nothing from main needs deploying.

## Ordering for the eventual deployment

The Sales Flow migrations must run in their existing sequence; several depend on
their predecessors. The dependency spine is:

1. `stage_requirements` (already in production's ledger, and the table exists)
2. the role and RLS fixes that follow it
3. `sale_types` and `sales_flows`, then `flow_stages` and `flow_edges` — the graph
   itself, which everything downstream references
4. `opportunity_sale_type`, then stage positions, conditions and actions
5. the seed that maps the legacy pipeline onto a flow
6. `sor_inclusions`, then the procurement request link
7. `sor_canvasses` and `sor_canvass_offers`, then inclusion cost
8. `sor_project_evaluations`, then purchase order links
9. the rename of requirements to conditions, and the widened condition kinds
10. flow plans, colours, bracket labels, the relaxed canvas RLS, and realtime

Step 9 is the one to watch: production still has `stage_requirements`, so the rename
migration will do real work there, where in staging it has already run.

## Naming convention

Production already records migrations under the timestamp convention adopted in
[ADR 0007](adr/0007-timestamped-migration-filenames.md) — for example
`20260820065348` carrying the name `0028_commission_rates_and_departments`. The repo
now matches. Sequential filenames in the repo below `0073` are historical and stay
as they are.

## Open question for whoever plans the deployment

How did the unrecorded objects reach production? Until that path is known, any
reconciliation risks being undone the next time it is used. Worth answering before,
not after, the Sales Flow deployment.
