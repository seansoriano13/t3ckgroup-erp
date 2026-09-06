# ADR 0012 — Server-Side Projection for the Employee Leave Calendar

## Status
Accepted

## Context

The shared leave calendar lets every employee see who is out on a given day.
To render those cards the calendar previously called `getAllOffsetLeaves` and
`getAllSilLeaves` — the same queries used by HR — and relied on a component
flag (`canViewAllReasons`) to hide colleagues' leave reasons in the UI.

That approach is client-side masking: the `reason`, employee `signature_path`,
and hours-balance fields were already present in the network response and visible
to any employee who opened DevTools or inspected their browser's network tab.
Leave reasons are frequently medical. Shipping them to every browser is a
structural privacy exposure, not just a UI gap.

ADR 0002 accepted client-side masking for commission figures as an interim
state under the existing single-tier anon-key model and noted that a future
backend projection should supersede it for stronger cases. This is that stronger
case: medical data warrants a server-side boundary.

## Decision

Two dedicated query methods are added — `getCalendarOffsetLeaves` in
`offsetService` and `getCalendarSilLeaves` in `silService` — that project
only the columns the calendar actually needs:

- `id`, `employee_id`, `date`, `start_time`, `end_time`, `hours`, `status`,
  `leave_group_id`
- `employee`: `id`, `name`, `department`, `avatar_path` only
- `category`: `label` only

The following fields are **not selected** and therefore never sent to the
client in any calendar response:

- `reason` (the leave reason — frequently medical)
- `employee.sil_hours_balance` / `employee.offset_hours_balance`
- `employee.signature_path`
- `hr.*` (the processing HR officer's details, unnecessary for the calendar)

The employee-facing `Leaves & Overtime` page (`/offsets`) switches to these
methods for the calendar data fetch. HR's `Leaves Manager` page continues to
use the full-projection `getAllOffsetLeaves` / `getAllSilLeaves` methods, which
remain unchanged.

An employee still sees their **own** reason via `getMyOffsetLeaves` /
`getMySilLeaves`, which filter by `employee_id = auth.uid()` and select `*`.

## Relationship to ADR 0002

ADR 0002 accepted client-side masking for commission figures and deferred
backend row-level policies. This ADR supersedes that decision for leave data:
the privacy exposure is materially stronger (medical information vs. monetary
figures), and the fix — a narrower select column list — is achievable without
schema changes or row-level-security rewrites.

Commission masking remains client-side per ADR 0002 until a separate decision
revisits it.

## Considered Options

1. **RLS policy on specific columns** — Postgres column-level permissions could
   hide `reason` from non-HR roles. Rejected for now: it requires schema
   changes and coordination with CI migrations, and the select-projection fix
   achieves the same result immediately at the application layer.

2. **Client-side masking only (status quo)** — Rejected. The data is already in
   the browser; hiding it in the DOM does not protect it.

3. **Separate calendar database view** — A `vw_calendar_leaves` view exposing
   only the calendar columns. Considered, but adds schema complexity without
   meaningful benefit over a select projection in the service layer.

## Consequences

- A non-HR employee's browser never receives a colleague's leave reason, hours
  balance, or signature path in the calendar response.
- HR retains the full view it has today via the unchanged `getAllOffsetLeaves`
  / `getAllSilLeaves` methods.
- The `canViewAllReasons` prop on `NotionLeaveCalendar` remains correct: when
  `true` (HR view) the `reason` field is present in the data; when `false`
  (employee view) the field is absent at the source.
- No migration is required; no schema changes are made.
