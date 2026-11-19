# Activity scheduling E2E tracker (2026-11-19)

A Playwright pass over the **Activity scheduling** module (Calendar, the New Activity form, My Activities, the HR Activities queue, Settings > Venues and Activities) on the hosted staging site (commit `1d813f3`, v1.11.3), driven with the new `playwright-cli` and a few `run-code` scripts.
Nothing was fixed. This file lists what was found and the fix for each item. The fixes are filed as spec **#1083** and its sub-issues (see the Ticket column).

**How it was checked**

- 5 mock logins on staging, each in its own browser session: Dani (Sales Executive, not a head), Aldrin (Sales Executive), Jen (head), Geane (HR Officer), 101 (Super Admin).
- Filed and walked through the whole life of an Activity: an Online Meeting, an Onsite Meeting in the Conference Room, a Hybrid Meeting in the Admin Office (with Lead, Participant and Guest), a 3-day Admin Task over a weekend, an Event. HR approved, returned, declined and cancelled. The applicant edited, sent again and cancelled.
- Clash rules: overlap, contained, touching (11:00 after 10:00 to 11:00), other Venue at the same time, and 4 parallel API calls for one slot.
- Form checks: empty and white-space purpose, end before start, end equal start, past date, cleared date, bad Guest email, same-name Guest, bad meeting link, 4,000-character purpose, year 9999, range longer than 31 days, removing days from a range.
- API checks with each person's own token: a non-HR user deciding, cancelling or editing someone else's Activity, a non-head filing an Event or Admin Task, filing in the past, a direct `PATCH` and `DELETE` on `meeting_requests`.
- Screens: Calendar month and Gantt (laptop), Calendar and form at phone width (390), Approvals > Activities (list and panel), notifications, Settings > Venues and Activities, the Activity Log.
- Script, screenshots and raw results: `scratch/activity-e2e-2026-11-19/` (not committed). Helper: `scratch/activity-e2e-2026-11-19/fileact.sh <session> '<json>'` files one Activity through the form.
- Cleanup: every test Activity is titled "E2E TEST ... safe to delete" and was cancelled or declined; the test Venues were deleted. Settings were only read.

**Not covered:** dark mode; tablet size; the Lead's own view (a person named as Lead but not the filer); Time Off warnings in the form; the reminder before an Activity starts; realtime between two open windows; printing.

**Environment notes (not app bugs):**

- The Venue list on staging has two active Venues (Conference Room, Admin Office). CONTEXT.md also names Reception, so it was not tested.
- Staging uses Event "Waits for HR" = off, so the Event Jen filed was approved at once. That matches the app default, not CONTEXT.md (see D4).
- `playwright-cli` option lists and snapshots go to `.playwright-cli/`, now in `.gitignore`.

Severity: **P1** fix before release, **P2** fix in the next pass, **P3** polish.

---

## Summary

| Area | P1 | P2 | P3 |
|---|---|---|---|
| A. Approvals and data | 0 | 2 | 2 |
| B. New Activity form | 0 | 2 | 4 |
| C. Settings (Venues) | 0 | 1 | 2 |
| D. Wording and docs | 0 | 0 | 4 |
| E. Requests | 0 | 0 | 1 |
| **Total (18)** | **0** | **5** | **13** |

No P1. The server side held up: every API attempt to decide, cancel or edit someone else's Activity, to file a type the person may not file, to file in the past, or to write the table directly was refused, and four parallel calls for one Venue slot gave one winner. The problems are in what people see and in one rule on edit.

The worst finding: **saving an edit with nothing changed sends an approved Activity back to HR** (A1). The person loses the approval, HR gets a second request, and the Lead and Participants get a second "approved" notice.

---

## A. Approvals and data

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| A1 | P2 | Open an approved Activity, press Edit, change nothing, press "Save changes": it goes back to "Waiting for HR". HR approves it again and the applicant gets a second "Activity approved" notice. "Save changes" is enabled even when nothing changed. | Dani's Conference Room booking: Approved, then no-change save, then Waiting for HR (twice). Notifications list shows two identical "approved your Activity" lines. Code: `meetingRequestService.editRequest` / `edit_meeting_request`. | The database function reports "no change" and keeps the status when no field differs. The form keeps "Save changes" disabled until something is different. A real change still goes back to HR (unchanged rule). | #1084 |
| A2 | P2 | The HR panel's History section is always empty, even for a request that was returned and sent again. HR cannot see why it is back or what changed. | `approvals:meetings-panel` text: "HISTORY" followed straight by "Why you're seeing this". `listPendingForApprover` selects `REQUEST_SELECT`, which has no `events`; `MeetingReview.jsx` reads `req.events`. | Load the request's events when the panel opens (the way `getRequest` does) and show them. | #1085 |
| A3 | P3 | After HR approves, declines or returns the last item in the queue, two toasts show: "Declined." and "This request is not waiting on you any more." The second one is wrong, HR just did it. | `scratch/.../toast-decline-1200.png`. `approvals/meetings/index.jsx:62-69`: the link check runs when the queue refresh removes the item, before `stepAfter` clears the address. | Clear the address in the mutation's own `onSuccess` before the refresh, or skip the "not waiting" toast for an id this person just decided. | #1085 |
| A4 | P3 | The "Waiting" time in the HR queue counts from the first filing. After the applicant edits or sends again, it keeps the old clock, so HR cannot tell when the request last landed on them. | HR queue still showed the original filing time for Dani's request after it was edited and went back to HR. `approvalItems.js:308`: `clockAt = created_at`. | Count from the last time it reached HR (the last FILED, EDITED or RESENT event), and show "first filed" in the panel. | #1085 |

## B. New Activity form

| ID | Sev | Finding | Where | Suggested fix | Ticket |
|---|---|---|---|---|---|
| B1 | P2 | The form can open already in error. After the default start (09:00) has passed, "New Activity" opens with today at 09:00, Send is greyed out, and the only reason ("the Activity cannot start in the past") is below Purpose. On a phone that is off screen, so Send looks broken. | `calendar:new-activity` laptop and phone. `MeetingRequestDialog.jsx:394`, `meetingDraft.js`. | Default to the next free time slot today (or the default start tomorrow when today is over). Show the reason next to the field that is wrong, and keep one summary line just above the buttons. | #1086 |
| B2 | P2 | The meeting link accepts anything: `javascript:alert(1)` and `not a url` both enable Send and are saved. Only `http(s)` links are clickable, so nothing runs, but HR approves a link that cannot work. | `calendar:new-activity` (Online, Hybrid). `draftProblem` only checks the box is not empty. | Require an `http://` or `https://` link, and say so under the box. Same check in `file_meeting_request` / `edit_meeting_request`. | #1087 |
| B3 | P3 | No limits. A 4,000-character purpose and a date in the year 9999 were both filed. The long text runs off the card in My Activities (no wrap) because it has no spaces, for example a pasted link. | `Activity 9999-12-31, Online`, My Activities screenshot. | Purpose up to 500 characters with a counter. Date no later than one year ahead. Break long words in My Activities, the Calendar panel and the HR panel. | #1087 |
| B4 | P3 | Adding a second Guest with the same name but a different email is dropped without a message, and both boxes are cleared. | `addGuest` in `MeetingRequestDialog.jsx:163`. | Treat name plus email as the key. If it is a true repeat, say "Already added." | #1087 |
| B5 | P3 | Esc closes the whole form and throws away the draft, with no question, even after a long form with people and Guests. | `calendar:new-activity`. | If anything was typed, ask "Discard this Activity?" before closing. | #1086 |
| B6 | P3 | In a range, a "To" date before "From" snaps back to "From" without a word. If the first day had been removed, the error then reads "Keep at least one day." which points at nothing the person did. | `calendar:new-activity` (Admin Task). | Show "To cannot be before From." under the box and keep the typed value until it is fixed. | #1086 |

## C. Settings (Venues)

| ID | Sev | Finding | Where | Suggested fix | Ticket |
|---|---|---|---|---|---|
| C1 | P2 | The trash button deletes a Venue at once. No question, no undo. | `settings:venues`. `VenueManager.jsx:100-110`. The database only refuses when the Venue already has Activities. | Ask "Delete Conference Room?" first (same dialog the Activity cancel uses). | #1088 |
| C2 | P3 | Venue names are unique only for the exact spelling. "e2e test venue" was accepted next to "E2E TEST Venue". Two rooms that read the same would confuse the form. | `settings:venues`. `addVenue` relies on the unique key. | Make the key case-insensitive (`lower(name)`), and check staging and prod for existing pairs before the migration. | #1088 |
| C3 | P3 | Clear a Venue's name and click away: the box stays empty, but the saved name is unchanged. The page shows a blank Venue that still exists under the old name. | `settings:venues`. `rename` returns early; the box is not reset. | Put the saved name back in the box when the new one is empty or the same. | #1088 |

## D. Wording and docs

| ID | Sev | Finding | Where | Suggested fix | Ticket |
|---|---|---|---|---|---|
| D1 | P3 | The cancel question says "The Venue is freed at once." for an Online Meeting, an Admin Task or an Event, which have no Venue. | `MeetingActions.jsx` cancel dialog. | Say it only when the Activity holds a Venue. Otherwise: "It comes off the Calendar at once." | #1089 |
| D2 | P3 | The Calendar panel names the status "Stage" ("Stage: Approved"). Stage means an SOR flow step in this app. | `calendar:detail-panel`. | Label it "Status". | #1089 |
| D3 | P3 | Old words still show: server messages say "Meeting Request" ("You cannot decide your own Meeting Request", "A meeting cannot start in the past"), the audit log type reads "Meeting request [MEETING_REQUEST]", and the HR Logs tag says "MEETING". CONTEXT.md says the screen words changed to Activity. | System Logs, HR Logs, API errors. | Reword the database messages and the log label. Keep the table and type names (CONTEXT.md). | #1089 |
| D4 | P3 | CONTEXT.md says "HR approves an Event". The app default and staging have Event "Waits for HR" off, so a head's Event is approved at once. One of the two is wrong. | `CONTEXT.md` (Activity type), `activitySettings.js:15`, Settings > Activities. | Decide with HR. Most likely fix the glossary: "an Event waits for HR only when HR switches that on". | #1089 |

## E. Requests

| ID | Sev | Finding | Where | Suggested fix | Ticket |
|---|---|---|---|---|---|
| E1 | P3 | The same data is asked for again and again. After one "Send request", the page called `calendar_entries` 5 times within 250 ms. One staging session of about 25 minutes made 570 requests: 75 `calendar_entries`, 64 `employees`, 63 `meeting_request_participants`, 56 `meeting_requests`. Each refresh runs the same `meeting_requests` select 3 times at once. | `playwright-cli requests` on Aldrin's session. Realtime hook plus several `invalidateQueries` on the same keys. | Share one query key per list, batch the invalidations after a mutation, and give `employees` a stale time of a few minutes. | #1090 |

## What held up

- Venue clashes: overlap and contained are blocked in the form with the name of who holds it; touching times and a different Venue are allowed. Four parallel API calls for one slot gave one winner (23P01) and the touching one passed.
- Rules by role: Dani (not a head) only sees "Meeting" in the type list; Jen sees all four. HR flows (approve, return with a note, decline with a note, cancel with a required reason) all worked, and every person who should hear about it was told.
- Server: deciding, cancelling or editing another person's Activity, filing a type you may not file, filing in the past, and direct table writes were all refused with a plain message.
- Calendar: a 3-day range spans Fri to Sun, a pending Activity is drawn dashed, a declined or cancelled one is gone; Gantt shows Venues, people and the pending mark; the phone layout has no sideways scroll.

## Watch list (not ticketed)

- The Settings page called "Activity Log" is the audit trail, not Activities. People may expect their Calendar Activities there. Name it "Audit Log" if it comes up again.
- On the Gantt, the Saturday and Sunday cells in a Venue row are empty (no "Free"), though a Meeting may be filed on a weekend. Probably the weekend shading; ask HR whether weekend rooms are meant to be bookable.
- Every full page load starts with "What's New" after a release (also in the HR tracker, E2).

## Decisions made for this spec

None of these change who can file, approve or cancel an Activity.

1. An edit that changes nothing is not an edit: status, queue and notifications stay as they are (A1). A real change still goes back to HR.
2. The meeting link must be a web link (B2).
3. A Venue name is the same name whatever its capitals (C2).
4. A Venue is deleted only after a question (C1).
5. CONTEXT.md follows the setting for Events, unless HR wants Events to wait by default (D4).
