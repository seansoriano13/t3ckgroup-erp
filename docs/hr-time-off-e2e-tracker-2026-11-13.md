# HR and Time Off E2E tracker (2026-11-13)

A Playwright pass over the **HR / Time Off & Overtime** module on the local app (commit `95ce756e`, a production build served by `vite preview`, local Supabase with the mock cast).
Nothing was fixed. This file lists what was found and the fix for each item. The fixes are filed as spec **#1000** and its sub-issues (see the Ticket column).

**How it was checked**

- 4 roles, each signed in with its own mock login: employee (`dani@local`, Sales / NGO), HR Assistant with `can_manage_leaves` (`ysabelle@local`), HR Officer (`geane@local`), Super Admin (`101@local`).
- 33 screens and dialogs at 4 sizes: phone 390×844, tablet 820×1180, laptop 1366×650, desktop 1920×950. 132 captures plus 4 follow-up captures of the HR detail panel.
- Every capture recorded console errors and warnings, failed requests (HTTP 400+), sideways overflow, dialogs that do not fit, text under 11px, tap targets under 24px and buttons with no name.
- Empty submits were tried on the File Time Off form. No valid form was submitted, so no data changed.
- Script, screenshots and raw results: `scratch/hr-e2e-2026-11-13/` (not committed). Re-run: `node scratch/hr-e2e-2026-11-13/hr-e2e.mjs <out-dir>` with `vite preview` on port 4173.

**Screens covered:** My Requests (list, calendar), File Time Off / Overtime (4 tabs, empty submit), Calendar, My Profile, Time Off & Overtime (Pending, Calendar, Request History, Document Center, Employee Balances, detail panel, File for Employee), HR Management (Employees, Categories Config, Leave & Form Config, Add and Edit Employee), Approval Center (Time Off & Overtime list and panel, HR Verifications list and panel).

**Not covered:** dark mode; actually approving, declining or printing (all change data); the TG-11/TG-12 print output; the Gantt view.

**Environment notes (not app bugs):**

- The local realtime service was down, so every screen logged `WebSocket ... 503`. Start it with `pnpm local:realtime` before the next run.
- Google sign-in logs "origin is not allowed" because the test ran on port 4173, which is not on the Google client's allowed list.
- The dev server (`pnpm dev`) took 30-60 seconds per page on this machine while another test run was going, so the pass used a production build instead.
- The local data stops in September 2026, so the November views are empty. That is correct, not a bug.

Severity: **P1** fix before release, **P2** fix in the next pass, **P3** polish.

---

## Summary

| Area | P1 | P2 | P3 |
|---|---|---|---|
| A. Breaking (server errors, data) | 3 | 1 | 0 |
| B. Forms | 1 | 4 | 1 |
| C. Consistency (colors, names) | 0 | 2 | 2 |
| D. Layout and responsive | 2 | 5 | 3 |
| E. UX | 0 | 3 | 4 |
| **Total (31)** | **6** | **15** | **10** |

The worst finding is not on an HR screen: the chat list loads on every page and **times out for normal employees** (A1), and the read rule on Group Task chat messages lets **any employee read every Group Task chat** (A2).

---

## A. Breaking

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| A1 | P1 | The chat list (`get_user_active_chats`) fails with HTTP 500 "canceling statement due to statement timeout" for a normal employee. It loads on every page, so the chat button and unread counts are broken for staff. The Approval Center's Group Task list (`GET committee_tasks?...`) fails the same way. | 11 captures across 3 roles. Called directly as `dani@local`: `{"code":"57014","message":"canceling statement due to statement timeout"}`. As the database owner it returns in milliseconds, so the cost is in the row-level read rules. The timeout trace runs through `committee_task_visible` → `get_employee_id`. | `committee_tasks_read` calls `get_employee_id()` once per row (not wrapped in `(select ...)`) and runs `sor_visible_visit_ids()` / `sor_access_level()` on every row. Wrap the stable calls in `(select ...)` so Postgres runs them once, put the cheap checks (`created_by`, `evaluator_id`, membership) before the SOR checks, and narrow the RPC to the person's own tasks before it joins activity. Add indexes `committee_task_activity (task_id, created_at desc)` and `task_activity (task_id, type, created_at desc)`, `task_activity (author_id)`. Check the plan on staging with `EXPLAIN ANALYZE` as a staff user. | #1001 |
| A2 | P1 | **Every signed-in employee can read every Group Task chat message.** The read rule on `committee_task_activity` is `true` ("Enable read access for all users"). That includes Group Tasks on Restricted Stages of an SOR, which ADR 0021 says must be shut. | `pg_policies` on the local database (built from the repo's migrations). | Replace the rule with `using (public.committee_task_visible(task_id))`, the same rule the task itself uses. Check staging and prod for the same policy first (this repo's live schema has drifted before). | #1002 |
| A3 | P1 | Approval Center, HR Verifications: the "who already replied" lookup puts every pending task id into one URL (`task_activity?task_id=in.(...)`). With 260 pending tasks the URL is too long, the request fails (`net::ERR_FAILED`, CORS), and the client retries 3 times. Reply markers are missing. | `hr:hr-verification-sheet`, `hr:hr-time-off`, 7 console lines per load. Code: `src/services/tasks/taskQueryService.js:327` called from `src/pages/approvals/tasks/index.jsx:151`. | Query by author only (`select task_id from task_activity where author_id = me`) and match ids in the browser, or split the ids into chunks of 100. | #1003 |
| A4 | P2 | File Time Off: the Department Head box stays empty for anyone whose team has two heads (Sales / NGO has Grace and Shara), with no hint why. The list then shows every head in the company, by name only. | `employee:file-modal-*` at all sizes. `headResolver.resolveHead` returns nothing on a tie, by design (#138). | Keep the no-guess rule, but when there is a tie, list the tied heads first under "Your team" with the note "Your team has 2 heads. Pick the one you report to." Show each head's department and sub-department in the option. | #1005 |

## B. Forms

| ID | Sev | Finding | Where | Suggested fix | Ticket |
|---|---|---|---|---|---|
| B1 | P1 | No required field has a red asterisk: File Time Off (all 4 tabs), File for Employee, Add and Edit Employee. | `src/components/ui/FieldBox.jsx` has no `required` prop. A `RequiredMark` exists but lives in `src/components/ipas/record/FormFields.jsx:31`. | Move `RequiredMark` to `src/components/ui`, add `required` to `FieldBox`, and mark every required field in these forms. | #1004, #1007 |
| B2 | P2 | An empty submit shows the browser's own bubble, one field at a time. The custom selects (Category, Department Head) are not covered by it, so they fall back to a toast that says "Please fill in all fields." without naming the field. | `employee:file-modal-overtime-empty-submit`; `ApplyLeaveModal.jsx:321-328`. | Validate in the form: show a red line under every missing field at once, scroll to the first, and keep the toast for server errors only. | #1004 |
| B3 | P2 | Each tab has a different submit button: Overtime "Submit Request" (dark), Offset "Apply for Leave" (blue), Leave "Apply for Leave" (green), Undertime "Submit Request" (dark). An Offset is not a leave (CONTEXT.md). The balance number is blue on one tab and green on another. | `ApplyLeaveModal.jsx:701, 811, 817, 955, 961, 1064`. | One primary button style for all tabs. Labels: "File overtime", "File Offset", "File leave", "File undertime". Balance in plain ink. | #1004 |
| B4 | P2 | You can fill in an Offset or SIL with 0 hours available. The error only comes after Submit, from the server. "0 hrs" is shown in green, which reads as fine. | `employee:file-modal-offset` (Available: 0 hrs). Rule: `assertWithinAvailableBalance` in `offsetService.js:211`. | Keep the rule as it is. Show "You have 0 Offset hours. This needs 8." under the hours as soon as the hours are known, and disable the button while it is short. | #1004 |
| B5 | P2 | The File Time Off window does not use the shared `ModalShell`: its own uppercase header, a close button with no name, a "Request Overtime" heading that repeats the tab, and on phone the Leave heading wraps into two lines beside the Single day / Date range switch. | `ApplyLeaveModal.jsx:585-640`. | Move it onto `ModalShell` (compact). Drop the repeated heading. Put the submit button in the pinned footer. | #1004 |
| B6 | P3 | Add / Edit Employee: each text box is only 20px tall inside a labelled card, so the tap target is small on phone (7 per form). Full Name looks like a heading, not a field. Department and Sub-Dept are unlabelled pill buttons. "Esc to close" shows on phone. | `hr:hr-add-employee`, `hr:hr-edit-employee`. | Use the shared field component at full height, label Department and Sub-department like the other fields, show the Esc hint only on devices with a keyboard. | #1007 |

## C. Consistency

| ID | Sev | Finding | Where | Suggested fix | Ticket |
|---|---|---|---|---|---|
| C1 | P2 | Each request type has three color sets. LWOP is orange on the HR list and My Requests, pink on the Calendar. Overtime is grey on the HR list, violet on My Requests and the Calendar. | `hr/offsets/_components/leaveDisplay.js:24-28`, `offsets/_components/requestTypes.js:3-7`, `components/calendar/entryKinds.jsx`. | One map, owned by `entryKinds.jsx` (the Calendar legend is what people learn), imported by the other two. | #1006 |
| C2 | P2 | The same leave has four names: "Leave" (form tab), "SIL" (balances, filters), "SIL Leave" (Approval Center title, which says "Leave" twice), "Request Service Incentive Leave" (form heading). | Approval Center panel, form, lists. | "SIL" everywhere a type is named, "Service Incentive Leave (SIL)" only in the form's help line. The form tab stays "Leave" (it holds SIL and LWOP). | #1006 |
| C3 | P3 | "Overdue" is red on the HR list and amber in the Approval Center for the same request. | `leaveManager:time-off-landing` vs `superAdmin:sa-approvals-leaves`. | Use the shared `StatusBadge` tone for Overdue in both. | #1006 |
| C4 | P3 | The phone top bar names the page differently from the page title: "Employee Directory" vs "HR Management"; "T3CKGROUP ERP" on My Profile; "Time Off & Overtime" on the Approval Center. | phone captures. | The top bar shows the page title. | #1010 |

## D. Layout and responsive

| ID | Sev | Finding | Where | Suggested fix | Ticket |
|---|---|---|---|---|---|
| D1 | P1 | The employee table is wider than its box at every size, even desktop (1720px of table in a 1230px box at 1920). Edit, Delete and Reissue Password are off to the right, so HR scrolls sideways for every edit. Categories Config does the same (1209 in 894). | `hr:hr-directory` all sizes. `hr/management/index.jsx:297`. | Click a row to open Edit. Keep Actions as a sticky right column. Move Balances and Role Flags into the edit window below 1600px wide. | #1007 |
| D2 | P1 | Approval Center panel on phone: icon, breadcrumb, arrows, Expand and Close share one row, so the title is squeezed to "financ rep…". Expand does nothing on a phone (the panel is already full screen). | `hr:hr-verification-sheet` phone. | On phone: arrows and Close on the top row, the title on its own full-width line below, no Expand button. | #1009 |
| D3 | P2 | Time Off & Overtime on tablet: the whole page scrolls sideways a little (757px in 734px), the view tabs are cut at "Em…" with no sign there is more, and the header buttons wrap untidily. The type chips on phone are also cut with no cue. | `leaveManager:time-off-*` tablet and phone. | Let the header actions wrap below the title. Give `TabGroup` a fade at the edge when it overflows. | #1008 |
| D4 | P2 | On the Time Off Calendar tab there are three date controls at once: the page month picker, the calendar's own month arrows and Today, and a "Today · Nov 13" chip. The page month picker also moves between the toolbar and the header when you switch tabs. | `leaveManager:time-off-calendar`, `employee:my-requests-calendar`. | Hide the page month picker on the Calendar tab. Keep it in one spot (the toolbar) on the other tabs. Drop the "Today · Nov 13" chip where a Today button is already shown. | #1008 |
| D5 | P2 | Laptop 1366: the Pending toolbar squeezes the search box to "Search employ". | `leaveManager:time-off-landing` laptop. | Give the search a minimum width and fold Company and Date into the Filters menu below 1440px. | #1008 |
| D6 | P2 | Approval Center list on phone: the requester's name is cut ("Sean D…", "Geane …") while half the card is empty. | `superAdmin:sa-approvals-leaves` phone. | Put the name on its own line at full width. | #1009 |
| D7 | P2 | Side menu: the group that holds the current page can stay closed ("Human Resources" closed while on HR pages), so you cannot see where you are. Labels are cut at 1366 ("Commission Dashbo…", "Time Off & Over…"). | all laptop captures. `SideNav.jsx:106-145`. | Always open the group of the current page (without changing the saved choice). Show the full label as a tooltip when it is cut. | #1010 |
| D8 | P3 | The quick-reply chips under the decision box are cut with no cue ("Incomplete documentati…"). | Approval Center panels, laptop and phone. | Wrap them, or add the same edge fade as D3. | #1009 |
| D9 | P3 | "File  for Employee" has a double gap. | `hr/offsets/index.jsx:378` (a leading space plus the button gap). | Remove the leading space. | #1008 |
| D10 | P3 | Document Center: the empty preview text sits at the very bottom of a tall empty box. | `leaveManager:time-off-documents`. | Center it, and shorten the box when nothing is queued. | #1008 |

## E. UX

| ID | Sev | Finding | Where | Suggested fix | Ticket |
|---|---|---|---|---|---|
| E1 | P2 | The Approval Center leave panel does not show how many hours the employee has left. The HR list does ("42.5 hrs available"). A head approves blind. | `superAdmin:sa-approvals-leaves-sheet`. | Add an "Available" row for SIL and Offset, with the same "after this: X hrs" math the HR list uses. | #1009 |
| E2 | P2 | "What's New" opens for every person on every release, even when the release only touches a module they cannot open. A Sales Executive gets a full-screen popup about Canvass. It blocks the first screen each day there is a release. | every first load. `ChangelogModal.jsx:22-33`. | Tag each `changelog.json` entry with the modules it touches. Open the popup only when it touches a module the person can open. Otherwise mark it seen and show a dot on Release Notes in the menu. | #1011 |
| E3 | P2 | Opening a page you cannot use sends you to the Dashboard with no message. The HR Assistant opening Approval Center → Time Off & Overtime lands on Dashboard and does not know why. | `leaveManager:approvals-leaves`. `ProtectedRoute.jsx:36-68`. | Show a "You don't have access to this page" screen that says which access it needs and links home. Permissions do not change. | #1010 |
| E4 | P3 | My Requests: the empty state says "matches this filter" when no filter is on, and offers no way to file. A pending request from another month is hidden by the month filter. | `employee:my-requests`. | Copy: "Nothing filed in November 2026." plus a File Time Off button. Show pending requests from any month in a "Still pending" group above the month's list. | #1012 |
| E5 | P3 | My Profile: the subtitle says "manage ... access levels" (you cannot), the disabled "Save settings" is faded red and looks broken, and a raw System ID (UUID) is shown. The UUID also shows in the employee table and the Edit Employee header. | `employee:profile`, `hr:hr-directory`. | Subtitle "Your details, signature and appearance." Hide Save until something changes. Show the UUID only to Super Admins, behind a "Copy ID" button. | #1012, #1007 |
| E6 | P3 | HR detail panel shows rows that do not apply: Category for overtime, and From, To and Days for a single day. | `followup:pending-sheet`. | Show only the rows that apply to the request type. | #1008 |
| E7 | P3 | HR Verification panel says "submitted 220 days ago" and "Waiting 183 days" side by side. Both are right but read as a contradiction. | `hr:hr-verification-sheet`. | Label it "Waiting for HR: 183 days". | #1009 |

## Watch list (not ticketed)

- **Start-up time:** every full page load shows "Loading portal…" for a median 3.7s (90th percentile 4.5s) on the production build. The machine was busy, so measure on staging before acting.
- **Login console:** `google.accounts.id.initialize() is called multiple times`. `GoogleLogin` with `useOneTap` sets Google sign-in up twice. Harmless today.
- **Initials:** names with brackets show odd initials ("Dani (local)" → "D("). Only test accounts have brackets.

## Decisions made for this spec

None of these change who can do what, what gets approved, or how balances move.

1. Group Task chat messages follow the Group Task's own read rule (A2). That is the existing rule for the task, applied to its messages.
2. A tie between two heads is still never guessed. The form only explains it and lists the team's heads first (A4).
3. The Calendar's colors are the single source for request types (C1).
4. "SIL" is the type name everywhere; "SIL Leave" goes away (C2).
5. The balance rule stays on the server; the form only warns earlier (B4).
6. "What's New" is filtered by the modules a person can open; the Release Notes page still lists everything (E2).
7. Blocked pages explain themselves instead of bouncing (E3); access rules do not change.
8. The UUID is a Super Admin detail (E5).
