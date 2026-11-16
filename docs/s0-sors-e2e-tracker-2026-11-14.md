# S0 Evaluation and SORS E2E tracker (2026-11-14)

A Playwright pass over **S0 Evaluation** (the price corridor, staging commit `e2673297`) and one more module picked at random, **SORS** (the pick landed on `/crm`, which is SORS and the Commission Dashboard). HR and Time Off were skipped (already in #1000).
Nothing was fixed. This file lists what was found and a fix for each item. The fixes are filed as spec **#1031** and its sub-issues (see "Decisions and tickets" at the end).

**How it was checked**

- A production build of the staging commit, served by `vite preview`, on the local Supabase data.
- S0 Evaluation was run end to end on SOR-256 with the demo cast, each on their own login: Sales (`dani@demo`), Purchasing (`cjay@demo`), Management (`201@demo`), Technical (`sherwin@demo`), Super Admin (`101@demo`), plus Finance and Warehouse to check they are kept out.
- The run: Final Acquire, Other costs, Marketing, ABC and Final Offer (per line and as one total), Technical verdict, approve the specs, Go, lock, Unlock, Revise, No-go, Go again, print.
- Every Revenue, OPEX, ITR, Go floor and percent figure on screen was worked again by hand and compared.
- SORS: every view (My work, List, Board, Overview, Deleted), the Commission Dashboard (Pool, Formula, SORs, People) as Sales and as Super Admin, Register SOR, a record's tabs, a blocked stage move, Mark as Lost, the delete confirm.
- 92 captures at 4 sizes (phone 390, tablet 820, laptop 1366×650, desktop 1920), each recording console errors, failed requests, sideways overflow, dialogs that do not fit and unnamed controls.
- Scripts, screenshots and raw results: `scratch/s0-sors-e2e-2026-11-14/` (not committed). Screenshot names below are under its `out/` folder.

**Not covered:** dark mode; anything that needs Odoo (Fetch from Odoo, a new evaluation from an S0, Refresh from the SOR); IPAS and Landed Cost after buying; moving a SOR to the next stage (the test SOR was blocked on a required document); Board drag; Flow Canvas; Retail; editing commission rates. The staging site itself was not opened: this is the staging commit on local data.

**Environment notes (not app bugs)**

- Realtime was down locally (`WebSocket ... 503`) and Google sign-in is not allowed on port 4173.
- Test data was put back: SOR-256 (a deleted demo SOR, brought back for the run) and the test SOR-261 are hidden again, and what was typed on SOR-73 was cleared. The "What's New seen" flag was set for the 27 local test logins.
- Docker and the local Supabase stack were started for this run and are still running.

Severity: **P1** fix before release, **P2** fix in the next pass, **P3** polish.

---

## Summary

| Area | P1 | P2 | P3 |
|---|---|---|---|
| S0 Evaluation: A. Rules and flow | 4 | 1 | 0 |
| S0 Evaluation: B. Numbers and data | 2 | 5 | 2 |
| S0 Evaluation: C. Forms and words | 0 | 4 | 5 |
| S0 Evaluation: D. Layout | 0 | 3 | 1 |
| App-wide (found on the way) | 0 | 1 | 0 |
| SORS | 2 | 6 | 5 |
| **Total (41)** | **8** | **20** | **13** |

The three that matter most:

1. **A Go was accepted and the sheet locked with the offer above the client's ABC** (A1).
2. **The decision card and the print can show figures that do not agree with each other** (B1, B2).
3. **In SORS, the Overview and the Commission Dashboard read an old status field**, so a SOR at Notice to Proceed is counted as a Lead (S2).

**The math is right.** Final Offer, VAT-exclusive, tax, retention, Collected, OPEX, ITR, Revenue and its percent matched hand calculations at four different offers. The Go floor matched at four states. Percent-of-ABC costs, line margins, the list's Planned figure and the commission formula all matched.

---

## S0 Evaluation

### A. Rules and flow

| ID | Sev | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| A1 | P1 | **A Go is allowed with the offer over the ABC.** Offer ₱460,000 against an ABC of ₱450,000: the bar said "Over the ABC: the client cannot accept it", the check "The offer is within the ABC" showed "over", yet Go stayed on, the confirm box showed no warning, and the sheet locked. | `flow/9-go-confirm-over-abc.png`, `flow/9-after-go-over-abc.png`. `DecisionCard.jsx` `goBlocked`; `costing_decide_bid` has no ABC check. | Decide: block the Go, or allow it with a red line in the confirm box (like the loss one) and a typed reason. Put the same rule in the database function. |
| A2 | P1 | **Final Acquire never fills by itself, and the step does not say why.** The rule needs each part's Status (Stockable or Source Out). 101 of 103 other local parts have no Status and none has a Final Acquire. The Final Acquire step says "Every part follows it" and each empty box shows "₱11,385.90 by rule", but changing the discount to 25 only changed the grey hint: still "12 of 12 left". Status can only be set in a line's slide-over, by Sales. (Setting Source Out there did fill Final Acquire, so the rule itself works.) | `roles/laptop-201-step2.png`, `flow/13-status-source-out.png`. `CorridorScreen.jsx:232`. | Show each part's Status on the Final Acquire step with a picker (or default to Stockable when the part has an Odoo product). When a part has no Status, show "Needs a Status" instead of "by rule". |
| A3 | P1 | **The Specs step tells the Technical in-charge to "Judge every product" but gives no way to do it.** There is no control and no link, and the line slide-over shows Compliance as read-only. The verdicts are given on the separate Technical page. | `flow/5-sherwin-open.png`, `flow/6-line1-slideover.png`. `PartDetail.jsx:104` (`canEvaluate = false`). | On the Specs step add a "Judge the products" button for the in-charge that opens the Technical record, and for everyone else say "The Technical in-charge judges them on the Technical page". |
| A4 | P1 | **Decision needed: who may decide a bid.** A Sales Executive on no list (`dani@demo`) took a Revise and is offered Go on a bid she priced. The database says "only Sales, Purchasing, a Super Admin or the Final Acquire list can decide a bid". The Bid Decisions page says "until the decider list or a Super Admin decides". | `flow/12-dani-decides.png`; `costing_decide_bid`. | Pick one. If Sales may decide, fix the words on the Bid Decisions page. If only the list may, tighten the function and hide the buttons. |
| A5 | P2 | **"Before a Go · 3 of 5" reads like a rule but is not one.** Go only needs every offer and approved specs. Four local SORs (257 to 260) are Go with no Final Acquire at all, so their Revenue was never worked; the confirm box just says "Planned revenue: Not worked yet". | Local data; `DecisionCard.jsx`. | Either block Go until the list is done, or rename it ("Worth finishing first") and make "Not worked yet" a clear warning in the confirm box. |

### B. Numbers and data

| ID | Sev | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| B1 | P1 | **After a Revise or No-go, the decision card mixes old and new figures.** Revise was taken at ₱410,000; Sales then changed the offer to ₱430,000. The card showed "Offer ₱410,000.00" beside "Revenue 23.7%" (which is the ₱430,000 figure), while the deal bar said ₱430,000. | `flow/11-dani-after-revise-change.png`. `DecisionCard.jsx:128,132`. | While the sheet is not locked, show live figures. Put the stamped figure in the decision line: "Revise at ₱410,000.00". |
| B2 | P1 | **The print ignores "One total".** With ABC ₱450,000 and Final Offer ₱430,000 typed as totals, the line table still prints each line's old ABC and offer (they add up to ₱1,370,535.74 and ₱389,327.02). "Achieved ×1.2479" is worked from those set-aside line offers. | `flow/12-print.png`. `src/lib/pdf/costingMatrixDocument.js`. | In One total mode print "in the total" in those two columns and work Achieved from the typed total. |
| B3 | P2 | **The Go floor counts unknown costs as zero.** With Other costs blank the bar showed a Go floor of ₱377,943.14 while Revenue was "—"; once typed it was ₱418,923.59. Blanking one line's ABC (which makes a "% of ABC" cost unknown) dropped *all* other costs out of the floor: ₱418,923.59 became ₱382,919.44. | `CorridorScreen.jsx:79-80` (`expenses ?? 0`, marketing `?? 0`). | Show no floor until the other costs are known ("Needs the other costs"), or label it "so far, without other costs". |
| B4 | P2 | **A line over its own ABC still passes the check.** Line 2 at ₱6,000 against its ABC of ₱5,803.57 showed "Over the ABC" on the line, but "The offer is within the ABC" stayed ticked because only the totals are compared. | `flow/3-over-abc.png`. | In Per line mode, count the lines over their ABC: "1 line over". |
| B5 | P2 | **Bulk "Complies" keeps an old deviation remark.** Product 1.1 was Deviates with "Client asks for Aramid IIIA, ours is Aramid II." Check all, then Complies, changed the verdict with no warning and kept the remark. The print now reads "COMPLIES · Client asks for Aramid IIIA, ours is Aramid II." | `flow/12-print.png` sheet 2. `BulkVerdictBar.jsx`. | Before applying, say "1 product is already judged Deviates" and let the person skip it; clear the remark when a deviation is changed to Complies in bulk. |
| B6 | P2 | **The list's total row shows ₱0.00 for figures that are blank.** With no row worked yet: "3 without a figure yet, left out" and Planned, Actual, Difference all ₱0.00. | `s0/01-list.png`. `costingMatrixPage.js` `matrixPageTotals`. | Show "—" when no row has a figure. |
| B7 | P2 | **Planned cost can sit below the supplier's price with no flag.** Every part's Final Acquire (Odoo SRP less 20%, for example ₱11,385.90) was below its Acquire (₱13,199.89). Revenue was planned on ₱247,845.72 while Acquire adds up to ₱299,482.28, and the Overview's "After buying" table estimates Landed at the higher figure. | `flow/10-overview.png`. | Confirm with the business whether this is expected. If not, mark a part whose Final Acquire is under its Acquire. |
| B8 | P3 | Range flags on Other costs: adding an empty second row under a category removes the category's "below" flag, and an amount of 0 is never flagged as below. | `flow/2-after-add.png`. `CorridorScreen.jsx` `RangeCell`. | Flag on the rows that have an amount; treat 0 as below. |
| B9 | P3 | A typed 0 counts as filled for Final Acquire, an Other cost and a Final Offer ("A Final Offer on every line" ticks with a ₱0.00 offer; margin shows 100.0%). | Flow 1 and 3 output. | Ask "Is ₱0.00 right?" once, or mark the cell. |

### C. Forms and words

| ID | Sev | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| C1 | P2 | A discount of 99.999 shows raw database text under the box: `new row for relation "costing_matrix_money" violates check constraint "costing_matrix_money_final_percent_chk"`. | `flow/1-discount-99999.png`. `corridorSaves.js` `finalAcquireDiscount`. | Round to two decimals first and refuse 99.995 and up with "Type a discount below 100, like 20." |
| C2 | P2 | **The mouse wheel changes a typed price.** With a number box focused and the pointer on it, one wheel notch turned 11385.9 into 11385.89; leaving the box saves it. | Flow 1b output. `GridCell.jsx` (`type="number"`). | Use `type="text"` with `inputMode="decimal"`, or drop focus on wheel. |
| C3 | P2 | "Below the Go floor: the deal stops paying." is shown on a single line that is under its share even when the whole deal is above its floor. When the deal is under, the same red sentence repeats on all 12 lines. | `sizes/laptop-offers-scrolled.png`. | On a line say "Under this line's share of the Go floor". Say the deal-level sentence once, on the deal bar. |
| C4 | P2 | When the Go floor is above the ABC (no offer can work) the bar only shows "Go floor ₱402,824.65 – ABC ₱400,000.00" and a red line for whichever side the dot is on. | `flow/3-both-one-total.png`. | Say it plainly: "No offer reaches the Go line under this ABC." |
| C5 | P3 | With the offer as one total the card still says "A Final Offer on every line · 1 without" and "Every line needs a Final Offer first." | Flow 3 output. | "The Final Offer total is typed" / "Type the Final Offer total first." |
| C6 | P3 | The same thing has different names: "Sales incharge", "Purchasing incharge", "PMS incharge", "Technical in-charge"; "Final Acquire" on screen and "Final cost" on the print; a product "remark" and an offer "note" (after writing the remark it still says "A deviation needs a note." without saying which box). | `flow/4-people.png`, `flow/12-new-from-s0.png`, `flow/12-print.png`. | One spelling each; "The Technical Evaluation Remarks box below needs a note." |
| C7 | P3 | "Earlier Go was cleared: Unlocked: E2E test.." (two labels in a row, double full stop). | `sizes/laptop-offers-scrolled.png`. | "Earlier Go was unlocked: <reason>" and trim the trailing full stop. |
| C8 | P3 | Typed boxes show 13199.89 with no ₱ or commas beside formatted figures, which makes large numbers hard to check. | `roles/laptop-dani-step4.png`. | Format the value when the box is not focused. |
| C9 | P3 | The print lists Other costs (Labor, Overhead) as "AWAITING PURCHASE", though they are never bought. | `flow/12-print.png`. | Leave that column blank for cost-only rows. |

### D. Layout

| ID | Sev | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| D1 | P2 | Laptop (1366×650): when you scroll, the pinned deal bar covers the table headings, and the step buttons and rows show through a gap above it. | `flow/2-after-add.png`, `sizes/laptop-offers-scrolled.png`. | Pin the bar flush to the top of the scroll area with a solid background, and make the table heading stick under it. |
| D2 | P2 | Phone (390): the deal bar is cut at the right edge. The hint, the ABC label and the Revenue figure are clipped, so the Revenue percent cannot be read. The pinned bar also takes about 230px of the screen. | `sizes/phone-offers.png`, `sizes/phone-offers-scrolled.png`. | Stack the three figures under the bar on small screens and do not pin it there. |
| D3 | P2 | Costs step: the Markup price beside each Acquire box has no label (tooltip only) and here equals the offer, so it reads as the offer. "Our cost" shows "—" on this step even when every Acquire is typed, because it means Final Acquire. | `roles/laptop-cjay-step1.png`. | Label the figure "Markup price"; name the column "Final Acquire / unit" or show Acquire on the Costs step. |
| D4 | P3 | Someone who may not read the evaluation still gets "SOR PMS tab" and "Print" buttons in the header above "not yours to see". | Roles pass (Technical before being named, Finance, Warehouse). | Hide the header actions when the evaluation cannot be read. |

**Worked well:** the lock (Sales had no writable box after a Go); Unlock asks for a reason; each role sees only its own steps; Finance, Warehouse and an unnamed Technical are kept out; a deviation needs a remark before it counts; the confirm box before a Go shows the figures; no page-level sideways overflow at any size.

---

## App-wide (found on the way)

| ID | Sev | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| G1 | P2 | **The "What's New" popup comes back on every new browser.** It checks `user.last_seen_changelog_version`, but the signed-in user object has no such field, so the flag saved to the database is never read. Only the browser's own storage stops it. | `blocked-Final Acquire.png`. `ChangelogModal.jsx:27`, `employeeService.js` `getEmployeeByEmail`. | Map `last_seen_changelog_version` onto the user object (`lastSeenChangelogVersion`) and read that. |

---

## SORS

| ID | Sev | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| S1 | P1 | **The SOR history read times out for Sales.** `sales_opportunity_logs` for several SORs at once fails with HTTP 500 "canceling statement due to statement timeout" after 8 seconds as `dani@demo` (one SOR alone takes 0.3s). It runs on My work and the List; the "Waiting" column showed "—" on every row. The read rule calls `sor_visible_visit_ids()` and `sor_access_level()` once per row (2,473 rows). Same family as #1001. | Called directly with curl; `opportunityService.js:1770`, `:4753`; policy `sor_log_read`. | Work out the SORs the person can read once (a `(select ...)` or a small function) instead of per row, or read through an RPC that filters by SOR first. Check the plan on staging as a Sales user. |
| S2 | P1 | **The Overview and the Commission Dashboard read the old status field.** 22 of 146 SORs are on a Sales Flow, and their old `status` stays at Lead or Proposal Submitted while the flow stage moves. SOR-260 is at Notice to Proceed but counts as "Lead" in the Team opportunity radar; SOR-196 is Awarded in the List and "Proposal Submitted" in the Commission table; SOR-166 at Delivery counts as Lead. | `sors/desktop-list.png` against `sors/desktop-commission.png`. `EmployeeOpportunityMatrix.jsx:109-112`, `commission/PoolTab.jsx:187`. | Read the stage the List reads (the flow stage, with the old status only for SORs with no Sale Type). |
| S3 | P2 | **"Won" means three things.** The register header's "Won ₱54.6M" includes Awarded and PO Received. The Overview's win rate counts only Closed Won (0% for someone with 4 Awarded and 1 PO Received). The Commission Dashboard's "Won SORs 21 of 21" is any SOR with a Contract Date, including ones at Lead with ₱0.00 (SOR-73 at Lead adds ₱3.38M to the Realized pool). | `sors/desktop-overview.png`, `sors/desktop-commission.png`. | Decide one meaning of won and use it in all three; name the Commission count "With a Contract Date" if that is the rule. |
| S4 | P2 | **Rows cannot be told apart.** My work, Board cards and the Deleted view show the Sales Reference (S03204) where the SOR number should be, so SORs that share an S0 look the same (three "S03204 · Marikina City Government" rows in Deleted). The Commission table shows only the company: four rows read "The Office of Civil Defense". | `sors/dani-mywork.png`, `sors/desktop-deleted.png`, `sors/desktop-commission.png`. | Lead with the SOR number everywhere, Sales Reference second; add SOR number and project to the Commission table. |
| S5 | P2 | **Mark as Lost is offered on a flow that cannot take it.** On an Outright SOR the server refuses with "This flow has no Lost Stage. Add one in Flow Canvas." The message is a toast that is gone in about three seconds, the dialog stays as it was, and a Sales user cannot edit the flow. The delete confirm even advises "Mark as Lost instead". Related to #785. | `sors/lost-check-1200.png`, `sors/delete-dialog.png`. | Until #785 lands, turn the menu item off with the reason, or show the refusal inside the dialog and keep it there. |
| S6 | P2 | **"Opportunity" is still on screen**, against the wording rule in `CONTEXT.md`: "Register Opportunity", "The opportunity number is issued automatically", "Edit opportunity", "Delete opportunity", and "No opportunities" in empty Board columns. | `sors/register-1.png`, `sors/record-more-menu.png`. `OpportunityFormModal.jsx:441,453`, `SorModalHeader.jsx:437,492`, `summary/shared.jsx:275,302`. | Say SOR in all of them. |
| S7 | P2 | Register SOR: an empty submit shows the browser's own bubble, one field at a time (same pattern as #1000 B2). The text boxes have no label a screen reader can read, only a placeholder. Required marks are there. | `sors/register-empty-submit.png`. | Validate in the form and show every missing field at once; tie each label to its box. |
| S8 | P2 | A record's History tab says "Nothing outstanding" while its header says "Blocked: 1" and "Can't move on until one thing is done". | `sors/record-history.png`. `constants/journey.js:283`. | Count the stage's missing required fields in that line. |
| S9 | P3 | Mark as Lost has no label or required mark on the reason list. The delete confirm and the "More actions" menu are not exposed as a dialog and a menu to assistive tools. | `sors/mark-lost-dialog.png`, `sors/delete-dialog.png`. | Add "Reason *"; give them the dialog and menu roles. |
| S10 | P3 | The List and the Board show different counts with no filter on (144 and 145 SORs; 145 and 146 after the test SOR). The Board's count also does not follow the Sales Flow picked. Cause not traced; the one Closed Lost SOR is the likely difference. | Pass 1 output. | Use one count, and say what is left out. |
| S11 | P3 | List at 1920 wide: the headings "Sales Ref." and "Div." are cut ("SALES R…", "DI…"), and the "Blocked on" icon is clipped at the right edge of the Status column. | `sors/desktop-list.png`. | Widen the two columns a little; keep the icon inside the cell. |
| S12 | P3 | The Commission chart draws two months as one falling line, which reads as a decline. In the stage ribbon the next stage is fainter than the later ones. | `sors/desktop-commission.png`, `sors/record-stage-menu.png`. | Bars for monthly amounts; one style for all stages not yet reached. |
| S13 | P3 | The record says "Estimated value"; the List says "Expected value". | `sors/register-after.png`. | One name. |

**Worked well:** commission privacy (Sales sees her own ₱ and dots for the pool and for others); the commission formula and its "Try it" figures; the pool split adds up to the Sales fund; required marks on the Register form; "Other" as a lost reason makes the note required; the delete confirm explains it is an archive; the blocked stage ribbon names what is missing; no page-level sideways overflow at any size.

---

## Decisions and tickets

**Decided 2026-11-14**

1. A Go over the ABC is **allowed, with a warning**. It is not blocked. (A1)
2. **Only the decider list or a Super Admin decides a bid.** Someone who needs it is added to the list in Settings. (A4)
3. The "Before a Go" list **stays advice**; it is renamed so it does not read like a rule. (A5)
4. **Won has one meaning: the glossary's** (the flow's Won Stage and anything after it; Awarded or beyond for legacy SORs). The Commission Dashboard keeps ADR 0006 (Realized means a Contract Date) and its count is renamed "With a Contract Date". (S3)

**Spec #1031 and its tickets**

| Ticket | What | Findings |
|---|---|---|
| #1032 | Bid decision card: warn on a Go over the ABC, live figures, advice list | A1, A5, B1, B4, C5, C7 |
| #1033 | Only the decider list or a Super Admin decides a bid | A4 |
| #1034 | Final Acquire step shows and sets each part's Status | A2, C1 |
| #1035 | Specs step leads to the Technical page; bulk verdict is careful | A3, B5, C6 |
| #1036 | Go floor is honest about what it does not know | B3, B8, C3, C4 |
| #1037 | S0 Evaluation print follows One total | B2, C6, C9 |
| #1038 | S0 Evaluation fits a laptop and a phone | D1, D2, D3, D4 |
| #1039 | Number boxes: the mouse wheel changes nothing, figures are readable | C2, C8 |
| #1040 | S0 Evaluation list totals and one spelling of in-charge | B6, C6 |
| #1041 | What's New remembers on the account that it was seen | G1 |
| #1042 | SOR history read stops timing out for Sales | S1 |
| #1043 | SORS: one stage and one meaning of Won on every screen | S2, S3 |
| #1044 | SORS: the SOR number leads every row, and it says SOR | S4, S6, S13 |
| #1045 | Mark as Lost says no before you fill it in | S5, S9 |
| #1046 | Register SOR form names every missing field | S7 |
| #1047 | SORS small fixes: History line, counts, columns, chart, ribbon | S8, S10, S11, S12 |

**Not ticketed:** B7 (Final Acquire below Acquire with no flag) needs a word from the business first. B9 (a typed 0 counts as filled) is left as it is.
