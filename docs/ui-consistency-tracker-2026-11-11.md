# UI consistency tracker (2026-11-11)

An audit of the app on `staging` (commit `20e939e7`), run locally as a Super Admin (`101@demo`).
Nothing was fixed. This file only lists what was found.

**How it was checked**

- 35 screens were measured by script at phone size (375 x 812): control heights, text sizes, corner radius, side gutter and sideways overflow.
- 15 of them were measured again at desktop size (1366 x 800).
- 17 phone screenshots and 3 dialogs were looked at by eye.
- The code was scanned for hand-set sizes.

**Not covered:** dark mode, tablet width, the mobile navigation drawer, the IPAS / Transmittal / Packing List record windows, the Flow Canvas beyond one measurement, and any role other than Super Admin. The IPAS list did not load on the local database ("IPAS could not be loaded"), so IPAS records were not seen.

Severity: **P1** fix before release, **P2** fix in the next pass, **P3** polish.
Status: every item is `Open` unless its ID is marked **Fixed** or **Partly fixed** (see "Fixed on 2026-11-11" at the end).

---

## Scores

| # | Area | Score (0-4) | Main finding |
|---|------|-------------|--------------|
| 1 | Accessibility | 2 | Tap targets are 15 to 32px on a phone; some text is 7 to 10px. |
| 2 | Performance | not checked | Outside this request. |
| 3 | Responsive | 3 | No screen scrolls sideways. Rough edges are gutters and wrapping filter rows. |
| 4 | Theming | not checked | Dark mode was not opened. |
| 5 | Consistency of sizes | 1 | The same control comes in 3 to 5 heights. See section A. |

**Summary:** 33 items. 10 are P1, 16 are P2, 7 are P3.
The sizes do not change between phone and desktop, so the problem is not "mobile sizes". It is that the shared components have several sizes and each screen picks its own.

---

## A. Size scale (the main problem)

What one control measures across screens. The "should be" column is what `DESIGN.md` says.

| Control | Sizes found | Should be |
|---|---|---|
| Page main action button | 32px / 14px text (HR, SORs, Calendar, Profile) and 28px / 12.8px text (all Purchasing lists) | 32px |
| Search box | 36px (most lists), 32px (Approval Center, Commission), 28px (Dashboard radar), 40px (Profile) | one size |
| Filter chips and Filters button | 36px (FilterBar), 32px (Approval Center), 31px round "Step" pill | one size |
| Level-1 tabs (underline) | 36-37px (Group Tasks, Commission, Release Notes) and 38-39px (My Requests, HR, Settings, Activity Log) | one size |
| Level-2 pill tabs | 26px (SORs), 28px (Tasks, Approvals, Retail), 29px (Purchasing) | one size |
| Display toggle | 28px with words (Tasks), 26px icon only (SORs), 24px icon only (Dashboard), 32px / 14px text (Calendar / Gantt) | one small segmented control |
| Dialog footer buttons | 36px, 13px text, 16.8px corners | 32px, 14px text, 12px corners |
| Form field in a dialog | 46px select, about 58px labelled card with a 20px input inside, 40px plain input | one size |
| Buttons inside one Purchase Request | 24, 28, 30 and 36px in the same view | two sizes at most |
| Body text | 12, 12.8, 13, 14, 15 and 16px all used as body text | 14px, 13px in dense lists |
| Small text | 7, 8, 9, 10, 10.5 and 11px | 11px label is the floor |
| Corners on controls | 9.6px (small buttons) next to 12px (default buttons, inputs) in the same row | 12px on controls |

| ID | Sev | Finding | Where | Suggested fix |
|---|---|---|---|---|
| A1 | P1 | The page main action has two sizes. Purchasing uses the small button (28px), every other page uses the default (32px). | `src/pages/purchasing/index.jsx:364`, `packing-lists/index.jsx:154`, `transmittals/index.jsx:293`, `ipas/index.jsx:282`, `tasks/index.jsx:441`, `group-tasks/index.jsx:434` | Remove `size="sm"` from header actions. DESIGN.md "Main action" says 32px. |
| A2 | P1 | Search boxes come in four heights (28, 32, 36, 40px). | `ui/FilterBar.jsx:50` (36), `pages/approvals/_components/ApprovalToolbar.jsx:64` (32), `components/EmployeePipelineMatrix.jsx:187` (28), `ui/input.jsx:61` (40) | Pick one toolbar height (36px) and use FilterBar everywhere. |
| A3 | P1 | The Approval Center has its own toolbar: 32px Filters button with 12px text, while every other list uses the 36px FilterBar. | `pages/approvals/_components/ApprovalToolbar.jsx:64-67` | Move the Approval Center to FilterBar. DESIGN.md says FilterBar is the only filter surface. |
| A4 (**Fixed**) | P1 | Level-1 tabs are 36-37px on some pages and 38-39px on others. | `ui/TabGroup.jsx:120-122` (`sm` and `md` sizes) | Use one size for the underline variant and remove the `size` choice from pages. |
| A5 (**Fixed**) | P1 | Level-2 pill tabs are 26, 28 or 29px. The 29px ones are the Purchasing pills with a count badge that makes them taller. | `ui/TabGroup.jsx:241` (count badge padding), SOR Register view switch | Fix the row height so a count badge cannot stretch it. |
| A6 | P2 | The display toggle is built four different ways (see table). | Tasks, SOR Register, Dashboard radar, `components/calendar/Calendar.jsx` | One segmented control, one size. DESIGN.md "Display toggle". |
| A7 (**Fixed**) | P1 | Dialog footer buttons do not match page buttons: 36px tall, 13px text, 16.8px corners. | `ui/ModalShell.jsx:199` and the submit button beside it | Use the plain `Button` with no size or radius override. |
| A8 | P2 | Three field heights inside dialogs. In Add Employee, a 46px select sits next to a 58px labelled card and round "Set Department" pills. | `ui/select.jsx:50` (`h-[46px]`), `ui/labeledCard.jsx`, `ui/input.jsx:61` (`h-10`), Add Employee dialog | Choose one field height for forms and one way to show a select. |
| A9 | P2 | Body text uses six sizes. Hand-set sizes in code: `text-[13px]` 252 times, `text-[12px]` 36, `text-[15px]` 17, `text-[12.5px]` 11, `text-[13.5px]` 1. | Whole `src/` | Add a named 13px token (like `text-label`) and remove 12.5, 13.5 and 15px. |
| A10 | P1 | Text below the 11px floor: `text-[10px]` 141 times, `text-[9px]` 68, `text-[8px]` 9, `text-[7px]` 7, `text-[10.5px]` 7. | Flow Canvas node chips (9px), count badges (10px), avatar initials (9px), Beta tag (9px) | Raise to 11px. Too small to read on a phone. |
| A11 (**Fixed**) | P2 | The small button rounds its corners to 9.6px and the default to 12px, so mixed rows look uneven (Export next to the filter chips; Clear all next to Filters). | `ui/button.jsx:35-36,40-42` | Give every button size the same 12px corner. |
| A12 | P2 | 136 buttons use `size="sm"` and 48 use `size="lg"` out of 979. 12 more set their own height (`h-7`, `h-8`, `h-10`, `h-11`). | Whole `src/` | Decide when small is allowed (table rows, inside cards) and remove the 12 overrides. |
| A13 | P2 | Section descriptions are 16px on the Dashboard and Release Notes, but page descriptions are 12-14px, so a section reads louder than its page. | Dashboard "Team opportunity radar", `release-notes` intro | Use the body size (14px). |
| A14 | P3 | Release Notes body text is 15px; every other screen is 14px. | `src/pages/release-notes`, `components/release-notes` | Use 14px. |
| A15 | P2 | Card padding differs: Settings cards pad 16px, Profile cards pad about 32px and use a larger corner. | `src/pages/profile`, `src/pages/settings` | Use Card at 16px. |

---

## B. Phone screens

| ID | Sev | Finding | Where | Suggested fix |
|---|---|---|---|---|
| B1 | P1 | The side gutter is 32px on a phone, not the 16px in DESIGN.md. Two wrappers each add 16px. On a 375px phone that leaves 311px for content. | `.wrapper` in `src/index.css:161` (`px-4`) plus `ui/PageContainer.jsx:38` (`px-4`) | Drop one of the two paddings below `sm`. |
| B2 | P2 | Full-width pages use a different gutter: 56px on the left and 16px on the right, so the content is off-centre. The title also sits beside the menu button and under the top banner. | `ui/PageContainer.jsx:37` (`pl-14 pr-4 pt-3`), seen on SOR Register and Flow Canvas | Match the other pages: equal gutters, title below the menu button. |
| B3 | P1 | Tap targets are small. Table sort headers are 15px tall, "Change Password" and "Clear date" are 17px, release note lines 21-24px, most buttons 28-32px. Only the bug button reaches 44px. | Everywhere; worst on `Profile`, Purchasing tables, `release-notes` | Below `md`, give controls a 40-44px hit area (padding or a pseudo-element), without changing how they look. |
| B4 | P2 | Filter rows wrap into 3 or 4 lines and push the list down by about 200px. DESIGN.md says filters fold into the Filters popover on phones. | Tasks, HR Management, Retail, Purchasing Dashboard | Show only search and Filters below `sm`. |
| B5 | P2 | Retail's range tabs are cut off at the right edge ("All time" is half hidden) with no hint that they scroll. | `src/pages/retail` header | Add the fade cue, or move the range into a dropdown on phones. |
| B6 | P2 | Purchase Request record: the header actions ("Create a PO in Odoo", "Open SOR") crowd the "P" badge and run to the edge. | `ui/ModalShell.jsx` header, `size="record"` | Fold header actions into the More menu on phones. |
| B7 | P2 | Purchase Request record: an empty gap of about 60px sits under "Requested Items". | Purchase Request record body | Remove the empty block or its fixed height. |
| B8 | P2 | Purchasing Dashboard: the "Value open" totals sit alone, right-aligned, between the filter rows; "Purchased (not received)" pushes its arrow onto a second line. | `pages/purchasing/dashboard/_components/Tracker.jsx:225` | Put the totals on their own line under the filters; let stat labels wrap with the arrow attached. |
| B9 | P2 | Settings rows do not line up. "Desktop Notifications" starts further left than "Theme Mode" and "What's New", and its icon floats mid-paragraph. | `src/pages/settings` General tab | Fixed icon column, top-aligned, same text start for every row. |
| B10 | P2 | Dialog breadcrumb wraps badly: "Add Employee • DEFINE SYSTEM ACCESS & ROLES" breaks into two uneven lines. | Add Employee dialog header | Hide the subtitle on phones or put it under the title. |
| B11 | P3 | Calendar shows two segmented controls stacked, both with a "Calendar" option, in two sizes (28px / 12px and 32px / 14px). | `src/pages/calendar`, `components/calendar/Calendar.jsx` | Rename one, and use the same size. |
| B12 | P3 | Dialogs on a phone float with a 9px margin and 21.6px corners, but record windows fill the screen. Two behaviours for one kind of surface. | `ui/ModalShell.jsx:106`, `ui/dialog.jsx` | Decide one phone behaviour for forms (full-screen sheet is the common choice). |
| B13 | P3 | Stat rows differ: Dashboard and Purchasing use 24px numbers, Retail uses 30px for the headline and 18px for the rest. | `ui/ReportFigure.jsx` users | Fine if deliberate; confirm the Retail sizes. |

---

## C. Wording and rules

| ID | Sev | Finding | Where | Suggested fix |
|---|---|---|---|---|
| C1 | P1 | The Register SOR dialog says "OPP", "Register Opportunity" and "The opportunity number is issued automatically". `CONTEXT.md` says SOR, never Opportunity. | `components/sor/OpportunityFormModal.jsx:441,453` | Change to "Register SOR" and "The SOR number". |
| C2 | P3 | One-word page titles are fully red ("Retail", "Settings", "Calendar", "IPAS") because the last word is always red. Two-word titles are half black. | `ui/PageHeader.jsx:18-34` | Decide: keep one-word titles in ink, or accept it. |
| C3 | P2 | The Dashboard radar's active view icon is red. Red is reserved for actions with consequences. | Dashboard "Team opportunity radar" toggle | Use the neutral active style. |
| C4 | P3 | Profile's "Save settings" sits in the header as a faded red button before anything has changed. | `src/pages/profile` | Hide it until there is something to save, or keep it neutral. |
| C5 | P3 | "YEARLY" on the Tasks timeframe chip is uppercase and tracked; every other chip is sentence case. | `ui/PeriodFilter.jsx` | Sentence case. |

---

## What is working

- No screen scrolls sideways at 375px. Wide tables scroll inside their own box.
- Page titles are the same on every screen: 20px on phones, 24px on desktop, weight 900.
- Field labels are consistent in the dialogs seen: 11px, bold, uppercase.
- The 36px FilterBar is already used on most lists, so it is the natural standard.

## Suggested order

1. **Agree the size scale** (section A table). Write the chosen sizes into `DESIGN.md`. Nothing else can be judged until this is decided.
2. **Fix the shared components** so the scale is the default: `button.jsx`, `TabGroup.jsx`, `ModalShell.jsx`, `select.jsx`, `input.jsx`, `FilterBar.jsx` (A4, A5, A7, A8, A11).
3. **Remove per-page overrides**: A1, A2, A3, A6, A12.
4. **Phone layout**: B1, B2, B3, B4.
5. **Text sizes**: A9, A10.
6. Everything else, then run the audit again.

## Fixed on 2026-11-11

Checked in the browser at phone size on 15 screens and five dialogs. The tests under `src/components/ui`, `purchase-request`, `ipas`, `calendar`, `log-task`, `hr` and `pages/group-tasks` pass; some timed out in a combined run on this laptop and passed when run alone. The full suite was not run. Not committed.

- **A4 Fixed.** Every level-1 underline tab is now 38px (the active one is 39px with its underline). `ui/TabGroup.jsx` no longer lets `size="sm"` or `"md"` change the height.
- **A5 Fixed.** Every pill tab is now 28px, including icon-only tabs (SOR Register) and tabs with a count badge (Purchasing).
- **A11 Fixed.** The small button and small icon button now have the same 12px corner as the default button (`ui/button.jsx`). The extra-small button keeps its 9.6px corner, because 12px would turn a 24px button into a pill.
- **A7 Fixed.** Dialog footer buttons are now the page size: 32px tall, 14px text, 12px corners. This covers ModalShell and its 22 Purchasing, IPAS and calendar dialogs, ConfirmDialog, Log Task, Task footer, Broadcast, the HR form (Add Employee, Register SOR) and the Group Task dialogs. Measured in the browser on five dialogs. Still 36px: the Flow Canvas dialogs and a few toolbar buttons (Bid Decision panel, Time Off page), which do not use the shared modal.

**Left open on purpose:** A8 (form field heights of 40, 46 and 58px). `DESIGN.md` documents the 46px select as deliberate, so changing it needs a decision first.
