# 3. stageRequirementService — configuration

**Blocked by:** 1

## What works after

A Super Admin can add a requirement to a Stage, choose its kind and config,
mark it required or optional, reorder a Stage's requirements, and archive
one — all through a service API, all audit-logged. Nobody who isn't a Super
Admin can write through it.

## Scope

New `stageRequirementService`, prior art `pipelineStageService.js`:

- `add` — Stage, kind, label, required/optional, kind-specific config.
- `reorder` — like `pipelineStageService.reorderStages`, a Stage's
  requirements read in the order the work is actually done.
- `archive` — soft only, never a hard delete (D21). Archiving stops future
  evaluation; existing `sor_requirement_status` rows are untouched.
- Every write is Super-Admin gated and lands an audit log entry with who
  and when (story 6). A rule that was once enforced stays visible in
  history after archiving (story 5, 30).

## Out of scope here

- The settings screen itself (ticket 4).
- Anything that reads `stage_requirements` for evaluation (that's ticket 1's
  pure module, called from ticket 2).

## Testing

Seam 2, against the fake PostgREST. Prior art: `procurementService.test.js`,
`pipelineStageService.test.js`.

- configuration writes are refused for non-Super-Admins
- an archived requirement stops blocking (verified jointly with ticket 2's
  suite, since archiving's effect is observed through `updateStage`)
- reordering and required/optional persist and round-trip

Factories gain `makeStageRequirement`; `seedPipeline` is unchanged since
requirements default to none.
