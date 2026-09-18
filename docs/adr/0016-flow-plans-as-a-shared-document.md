# ADR 0016 — A Flow Plan is a shared document, not rows

## Status
Superseded by [ADR 0019](0019-flow-canvas-is-one-editing-surface.md) (issue
#186). The Sandbox mode and the `flow_plans` shared document it describes were
removed; the Flow Canvas now edits the live Sales Flow only. This ADR is kept
for the history of why the CRDT approach was chosen while it existed.

## Context

A Flow Plan (#115) is a sandbox: the same canvas as the operational Flow
Canvas, but drafting a flow rather than editing the live one. Issue #116 asked
for two people to be able to work on one plan at the same time — one adding a
Stage while the other drags a different one — with both seeing both changes,
neither losing work, and neither having to reload.

The first cut stored the plan as `JSON.stringify(...)` of React state in
`flow_plans.yjs_state`, written on every mutation. Two people on one plan would
have taken turns clobbering each other: whoever saved last replaced the whole
document, including everything the other person had just done.

`yjs` and `y-supabase` were already dependencies and imported nowhere, which is
what the ticket read as the intent this was started with.

## Decision

**The plan is a CRDT document (Yjs), and the canvas binds to it rather than
reading and writing rows.** The document's shape and every mutation on it live
in `src/lib/flowPlanDoc.js`; `SandboxFlowDataProvider` is only an adapter
between the canvas's service shape and the document's.

**Each collection is a `Y.Map` keyed by id, not a list.** Two people adding
Stages at the same time both keep theirs, and two people editing *different*
Stages never touch the same key, so nothing has to be resolved at all. Order is
a `sort_order` field rather than a position in a list, so reordering is an
ordinary field write that merges like every other one.

Where a merge genuinely cannot decide — two people renaming one Stage in the
same instant — Yjs picks a winner by client id. The point is not which name
wins but that both sessions compute the same answer, rather than each keeping
its own and disagreeing until someone reloads.

**Delivery is Supabase realtime broadcast, written here rather than taken from
`y-supabase`.** That package is unusable as published: its `main` points at
`src/y-supabase.js`, which it does not ship. It has been removed from
`package.json` rather than left as a broken invitation to the next person to
try it. What it would have provided is about sixty lines in
`useFlowPlanDoc.js`: broadcast every local update, apply every update that
arrives, and on joining ask the room for what this session is missing by
sending its state vector, which peers answer with exactly the difference. That
last part is what makes a session that dropped its connection reconcile on
return rather than overwrite what happened while it was away.

**What persists is the merged state.** `flowPlanService.saveState` applies the
stored state into the document before encoding it back out. Applying an update
is idempotent and commutative, so this costs nothing and closes the window
where a session that had missed a broadcast would otherwise persist a document
missing someone's work.

Reading and writing are still two statements, which leaves a narrower window: a
third session's save landing between them would be read by nobody and then
overwritten. The write therefore carries the `updated_at` it read as a
precondition — a compare-and-set — so a save that lost that race matches no rows
and is retried against the state that actually won. Retries are bounded and each
one re-merges; exhausting them raises rather than discarding the work silently.
A plan that has been deleted fails on the first round instead, since retrying
cannot bring the row back and reporting that as contention would tell the
person the wrong thing.

Saves are debounced, fired by whichever session made the change, and flushed on
unmount so a change made a moment before navigating away is not lost.

Plans written by the first cut still open: `loadFlowPlanState` recognises the
old JSON blob in the same column and seeds the document from it. Those rows
convert on the next save.

**Presence and live cursors move to plans (#117).** They were on the
operational Flow Canvas, which is the wrong place: that canvas edits live
records, where two people working at once is a hazard rather than a feature. A
plan is the opposite — collaborating is the entire point. `useFlowPresence`
takes a scope id and joins `flow_presence_<scope>`, so two plans open at once
never bleed their viewers into each other. `FlowDataContext` supplies that
scope: the plan's id from the sandbox provider, `null` from the live one, and
with `null` the hook subscribes to nothing. The operational canvas keeps its
`postgres_changes` subscription, which is data refresh rather than presence.

## Consequences

- The concurrency contract is tested by handing updates between two documents
  with no realtime connection involved (`src/lib/flowPlanDoc.test.js`), because
  the merge is the CRDT's job and the transport's only job is delivery. The
  transport (`src/hooks/useFlowPlanDoc.js`) and presence
  (`src/hooks/useFlowPresence.js`) are tested separately against a stubbed
  channel, the pattern `useTableRealtime.test.jsx` established — including the
  sync-request exchange itself, since "a returning session reconciles" is a
  claim about the transport, not about the CRDT.
- Two channels exist per plan — `flow_plan_doc_<id>` and
  `flow_presence_<id>` — rather than one carrying both. Document sync and
  "who else is here" fail, reconnect and get tested independently.
- `FlowPlanSandboxPage` keys the provider on the plan id, so opening a
  different plan remounts with a fresh document instead of merging one plan's
  edits into another's.
- `flow_plans.yjs_state` keeps its name, which is now accurate: it holds a Yjs
  update, not a JSON blob.
- A plan has no draft/locked lifecycle and no sale types of its own — those are
  properties of the live configuration a plan is a sketch *of*. The sandbox
  provider answers those calls with its single sandbox flow rather than
  pretending to change anything.
