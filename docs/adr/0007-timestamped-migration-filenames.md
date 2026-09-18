# Timestamped Migration Filenames

New migrations are named with a UTC timestamp prefix (`20260831143022_name.sql`), not
the next sequential number. Existing sequentially-numbered migrations keep their names.

Sequential numbering forces every branch to guess which number is free. Two branches
working in parallel guess the same one, and the collision does not surface as a merge
conflict, because the filenames differ — git merges them cleanly and the problem lands
silently. Supabase then keys `supabase_migrations.schema_migrations` on the numeric
prefix, so of the two files claiming a version, one is recorded and the other is never
applied and never will be. Nothing errors. The schema simply diverges from the
migration history.

This has now cost us twice. Commit `57d1778` restored a `closing_sales_id` migration
that a numbering collision had deleted. Then `0065` was claimed by both
`chat_reactions_rpc` on main and `stage_conditions_new_kinds` on staging; staging's
ledger recorded the former, so the latter never ran, and the Inclusions and Purchasing
Stage Condition kinds were rejected by the database while the application offered them
in the UI. Both were diagnosed by hand, after the fact.

A timestamp cannot collide, because it is derived from when the migration was written
rather than from what else exists in the tree. Production had already independently
adopted this convention — its ledger records `20260820065348` and its siblings — so
this also brings the repo in line with the environment it must ultimately deploy to.

We deliberately do not renumber history. Renaming a migration that a ledger has already
recorded is the mechanism that breaks ledgers, and prod, staging and the repo would each
need renaming in lockstep to stay consistent. Old migrations sort before new ones
regardless, since every timestamp is numerically larger than every four-digit number.

The one exception: a sequentially-numbered migration that has been applied *nowhere*
may be renamed to a timestamp, because there is no ledger entry to invalidate. That is
how `0065_stage_conditions_new_kinds.sql` was recovered rather than duplicated.
