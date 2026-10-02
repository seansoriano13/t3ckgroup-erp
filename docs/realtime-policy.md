# Realtime Policy

When a table gets Supabase Realtime enabled, how it's wired, and why.

## The decision is per table, not per page

Realtime is a property of a data stream, not of a screen. Decide it once per
table; pages and components just choose whether to subscribe. Deciding it
per-page risks the same table ending up realtime on one screen and stale on
another.

## When a table qualifies

Either of these is enough on its own:

- **Concurrency risk** — multiple users can plausibly act on the same record,
  and acting on stale state causes a real error (two people approving the same
  request, two people allocating the same inventory unit).
- **Push-urgency** — the user needs to know within seconds, not on next
  refresh (a new item landing in someone's queue).

"Feels snappier" is not on its own a reason — a live dashboard that's merely
nice-to-have doesn't qualify by itself.

## Every realtime table needs a tracked migration

No more enabling realtime from the Supabase dashboard and leaving it
unrecorded. As of this writing, three of the six realtime-enabled tables in
this codebase were switched on that way — `task_activity`,
`committee_task_activity`, `system_audit_logs`. That gap is acknowledged here,
not fixed retroactively, and not the norm to repeat: every table enabled after
this document exists gets a migration, the same way `sor_procurement_requests`
(0020), `sales_opportunity_logs` (0021), `tasks` (0027), and `notifications`
(#169) did.

## Two ways to enable a table, and how to choose

- **`postgres_changes`** (the publication-based model used by 0020/0021) — the
  client receives full row contents on every change. Only use this when the
  table either has a working row-level security policy that scopes who can
  read what, or its contents aren't sensitive to begin with.
- **Broadcast from a trigger** (used by 0027, `tasks`) — the client receives
  only whatever minimal payload the trigger chooses to send (typically just an
  id), never row contents. Use this when the table lacks RLS, or carries
  data that shouldn't cross the wire to every subscriber regardless of what
  they're authorized to see. It also requires a Realtime Authorization policy
  on `realtime.messages` (see 0027) — Broadcast is gated by that policy, not
  by the source table's own RLS.

Default to `postgres_changes` when RLS already covers the table; reach for
Broadcast when it doesn't and adding RLS isn't in scope for the work at hand.

A table with RLS can still choose Broadcast when its read policy is expensive.
`sales_opportunities` is the case: `sor_read` calls `sor_is_deal_team` and
`sor_always_sees`, and `postgres_changes` would run it for every change for
every subscriber on Realtime's RLS thread. The SORS register only needs a nudge
to refetch through the same RLS-filtered query it already uses, so
`20260930020000_sales_opportunities_realtime_broadcast.sql` broadcasts just the
row id, exactly as `tasks` does, and the register subscribes with
`useTableRealtime("sales_opportunities", { invalidateKeys: [["opportunities"]], debounceMs: 800 })`.
Its qualifying reason is concurrency: two people can move the same SOR.

`retail_orders` is the same shape for a different reason: push-urgency. The sync
writes it every 5 minutes, and `20261002120000_retail_sync_cron_and_realtime.sql`
broadcasts the row id of each row that actually changed (an update that wrote the
stored values announces nothing). The Retail screen subscribes through
`useRetailArrivals`, which wraps `useTableRealtime("retail_orders", { invalidateKeys:
[["retailOrders"]], debounceMs: 800 })` and also names the orders that arrived
after the first load so the screen can highlight them.

## Consumers use the shared hook

New consumers subscribe via `useTableRealtime` (`src/hooks/useTableRealtime.js`)
rather than hand-writing another `.channel()` call. It takes a table name and
the query keys to invalidate when a change arrives, and handles subscribing on
mount and tearing the channel down on unmount.

A channel that is not a table stream is outside what this hook can express:
it takes a table name and the query keys to invalidate when a row changes, and
a channel carrying neither has nothing to give it. `useFlowPresence` is the
one such channel — it carries a presence roster and cursor positions rather
than row changes, hand-writes `.channel()` deliberately, and owns the
subscribe-on-mount / tear-down-on-unmount discipline the hook exists to
standardise. The rule above still binds every consumer that *is* watching a
table.

(Flow Plans, #116–#117, once added a second such channel — `useFlowPlanDoc`,
moving CRDT document updates between people editing one plan. The Sandbox and
its `flow_plans` table were removed with [ADR 0019](adr/0019-flow-canvas-is-one-editing-surface.md);
`useFlowPresence` survives, now scoped to the live Flow Canvas.)

The hand-written subscriptions that predate this hook (in
`taskActivityService.js`, `groupTaskActivityService.js`,
`notificationService.js`, `systemAuditLogService.js`,
`ProcurementResolutionPanel.jsx`, `sor/PurchasingPanel.jsx`,
`sor/OpportunityDetailsModal.jsx`, `sor/modal/SorModal.jsx`,
`TaskActivityTimeline.jsx`, `flow-canvas/FlowCanvas.jsx`,
`group-tasks/_components/GroupTaskDetailModal.jsx` and
`ComprehensiveChatModal.jsx`) are not retrofitted onto it as part of
introducing it — that's a separate follow-up, not a prerequisite.

## Running Realtime locally

`supabase/config.toml` keeps Realtime disabled because the image the CLI pins
ships a broken library (issue #87). To see live updates on a local stack, run
`pnpm local:realtime` after `supabase start` (`scripts/local-realtime.mjs`): it
starts the last known-good image beside the stack and adds the one
`realtime.messages` policy a signed-in client needs. Re-run it after
`supabase db reset`. `pnpm local:realtime -- stop` removes it.

## Cost

Current plan: Supabase Pro — 500 concurrent connections, 500 messages/second,
500 channel joins/second, 100 channels per connection. This codebase's
realtime usage (a dozen or so subscription sites) is nowhere close to those
limits, so there's no cap here on how many tables may be
realtime-enabled. A cap picked without evidence would be worse than checking
the Supabase dashboard's realtime usage graph if this ever becomes a real
question — revisit there, not here, if it does.

## Testing

The project's fake database has no WebSocket layer — realtime subscription
callbacks never fire against it (see `docs/testing.md`). That means:

- The shared hook's *reaction* to a change (which query keys it invalidates)
  is unit-tested by mocking the Supabase client's channel entry point,
  capturing the callback the hook registers, and invoking it directly —
  bypassing the socket the same way MSW bypasses HTTP for everything else.
- The database trigger and its broadcast mechanism are not covered by the
  automated suite. `src/test/db/triggers.js` only mirrors triggers that shape
  row data; a broadcast-only trigger has no data-shaping effect to mirror,
  the same way permission-branching triggers are already listed there as
  deliberately unmirrored. Verify broadcast triggers manually against a real
  Supabase project.
