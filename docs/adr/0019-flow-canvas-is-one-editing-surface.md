# ADR 0019 — The Flow Canvas is one editing surface

## Status
Accepted (issue #186). Supersedes [ADR 0016](0016-flow-plans-as-a-shared-document.md).

## Context

The Flow Canvas carried two modes on one screen. **Live** edited `sales_flows`
directly. **Sandbox** bound the same canvas to a single shared Yjs document
(`flow_plans.yjs_state`, ADR 0016) so several people could sketch a flow
together without touching a live record.

The Sandbox earned its keep when the canvas was a rare, Super-Admin activity.
The Flow Canvas versioning work (#185) makes the canvas the everyday way the
Sales Flow is revised, with real version history (#192) rather than a throwaway
draft. In that world the Sandbox is a second code path that every later ticket
touching the canvas's service calls would have to fake twice — once against the
live provider, once against the Sandbox provider that reimplements the whole
service surface on top of the CRDT document.

## Decision

**The Flow Canvas is one editing surface. It always edits the live Sales Flow
on staging.** The Live/Sandbox toggle, the `SandboxFlowDataProvider`, the
shared-document module (`flowPlanDoc`), its hook (`useFlowPlanDoc`), the
`flowPlanService`, and the `yjs` dependency are removed. A migration drops
`flow_plans` — defined in the 20260904000000 baseline, so on every database the
Sandbox reached — with `drop table if exists`, safe to re-run.

**`FlowDataProvider` stays, with only the live provider behind it.** The canvas
still reaches its services through `FlowDataContext`, so a future second source
(a read-only version view, say) has a seam to attach to — but there is one
provider today, not two.

**Peer presence stays.** It is no longer tied to a Sandbox plan id: the live
provider names no presence scope, and `FlowCanvas` falls back to a
per-Sale-Type scope (`flow_presence_live_<saleTypeId>`), so everyone editing
the same flow still sees each other's avatars and node drags.

**Snapshot History stays reachable.** A Super Admin opens it from a floating
button where the mode bar used to be, until the version rail (#192) replaces
that entry point.

## Consequences

- ADR 0016's CRDT reasoning no longer describes anything in the codebase. It is
  marked superseded and kept for the record.
- The Flow Canvas tables remain writable by every signed-in employee (the
  policy tier, `src/test/policy/04-flow-canvas.test.js`), so the nav entry
  stays visible to everyone; only the Snapshot History is Super-Admin-gated.
- `flow_plans` and its RLS policies are gone. The policy tier no longer asserts
  anything about a Sandbox document.
- Later versioning tickets fake one service surface, not two.
