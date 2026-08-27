# 1. Schema + pure evaluation engine

**Blocked by:** —

## What works after

The two tables the engine depends on exist, the orphan `stage_checkpoints`
column is gone, and a pure module — no database, no network — can answer
every question the gate needs asked of it. Nothing reads or writes through
this module from the app yet; that's tickets 2 and 5.

## Scope

- Migration:
  - `stage_requirements` — `stage_id` (FK), `kind` (`attachment` | `field` |
    `tickbox` | `assignment` | `deadline`), `label`, `is_required`,
    `sort_order`, `archived_at`, `config jsonb` (shape per kind — see spec's
    table under "Two new tables").
  - `sor_requirement_status` — keyed on `(sor_id, requirement_id)`,
    `satisfied_by`, `satisfied_at`. A row's absence is meaningful (D41) — do
    not pre-create rows on Stage entry.
  - Drop `sales_opportunities.stage_checkpoints` in the same migration
    (spec's flagged clarification — it's an unreferenced `jsonb` column on
    every one of the 128 production rows).
  - Mirror both tables' constraints in `src/test/db/schema.js` and
    `src/test/db/triggers.js`, per the existing convention.
- Pure module (beside `src/constants/sor.js`, e.g.
  `src/constants/stageGate.js` or similar):
  - **Crossing range** — given a stage list, a `from` and a `to` code,
    return every Stage in `[from, to)` for a forward move, and nothing for a
    backward move. Must handle multi-Stage jumps (the 17 `Lead → Awarded`
    moves in production are the motivating case).
  - **Per-kind satisfaction** — given a requirement, an SOR record, its
    members, and its status rows, return satisfied / unsatisfied /
    never-applied:
    - `attachment`, `field`, `assignment` — evaluated live against the
      record / SOR Members, no status row involved.
    - `tickbox` — satisfied iff a status row exists.
    - `deadline` — never blocks; this module still computes days
      remaining / breached for ticket 7 to render.
  - **Never-applied vs. unsatisfied** — a requirement created after the SOR
    already crossed its Stage is never-applied, not unsatisfied (D18, D41).
    This distinction must be a first-class return value, not inferred by
    the caller.
  - **Deadline arithmetic** — days remaining, breached, and the boundary
    day, from a Stage-entry timestamp (no new timestamp column — this reads
    the existing Stage-move entries in `sales_opportunity_logs`).

## Out of scope here

- Wiring into `opportunityService.updateStage` (ticket 2).
- The configuration service and UI (tickets 3, 4).
- Notifications (ticket 7).

## Testing

Seam 1 per the spec. Combinatorial unit tests against the pure module —
crossing ranges including multi-Stage jumps and backward moves, satisfaction
per kind, never-applied vs. unsatisfied, deadline boundary arithmetic. Model:
`src/constants/sor.test.js`, `src/utils/commission.test.js`.
