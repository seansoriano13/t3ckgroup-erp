# IPAS Status, Direct delivery and several files: E2E tracker (2026-11-21)

The run of the E2E plan in **#1160** for spec **#1151** (tickets #1152–#1158, PR #1159), on the hosted staging site. Staging branch head `1c9b5ec8`; the deployed bundle (`index-DpwR2P-f.js`) carries the 1.11.10 code ("Comes from filing", "Direct delivery to client").
Nothing was fixed. Each Fail is filed as a sub-issue of #1160 (see "Findings").

**How it was checked**

- `playwright-cli` sessions signed in as each mock person (`<key>@staging`), plus small Node scripts that call the same database functions the screens call, with that person's own login. Database reads for evidence were read-only.
- Before calling anything a bug, the rule was checked in `src/test/policy/`.
- Scripts, screenshots and raw answers: `scratch/ipas-status-e2e-2026-11-21/` (not committed). Screenshots named below are in its `out/` folder.

**Before you start (plan checks)**

| Check | Result |
|---|---|
| The six #1151 migrations on staging | **Pass.** `1152`, `1153`, `1154`, `1156`, `1157`, `1158` and the `130150` fix-up are all in `schema_migrations`. |
| Deployed app has PR #1159 | **Pass.** The live bundle has the status steps, "Comes from filing" and Direct delivery; the What's New popup shows 1.11.10. |
| Duplicate migration number | **Fixed during the run, not filed.** Two files shared version `20261221130150` (PR #1162 and PR #1163); the "Apply migrations — staging" run after #1162 failed with `duplicate key value violates unique constraint "schema_migrations_pkey"` (run 44772105244). PR #1165 dropped the never-applied file and was merged at 16:41 UTC while this run was going; the staging migration run after it passed (run 44775816378). Staging also took #1166–#1168 (tests and a main sync) during the run; nothing seen changed behaviour. |
| Sign-off lists | 101 added the "(staging)" people (originals saved first); restored at the end and checked equal to the saved copy. |

**Records made** (all cancelled at the end; the app cannot delete them)

| Name | Number | PO | Source / Purpose | SOR |
|---|---|---|---|---|
| IPAS-L | TGIPAS_081 | P01048 (RFQ, not received in Odoo) | Local / Inventory | none |
| IPAS-I | TGIPAS_082 | P01050 (confirmed, fully received in Odoo) | Import / Project | SOR-248 (S04646) |
| IPAS-DD | TGIPAS_083 | P01051 (confirmed, fully received) | Local / Project | SOR-145 (S05766) |
| Spare | TGIPAS_084 | P01052 (confirmed, fully received) | Local / Project | SOR-168 |
| Transmittal | TG03-11 | names TGIPAS_081 | made by Jade, submitted, then cancelled | |

Also left on staging: bank details and a Full payment on TGIPAS_082, a Full payment on TGIPAS_081, test files `e2e1151-a.pdf`, `e2e1151-b.pdf`, `e2e1151-c.jpg` in the Cloudinary `task-attachments` folder. **Alvin keeps Logistics access** (A1). Micko is off. The In Transit ageing rule was set to 1 day for D5 and put back to blank (no ageing rule is set on staging, as before).

**Notes on the plan**

- Order Monitoring is now the Purchasing Dashboard (`/purchasing/order-monitoring` opens `/purchasing/dashboard`). Its "next move" filter is "Ours to move" (the plan's Waiting on us), "Waiting on someone else", and "Late by the ageing rules" (the plan's Needs chasing). It lists SORs, so only Project IPAS show; D1, D2 and D7 used the Project IPAS TGIPAS_083 and TGIPAS_084 instead of IPAS-L.
- Every PO older than P01048 is fully received in Odoo, so any IPAS on them already suggests "Delivered" from the Odoo receipt. C3 and C5 were run where the reason could be told apart (see the rows).
- Staging has no filed IPAS from before #1151 and no open IPAS with Supplier Origin dates, so those two switch-over rows in B25 could not be checked.

Result key: **Pass**, **Fail** (filed), **Blocked** (why). Severity: **P1** fix before release, **P2** next pass, **P3** polish.

---

## A. Logistics access (#1152)

| # | Login | Result | Evidence |
|---|---|---|---|
| A1 | geane | Pass | Employee Directory → Alvin → Logistics on → Update Employee. Reopened: on. Database `has_logistics_flow = true`. |
| A2 | geane | Pass | On her own record the switch can be flipped, but the save puts it back (reopened: off; database false). A direct `PATCH` of her own row also stays false. Note: the screen says nothing when it reverts. |
| A3 | 101 | Pass | Micko on, off, on, off through the form; each change saved (database after each: true, false, true, false). Left off. |
| A4 | ayla, jelai, dani | Pass | `/hr/management` shows "You don't have access to this page. This page needs HR access." A direct `PATCH` of Alvin's flag by each changes nothing (stays true). |
| A5 | alvin | Pass | With Alvin taken off every sign-off list for the check (so only the flag counted), the side menu lists IPAS, Transmittals and Packing Lists. |
| A6 | alvin | Pass | IPAS list (16 rows) and TGIPAS_082 open. With bank details typed on it, the record (Payments opened) shows no bank name or account; reading `ipas_bank_details` directly returns nothing. |
| A7 | jade | Pass | `/purchasing/ipas` shows no rows and "You don't have access to IPAS"; the record URL shows nothing; the API returns no rows. Wording finding F-3 (#1171). |
| A8 | 101 | Pass | 0 people on `logistics_signed` without the flag. The one person on that list before the change (aldrin@demo) has the flag from the backfill. |

## B. IPAS Status set by hand (#1154)

| # | Login | Result | Evidence |
|---|---|---|---|
| B1 | ayla | Pass | Raised TGIPAS_081 in the browser. 4 Delivery: "ORDER-DRAFT Current Nov 21, 2026", Local steps only (`out/b1-ipas-l-delivery.png`). |
| B2 | ayla | Pass | No Customs / Port Hold, Arrived at Local Hub or Out for Delivery on IPAS-L. |
| B3 | ayla | Pass | Raised TGIPAS_082 in the browser (Import, Project, SOR-248). All ten steps plus Done. |
| B4 | ayla | Pass | Ordered, Nov 14: "ORDERED Current Nov 14, 2026 set by Ayla (staging)"; header pill "Status Ordered". |
| B5 | ayla | Pass | In Transit, Nov 19. Processing and Shipped stay blank. |
| B6 | ayla | Pass | Back to Ordered (kept Nov 14). In Transit cleared. History: "Ordered → In Transit · Nov 19, 2026", "In Transit → Ordered · Nov 14, 2026 · cleared In Transit". |
| B7 | ayla | Pass | Shipped, Nov 22: the dialog says "The Shipped / Picked Up date cannot be after today." and Save is off. The server also refuses ("the Shipped / Picked Up date cannot be after today"). |
| B8 | ayla | Pass | Shipped, Nov 10 (before Ordered Nov 14) saves; amber "Before Ordered (Nov 14, 2026)" beside the date (`out/b8-warning.png`). |
| B9 | ayla | Pass | Edit date Shipped → Nov 16: warning gone. |
| B10 | ayla | Pass | Edit date Ordered → Nov 18: "Before Ordered (Nov 18, 2026)" on Shipped. Put back to Nov 14: gone. |
| B11 | ayla | Pass | Done has no button and reads "Comes from filing". The server refuses Done ("Done comes from filing; it can't be picked by hand") and its date. |
| B12 | alvin | Pass | With only the Logistics flag: In Transit saved, "set by Alvin (staging)". |
| B13 | 101 | Pass | Shipped then In Transit, both saved. |
| B14 | jelai | Pass | Steps and dates shown; no step has a button, no Edit date, no suggestion. The server refuses status, date and Direct delivery ("only Purchasing, Logistics or a Super Admin…"). |
| B15 | dani, jade | Pass | The record does not open; the API returns no IPAS and no status rows; setting a status is refused. |
| B16 | ayla | Pass | More → Put On-Hold: pill "On-Hold · In Transit". |
| B17 | ayla | Pass | Clear On-Hold: pill "In Transit". |
| B18 | ayla → 201 | Pass | TGIPAS_081 taken to filing (Logistics by Alvin, Send for signing by Ayla in the browser, Approve by Jelai in the browser and Jen, Check by Gracean, Approve and file by 201 in the browser). Status became Done, dated Nov 21. |
| B19 | 101 | Pass | Reopen (with a reason): Done removed, status Delivered (the last dated step). Section 7 sign-offs cleared, the rest kept. |
| B20 | ayla | Pass | Filed: no step buttons; the server refuses set status and edit date ("TGIPAS_081 is filed; a Super Admin reopens it first"). |
| B21 | ayla | Pass | Cancelled TGIPAS_084 in the browser: no step list; the server refuses ("TGIPAS_084 is cancelled"). |
| B22 | ayla | Pass | Full payment ₱8,000 on the ₱8,436 order: "Remaining balance ₱0.00 Settled". |
| B23 | ayla | Pass | On-Hold after B22: still ₱0.00; list row "ON-HOLD · IN TRANSIT … ₱0.00". |
| B24 | — | Pass | Filed TGIPAS_081: "Remaining balance $0.00 Settled". |
| B25 | — | Pass (partial) | Cancelled → no status (TGIPAS_050, 063–076). PO confirmed only → Ordered (TGIPAS_053–062, 077). Section 1 sent only → Payment Approval (TGIPAS_049). Nothing → Order-Draft (TGIPAS_052). Not checkable on staging: a filed IPAS from before, and Supplier Origin dates on an open IPAS (only cancelled ones have them). Ordered takes the day Odoo was last read (for example Nov 20), as the migration says. |

## C. Status suggestions (#1155)

| # | Login | Result | Evidence |
|---|---|---|---|
| C1 | ayla | Pass | After section 1 Prepared on TGIPAS_081: "Section 1 is prepared. Move to Payment Approval?" with one button. Status still Order-Draft. |
| C2 | ayla | Pass | Click: "PAYMENT APPROVAL Current Nov 21, 2026"; the line is gone. |
| C3 | ayla | Pass (adapted) | TGIPAS_082 at Order-Draft on a confirmed PO did not suggest Payment Approval. It suggested "Odoo says the goods are received. Move to Delivered?", because P01050 is also fully received and only the furthest match is offered (as the rule says). No confirmed-but-not-received PO was free to test "Ordered" alone. |
| C4 | ayla | Pass | TGIPAS_081 at In Transit: no suggestion line. |
| C5 | ayla | Pass (adapted) | Run on TGIPAS_081 (its PO is not received in Odoo, so the Transmittal is the only reason). A draft TG03-11 naming it: no suggestion. Submitted: "A Transmittal names this IPAS. Move to Delivered?". |
| C6 | jelai | Pass | The IPAS from C1, before the click: no line, no button. |
| C7 | ayla | Pass | Reloaded without clicking: still Order-Draft, line still there. |

## D. Order Monitoring and ageing (#1156)

| # | Login | Result | Evidence |
|---|---|---|---|
| D1 | ayla | Pass | TGIPAS_083 at Order-Draft: "Order-Draft · TGIPAS_083 · Purchasing to move · 0d" (Ours to move). |
| D2 | ayla | Pass | TGIPAS_084 at Payment Approval: "Payment Approval · TGIPAS_084 · Order approvers to move". |
| D3 | ayla | Pass | TGIPAS_082 at In Transit (no rule): under "Waiting on someone else", "In Transit · waiting on supplier, forwarder or port · 5d". |
| D4 | 101 | Pass | Settings → Purchasing → Ageing rules: the ten steps Order-Draft … Delivered plus "Delivered, no Transmittal raised", "Transmittal check open", "Section 3 waiting…", "Costs complete, ready to file". Customs shows "Example: 3 days". No Purchase Order or Import Clearance rows. (No rule was set before, so the carry-over could not be seen.) |
| D5 | 101, ayla | Pass | In Transit rule 1 day; In Transit dated Nov 16. "Late by the ageing rules" lists only S04646: "In Transit · TGIPAS_082 · waiting on supplier, forwarder or port · 5d · late". "Late orders 1". |
| D6 | ayla | Pass | On-Hold: "Late by the ageing rules" is empty; under "Waiting on someone else" as "On-Hold". |
| D7 | ayla | **Fail (P2) → F-1, #1169** | TGIPAS_084 at Delivered with no Transmittal: its SOR disappears from the dashboard (search "TGIPAS_084": "No SOR matches", every stage 0) (`out/d7-search.png`). The SOR's own PMS tab does say "Delivered — no Transmittal raised · Purchasing · 0 days waiting". |
| D8 | 101 | Pass | In Transit rule back to blank (saved; no rule set in the table). |

## E. Status everywhere (#1157)

| # | Login | Result | Evidence |
|---|---|---|---|
| E1 | ayla | Pass | Status column: DELIVERED, OUT FOR DELIVERY, IN TRANSIT, ORDERED, ORDER-DRAFT, PAYMENT APPROVAL; held: "ON-HOLD · OUT FOR DELIVERY". |
| E2 | ayla | Pass | Filter In Transit: only TGIPAS_081. "On-Hold" is its own value (only the held TGIPAS_082). A held order also shows under its step's filter. |
| E3 | ayla | Pass | `ipas-2026-11-21.xlsx` has "Status" and "Status date": "On-Hold · Out for Delivery, Nov 20, 2026", "In Transit, Nov 21, 2026", "Delivered, Nov 21, 2026", matching the list. |
| E4 | ayla | Pass | Dashboard vs stored status and day: TGIPAS_054 "ORDERED Nov 5", TGIPAS_082 "OUT FOR DELIVERY Nov 20", TGIPAS_049 "PAYMENT APPROVAL Oct 16" all match. TGIPAS_083 at Delivered is not under "Purchased (not received)". |
| E5 | dani | Pass | SOR-248 PMS tab: "Status IN TRANSIT · Nov 16" and the standing line; no payment or Landed Cost amounts (`out/e5-sor-pms.png`). |
| E6 | ayla | Pass | Print preview of TGIPAS_082 (held): "IPAS STATUS · ON-HOLD · OUT FOR DELIVERY", every reached step with its date, skipped steps blank, no buyer-track legend. |
| E7 | ayla | Pass | Print preview of TGIPAS_081: no Customs, Local Hub or Out for Delivery rows. Side finding S-1 (#1172) on the same page. |

## F. Several files per document (#1153)

| # | Login | Result | Evidence |
|---|---|---|---|
| F1 | ayla | Pass | Three files in one pick on Quotation (Local): listed as e2e1151-a.pdf, e2e1151-b.pdf, e2e1151-c.jpg; each link opens (HTTP 200). |
| F2 | ayla | Pass | Removed b.pdf; a.pdf and c.jpg stay. |
| F3 | ayla | Pass | All removed: "Quotation (Local) (required) Missing"; preparing section 1 is refused ("section 1 needs Quotation (Local) first"). |
| F4 | ayla | Pass | One file back: Attached; section 1 Prepared goes through. |
| F5 | ayla | Pass | Edit view (`?edit=documents`): added two (held until Save all), removed one, saved; then added and removed a saved file. History shows each add and remove. |
| F6 | — | Pass | All 40 older single-file documents have their file in the new table (same link). TGIPAS_077's Proforma Invoice still opens. Old files show the store's random name (for example `y9re7sm68z9mm09bbahn.pdf`), since the old rows never kept one. |
| F7 | ayla | Pass | Filed TGIPAS_081: no Attach or Remove buttons; the server refuses both ("is filed; a Super Admin reopens it first"). |
| F8 | ayla | Pass | From the browser: `https://example.com/x.pdf` and a look-alike `res.cloudinary.com.evil.example` are refused ("attach a file you uploaded here, not a link to another site"); `javascript:` is refused too. |
| F9 | ayla, gracean | Pass | Print: "Quotation (Local) (e2e1151-a.pdf, e2e1151-c.jpg)". Approval Center review (Gracean): both files listed. Side finding S-2 (#1173) on the queue. |
| F10 | alvin, jelai | Pass | Both see the files as links, with no Attach or Remove buttons and the "has it" ticks off. The server refuses both ("only Purchasing changes an IPAS"), as policy test 1153 says. |

## G. Import-specific

| # | Login | Result | Evidence |
|---|---|---|---|
| G1 | ayla | Pass | TGIPAS_082: Customs / Port Hold Nov 17, Arrived at Local Hub Nov 18, Out for Delivery Nov 20, all saved with dates. |
| G2 | ayla | **Blocked** | Source cannot be changed after raising: no screen, no database function, and no write rule on `ipas`. The trigger that clears the Import-only steps is reachable only by direct SQL, which policy test 1154 ("a source change to Local deletes them") covers. |

## H. Direct delivery (#1158)

| # | Login | Result | Evidence |
|---|---|---|---|
| H1 | ayla | **Fail (P3) → F-2, #1170** | Edit view: the tick saves; Item Location is replaced by "The supplier delivers straight to the client, so no Item Location or Transmittal is asked for…"; History "Direct delivery to client: on". But the normal read view of 4 Delivery still shows the Item Location picker ("Not set") and says nothing about Direct delivery (`out/h2-dd-read-view.png`). |
| H2 | ayla | **Fail (P3) → F-2, #1170** | The rail is right: no Item Location or Transmittal item, "Set the status to Delivered", "Sign Logistics · Opens once the Delivered status is in". The section line still reads "Item Location not set · no Transmittal yet". |
| H3 | alvin | Pass | Before Delivered: "ipas_sign: Logistics needs the Delivered status first" (nothing else asked). |
| H4 | ayla | Pass | Clicked "Move to Delivered" (from the Odoo receipt): "DELIVERED Current Nov 21, 2026". |
| H5 | alvin | Pass | Sign Logistics in the browser, no Item Location and no Transmittal: signed. |
| H6 | ayla, dani | Pass | SOR-145: "Costs not complete · Purchasing", not "no Transmittal raised". (The dashboard hides Delivered orders anyway, F-1.) |
| H7 | ayla, dani | Pass | Print: "IPAS STATUS · DELIVERED · DIRECT DELIVERY TO CLIENT". SOR summary: "Status DELIVERED · Nov 21 · Direct delivery to client". The print still has an "ITEM LOCATION" heading (part of F-2). |
| H8 | alvin | Pass | Logistics only: on and off on TGIPAS_081; the tick is live, Item Location is greyed (not his). |
| H9 | 101 | Pass | On and off on TGIPAS_082. |
| H10 | jelai | Pass | Tick and Save all greyed; the server refuses. |
| H11 | ayla | Pass | TGIPAS_084 at Delivered: on → the SOR stops asking for a Transmittal; off → Item Location field back and "Delivered — no Transmittal raised" again. |
| H12 | ayla, 101 | Pass | Filed TGIPAS_081: refused for both ("is filed; a Super Admin reopens it first"). |
| H13 | ayla | Pass | TGIPAS_083 (Odoo receipt, no Transmittal): "Odoo says the goods are received. Move to Delivered?". TGIPAS_081 (Transmittal, no receipt) with Direct delivery on: no suggestion; off: "A Transmittal names this IPAS". |

## I. Cross-checks

| # | Result | Evidence |
|---|---|---|
| I1 | Pass | What's New popup (Micko, first sign-in): "Version 1.11.10 • 2026-11-20 IPAS Status, Direct delivery and several files per document" with status steps, suggestions, Logistics access, Direct delivery and several files. The Release Notes page itself still covers 1 October to 16 November. |
| I2 | Pass | No console errors on the IPAS list, three IPAS records, both edit views, the dashboard, Order Monitoring, Approvals, Release Notes, Settings → Purchasing and the Employee Directory. Only Google sign-in noise on `/login`. |
| I3 | Pass | 375 px: the record's steps wrap to two lines and "Before In Transit (Nov 16, 2026)" is readable (`out/i3-phone-record.png`); the list turns into cards. Page width 375, no sideways scroll. |

---

## Findings

| ID | Sev | Finding | Issue |
|---|---|---|---|
| F-1 | P2 | The Purchasing Dashboard (now Order Monitoring) drops every order at Delivered or later, so "Delivered — no Transmittal raised" and the other after-delivery moves and their ageing rules never show there. | #1169 |
| F-2 | P3 | Direct delivery: the 4 Delivery read view, its section line and the print still show Item Location / "no Transmittal yet". | #1170 |
| F-3 | P3 | The IPAS "no access" message leaves out Logistics access. | #1171 |
| S-1 | P3 | Older than #1151: the printed IPAS shows a Transmittal's date as a raw timestamp in UTC. | #1172 |
| S-2 | P3 | Older than #1151: the Approval Center offers the merged Check only to the Received list. | #1173 |

No security hole was found: every role gate held at the server, and outside file links are refused.

## Clean-up (done and checked)

1. Sign-off lists restored from the saved copy; compared member by member: equal.
2. Micko's Logistics off. Alvin's left on.
3. In Transit ageing rule back to blank; no rule is set.
4. TG03-11 cancelled; TGIPAS_081, 082, 083 cancelled (084 cancelled in B21). All carry "[E2E 1151]" in their remarks.
