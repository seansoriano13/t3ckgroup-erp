# Deep views and links tracker (2026-11-14)

A Playwright pass over the screens people rarely see: what a notification click opens, windows that only open from another window, tabs inside a window, links to records that are gone, old addresses and signed-out pages. It ran on the local app (staging code at `e2673297`, a production build served by `vite preview`, local Supabase with the mock cast, signed in as Super Admin `101@local`).

Nothing was fixed. This file lists what was found and the fix for each item. The fixes are filed as spec **#1013** and its sub-issues (see the Ticket column).

**How it was checked**

- **Notification clicks:** `scripts/notification-click-audit.mjs` (`pnpm audit:notifications`). It plants one notification of each type for the signed-in mock login in the local database, opens the bell, clicks it, and records the address and any window that opens. 84 types: every type the code can write today, 10 old types still sitting in people's bells, and one with no record id. The test rows are removed at the end.
- **Deep views:** `scripts/deep-view-audit.mjs` (`pnpm audit:deep-views`). 92 views at laptop size (1366×650) and 60 of them again at phone size (390×844). For each one it records what the screen says, console errors, failed requests, windows that do not fit, controls that sit on top of other controls, and whether opening the view changed the address (so a link can bring it back).
- **The circled Close button:** opened in the browser at 375×812 and measured.
- **Code reading** for the parts the local data could not reach (the Calendar has no entries in November locally, the mock cast owns no tasks). These are marked "from code".

**Not covered:** other roles than Super Admin (the click targets do not depend on role, except the task ones, which were read in code); desktop push clicks (they use the same router, so the same types fail, but no push was sent); dark mode; anything that changes data.

**Environment notes (not app bugs):**

- Local realtime and the edge functions (Odoo lookups) are not running locally. Their errors are filtered out.
- The dev server took 25 to 40 seconds per page on this machine, so the pass used a production build.
- The local data stops in September 2026, so November lists are empty. That is correct.
- The SOR window shows a layout switcher bar locally ("H · Summary · two columns"). It is not in the production build.
- The "task ids in the URL" error on the Approval Center is already ticket #1003.

Severity: **P1** fix before release, **P2** fix in the next pass, **P3** polish.

---

## Summary

| Area | P1 | P2 | P3 |
|---|---|---|---|
| A. Notification clicks | 2 | 9 | 2 |
| B. Links for windows and tabs | 0 | 7 | 3 |
| C. Layout | 0 | 1 | 3 |
| D. Bad links and rare pages | 0 | 3 | 3 |
| **Total (33)** | **2** | **20** | **11** |

The headline: **43 of 84 notification types do nothing when clicked.** 32 of them are types the app writes today (every meeting, leave, overtime, undertime, Transmittal and Packing List notification). The bell just closes.

The second theme: a window often opens with **no address**. A refresh closes it, Back does not close it, and it cannot be shared. Some windows already do this right (Task, Group Task and SOR through `?open=`, the Approval Center through `?record=`, IPAS and other record pages), so the fix is to make the rest follow them.

---

## A. Notification clicks

Result of the click audit, by where the click lands:

| Lands on | Types | Count |
|---|---|---|
| Opens the record | Task (13), Group Task (9), SOR and S0 Evaluation (9), Purchase Request (6), IPAS (2) | 39 |
| Reaches the page only | Bug Report (2). No bug report exists locally, so this is expected. | 2 |
| **Nothing, bell closes** | Meeting (6), SIL (4), LWOP (4), Offset (3), Overtime (3), Undertime (3), Transmittal (8), Packing List (1), old types (10) | 42 |
| **Nothing, bell stays open** | Any type with no record id (tested with `TASK_COMPLETED`) | 1 |

| ID | Sev | Finding | Evidence | Fix | Ticket |
|---|---|---|---|---|---|
| A1 | P1 | **32 current notification types do nothing when clicked.** `MEETING_REQUEST`, `MEETING_REQUEST_DECISION`, `MEETING_APPROVED`, `MEETING_CANCELLED`, `MEETING_CHANGED`, `MEETING_REMINDER`; `SIL_LEAVE_*` (4), `LWOP_LEAVE_*` (4), `OFFSET_LEAVE_*` (3), `OVERTIME_*` (3), `UNDERTIME_*` (3); all 8 `TRANSMITTAL_*`; `PACKING_LIST_REQUESTED`. | Click audit: address unchanged, no window, bell closes. `src/utils/notificationRouter.js` has no branch for them. | Give each one a target. Approver types open the Approval Center record. Filer types open the request in My Requests. Meeting types for attendees open the meeting on the Calendar. Transmittal and Packing List types open the record page. | #1015, #1016, #1017 |
| A2 | P1 | **A task notification opens nothing when the person's task list is empty.** Both task pages wait for a non-empty list before they open the task the notification names. | From code: `src/pages/tasks/index.jsx:272` (`if (rawTasks.length > 0)`) and `src/pages/approvals/tasks/index.jsx:197` (`!q.rawTasks.length` returns). Not reproduced: the mock cast owns no tasks. | Open the task through the address (`?open=task:<id>` or the queue's `?record=<id>`), which does not depend on the list. | #1018 |
| A3 | P2 | A task opened from a notification has no address. The window opens over `/approvals/tasks` or `/tasks` and the address stays plain. | Click audit: 12 task types end on `/approvals/tasks` with the window open and nothing in the address. | Same fix as A2. | #1018 |
| A4 | P2 | Four SOR types (`OPPORTUNITY_STAGE_REVERTED`, `OPPORTUNITY_ACTION_DECISION_DUE`, `OPPORTUNITY_COSTING_INCHARGE_NEEDED`, `OPPORTUNITY_FOLLOW_UP_DUE`) open the SOR through hidden state. The address stays `/sors`. The code comment in the router says this path shows nothing to a person outside the deal team. | Click audit: lands on `/sors`, window open, no id in the address. `notificationRouter.js:162`. | Use the global window (`?open=sor:<id>`) like `OPPORTUNITY_MENTION` and `SOR_*` already do. | #1018 |
| A5 | P2 | A Purchase Request opened from a notification has no address. | Click audit: 6 types open the window, address unchanged. | The Purchase Request window gets a place in the `?open=` address. | #1019 |
| A6 | P2 | A chat notification (`TASK_MENTION`, `GROUP_TASK_COMMENT`, `GROUP_TASK_REACTION`, `GROUP_TASK_MENTION`) jumps to `/tasks` or `/group-tasks` and opens Conversations with no address. | Click audit: lands on the list page with the Conversations window open. | Conversations gets an address and opens over the page the person is on. | #1022 |
| A7 | P2 | `SOR_BID_DECISION` opens the SOR on the PMS tab, but the address does not say PMS. A refresh shows the Summary. | Click audit: `?open=sor:<id>` only. `GlobalDetailManager.jsx:29` keeps the tab in state. | The tab becomes part of the address (B2). | #1020 |
| A8 | P2 | 10 old notification types still sit in people's bells and do nothing: `UNPLANNED_ACTIVITY`, `SALES_PLAN_SUBMITTED`, `SALES_DAY_CONQUERED`, `SALES_COMMENT`, `DAY_DELETE_REQUESTED`, `ACTIVITY_DELETE_REQUESTED`, `EXPENSE_APPROVED`, `PLAN_AMENDMENT_RESULT`, `DAY_DELETE_RESULT`, `SALES_QUOTA_PUBLISHED`. | Click audit. The local copy of the data has 248 such rows. | A type with no target says so in one line ("This notification is from an older version of the portal") instead of closing silently. | #1014 |
| A9 | P2 | A notification with no record id does nothing and leaves the bell open. | Click audit (`TASK_COMPLETED` with no id). `notificationRouter.js:37` returns early. Local data has 25 such rows. | Same plain line as A8, and the bell closes. | #1014 |
| A10 | P2 | The desktop push and the pop-up toast use the same router, so they hit the same dead ends. 19 of the 33 types that push are in A1 (all the leave, overtime, undertime and meeting ones). A push opened with no tab lands on the Dashboard and stops. | From code: `src/constants/pushNotificationTypes.js`, `src/hooks/usePushNotificationClick.js`, `src/utils/notificationPopup.jsx`. | Fixed by A1's targets. Add the push path to the test. | #1014 |
| A11 | P2 | Nothing fails when a new notification type is added without a click target. The router is one long if/else chain, which is how A1 grew to 32 types. | `notificationRouter.js`. | One map from type to target, and a test that every type the code and the database can write has an entry (the same idea as `pushNotificationTypes.sync.test.js`). | #1014 |
| A12 | P3 | The bell's tabs cover Tasks and Opportunities only. Purchasing, HR and meeting notifications show under All only. `SOR_*` types are not under Opportunities because the tab matches the `OPPORTUNITY_` prefix. | `NotificationDrawer.jsx:141`. | Tabs follow the module of each type, taken from the map in A11. | #1028 |
| A13 | P3 | Only 16 types have their own icon. The other 60 or so show the plain bell. The icon list is written twice (the bell and the pop-up). | `NotificationDrawer.jsx`, `notificationPopup.jsx`. | One icon per module, kept in the map in A11. | #1028 |

---

## B. Links for windows and tabs

What already keeps its address (checked, no change needed): Task, Group Task and SOR windows opened through `?open=`; the SOR Quick View; Approval Center records (`?record=`); the HR Time Off & Overtime sheet (`?record=`); the Purchasing Dashboard panel (`?sor=`); Activity Log rows (`?open=task:`); Bid Decisions rows (`?open=sor:`); Settings tabs (`?tab=`); IPAS, Transmittal, Packing List, S0 Evaluation, Technical and Flow version pages.

| ID | Sev | Finding | Evidence | Fix | Ticket |
|---|---|---|---|---|---|
| B1 | P2 | **The PMS tab (Beta) cannot open on its own.** It lives only inside the SOR window. An IPAS and an S0 Evaluation each have their own page keyed by the record; the PMS file of an SOR does not. | `src/components/sor/modal/PmsTab.jsx` is only mounted by the SOR window. | A page for one SOR's PMS file, keyed by the SOR, built from the same sections. **Decision needed:** own page, or only a link that opens the SOR window on PMS (B2). | #1021 |
| B2 | P2 | The tabs of the SOR window (This stage, Products, PMS, History, Commission) are not in the address. Clicking a tab does not change it, so a refresh or a shared link always opens the Summary. `/sors?record=<id>&view=pms` does open on PMS, but `?open=sor:<id>` has no tab form. | Deep view audit: `sor-tab-products`, `sor-tab-pms-beta`, `sor-tab-history`, `sor-tab-commission` all "no link", laptop and phone. | The open tab is written to the address (`&view=<tab>`) and read back on open. | #1020 |
| B3 | P2 | **Opening a Purchase Request by its link wipes the link.** `/purchasing?request=<id>` opens the window and the address becomes `/purchasing`. A refresh closes it. The Chat tab has no address either. | Deep view audit: `purchase-request-window` ends on `/purchasing`; `purchase-request-chat-tab` "no link". `src/hooks/useRequestInGlobalWindow.js`. | The window keeps its address while open, and its tab too. | #1019 |
| B4 | P2 | A Group Task opened by clicking its row on Group Tasks has no address, though `?open=group-task:<id>` exists and works. My Tasks rows do the same (from code: `setViewTask`). | Deep view audit: `group-task-row` "no link". | Row clicks open through the same `?open=` address. | #1023 |
| B5 | P2 | A Calendar entry (a meeting, a leave) opens in a panel with no address. This blocks A1: a meeting notification has nowhere to point for attendees. | From code: `src/components/calendar/Calendar.jsx:261` (`selected` state). No entries exist locally in November. | The open entry is in the address (`?entry=<kind>:<id>`), with the date. | #1016 |
| B6 | P2 | The Conversations window has no address. It cannot be reopened on the same chat. | Deep view audit: `chats` opens over `/` with a plain address. | `?chat=<kind>:<id>`. | #1022 |
| B7 | P2 | 18 links pass their target as hidden state instead of an address: 5 open an SOR (`/sors` with `openOpportunityId`, including the Purchasing Dashboard and the Commission window), 13 set filters on My Tasks or the SOR Register from Dashboard cards. They break on refresh, in a new tab and when shared. | `grep 'navigate("/tasks", { state'` and `"/sors", { state'`: `purchasingDashboard.js:131`, `purchasing/dashboard/index.jsx:40`, `DealCommissionModal.jsx:128`, `OpportunityCommissionFooter.jsx:50`, `ComponentCanvass.jsx:96`, `PersonalPipelineRadar.jsx:157`, `EmployeePipelineMatrix.jsx:257`, `DashboardStats.jsx:190`, and others. | Record links use `?open=`. Filter links use query params the page already reads or new ones. | #1024 |
| B8 | P3 | More windows with no address: the Commission deal window, the Group Task template editor, Help & FAQ. | Deep view audit: `commission-deal-window`, `group-task-template-editor`, `settings-faq` "no link". | Each gets an address. | #1023 |
| B9 | P3 | Four address shapes name an open record: `?open=sor:<id>`, `?record=<id>`, `?request=<id>`, `?sor=<id>`, plus `/sors?record=<id>&view=pms`. | See the list above. | Keep `?open=<kind>:<id>` for windows that open over any page and `?record=<id>` for a page's own queue. Old shapes keep working. | #1025 |
| B10 | P3 | No window has a Copy link button. The only way to share a record is to copy the address bar. | `grep "Copy link"` finds none. | A Copy link action in the shared window header. | #1025 |

---

## C. Layout

| ID | Sev | Finding | Evidence | Fix | Ticket |
|---|---|---|---|---|---|
| C1 | P2 | **The circled one.** On a phone, the Close button of the side menu sits on top of the profile row. It covers the top 20px of the row and part of the chevron, so a tap near the top right of the name closes the menu instead of opening the profile menu. | Measured at 375×812: Close is at x 173 to 251, y 8 to 44; the profile row is at x 12 to 247, y 24 to 72. The deep view audit also flags it ("Close sits on top of 101"). `src/components/SideNav.jsx:645` places Close with `absolute top-2 right-2` and the menu body starts under it with no room left. | Put Close in the row with the profile (profile on the left, Close on the right), or give the menu body top padding equal to the button. | #1026 |
| C2 | P3 | On a phone, the SOR window's tab strip scrolls under the pinned Notes button. The last tab shows as "Co" with nothing to say more tabs are there. | Screenshot `scratch/deep-view-audit/phone/sor-tab-pms-beta.png`. | A fade at the edge of the strip, and scroll the active tab into view. | #1026 |
| C3 | P3 | On a phone, the IPAS "Your move" bar at the bottom is one line and is cut off at the right edge ("Waiting on Finance: Record"). | Screenshot `scratch/deep-view-audit/phone/ipas-print-preview.png`. | Let it wrap to two lines on a phone. | #1026 |
| C4 | P3 | The Purchase Request window has an empty band, about 50px tall, between the "Requested Items" heading and the "2 of 12 ready" card. Laptop and phone. | Screenshots `scratch/deep-view-audit/laptop/purchase-request-window.png` and `phone/purchase-request-window.png`. | Remove the empty space when nothing is selected. | #1026 |

---

## D. Bad links and rare pages

A link can point at a record that was deleted, that someone else already handled, or that the reader may not open. These screens handle it well and need no change: SOR ("SOR not found"), Purchase Request ("Request not available"), IPAS, Transmittal, Packing List, S0 Evaluation, Flow version, the 404 page, the verify page with a bad token, reset password with no token, a signed-out deep link (goes to sign in), and the old `/opportunities`, `/crm` and `/my-sors` addresses.

| ID | Sev | Finding | Evidence | Fix | Ticket |
|---|---|---|---|---|---|
| D1 | P2 | An Approval Center link to a request that is no longer in the queue shows the list and says nothing. The dead id stays in the address. This is the normal case when someone else already decided the request. | Deep view audit: `bad-approval-leave`, `bad-approval-meeting`, `bad-approval-task`. | One line: "This request is not waiting on you any more", then clear the address. If the request is decided, offer to open it. | #1027 |
| D2 | P2 | A link to a task that is gone shows nothing for 7 to 10 seconds, then the address clears. | Opened in the browser: no window and no message at 3s; address cleared by 11s. The read is retried before it gives up. | Do not retry a "not found". Say so at once. | #1027 |
| D3 | P2 | `/technical/<id>` for an SOR that is gone opens an empty window: a header and no message. | Deep view audit: `bad-technical` says only "SOR · Technical sheet". | The same "not found, or not yours to see" block the S0 Evaluation shows. | #1027 |
| D4 | P3 | A Bug Report link to a report that is gone shows the list and says nothing. | Deep view audit: `bad-bug-report`. | Same line as D1. | #1027 |
| D5 | P3 | Six screens word "not found" six ways ("SOR not found", "Request not available", "IPAS not found", "No such Transmittal", "Not found", "No S0 Evaluation yet, or it is not yours to see"). An IPAS address with a malformed id says "could not be loaded, Retry" and sends two failing requests. | Deep view audit: the `bad-*` rows. | One shared block and wording. A malformed id counts as not found, with no request sent. | #1027 |
| D6 | P3 | An `?open=` value the app does not know (for example `?open=banana:1`) stays in the address and nothing happens. | Deep view audit: `bad-open-key`. | Clear it. | #1027 |

---

## Watch list (seen, not filed)

- `/approvals/transmittals` and `/approvals/hr-verification` send a Super Admin to Task Approvals without a word. Spec #1000 (#1010) already adds a "No access" screen.
- `/super-admin` lands on Settings, System Announcements. Looks intended.
- The mock names ("101 (local)") give the avatar the initials "1(". Local only.
- On a phone, the Requested Items table in the Purchase Request window shows only Product and Qty; Stock and Status need a sideways scroll inside the table. Screen fit is spec #975.
- The IPAS record's Print button was not found by the script, so the print preview was not checked.

## Files

- Scripts: `scripts/notification-click-audit.mjs`, `scripts/deep-view-audit.mjs`.
- Raw results and screenshots: `scratch/notification-click-audit.json`, `scratch/deep-view-audit/` (not committed).
