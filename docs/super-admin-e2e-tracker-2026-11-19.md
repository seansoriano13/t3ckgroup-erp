# Super Admin E2E tracker (2026-11-19)

A Playwright pass over the **Super Admin** pages on the hosted staging site (`origin/staging` at `1d813f3`), driven with `playwright-cli` and a few `run-code` scripts. The module is the **Activity Log** (Task, Group Task, SOR, System and HR tabs), the old `/super-admin/*` routes, the Administration menu (Flow Canvas, Bug Reports) and the things only a Super Admin may change (System Announcements, Lead Sources, Commission rates, Flow Canvas edits).
Nothing was fixed. This file lists what was found and the fix for each item. The fixes are filed as spec **#1093** and its sub-issues (see the Ticket column).

**How it was checked**

- 4 mock logins on staging, each in its own browser session: 101 (Super Admin), Geane (HR Officer), Sean (Flow editor, `can_edit_sales_flows`), Jade (plain employee, no flags).
- Activity Log: every tab as the Super Admin; the HR Logs tab as Geane; paging to the last page of System Logs (42 pages, 2,084 rows); search with `%`, `_`, `\`, `,`, `(`, `)`, quotes, white space, `*`, 2,000 characters and an HTML string; Type, Task status, Task owner, Department and date filters (single day, reversed, future, year 1 to 9999, from only); sort; row click; phone width (390).
- Gates: nine URLs (`/super-admin`, `/super-admin/activity-log`, `/super-admin/flow-canvas`, `/super-admin/commission`, `/super-admin/lead-sources`, `/bug-reports`, `/settings?tab=announcements`, `/settings?tab=sales`, `/flow-versions/<id>`) and the side menu, for all 4 people.
- API checks with each person's own token (`localStorage['t3ckgroup-auth-session']`): read `system_audit_logs`, `task_activity`, `committee_task_activity`; write `system_audit_logs`, `crm_lead_sources`, `system_updates`, `sales_flows`, `flow_snapshots`, `commission_departments`, `commission_rates`.
- Live update: Jade wrote an audit row while the Super Admin kept System Logs open for 90 seconds.
- Script, screenshots and raw results: `scratch/super-admin-e2e-2026-11-19/` (not committed). Helper: `run-probe.sh <session> '<json calls>'` sends REST calls as that person.
- Cleanup: the 5 test rows (3 audit rows, 2 Lead Sources, 1 announcement; all titled "E2E TEST ... safe to delete" or `e2e-` ids) were deleted by the Super Admin and read back as gone. The announcement was written switched off, so nobody saw it. No Settings were changed. The Venue rows seen in the log are from the earlier Activity pass.

**Not covered:** dark mode; tablet size; the other Settings tabs (Approval Rules, Purchasing, S0 Evaluation, Reference rates) and who may write their tables; drawing and publishing in the Flow Canvas itself (only who may open and write it); the Bug Reports page; an active announcement (only a switched-off one was written); the Group Task Logs filter bug on screen (same code as B1, so it is marked "code"); the HR Logs Category filter for "Activity" (the database check in A4 already shows nothing can come back).

**Environment notes (not app bugs):**

- Staging has 2,084 audit rows, 13,307 task activity rows and 2,544 tasks, so paging and search run against a real amount of data.
- The Activity words in the log ("[MEETING_REQUEST]", "MEETING") are already filed in #1089 (item D3 of the Activity pass). They are not counted again here.
- Supabase answers 206 for a page with a count header. That is normal.

Severity: **P1** fix before release, **P2** fix in the next pass, **P3** polish.

---

## Summary

| Area | P1 | P2 | P3 |
|---|---|---|---|
| A. Who can read and write | 2 | 2 | 0 |
| B. Activity Log screen | 0 | 4 | 6 |
| **Total (14)** | **2** | **6** | **6** |

Two P1. The screens hide admin tools from normal staff, but the database does not: **any employee can write the audit log as someone else (A1)** and **any employee can add, rename and delete Lead Sources and post System Announcements (A2)**. The page gates, the Flow Canvas write rule and the Commission write rule all held.

The worst findings: **A1** (a forged audit row shows up in the Super Admin's log as written by the Super Admin), **A2** (the Super Admin-only Settings are open at the API), and **B1** (the Task status and Task owner filters do not filter, and they blank every row's subject).

---

## A. Who can read and write

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| A1 | P1 | Any signed-in employee can add rows to the audit log, with any author. Jade (no flags) wrote one row as Super Admin 101 and one as "System" (no author). The Super Admin's System Logs then showed "E2E TEST forged by Jade" under **101 (staging)**. A log that anyone can write to cannot be trusted in a dispute. | `POST /rest/v1/system_audit_logs` as Jade: 201 twice. `forged-rows.png`. Code: baseline policy `authenticated_insert_system_audit_logs` is `with check (auth.uid() is not null)`; never replaced. | The insert rule requires `author_id` to be the caller's own employee id. Rows with no author and the app's own events come from `security definer` functions only, so the browser cannot write "System". Change `addSystemEvent` / `addApprovalEvent` callers to the new path. | #1094 |
| A2 | P1 | The tools that screens call "Super Admin only" are open to every employee at the API. Jade and Sean added a Lead Source (`crm_lead_sources`, 201), Jade renamed it, switched it off and deleted it (200). Jade also posted a System Announcement (`system_updates`, 201). A live announcement shows to everyone, so any employee can write a company-wide notice. Settings tabs for Announcements and Sales Configuration are hidden for them, but only in the screen. | Jade `POST`, `PATCH`, `DELETE` on `crm_lead_sources`; Jade `POST` on `system_updates` (written switched off). All cleaned by the Super Admin. | Write rules for these two tables: Super Admin only (reads stay open: Lead Sources feed forms, live announcements feed the pop-up). Then check every other table behind a Settings tab the same way (see Not covered). | #1095 |
| A3 | P2 | The Task Logs data is open to every employee. Jade has no tasks, yet she can read all 13,307 task activity rows, including 2,045 task chat comments and 1,352 HR notes. For many of them the task itself is hidden from her (the task came back empty), so she reads the chat of a task she cannot open. Group Task chat is correctly limited (she sees 3 of 606). The Task Logs tab is "Super Admin only" on the screen. | `GET task_activity?select=*` as Jade: `content-range 0-0/13307`; the Super Admin sees the same 13,307. `task_activity?select=content,task_id,task:tasks(id)&task=is.null` returned rows. Code: policy "Enable read access for all users" is `using (true)` (`20260908101315_server_side_sor_task_visibility.sql`). | Reading a task's activity follows reading the task (the same rule `committee_task_activity` got in #1002). Super Admin keeps reading all. | #1097 |
| A4 | P2 | HR cannot see Activity events or unpaid-leave events in HR Logs. The tab asks for 8 types, the database lets HR read 6. Geane sees 0 of the 38 `MEETING_REQUEST` rows and 0 of the 1 `LWOP_LEAVE` row; the Super Admin sees all of them. So HR Logs never shows the Activities HR approved, returned or cancelled. | `count` per entity type as Geane vs 101: `MEETING_REQUEST` 0 / 38, `LWOP_LEAVE` 0 / 1, other 6 types equal. HR Logs on screen (`hr-logs.png`): no Activity rows. Code: `hr_read_system_audit_logs` lists 6 types (`20261001100000`); `HR_ENTITY_TYPES` lists 8. | Add the two types to the HR read rule. Add a test that fails when the two lists differ. | #1096 |

## B. Activity Log screen

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| B1 | P2 | The **Task status** and **Task owner** filters on Task Logs do not filter. Pick "Not approved" or "Jade (staging)": still 50 rows, the same ones, but every Subject turns into "Task e36078ac-1203-…" and the Status column goes empty. Group Task Logs has the same two lines. | `task-status-notapproved.png`, `owner-jade.png`. Rows with a status badge: 43 before, 0 after. Code: `.eq("task.status", …)` and `.eq("task.logged_by", …)` on an embedded table without `!inner`; `taskActivityService.js:143-144`, `groupTaskActivityService.js:230-231` (Group: code). Also the filter value `COMPLETE` is not what the badge shows (`COMPLETED`); check the values. | Filter the parent rows (`task:tasks!…!inner(...)` only when a filter is set), and make the status values match the real statuses. | #1098 |
| B2 | P2 | The **Department** and **Sub-department** filters only look at the 50 rows already loaded. On Task Logs, Department = ADMIN gives "No activity found, try adjusting your filters" and no "Older" button, so older ADMIN entries cannot be reached. The page also says "Older" is available only when the unfiltered page was full. | `dept-pages.png`: 0 rows, `Older` count 0. Code: `filteredEntries` in `activity-log/index.jsx:284` filters after the fetch. | Filter on the server (the creator's department) together with B1, so paging and the empty state are right. | #1098 |
| B3 | P2 | Searching for a **comma** on Task Logs shows "Failed to load activity log" with a raw database message that includes up to 500 task ids ("failed to parse logic tree ((content.ilike.%,%,task_id.in.(be8235e6-…"). The page first sits on "Loading activity log…" for several seconds while it retries. Brackets can break it the same way. | `search-comma.png`, `search-comma-after12s.png`; 2 failed requests, `PGRST100`. Code: `taskActivityService.js:164-167` builds the `.or(...)` string from the raw text. | Quote the search text inside `.or`, or find the tasks and the log lines in two queries. Show a plain message ("Could not load the log. Try again.") and do not retry a 400. | #1099 |
| B4 | P2 | **LIVE** does nothing on the Task, System and SOR tabs. A row written while the Super Admin had System Logs open did not appear in 90 seconds. The two tables are not in the realtime list (only `committee_task_activity` is). | Test row created 07:52:57, tab open 07:52:46 to 07:54:23, row never shown (`live.js`). Code: no `add table … system_audit_logs` or `task_activity` in any migration. | Add `system_audit_logs` to the realtime list. `task_activity` is large: either add it or remove the LIVE badge on Task Logs. | #1100 |
| B5 | P3 | Filters that do nothing are shown. On System Logs and SOR Logs the **Task status** chip, **Department** and **Sub-department** have no effect ("Complete" left the same 50 rows). The search box still says "task description". | `statusComplete` equals `base` in `filters.js`. Code: `isDeptFiltered` skips both tabs; `getRecentSystemActivity` has no status. | Show only the filters each tab uses. | #1101 |
| B6 | P3 | System Logs "Subject" column shows only "[HR_SETTINGS]" or "[MEETING_REQUEST]", the same thing as the badge beside Type. It says nothing about what changed. | `sys-tab.png`. Code: `taskDescription: [entity_type]` in `systemAuditLogService.js`. | Show the thing that changed (for example the Venue name or the employee) when the row has it, or drop the column on this tab. | #1101 |
| B7 | P3 | Every title that starts with "[" (for example "[PR] S07696") logs a red `Failed to parse checklist` error. First load of Task Logs: 11 console errors. | `rows.js`: 11 errors, all `Failed to parse checklist`. Code: `tryParseChecklist` `console.error`s in its `catch`. | Return quietly when the text is not a checklist. | #1101 |
| B8 | P3 | A date range that ends before it starts is accepted when typed (the picker blocks it, typing does not). The page answers "No activity found, try adjusting your filters" and does not say why. | `dates.js`: from 2026-11-19, to 2026-11-01: 0 rows, the box keeps 2026-11-01. | Swap the two dates or say "End date is before start date". | #1101 |
| B9 | P3 | On a phone the Task Logs cards leave out the Status that the laptop table shows (INCOMPLETE on the first row). | 390 px: first card text has no status; laptop row ends with INCOMPLETE. `m-task.png`. | Show the Status badge on the card. | #1101 |
| B10 | P3 | A `*` in the search box works as a wildcard (it returned all 50 rows on Task Logs and Group Task Logs). A person searching for text with a star gets everything. | `tasksearch.js`: `*` gives 50. | Escape `*` along with `%` and `_`. | #1099 |

---

## What held up

- **Page gates.** Jade and Sean get "not authorized" on `/super-admin/activity-log`; Geane gets only the **HR Logs** tab; the Super Admin gets all 5. The side menu shows Flow Canvas and Bug Reports only to the Super Admin and Sean. Old routes redirect (`/super-admin` and `/super-admin/lead-sources` to Settings, `/super-admin/commission` to the Commission Formula tab) and Settings tabs a person may not use fall back to General.
- **Flow Canvas writes.** Jade's insert into `sales_flows` and `flow_snapshots` was refused (403, 42501). Sean's got past the rule (a foreign key error, so he is allowed). Everyone else opens the canvas read-only, as ADR 0019 says.
- **Commission rates.** Jade's insert into `commission_departments` and `commission_rates` was refused (403, 42501).
- **Audit log reads.** Jade reads 0 rows of `system_audit_logs` (she sees `[]`). Geane reads only the 6 HR types. Jade's update and delete cannot touch rows she cannot read.
- **Search on System, HR and Task logs** handled `%`, `_`, `\`, quotes, white space only, 500 and 2,000 characters and an HTML string without an error (escaped `_` matched the 199 rows that really contain one). Only the comma broke Task Logs (B3).
- **Paging** is right: 42 pages, 41 x 50 + 34 = 2,084 rows; "Newer" is off on page 1 and "Older" off on the last page.
- **Dates:** a single day (25 rows for today), a future range (empty state), year 1 to 9999 and "from" only all worked, with no failed request.
- **Rows open the record.** Clicking a Task Logs row opens the task; a SOR Logs row opens the SOR.
- **Phone (390):** no sideways scroll on Task Logs, System Logs or the Filters sheet; the tabs become a menu and the table becomes cards.

## Watch list

- The Super Admin can edit and delete audit rows (`super_admin_all_system_audit_logs` is `for all`). A test row was deleted this way. If the log is meant as evidence, make it append only.
- The Task Logs "Subject" falls back to `Task <id>` when a task is hidden or deleted; after A3 is fixed, check what a Super Admin sees for a deleted task.
- The page title says "Activity Log" while the Calendar has Activities. The earlier pass suggested "Audit Log" (see the Activity tracker, watch list).
- The Settings tabs not tested here may have the same open writes as A2.

## Decisions made for this spec

- **D1.** A1 and A2 are P1 even though nobody has used them: the screen says "Super Admin only" and the database does not enforce it, and staging data is the same shape as production.
- **D2.** A3 is P2, not P1: the policy was set on purpose (see the comment in `20260908101315`), so it is a rule to decide, not a slip. The ticket asks for the narrower rule; if the team wants to keep it open, close the ticket with that decision written down.
- **D3.** The Activity wording in the log stays with #1089. This spec does not touch it.
- **D4.** Group Task Logs gets the B1 fix in the same ticket as Task Logs because the two functions are copies.
