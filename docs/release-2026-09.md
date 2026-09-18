# release/2026-09 — frozen release branch

Parent: #325 (first staging→production release). Cut from staging at `0dea7ed` (#326).

## Freeze rule

- `release/2026-09` does not follow staging. Staging keeps moving; this branch does not.
- The only changes allowed here are the preparatory tickets of #325 (#327–#333, #335), each through a reviewed PR. No direct pushes.
- Every change lands on `release/2026-09` **first**, then is cherry-picked back to `staging` (`git cherry-pick -x <sha>`). That way the rehearsal (#336) and the cutover (#338) run the same bytes, and staging doesn't drift from what ships.
- Cutover-only steps (Legacy Pipeline backfill #330, flow transfer #331) are scripts, not migrations. They are cherry-picked too, but they are never run against staging.
- Nothing else merges here. Anything that isn't a #325 preparatory ticket waits for the next release.

The cutover order, gates and rollback are in [production-cutover-runbook.md](production-cutover-runbook.md) (#335).
