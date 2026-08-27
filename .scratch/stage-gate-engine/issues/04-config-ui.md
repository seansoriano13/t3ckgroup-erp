# 4. Config UI

**Blocked by:** 3

## What works after

A Super Admin can agree a department's checklist in a meeting and have it
live on the board before the meeting ends — from a settings screen reachable
and usable on a phone, next to the existing pipeline stage configuration.

## Scope

- New screen under settings, alongside `PipelineStageManager.jsx`. Per
  Stage: list requirements in sort order, add one (kind picker across the
  five supported kinds, label, required/optional, kind-specific config
  field), drag-or-button reorder, archive with a confirmation (the only
  escape route — no override button exists anywhere, story 29).
- Mobile-usable layout — the stated use is editing it in a meeting on a
  phone, not at a desk.
- Wired to `stageRequirementService` (ticket 3) only — no direct table
  access from the UI.

## Out of scope here

- Anything on the Deal Owner side (checklist appearing on their board,
  blocked-move messaging) — ticket 6.

## Testing

Component-level only if the repo's existing convention tests settings
screens that way (check `PipelineStageManager` for the pattern to match).
The spec calls for no new browser-level test seam for this feature; don't
add one here either.
