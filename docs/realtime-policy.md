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
unrecorded. As of this writing, four of the six realtime-enabled tables in
this codebase were switched on that way — `notifications`, `task_activity`,
`committee_task_activity`, `system_audit_logs`. That gap is acknowledged here,
not fixed retroactively, and not the norm to repeat: every table enabled after
this document exists gets a migration, the same way `sor_procurement_requests`
(0020), `sales_opportunity_logs` (0021), and `tasks` (0027) did.

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

## Consumers use the shared hook

New consumers subscribe via `useTableRealtime` (`src/hooks/useTableRealtime.js`)
rather than hand-writing another `.channel()` call. It takes a table name and
the query keys to invalidate when a change arrives, and handles subscribing on
mount and tearing the channel down on unmount.

The ten realtime subscriptions across eight files that predate this hook (two
each in `taskActivityService.js` and `groupTaskActivityService.js`, one each
in `notificationService.js`, `systemAuditLogService.js`,
`ProcurementResolutionPanel.jsx`, `ProcurementPanel.jsx`,
`OpportunityDetailsModal.jsx`, and `ComprehensiveChatModal.jsx`) are not
retrofitted onto it as part of introducing it — that's a separate follow-up,
not a prerequisite.

## Cost

Current plan: Supabase Pro — 500 concurrent connections, 500 messages/second,
500 channel joins/second, 100 channels per connection. This codebase's
realtime usage (11 subscription sites as of `tasks` being added) is nowhere
close to those limits, so there's no cap here on how many tables may be
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
