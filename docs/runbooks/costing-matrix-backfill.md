# Costing Matrix release backfill

Ticket #468, spec #461 (Q23), [ADR 0033](../adr/0033-purchasing-tools-mount-on-sales-flow-stages.md).

Stage Actions only fire when an SOR enters a stage. An SOR already at or past the stage where its Flow Snapshot mounts Open Costing Matrix on release day would never get a matrix. `costing_matrix_backfill` gives it one. It adds rows only, never deletes, and is safe to run twice (an SOR that already has a matrix is left alone).

Super Admin or service role only. Run it through the Supabase SQL editor or a service-role client; it is not wired to any button.

## Steps

1. **Staging, dry run.** After the migration is on staging:

   ```sql
   select * from public.costing_matrix_backfill(true);   -- same as calling it with no argument
   ```

   One row per SOR, grouped by flow (`flow_id`, `flow_name`). Check the SORs and the `reason` column make sense: `would_open` for SORs at or downstream of the mounting stage, `already_has_matrix` for the ones that need nothing. Soft-deleted SORs and SORs upstream of the stage are not listed.

   `skipped_no_snapshot_edges` marks an SOR whose Flow Snapshot has no `edges` array. Its place in the flow cannot be told, and the live flow edges are deliberately not used instead, so it is reported and nothing is written for it, in dry and real runs alike. Check each one by hand and open its matrix from the SOR if it needs one.
2. **Staging, real run.**

   ```sql
   select * from public.costing_matrix_backfill(false);
   ```

   Every `would_open` row becomes `opened` with a `matrix_id`. A `failed` row names the cause in `reason` (for example, the configured Purchasing Incharge has no Purchasing access); the other SORs still ran. Fix the cause and run it again.
3. **Staging, run it again.** Every row must say `already_has_matrix` (or `failed` again for an unfixed cause, or `skipped_no_snapshot_edges` again). Nothing new is created.
4. **Prod release.** With the release migrations applied, repeat steps 1 to 3 on prod, dry run first, and compare the dry run with the staging one. Prod DDL is a manual workflow; this is a data step that follows it.

## Side effects to expect

The run uses the same code path as the action, so people named in the action's config are told as they would have been: called-in members get "Added to a deal", and the assigners get "Costing Matrix needs a Purchasing Incharge" when the config names no Purchasing Incharge.

## Not covered

Open Purchase Request needs no backfill (Lead's is optional, and NTP is ahead of every live Government SOR).
